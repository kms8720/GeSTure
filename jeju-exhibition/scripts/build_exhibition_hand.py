"""Blender builder. Read-only inputs: -- source.glb output.glb [legacy-donor.glb]."""
import bpy, bmesh, sys, os, json, math, hashlib
import numpy as np
from mathutils import Vector
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from graft_legacy_index import graft_index

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if not args:
    raise SystemExit('Usage: blender -b --python build_exhibition_hand.py -- source.glb [output.glb] [legacy-donor.glb]')
SOURCE=os.path.abspath(args[0])
OUT=args[1] if len(args)>1 else os.path.abspath('jeju-exhibition/public/models/hand_exhibition.glb')
OUT=os.path.abspath(OUT)
DONOR=os.path.abspath(args[2] if len(args)>2 else os.path.join(os.path.dirname(__file__),'../../virtual-hand-rigged-final/public/models/robot_hand_rig.glb'))
DONOR_RECORD=os.path.relpath(DONOR,os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))).replace('\\','/')
assert os.path.normcase(os.path.abspath(SOURCE)) != os.path.normcase(OUT), 'Output must not overwrite the source GLB'
assert os.path.normcase(DONOR) != os.path.normcase(OUT), 'Output must not overwrite the donor GLB'
WORK=os.path.abspath('data/model-work'); os.makedirs(WORK,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)
source=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=source; source.select_set(True)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
mesh=source.data
vertices=np.empty(len(mesh.vertices)*3,dtype=np.float32); mesh.vertices.foreach_get('co',vertices); vertices=vertices.reshape(-1,3)
tri=np.empty(len(mesh.loops),dtype=np.int32); mesh.loops.foreach_get('vertex_index',tri); tri=tri.reshape(-1,3)
uv=np.empty(len(mesh.loops)*2,dtype=np.float32); mesh.uv_layers.active.data.foreach_get('uv',uv); uv=uv.reshape(-1,3,2)
centers=vertices[tri].mean(axis=1); x,y,z=centers.T
_,weld_ids=np.unique(np.round(vertices,6),axis=0,return_inverse=True)
weld_tri=weld_ids[tri]
materials=list(mesh.materials)
for mat in materials:
    mat.name='Original porcelain · copper · graphite'
    for node in mat.node_tree.nodes:
        if node.type=='BSDF_PRINCIPLED':
            # Source baked emission washed out the sculptural shadows.
            node.inputs['Emission Strength'].default_value=0

# Anatomical landmarks picked from orthographic source renders, in Blender metres.
FINGERS={
 'pinky': {'points':[[-.345,.225,.270],[-.384,.245,.455],[-.405,.095,.575]],'radii':[.054,.043,.039],'angles':[.95,1.0,.7]},
 'ring': {'points':[[-.181,.25,.355],[-.207,.30,.586],[-.201,.20,.733]],'radii':[.060,.048,.043],'angles':[1.0,1.05,.75]},
 'middle': {'points':[[-.015,.26,.365],[-.006,.29,.606],[-.002,.18,.772]],'radii':[.064,.050,.047],'angles':[1.0,1.05,.75]},
 'index': {'points':[[.190,.235,.298],[.200,.23,.505],[.200,-.020,.590]],'radii':[.061,.048,.045],'angles':[1.08,1.36,1.08]},
 'thumb': {'points':[[.350,-.170,.070],[.405,-.215,.205]],'radii':[.053,.058],'angles':[.55,.80],'axis':[.50,-.866,0]},
}
thumb_base=np.array(FINGERS['thumb']['points'][0])
thumb_normal=np.array(FINGERS['thumb']['points'][1])-thumb_base; thumb_normal/=np.linalg.norm(thumb_normal)
front_palm_plate=(x>.10)&(x<.28)&(z<.32)&(y<.175)
labels=np.zeros(len(tri),dtype=np.int16)
region={
 'pinky': (x<-.270)&(z>.270),
 'ring': (x>=-.270)&(x<-.100)&(z>.355),
 'middle': (x>=-.100)&(x<.100)&(z>.365),
 'index': (x>=.100)&(x<.300)&(z>.298)&~front_palm_plate,
 'thumb': (x>=.285)&((centers-thumb_base)@thumb_normal>0),
}
segments=[('palm',None,None)]
for finger,cfg in FINGERS.items():
    points=np.array(cfg['points']); count=len(points)
    membership=np.zeros(len(tri),dtype=np.int16)
    # Cut at the hinge centres along each original phalanx's direction.
    for joint in range(1,count):
        direction=points[joint]-points[joint-1]; direction/=np.linalg.norm(direction)
        if finger=='index' and joint+1<count:
            outgoing=points[joint+1]-points[joint]; outgoing/=np.linalg.norm(outgoing)
            direction+=outgoing; direction/=np.linalg.norm(direction)
        membership[(centers-points[joint])@direction>0]=joint
    for seg in range(count):
        labels[region[finger] & (membership==seg)]=len(segments)
        segments.append((finger+'_'+['proximal','intermediate','distal'][seg],finger,seg))

palette=[(.32,.32,.32,1),(.9,.2,.2,1),(.2,.8,.2,1),(.2,.3,.9,1),(.8,.6,.1,1)]
root=bpy.data.objects.new('exhibition_hand',None); bpy.context.collection.objects.link(root)
pivots={}; rig={}; audit=[]; cut_checks=[]
for finger,cfg in FINGERS.items():
    if finger=='index': continue  # The legacy subtree supplies these exact pivots.
    parent=root; previous=Vector((0,0,0)); names=[]
    for j,point in enumerate(cfg['points']):
        ob=bpy.data.objects.new(finger+'_'+['base','middle','tip'][j]+'_pivot',None)
        bpy.context.collection.objects.link(ob); ob.parent=parent
        ob.location=Vector(point)-previous
        names.append(ob.name); pivots[(finger,j)]=ob; parent=ob; previous=Vector(point)
    axis=cfg.get('axis',[1,0,0]); threeaxis=[axis[0],axis[2],-axis[1]]
    rig[finger]={'pivots':names,'axes':[threeaxis]*len(names),'angles':cfg['angles']}

for label,(name,finger,joint) in enumerate(segments):
    if finger=='index': continue  # Exclude the source index and all its joint covers.
    owned=np.flatnonzero(labels==label)
    selected=owned
    # Carry complete crossing triangles into the knife operation, including UV
    # seam twins; centroid ownership alone creates open, saw-toothed cut loops.
    used=np.zeros(int(weld_ids.max())+1,dtype=bool); used[weld_tri[selected].ravel()]=True
    selected=np.flatnonzero(used[weld_tri].any(axis=1)); faces=tri[selected]
    unique,inverse=np.unique(faces,return_inverse=True)
    pivot=Vector(FINGERS[finger]['points'][joint]) if finger else Vector((0,0,0))
    data=bpy.data.meshes.new(name); data.from_pydata((vertices[unique]-np.array(pivot)).tolist(),[],inverse.reshape(-1,3).tolist()); data.update()
    layer=data.uv_layers.new(name='UVMap'); layer.data.foreach_set('uv',uv[selected].ravel())
    for mat in materials: data.materials.append(mat)
    ob=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(ob); ob.parent=pivots[(finger,joint)] if finger else root
    for poly in data.polygons: poly.use_smooth=True
    audit.append({'name':name,'source':'hand-color','sourceTriangles':len(owned),'sourceTriangleIdHash':hashlib.sha256(owned.astype('<i4').tobytes()).hexdigest(),'sourceVertexHash':hashlib.sha256(vertices[np.unique(tri[owned])].tobytes()).hexdigest()})
    # Preserve UV seams while reducing the 1.86M-triangle scan for live exhibition rendering.
    bpy.context.view_layer.objects.active=ob; source.select_set(False); ob.select_set(True)
    # Weld identical positions before simplification: glTF duplicates vertices at
    # UV seams, and independent decimation of those copies opens zipper cracks.
    bm=bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
    if finger:
        # Weld UV-split positions, then close exposed segmentation boundaries.
        # UV data stays per-loop; caps receive a separate dark interior material.
        # Trim a small kerf with true interpolated plane intersections. Cap only
        # the new cut boundaries, not pre-existing openings in the AI scan.
        points=[Vector(p) for p in FINGERS[finger]['points']]
        if finger=='thumb':
            own_axis=(points[joint+1]-points[joint]).normalized() if joint+1<len(points) else (points[joint]-points[joint-1]).normalized()
            planes=[(Vector((0,0,0)),own_axis,True)]
        else:
            planes=[(Vector((0,0,0)),(points[joint]-points[joint-1]).normalized() if joint else Vector((0,0,1)),True)]
        if joint+1<len(points): planes.append((points[joint+1]-pivot,(points[joint+1]-points[joint]).normalized(),False))
        for position,normal,inner in planes:
            kerf=.006
            position=position+normal*(kerf if inner else -kerf)
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=position,plane_no=normal,clear_inner=inner,clear_outer=not inner)
            edges=[edge for edge in bm.edges if edge.is_boundary and all(abs((v.co-position).dot(normal))<.0001 for v in edge.verts)]
            caps=bmesh.ops.holes_fill(bm,edges=edges,sides=0).get('faces',[])
            for face in caps:
                face.material_index=len(materials)
                face.smooth=False
            cut_checks.append({'segment':name,'atStart':inner,'capArea':sum(f.calc_area() for f in caps),'largestCapArea':max((f.calc_area() for f in caps),default=0),'remainingPlanarBoundaryEdges':sum(e.is_boundary for e in edges)})
    else:
        # Close only the palm side of the oblique thumb-neck cut. The complete
        # rounded CMC cup stays stationary; it is no longer split through its wall.
        for base_finger in ('thumb','index'):
            origin=Vector(FINGERS[base_finger]['points'][0])
            normal=Vector(thumb_normal) if base_finger=='thumb' else Vector((0,0,1))
            position=origin-normal*(.018 if base_finger=='index' else .006)
            faces=[f for f in bm.faces if all(abs(v.co.x-origin.x)<.10 and (v.co-origin).length<.16 and (base_finger!='index' or v.co.y>.175) for v in f.verts)]
            geom=set(faces)
            for face in faces: geom.update(face.edges); geom.update(face.verts)
            bmesh.ops.bisect_plane(bm,geom=list(geom),dist=.00001,plane_co=position,plane_no=normal,clear_inner=False,clear_outer=True)
            edges=[edge for edge in bm.edges if edge.is_boundary and all(abs((v.co-position).dot(normal))<.0001 and (v.co-origin).length<.16 for v in edge.verts)]
            for face in bmesh.ops.holes_fill(bm,edges=edges,sides=0).get('faces',[]): face.material_index=len(materials); face.smooth=False
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    modifier=ob.modifiers.new('Display mesh reduction','DECIMATE'); modifier.ratio=.18
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    ob.data.validate(clean_customdata=False)
    ob.data.update()
    ob.select_set(False)

bpy.data.objects.remove(source,do_unlink=True)
metal=bpy.data.materials.new('Joint · brushed dark titanium'); metal.diffuse_color=(.085,.075,.06,1); metal.use_nodes=True
bsdf=metal.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value=(.085,.075,.06,1); bsdf.inputs['Metallic'].default_value=.8; bsdf.inputs['Roughness'].default_value=.34
for ob in bpy.context.scene.objects:
    if ob.type=='MESH': ob.data.materials.append(metal)
for finger,cfg in FINGERS.items():
    if finger=='index': continue
    for j,radius in enumerate(cfg['radii']):
        # Small mechanical bearing cores conceal cut interiors when the shells rotate.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=radius*.85)
        ob=bpy.context.object; ob.name=finger+'_bearing_'+str(j); ob.parent=pivots[(finger,j)]; ob.location=(0,0,0); ob.scale=(1,.95,.95); ob.data.materials.append(metal)
        for face in ob.data.polygons: face.use_smooth=True
    points=[Vector(p) for p in cfg['points']]
    # Machined collars cover scan-cut edges with a deliberate, closed housing.
    for j,point in enumerate(points):
        normal=(points[j]-points[j-1]).normalized() if j else (points[1]-point).normalized()
        for owner,position in [(j,Vector((0,0,0)))]+([(j-1,point-points[j-1])] if j else []):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=cfg['radii'][j]*1.12,depth=.048)
            cuff=bpy.context.object; cuff.name=finger+'_joint_collar_'+str(j)+'_'+str(owner)
            cuff.parent=pivots[(finger,owner)]; cuff.location=position
            cuff.rotation_euler=normal.to_track_quat('Z','Y').to_euler(); cuff.data.materials.append(metal)
            bevel=cuff.modifiers.new('Machined edge','BEVEL'); bevel.width=.006; bevel.segments=3
            bpy.context.view_layer.objects.active=cuff; bpy.ops.object.modifier_apply(modifier=bevel.name)
            for face in cuff.data.polygons: face.use_smooth=True
# Keep the donor's three meshes and pivot-local transforms untouched. A common
# uniform transform is the only geometric alignment applied to the entire index.
existing=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=DONOR)
imported=set(bpy.context.scene.objects)-existing
donor_base=next(o for o in imported if o.name=='index_base_pivot')
donor_objects={donor_base,*donor_base.children_recursive}
assert {o.name for o in donor_objects}=={'index_base_pivot','index_middle_pivot','index_tip_pivot','index_03','index_02','index_01'}
for ob in imported-donor_objects: bpy.data.objects.remove(ob,do_unlink=True)
alignment=bpy.data.objects.new('legacy_index_alignment',None); bpy.context.collection.objects.link(alignment); alignment.parent=root
alignment_scale=.97
alignment.scale=(alignment_scale,)*3
alignment.location=Vector(FINGERS['index']['points'][0])-donor_base.location*alignment_scale
donor_base.parent=alignment
index_names=['index_base_pivot','index_middle_pivot','index_tip_pivot']
for j,name in enumerate(index_names): pivots[('index',j)]=bpy.data.objects[name]
rig['index']={'pivots':index_names,'axes':[[1,0,0]]*3,'angles':FINGERS['index']['angles']}

assert len(labels)==len(tri) and len(audit)==12
assert all(e['sourceTriangles']>100 for e in audit)
assert all(math.isfinite(c['capArea']) and c['largestCapArea']<.03 for c in cut_checks), 'Unexpected oversized cut cap'
bpy.context.view_layer.update()
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
metadata={'version':2,'sourceSha256':hashlib.sha256(open(SOURCE,'rb').read()).hexdigest(),'fingers':rig,'sourceTriangles':len(tri),'displayTriangles':sum(len(p.vertices)-2 for o in objects for p in o.data.polygons),'segments':audit,'cutChecks':cut_checks,
 'legacyIndex':{'sourceSha256':hashlib.sha256(open(DONOR,'rb').read()).hexdigest(),'sourcePath':DONOR_RECORD,'sourceNodes':['index_03','index_02','index_01'],'outputNodes':['index_03','index_02','index_01'],'alignmentNode':alignment.name,'uniformScale':alignment_scale},
 'notes':['Palm, thumb, middle, ring and pinky retain the original hand-color geometry and UV maps.','Index is the unchanged legacy index subtree: three meshes, materials and local pivot transforms copied exactly from the donor GLB.','Only one common uniform scale and translation align the donor index to the current palm.','Thumb cup stays with the palm; the moving chain starts at the oblique neck.','Hand-color ownership audited before crossing-face halo, local seam trimming and mesh reduction.','Small bearing cores and beveled collars on the four source fingers are exhibition geometry, not manufacturing CAD.']}
os.makedirs(os.path.dirname(OUT),exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
# Blender imports are retained in the editable file and renders. The distributed
# GLB gets the original donor bytes, bypassing Blender's geometry re-export.
for ob in donor_objects: ob.select_set(False)
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
metadata['segments'].extend(graft_index(OUT,DONOR))
with open(OUT.replace('.glb','.rig.json'),'w',encoding='utf8') as f: json.dump(metadata,f,ensure_ascii=False,indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK,'hand_exhibition.blend'))

# Gallery validation renders of the exact exported rig at extension and flexion.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.render.resolution_x=1100; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.world.color=(.12,.12,.12)
target=Vector((0,0,0)); distance=2.5
for pos,power,size in [((2,-3,4),500,3),((-3,-1,1),300,2),((1,3,3),650,2)]:
    bpy.ops.object.light_add(type='AREA',location=pos); ob=bpy.context.object; ob.data.energy=power; ob.data.shape='DISK'; ob.data.size=size; ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-5,.2)); camera=bpy.context.object; scene.camera=camera; camera.data.type='ORTHO'; camera.data.ortho_scale=2.35; camera.rotation_euler=(Vector((0,0,.05))-camera.location).to_track_quat('-Z','Y').to_euler()
initial={key:ob.rotation_euler.copy() for key,ob in pivots.items()}
for state,flex in [('open',0),('half',.5),('closed',1),('thumb_only',1),('index_only',1)]:
    for (finger,j),ob in pivots.items():
        ob.rotation_mode='QUATERNION'; axis=Vector(FINGERS[finger].get('axis',[1,0,0])); from mathutils import Quaternion
        amount=0 if state.endswith('_only') and not state.startswith(finger) else flex
        ob.rotation_quaternion=initial[(finger,j)].to_quaternion()@Quaternion(axis,FINGERS[finger]['angles'][j]*amount)
    scene.render.filepath=os.path.join(WORK,'rig_'+state+'.png'); bpy.ops.render.render(write_still=True)
print('RIG_COMPLETE',json.dumps(metadata))
