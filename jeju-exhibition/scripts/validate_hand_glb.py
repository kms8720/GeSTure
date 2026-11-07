"""Validate the exhibition rig contract. No Blender or third-party modules needed."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct

LEGACY_INDEX_NODES = ('index_base_pivot', 'index_middle_pivot', 'index_tip_pivot', 'index_03', 'index_02', 'index_01')
LEGACY_INDEX_PARTS = {'index_03': 36870, 'index_02': 33885, 'index_01': 6106}
DEFAULT_DONOR = Path(__file__).resolve().parents[2] / 'virtual-hand-rigged-final/public/models/robot_hand_rig.glb'


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and length == len(data), 'Invalid GLB header'
    offset, document, binary = 12, None, None
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        assert len(chunk) == size, 'Truncated chunk'
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += size + 8
    assert document is not None and binary is not None
    return document, binary


def texture_hashes(gltf, binary, material):
    hashes = {}
    for role, reference in list(material.items()) + list(material.get('pbrMetallicRoughness', {}).items()):
        if role.endswith('Texture') and isinstance(reference, dict) and 'index' in reference:
            image = gltf['images'][gltf['textures'][reference['index']]['source']]
            view = gltf['bufferViews'][image['bufferView']]
            offset = view.get('byteOffset', 0)
            hashes[role] = hashlib.sha256(binary[offset:offset+view['byteLength']]).hexdigest()
    return hashes


def accessor_fingerprint(gltf, binary, index):
    accessor = gltf['accessors'][index]
    assert 'sparse' not in accessor, 'Sparse donor accessor needs an explicit value decoder'
    size = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[accessor['componentType']]
    width = size * {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[accessor['type']]
    view = gltf['bufferViews'][accessor['bufferView']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', width)
    values = b''.join(binary[offset+i*stride:offset+i*stride+width] for i in range(accessor['count']))
    assert len(values) == accessor['count'] * width, 'Truncated donor accessor'
    return {'componentType': accessor['componentType'], 'type': accessor['type'],
            'count': accessor['count'], 'normalized': accessor.get('normalized', False),
            'sha256': hashlib.sha256(values).hexdigest()}


def material_fingerprint(gltf, binary, index):
    # Resolve numeric references so relocation/deduplication cannot hide a changed map or sampler.
    def canonicalize(value):
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        if not isinstance(value, dict):
            return value
        result = {}
        for key, child in value.items():
            if key.endswith('Texture') and isinstance(child, dict) and 'index' in child:
                texture = copy.deepcopy(gltf['textures'][child['index']])
                image = gltf['images'][texture.pop('source')]
                assert 'bufferView' in image, 'Donor texture must be embedded'
                view = gltf['bufferViews'][image['bufferView']]
                start = view.get('byteOffset', 0)
                image_bytes = binary[start:start+view['byteLength']]
                sampler = texture.pop('sampler', None)
                resolved = {'imageSha256': hashlib.sha256(image_bytes).hexdigest(),
                            'mimeType': image['mimeType'],
                            'sampler': gltf.get('samplers', [])[sampler] if sampler is not None else None,
                            'textureProperties': texture}
                result[key] = {**{k: canonicalize(v) for k, v in child.items() if k != 'index'}, 'resolved': resolved}
            else:
                result[key] = canonicalize(child)
        return result
    return canonicalize(gltf['materials'][index])


def validate_legacy_index(gltf, binary, rig, donor):
    original, original_binary = read_glb(donor)
    origin = {node['name']: node for node in original['nodes'] if 'name' in node}
    actual = {node['name']: node for node in gltf['nodes'] if 'name' in node}
    assert {name for name in actual if name.startswith('index_')} == set(LEGACY_INDEX_NODES), 'Obsolete or extra index geometry remains'
    contract = rig['legacyIndex']
    assert hashlib.sha256(donor.read_bytes()).hexdigest() == contract['sourceSha256'], 'Legacy donor changed'
    assert contract['sourceNodes'] == contract['outputNodes'] == list(LEGACY_INDEX_PARTS)
    defaults = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1], 'matrix': None}
    donor_parts = {s['name']: s for s in rig['segments'] if s['source'] == 'legacy-index'}
    for name in LEGACY_INDEX_NODES:
        before, after = origin[name], actual[name]
        for prop, default in defaults.items():
            assert before.get(prop, default) == after.get(prop, default), f'Donor local {prop} changed: {name}'
        expected_children = [original['nodes'][i]['name'] for i in before.get('children', [])]
        actual_children = [gltf['nodes'][i]['name'] for i in after.get('children', [])]
        assert sorted(expected_children) == sorted(actual_children), f'Donor hierarchy changed: {name}'
        assert ('mesh' in before) == ('mesh' in after) and 'skin' not in after
        if 'mesh' not in before:
            continue
        old_primitives = original['meshes'][before['mesh']]['primitives']
        new_primitives = gltf['meshes'][after['mesh']]['primitives']
        assert len(old_primitives) == len(new_primitives) == 1
        old, new = old_primitives[0], new_primitives[0]
        assert old.get('mode', 4) == new.get('mode', 4) == 4
        assert set(old['attributes']) == set(new['attributes']), f'Donor attributes changed: {name}'
        assert not old.get('targets') and not new.get('targets'), 'Unexpected index deformation targets'
        for role, index in {**old['attributes'], 'INDICES': old['indices']}.items():
            new_index = new['indices'] if role == 'INDICES' else new['attributes'][role]
            assert accessor_fingerprint(original, original_binary, index) == accessor_fingerprint(gltf, binary, new_index), f'Donor {role} values changed: {name}'
            view = original['bufferViews'][original['accessors'][index]['bufferView']]
            offset = view.get('byteOffset', 0)
            assert hashlib.sha256(original_binary[offset:offset+view['byteLength']]).hexdigest() == donor_parts[name]['sourceBufferViewHashes'][role]
        assert material_fingerprint(original, original_binary, old['material']) == material_fingerprint(gltf, binary, new['material']), f'Donor material changed: {name}'
        assert original['accessors'][old['indices']]['count'] // 3 == donor_parts[name]['sourceTriangles'] == LEGACY_INDEX_PARTS[name]
        assert donor_parts[name]['sourceNode'] == name

    parents = {gltf['nodes'][child]['name']: node['name'] for node in gltf['nodes'] for child in node.get('children', [])}
    alignment_name = contract['alignmentNode']
    assert alignment_name == 'legacy_index_alignment' and parents['index_base_pivot'] == alignment_name
    alignment = actual[alignment_name]
    assert [gltf['nodes'][i]['name'] for i in alignment.get('children', [])] == ['index_base_pivot']
    assert 'matrix' not in alignment and 'mesh' not in alignment, 'Explicit placement TRS expected'
    scale = alignment.get('scale', [1, 1, 1])
    assert len(scale) == 3 and all(math.isfinite(v) and v > 0 for v in scale)
    assert max(scale) - min(scale) < 1e-7, 'Legacy index placement must use uniform scale'
    assert abs(scale[0] - contract['uniformScale']) < 1e-7
    rotation = alignment.get('rotation', [0, 0, 0, 1])
    assert len(rotation) == 4 and abs(sum(v*v for v in rotation) - 1) < 1e-6
    translation = alignment.get('translation', [0, 0, 0])
    assert len(translation) == 3 and all(math.isfinite(v) for v in translation)
    config = rig['fingers']['index']
    assert config['pivots'] == list(LEGACY_INDEX_NODES[:3])
    assert config['axes'] == [[1, 0, 0]] * 3 and config['angles'] == [1.08, 1.36, 1.08]
    return sum(LEGACY_INDEX_PARTS.values())


def validate(model, metadata, source=None, donor=DEFAULT_DONOR):
    gltf, binary = read_glb(model)
    rig = json.loads(metadata.read_text(encoding='utf-8'))
    assert rig['version'] == 2, 'Expected the mixed-source exhibition rig'
    expected_fingers = {'thumb', 'index', 'middle', 'ring', 'pinky'}
    assert set(rig['fingers']) == expected_fingers
    if source:
        assert hashlib.sha256(source.read_bytes()).hexdigest() == rig['sourceSha256'], 'Original changed'
    nodes = gltf['nodes']
    by_name = {node.get('name'): i for i, node in enumerate(nodes)}
    assert len(by_name) == len(nodes), 'Duplicate node names'
    parent = {}
    for i, node in enumerate(nodes):
        for key in ('translation', 'rotation', 'scale', 'matrix'):
            assert all(math.isfinite(value) for value in node.get(key, []))
        for child in node.get('children', []):
            assert child not in parent, 'Node has multiple parents'
            parent[child] = i
    for start in range(len(nodes)):
        seen, current = set(), start
        while current in parent:
            assert current not in seen, 'Hierarchy cycle'
            seen.add(current)
            current = parent[current]

    for finger, config in rig['fingers'].items():
        names, axes, angles = config['pivots'], config['axes'], config['angles']
        assert len(names) == len(axes) == len(angles) == (2 if finger == 'thumb' else 3)
        for i, name in enumerate(names):
            assert name in by_name and name.startswith(finger + '_'), f'Missing pivot {name}'
            assert abs(sum(v*v for v in axes[i]) - 1) < 0.002, f'Non-unit axis {name}'
            assert math.isfinite(angles[i]) and 0 < angles[i] < math.pi
            if i:
                assert parent[by_name[name]] == by_name[names[i-1]], f'Broken chain {name}'

    segments = rig['segments']
    assert len(segments) == 15
    scanned = [s for s in segments if s['source'] == 'hand-color']
    reused = [s for s in segments if s['source'] == 'legacy-index']
    assert len(scanned) == 12 and {s['name'] for s in reused} == set(LEGACY_INDEX_PARTS)
    expected_scanned = {'palm', 'thumb_proximal', 'thumb_intermediate'} | {
        finger + '_' + part for finger in ('pinky', 'ring', 'middle') for part in ('proximal', 'intermediate', 'distal')}
    assert {s['name'] for s in scanned} == expected_scanned, 'Missing retained hand-color part'
    assert len({s['sourceTriangleIdHash'] for s in scanned}) == len(scanned)
    assert len({s['sourceVertexHash'] for s in scanned}) == len(scanned)
    assert 0 < sum(s['sourceTriangles'] for s in scanned) < rig['sourceTriangles']
    assert all(s['sourceTriangles'] > 100 and s['name'] in by_name for s in segments)
    segment_hashes = []
    face_count = 0
    for segment in segments:
        node = nodes[by_name[segment['name']]]
        mesh = gltf['meshes'][node['mesh']]
        digest = hashlib.sha256()
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            assert {'POSITION', 'NORMAL', 'TEXCOORD_0'} <= attrs.keys(), 'Missing texture/normal data'
            assert primitive.get('mode', 4) == 4, 'Expected triangle meshes'
            count = gltf['accessors'][primitive['indices']]['count']
            assert count > 0 and count % 3 == 0
            face_count += count // 3
            accessor = gltf['accessors'][attrs['POSITION']]
            assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
            view = gltf['bufferViews'][accessor['bufferView']]
            offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            for i in range(accessor['count']):
                raw = binary[offset+i*stride:offset+i*stride+12]
                assert len(raw) == 12 and all(math.isfinite(x) for x in struct.unpack('<3f', raw))
                digest.update(raw)
        segment_hashes.append(digest.hexdigest())
    assert len(set(segment_hashes)) == len(segments), 'Duplicated segment geometry'

    assert donor is not None, 'Legacy donor path is required'
    legacy_triangles = validate_legacy_index(gltf, binary, rig, donor)

    palm = nodes[by_name['palm']]
    material_index = gltf['meshes'][palm['mesh']]['primitives'][0]['material']
    material = gltf['materials'][material_index]
    pbr = material['pbrMetallicRoughness']
    assert 'baseColorTexture' in pbr and 'metallicRoughnessTexture' in pbr and 'normalTexture' in material
    assert len(gltf.get('images', [])) >= 3
    for image in gltf['images']:
        assert 'bufferView' in image, 'Texture must be embedded for offline exhibition'
        view = gltf['bufferViews'][image['bufferView']]
        assert view['byteLength'] > 0
    assert not gltf.get('skins'), 'Rigid rig expected; skinned models need SkeletonUtils.clone'
    if source:
        source_gltf, source_binary = read_glb(source)
        assert sum(source_gltf['accessors'][p['indices']]['count'] // 3 for m in source_gltf['meshes'] for p in m['primitives']) == rig['sourceTriangles']
        assert texture_hashes(source_gltf, source_binary, source_gltf['materials'][0]) == texture_hashes(gltf, binary, material), 'Source texture changed or missing'
    print(json.dumps({'result':'PASS', 'pivots':14, 'distinctSegments':len(segments),
                      'handColorPartitionTriangles':sum(s['sourceTriangles'] for s in scanned),
                      'legacyIndexTriangles':legacy_triangles, 'legacyIndexByteExact':True,
                      'outputShellTriangles':face_count, 'embeddedTextures':len(gltf['images']),
                      'originalHashVerified':source is not None, 'donorHashVerified':True}, indent=2))
    print('Source hashes audit provenance; they do not prove mesh intersection clearance.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=Path(__file__).resolve().parents[1] / 'public/models/hand_exhibition.glb')
    parser.add_argument('--source', type=Path, help='Read-only original GLB, for checksum verification')
    parser.add_argument('--donor', type=Path, default=DEFAULT_DONOR, help='Read-only legacy index donor')
    args = parser.parse_args()
    validate(args.model, args.model.with_suffix('.rig.json'), args.source, args.donor)
