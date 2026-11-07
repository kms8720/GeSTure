import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FingerName, HandState, Orientation } from '../socket/types';

const MODEL_PATH = '/models/hand_exhibition.glb';
const RIG_PATH = '/models/hand_exhibition.rig.json';
const HEIGHT = 4.6;
const FLOOR = -2.4;
type Rig = { fingers: Record<FingerName, { pivots: string[]; axes: [number, number, number][]; angles: number[] }> };

function Hand({ handState }: { handState: HandState })
{
  const gltf = useLoader(GLTFLoader, MODEL_PATH);
  const rigText = useLoader(THREE.FileLoader, RIG_PATH) as string;
  const invalidate = useThree((state) => state.invalidate);
  const { model, scale, offset, pivots } = useMemo(() =>
  {
    const rig = JSON.parse(rigText) as Rig;
    // Rigid, individually segmented meshes; the export does not contain a skin.
    const model = gltf.scene.clone(true);
    model.traverse((object) =>
    {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = HEIGHT / size.y;
    const offset: [number, number, number] = [-center.x * scale, FLOOR - bounds.min.y * scale, -center.z * scale];
    const pivots = (Object.entries(rig.fingers) as [FingerName, Rig['fingers'][FingerName]][]).flatMap(([finger, config]) =>
      config.pivots.map((name, index) =>
      {
        const object = model.getObjectByName(name);
        if (!object) throw new Error(`Missing hand joint: ${name}`);
        return { finger, object, rest: object.quaternion.clone(),
          axis: new THREE.Vector3(...config.axes[index]).normalize(), angle: config.angles[index],
          target: new THREE.Quaternion(), rotation: new THREE.Quaternion() };
      })
    );
    return { model, scale, offset, pivots };
  }, [gltf.scene, rigText]);
  useEffect(() => invalidate(), [handState, invalidate, model]);
  useFrame((_state, delta) =>
  {
    let moving = false;
    for (const pivot of pivots)
    {
      const flex = 1 - THREE.MathUtils.clamp(handState[pivot.finger] / 100, 0, 1);
      pivot.rotation.setFromAxisAngle(pivot.axis, pivot.angle * flex);
      pivot.target.copy(pivot.rest).multiply(pivot.rotation);
      pivot.object.quaternion.slerp(pivot.target, 1 - Math.exp(-9 * Math.min(delta, 0.1)));
      if (pivot.object.quaternion.angleTo(pivot.target) > 0.0002) moving = true;
      else pivot.object.quaternion.copy(pivot.target);
    }
    // Stop using the GPU continuously once the sculpture is stationary.
    if (moving) invalidate();
  });
  return <group position={offset} scale={scale}><primitive object={model} /></group>;
}

function CameraFraming()
{
  const { camera, size, invalidate } = useThree();
  useEffect(() =>
  {
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tangent = Math.tan(THREE.MathUtils.degToRad(perspective.fov * 0.5));
    perspective.position.set(0, 0.05, Math.max((HEIGHT * 0.5 + 0.5) / tangent, 1.85 / (tangent * aspect)));
    perspective.lookAt(0, -0.05, 0);
    perspective.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  return null;
}

function Gallery({ handState }: { handState: HandState })
{
  return <>
    <color attach="background" args={['#111210']} />
    <fog attach="fog" args={['#111210', 13, 30]} />
    <CameraFraming />
    <ambientLight intensity={0.22} />
    <hemisphereLight intensity={0.55} color="#eee5d6" groundColor="#242522" />
    <spotLight position={[-3.5, 6, 5]} intensity={105} angle={0.48} penumbra={1} color="#ffe7c5" castShadow
      shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002} shadow-normalBias={0.025} />
    <spotLight position={[4, 3, -2]} intensity={95} angle={0.6} penumbra={1} color="#dde5e0" />
    <directionalLight position={[2, 1, 5]} intensity={0.8} color="#efe8dc" />
    <Environment resolution={128}>
      <Lightformer form="rect" intensity={2.5} color="#fff1db" position={[-4, 3, 4]} scale={[3, 6, 1]} rotation={[0, Math.PI / 4, 0]} />
      <Lightformer form="rect" intensity={1.6} color="#e0e5e1" position={[4, 2, 1]} scale={[2, 5, 1]} rotation={[0, -Math.PI / 3, 0]} />
      <Lightformer form="rect" intensity={1} position={[0, 5, -1]} scale={[5, 2, 1]} rotation={[Math.PI / 2, 0, 0]} />
    </Environment>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR - 0.08, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#171916" roughness={0.95} />
    </mesh>
    <mesh position={[0, FLOOR - 0.045, 0]} receiveShadow>
      <cylinderGeometry args={[1.35, 1.38, 0.07, 64]} />
      <meshStandardMaterial color="#282a25" roughness={0.65} metalness={0.25} />
    </mesh>
    <Hand handState={handState} />
  </>;
}

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }>
{
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render()
  {
    return this.state.failed
      ? <div className="offline-banner" role="alert">손을 불러오지 못했습니다. 운영자에게 알려주세요.</div>
      : this.props.children;
  }
}

export default function VirtualHand({ handState }: {
  handState: HandState; orientation: Orientation | null; framing?: 'portrait' | 'landscape';
})
{
  return <div className="hand-stage" aria-label="다섯 관객의 움직임으로 완성되는 손">
    <ModelBoundary>
      <Suspense fallback={<div className="offline-banner" role="status">손을 준비하고 있습니다</div>}>
        <Canvas shadows={{ type: THREE.PCFShadowMap }} frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 0.05, 10], fov: 34 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
          <Gallery handState={handState} />
        </Canvas>
      </Suspense>
    </ModelBoundary>
  </div>;
}
