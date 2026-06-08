import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { socket } from '../socket/socket';
import { HandState, FingerName, VirtualSkeleton, VirtualSkeletonPoint } from '../socket/types';

type LoadedGLTF = {
  scene: THREE.Group;
};

type Axis = 'x' | 'y' | 'z';

type FingerRigConfig = {
  pivots: string[];
  angles: number[];
  axis: Axis;
  direction: 1 | -1;
};

type PivotRecord = {
  object: THREE.Object3D;
  initialRotation: THREE.Euler;
};

type FingerLandmarkNames = {
  base: string;
  middle?: string;
  tip: string;
};

const DEBUG_PIVOTS = false;

const MODEL_PATH = '/models/robot_hand_rig.glb';

const FINGER_RIGS: Record<FingerName, FingerRigConfig> = {
  thumb: {
    pivots: ['thumb_base_pivot', 'thumb_tip_pivot'],
    // 엄지는 화면 앞뒤 방향으로 접히면 안 되므로 x축이 아니라 z축으로 접는다.
    // thumb 값이 100이면 화면 기준 왼쪽, 즉 손바닥 안쪽으로 들어오도록 설정한다.
    angles: [0.82, 1.02],
    axis: 'z',
    direction: 1
  },
  index: {
    pivots: ['index_base_pivot', 'index_middle_pivot', 'index_tip_pivot'],
    // 기존 -x 방향은 화면 뒤쪽으로 꺾였으므로 +x 방향으로 변경한다.
    // 100까지 올렸을 때 주먹에 가까운 강한 굽힘이 나오도록 각도를 키웠다.
    angles: [1.08, 1.36, 1.08],
    axis: 'x',
    direction: 1
  },
  middle: {
    pivots: ['middle_base_pivot', 'middle_middle_pivot', 'middle_tip_pivot'],
    angles: [1.04, 1.32, 1.04],
    axis: 'x',
    direction: 1
  },
  ring: {
    pivots: ['ring_base_pivot', 'ring_middle_pivot', 'ring_tip_pivot'],
    angles: [1.08, 1.36, 1.08],
    axis: 'x',
    direction: 1
  },
  pinky: {
    pivots: ['pinky_base_pivot', 'pinky_middle_pivot', 'pinky_tip_pivot'],
    angles: [1.12, 1.4, 1.1],
    axis: 'x',
    direction: 1
  }
};

const FINGER_LANDMARKS: Record<FingerName, FingerLandmarkNames> = {
  thumb: {
    base: 'thumb_base_pivot',
    tip: 'thumb_tip_pivot'
  },
  index: {
    base: 'index_base_pivot',
    middle: 'index_middle_pivot',
    tip: 'index_tip_pivot'
  },
  middle: {
    base: 'middle_base_pivot',
    middle: 'middle_middle_pivot',
    tip: 'middle_tip_pivot'
  },
  ring: {
    base: 'ring_base_pivot',
    middle: 'ring_middle_pivot',
    tip: 'ring_tip_pivot'
  },
  pinky: {
    base: 'pinky_base_pivot',
    middle: 'pinky_middle_pivot',
    tip: 'pinky_tip_pivot'
  }
};

const WRIST_PIVOT_NAME = 'palm_wrist';
const SKELETON_EMIT_INTERVAL_SEC = 0.18;

function clamp01(value: number): number
{
  return Math.max(0, Math.min(1, value));
}

function enhanceModel(scene: THREE.Object3D): void
{
  scene.traverse((child) =>
  {
    const mesh = child as THREE.Mesh;

    if (!mesh.isMesh)
    {
      return;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (Array.isArray(mesh.material))
    {
      mesh.material.forEach((material) =>
      {
        material.needsUpdate = true;
      });
    }
    else if (mesh.material)
    {
      mesh.material.needsUpdate = true;
    }
  });
}

function PivotDebug({ object }: { object: THREE.Object3D })
{
  if (!DEBUG_PIVOTS)
  {
    return null;
  }

  const worldPosition = new THREE.Vector3();
  object.getWorldPosition(worldPosition);

  return (
    <group position={worldPosition}>
      <mesh>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color="#ff4d6d" />
      </mesh>
      <axesHelper args={[0.18]} />
    </group>
  );
}

function RoboticHandModel({ handState }: { handState: HandState })
{
  const gltf = useLoader(GLTFLoader, MODEL_PATH) as LoadedGLTF;
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const pivotsRef = useRef<Map<string, PivotRecord>>(new Map());
  const lastSkeletonEmitRef = useRef(0);
  const reportedSkeletonIssueRef = useRef(false);

  useEffect(() =>
  {
    enhanceModel(model);

    const nextPivotMap = new Map<string, PivotRecord>();

    Object.values(FINGER_RIGS).forEach((rig) =>
    {
      rig.pivots.forEach((pivotName) =>
      {
        const pivot = model.getObjectByName(pivotName);

        if (pivot)
        {
          nextPivotMap.set(pivotName, {
            object: pivot,
            initialRotation: pivot.rotation.clone()
          });
        }
        else
        {
          console.warn(`[VirtualHand] pivot not found: ${pivotName}`);
        }
      });
    });

    const wristPivot = model.getObjectByName(WRIST_PIVOT_NAME);
    if (wristPivot)
    {
      nextPivotMap.set(WRIST_PIVOT_NAME, {
        object: wristPivot,
        initialRotation: wristPivot.rotation.clone()
      });
    }
    else
    {
      console.warn(`[VirtualHand] pivot not found: ${WRIST_PIVOT_NAME}`);
    }

    pivotsRef.current = nextPivotMap;
  }, [model]);

  useEffect(() =>
  {
    if (pivotsRef.current.size === 0)
    {
      return;
    }

    applyFingerRotations(pivotsRef.current, handState, true);
    model.updateMatrixWorld(true);
    emitVirtualSkeleton(model);
  }, [model, handState]);

  useFrame((state, delta) =>
  {
    applyFingerRotations(pivotsRef.current, handState, false, delta);

    if (state.clock.elapsedTime - lastSkeletonEmitRef.current >= SKELETON_EMIT_INTERVAL_SEC)
    {
      model.updateMatrixWorld(true);
      const emitted = emitVirtualSkeleton(model);
      if (emitted)
      {
        lastSkeletonEmitRef.current = state.clock.elapsedTime;
      }
      else if (!reportedSkeletonIssueRef.current)
      {
        reportedSkeletonIssueRef.current = true;
        console.warn(`[VirtualHand] virtual skeleton unavailable; missing: ${missingVirtualSkeletonObjects(model).join(', ') || 'unknown'}`);
      }
    }
  });

  const debugPivots = Array.from(pivotsRef.current.values()).map((record) => (
    <PivotDebug key={record.object.uuid} object={record.object} />
  ));

  return (
    <group scale={2.65} position={[0, 0, 0]} rotation={[0, 0, 0]}>
      <group position={[0.3, 0.07, -0.17]}>
        <primitive object={model} />
      </group>
      {debugPivots}
    </group>
  );
}

function applyFingerRotations(
  pivots: Map<string, PivotRecord>,
  handState: HandState,
  immediate: boolean,
  delta = 0,
): void
{
  (Object.entries(FINGER_RIGS) as Array<[FingerName, FingerRigConfig]>).forEach(([finger, rig]) =>
  {
    const normalized = clamp01((100 - handState[finger]) / 100);

    rig.pivots.forEach((pivotName, index) =>
    {
      const pivotRecord = pivots.get(pivotName);

      if (!pivotRecord)
      {
        return;
      }

      const baseRotation = pivotRecord.initialRotation[rig.axis];
      const targetRotation = baseRotation + rig.angles[index] * normalized * rig.direction;
      pivotRecord.object.rotation[rig.axis] = immediate
        ? targetRotation
        : THREE.MathUtils.damp(pivotRecord.object.rotation[rig.axis], targetRotation, 8.5, delta);
    });
  });
}

function emitVirtualSkeleton(model: THREE.Object3D): boolean
{
  const skeleton = buildVirtualSkeleton(model);
  if (!skeleton)
  {
    return false;
  }

  (window as typeof window & { __ACC_VIRTUAL_SKELETON__?: VirtualSkeleton }).__ACC_VIRTUAL_SKELETON__ = skeleton;
  socket.emit('virtual:skeleton', skeleton);
  return true;
}

function buildVirtualSkeleton(model: THREE.Object3D): VirtualSkeleton | null
{
  const wrist = getWorldPoint(model, WRIST_PIVOT_NAME);
  if (!wrist)
  {
    return null;
  }

  const thumb = buildThumbLandmarks(model, wrist);
  const index = buildFingerLandmarks(model, FINGER_LANDMARKS.index);
  const middle = buildFingerLandmarks(model, FINGER_LANDMARKS.middle);
  const ring = buildFingerLandmarks(model, FINGER_LANDMARKS.ring);
  const pinky = buildFingerLandmarks(model, FINGER_LANDMARKS.pinky);

  if (!thumb || !index || !middle || !ring || !pinky)
  {
    return null;
  }

  return {
    source: 'virtual-hand-rigged-final',
    handedness: 'Right',
    points: [
      toPoint(wrist),
      ...thumb.map(toPoint),
      ...index.map(toPoint),
      ...middle.map(toPoint),
      ...ring.map(toPoint),
      ...pinky.map(toPoint)
    ],
    timestamp: new Date().toISOString()
  };
}

function buildThumbLandmarks(model: THREE.Object3D, wrist: THREE.Vector3): THREE.Vector3[] | null
{
  const base = getWorldPoint(model, FINGER_LANDMARKS.thumb.base);
  const tip = getWorldPoint(model, FINGER_LANDMARKS.thumb.tip);
  if (!base || !tip)
  {
    return null;
  }

  const baseToTip = tip.clone().sub(base);
  const extendedTip = tip.clone().add(baseToTip.clone().multiplyScalar(0.38));
  return [
    base.clone().lerp(wrist, 0.22),
    base,
    base.clone().lerp(tip, 0.56),
    extendedTip
  ];
}

function buildFingerLandmarks(model: THREE.Object3D, names: FingerLandmarkNames): THREE.Vector3[] | null
{
  const base = getWorldPoint(model, names.base);
  const middle = names.middle ? getWorldPoint(model, names.middle) : null;
  const tip = getWorldPoint(model, names.tip);
  if (!base || !middle || !tip)
  {
    return null;
  }

  const finalTip = tip.clone().add(tip.clone().sub(middle).multiplyScalar(0.55));
  return [base, middle, tip, finalTip];
}

function getWorldPoint(model: THREE.Object3D, name: string): THREE.Vector3 | null
{
  const object = model.getObjectByName(name);
  if (!object)
  {
    return null;
  }

  const point = new THREE.Vector3();
  object.getWorldPosition(point);
  return point;
}

function missingVirtualSkeletonObjects(model: THREE.Object3D): string[]
{
  const names = [
    WRIST_PIVOT_NAME,
    FINGER_LANDMARKS.thumb.base,
    FINGER_LANDMARKS.thumb.tip,
    FINGER_LANDMARKS.index.base,
    FINGER_LANDMARKS.index.middle,
    FINGER_LANDMARKS.index.tip,
    FINGER_LANDMARKS.middle.base,
    FINGER_LANDMARKS.middle.middle,
    FINGER_LANDMARKS.middle.tip,
    FINGER_LANDMARKS.ring.base,
    FINGER_LANDMARKS.ring.middle,
    FINGER_LANDMARKS.ring.tip,
    FINGER_LANDMARKS.pinky.base,
    FINGER_LANDMARKS.pinky.middle,
    FINGER_LANDMARKS.pinky.tip
  ].filter((name): name is string => Boolean(name));

  return names.filter((name) => !model.getObjectByName(name));
}

function toPoint(vector: THREE.Vector3): VirtualSkeletonPoint
{
  return [vector.x, vector.y, vector.z];
}

function ExhibitionEnvironment()
{
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.62, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#111923" roughness={0.88} metalness={0.06} />
      </mesh>

      <mesh position={[0, -2.56, -0.03]} receiveShadow>
        <cylinderGeometry args={[2.25, 2.4, 0.14, 64]} />
        <meshStandardMaterial color="#242c33" roughness={0.78} metalness={0.18} />
      </mesh>

      <mesh position={[0, -2.46, -0.03]} receiveShadow>
        <cylinderGeometry args={[2.02, 2.16, 0.06, 64]} />
        <meshStandardMaterial color="#39434b" roughness={0.66} metalness={0.22} />
      </mesh>

      <mesh position={[0, 0.75, -3.35]} receiveShadow>
        <boxGeometry args={[8.4, 6.6, 0.12]} />
        <meshStandardMaterial color="#202a33" roughness={0.94} metalness={0.02} />
      </mesh>

      <mesh position={[-3.08, 0.75, -3.28]} receiveShadow rotation={[0, 0.2, 0]}>
        <boxGeometry args={[0.08, 6.6, 3.8]} />
        <meshStandardMaterial color="#17212a" roughness={0.9} metalness={0.03} />
      </mesh>

      <mesh position={[3.08, 0.75, -3.28]} receiveShadow rotation={[0, -0.2, 0]}>
        <boxGeometry args={[0.08, 6.6, 3.8]} />
        <meshStandardMaterial color="#17212a" roughness={0.9} metalness={0.03} />
      </mesh>

      <mesh position={[-2.2, 2.82, -3.18]}>
        <boxGeometry args={[1.1, 0.04, 0.04]} />
        <meshStandardMaterial color="#a8dfff" emissive="#71c7ff" emissiveIntensity={0.75} />
      </mesh>

      <mesh position={[2.4, 2.42, -3.18]}>
        <boxGeometry args={[0.92, 0.035, 0.035]} />
        <meshStandardMaterial color="#ffe8c6" emissive="#ffc173" emissiveIntensity={0.46} />
      </mesh>
    </group>
  );
}

function HandScene({ handState }: { handState: HandState })
{
  const rootRef = useRef<THREE.Group | null>(null);

  useFrame((state, delta) =>
  {
    if (!rootRef.current)
    {
      return;
    }

    const targetY = Math.sin(state.clock.elapsedTime * 0.26) * 0.035;
    rootRef.current.rotation.y = THREE.MathUtils.damp(rootRef.current.rotation.y, targetY, 3.2, delta);
  });

  return (
    <>
      <color attach="background" args={['#06131f']} />
      <fog attach="fog" args={['#06131f', 7.8, 15]} />

      <ambientLight intensity={0.34} />
      <hemisphereLight intensity={0.36} color="#eaf7ff" groundColor="#11161c" />
      <spotLight
        castShadow
        position={[4.8, 6.8, 5.4]}
        intensity={95}
        angle={0.38}
        penumbra={0.82}
        color="#fff1de"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight
        castShadow
        position={[-4.6, 4.2, 4.2]}
        intensity={52}
        angle={0.48}
        penumbra={0.88}
        color="#cfeaff"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[0.2, 1.3, 3.6]} intensity={14} color="#ffe1bd" />
      <pointLight position={[0, 2.1, -2.7]} intensity={12} color="#79ccff" />

      <ExhibitionEnvironment />

      <group ref={rootRef}>
        <Suspense fallback={null}>
          <RoboticHandModel handState={handState} />
        </Suspense>
      </group>
    </>
  );
}

export default function VirtualHand({ handState }: { handState: HandState })
{
  return (
    <div className="virtual-hand-stage" aria-label="rigged robotic hand display">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 0.15, 7.65], fov: 36 }}
        gl={{ antialias: true }}
      >
        <HandScene handState={handState} />
        <OrbitControls
          makeDefault
          target={[0.3, -0.18, -0.17]}
          enableRotate
          enableZoom
          enableDamping
          enablePan={false}
          dampingFactor={0.08}
          rotateSpeed={0.64}
          zoomSpeed={0.72}
          minDistance={5.4}
          maxDistance={11.4}
          minPolarAngle={Math.PI * 0.18}
          maxPolarAngle={Math.PI * 0.84}
          minAzimuthAngle={-Math.PI * 0.62}
          maxAzimuthAngle={Math.PI * 0.62}
        />
      </Canvas>
    </div>
  );
}
