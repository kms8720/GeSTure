import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FingerName, HandState, Orientation } from '../socket/types';

type LoadedGLTF = { scene: THREE.Group };
type Axis = 'x' | 'y' | 'z';

type FingerRigConfig = {
  pivots: string[];
  /** 굽힘 각도. pivots와 같은 길이 */
  flexAngles: number[];
  flexAxis: Axis;
  flexDirection: 1 | -1;
  /**
   * 벌림은 base pivot을 굽힘과 다른 축으로 돌려서 만든다.
   * GLB에 벌림 전용 노드가 없기 때문이다(29노드 전부 확인함).
   */
  spreadAxis: Axis;
  /** 손가락을 완전히 폈을 때의 벌림 각도. 중지를 기준으로 부채꼴로 퍼진다 */
  spreadOpen: number;
  /** 완전히 접었을 때의 벌림 각도. 손바닥 쪽으로 모이도록 반대 부호를 준다 */
  spreadClosed: number;
};

const MODEL_PATH = '/models/robot_hand_rig.glb';

/**
 * 벌림은 굽힘에 따라간다.
 *
 * 처음에는 포즈 클래스마다 실측 벌림 프리셋을 얹었는데, 손을 쥐었다 폈다 할 때
 * 벌어지는 방향이 실제 손과 반대로 보였다. 원인을 데이터에서 확인했다.
 * reference_samples.jsonl은 31개 정적 지화를 찍은 것이라 각 지화 고유의 벌림만 들어 있고,
 * 손을 쥐고 펴는 동작 자체가 없다. 굽힘과 벌림의 상관은 전체 -0.04로 사실상 무관하고
 * 손가락별 부호도 제각각이었다(엄지 +0.34, 약지 -0.38).
 *
 * 그래서 프리셋을 버리고 해부학적 결합을 직접 넣었다.
 * 손가락을 펴면 중지를 축으로 부채꼴로 퍼지고, 접으면 손바닥 가운데로 모인다.
 * 관객은 여전히 굽힘 하나만 조작한다.
 */
const FINGER_RIGS: Record<FingerName, FingerRigConfig> = {
  thumb: {
    pivots: ['thumb_base_pivot', 'thumb_tip_pivot'],
    flexAngles: [0.82, 1.02],
    flexAxis: 'z',
    flexDirection: 1,
    // 엄지는 부채꼴이 아니라 손바닥에서 멀어졌다 붙었다 한다
    spreadAxis: 'y',
    spreadOpen: 0.26,
    spreadClosed: -0.10
  },
  index: {
    pivots: ['index_base_pivot', 'index_middle_pivot', 'index_tip_pivot'],
    flexAngles: [1.08, 1.36, 1.08],
    flexAxis: 'x',
    flexDirection: 1,
    spreadAxis: 'y',
    spreadOpen: 0.15,
    spreadClosed: -0.05
  },
  middle: {
    pivots: ['middle_base_pivot', 'middle_middle_pivot', 'middle_tip_pivot'],
    flexAngles: [1.04, 1.32, 1.04],
    flexAxis: 'x',
    flexDirection: 1,
    // 중지는 부채꼴의 축이라 거의 움직이지 않는다
    spreadAxis: 'y',
    spreadOpen: 0.02,
    spreadClosed: 0
  },
  ring: {
    pivots: ['ring_base_pivot', 'ring_middle_pivot', 'ring_tip_pivot'],
    flexAngles: [1.08, 1.36, 1.08],
    flexAxis: 'x',
    flexDirection: 1,
    spreadAxis: 'y',
    spreadOpen: -0.13,
    spreadClosed: 0.04
  },
  pinky: {
    pivots: ['pinky_base_pivot', 'pinky_middle_pivot', 'pinky_tip_pivot'],
    flexAngles: [1.12, 1.4, 1.1],
    flexAxis: 'x',
    flexDirection: 1,
    spreadAxis: 'y',
    spreadOpen: -0.24,
    spreadClosed: 0.07
  }
};

/**
 * 포즈별 손 방향 프리셋을 쓸 것인가.
 *
 * 지금은 끈다. 이유는 좌표계가 맞춰져 있지 않기 때문이다.
 * poseClasses.ts의 orientation 값은 MediaPipe 카메라 좌표계에서 뽑은 회전인데,
 * 그것이 이 GLB의 three.js 좌표계에서 어느 축에 대응하는지 알 수 없다.
 * 게다가 원본 캡처는 왼손 600개 / 오른손 20개가 섞여 있어 부호조차 확실하지 않다.
 * 그대로 오일러각에 넣으면 손이 임의 방향으로 돌아 정면을 벗어난다.
 *
 * 그래서 손은 항상 정면(손등이 관객 쪽, 손가락이 위)을 향한다.
 * 자모의 모호함은 화면의 후보 칩이 이미 말해주므로 방향까지 동원할 필요는 없다.
 *
 * 나중에 좌표계를 맞추고 나면 이 값을 true로 바꾸고 SCALE/LIMIT을 조정하면 된다.
 * 맞추는 방법은 docs/pose-derivation.md 참고.
 */
const USE_POSE_ORIENTATION = false;
const ORIENTATION_SCALE = 0.7;
const ORIENTATION_LIMIT = 0.9;

/** 굽힘은 관객 조작이라 즉각 따라가고, 벌림/방향은 프리셋이라 느리게 붙는다 */
const FLEX_DAMP = 8.5;
const PRESET_DAMP = 2.4;

type PivotRecord = {
  object: THREE.Object3D;
  initialRotation: THREE.Euler;
};

type HandPose = {
  handState: HandState;
  orientation: Orientation | null;
};

function clamp01(value: number): number
{
  return Math.max(0, Math.min(1, value));
}

function clampAngle(value: number): number
{
  return Math.max(-ORIENTATION_LIMIT, Math.min(ORIENTATION_LIMIT, value));
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
  });
}

function RoboticHandModel({ pose }: { pose: HandPose })
{
  const gltf = useLoader(GLTFLoader, MODEL_PATH) as LoadedGLTF;
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const pivotsRef = useRef<Map<string, PivotRecord>>(new Map());
  const orientationRef = useRef<THREE.Group | null>(null);

  useEffect(() =>
  {
    enhanceModel(model);

    const nextPivots = new Map<string, PivotRecord>();
    Object.values(FINGER_RIGS).forEach((rig) =>
    {
      rig.pivots.forEach((pivotName) =>
      {
        const pivot = model.getObjectByName(pivotName);
        if (pivot)
        {
          nextPivots.set(pivotName, { object: pivot, initialRotation: pivot.rotation.clone() });
        }
        else
        {
          console.warn(`[VirtualHand] pivot을 찾지 못했다: ${pivotName}`);
        }
      });
    });

    pivotsRef.current = nextPivots;
  }, [model]);

  useFrame((_state, delta) =>
  {
    applyFingerRotations(pivotsRef.current, pose, delta);
    applyOrientation(orientationRef.current, pose.orientation, delta);
  });

  return (
    // 바깥 group이 손 전체 방향을 담당한다.
    // GLB의 palm_wrist는 children이 0인 메시 리프라 손목 관절로 쓸 수 없다.
    <group ref={orientationRef}>
      <group scale={2.15}>
        <group position={[0.3, 0.07, -0.17]}>
          <primitive object={model} />
        </group>
      </group>
    </group>
  );
}

function applyFingerRotations(pivots: Map<string, PivotRecord>, pose: HandPose, delta: number): void
{
  (Object.entries(FINGER_RIGS) as Array<[FingerName, FingerRigConfig]>).forEach(([finger, rig]) =>
  {
    // 관객이 만든 굽힘값은 손대지 않는다. 어설픈 손 모양이 그대로 보여야 한다
    const extension = clamp01(pose.handState[finger] / 100);
    const flex = 1 - extension;
    // 펴면 부채꼴로 퍼지고 접으면 손바닥 가운데로 모인다
    const spreadAngle = rig.spreadClosed + (rig.spreadOpen - rig.spreadClosed) * extension;

    rig.pivots.forEach((pivotName, index) =>
    {
      const record = pivots.get(pivotName);
      if (!record)
      {
        return;
      }

      const flexTarget = record.initialRotation[rig.flexAxis] + rig.flexAngles[index] * flex * rig.flexDirection;
      record.object.rotation[rig.flexAxis] = THREE.MathUtils.damp(
        record.object.rotation[rig.flexAxis], flexTarget, FLEX_DAMP, delta
      );

      // 벌림은 손가락 뿌리에서만 준다. 마디마다 주면 손가락이 휘어 보인다.
      // 굽힘과 같은 속도로 따라가야 한 동작으로 읽힌다
      if (index === 0 && rig.spreadAxis !== rig.flexAxis)
      {
        const spreadTarget = record.initialRotation[rig.spreadAxis] + spreadAngle;
        record.object.rotation[rig.spreadAxis] = THREE.MathUtils.damp(
          record.object.rotation[rig.spreadAxis], spreadTarget, FLEX_DAMP, delta
        );
      }
    });
  });
}

function applyOrientation(group: THREE.Group | null, orientation: Orientation | null, delta: number): void
{
  if (!group)
  {
    return;
  }

  const target = USE_POSE_ORIENTATION && orientation
    ? {
        y: clampAngle(orientation.yaw * ORIENTATION_SCALE),
        x: clampAngle(orientation.pitch * ORIENTATION_SCALE),
        z: clampAngle(orientation.roll * ORIENTATION_SCALE)
      }
    : { y: 0, x: 0, z: 0 };

  group.rotation.y = THREE.MathUtils.damp(group.rotation.y, target.y, PRESET_DAMP, delta);
  group.rotation.x = THREE.MathUtils.damp(group.rotation.x, target.x, PRESET_DAMP, delta);
  group.rotation.z = THREE.MathUtils.damp(group.rotation.z, target.z, PRESET_DAMP, delta);
}

function Stage()
{
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.62, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0d1117" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[0, -2.56, -0.03]} receiveShadow>
        <cylinderGeometry args={[2.3, 2.5, 0.12, 64]} />
        <meshStandardMaterial color="#1c242c" roughness={0.8} metalness={0.15} />
      </mesh>
    </group>
  );
}

function Scene({ pose }: { pose: HandPose })
{
  return (
    <>
      <color attach="background" args={['#050b12']} />
      <fog attach="fog" args={['#050b12', 8.5, 17]} />

      <ambientLight intensity={0.36} />
      <hemisphereLight intensity={0.4} color="#eaf7ff" groundColor="#0d1117" />
      <spotLight
        castShadow
        position={[4.8, 6.8, 5.4]}
        intensity={110}
        angle={0.4}
        penumbra={0.85}
        color="#fff3e2"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[-4.6, 4.2, 4.2]} intensity={55} angle={0.5} penumbra={0.9} color="#cfeaff" />
      <pointLight position={[0.2, 1.3, 3.6]} intensity={16} color="#ffe1bd" />

      <Stage />
      <Suspense fallback={null}>
        <RoboticHandModel pose={pose} />
      </Suspense>
    </>
  );
}

/**
 * 화면 비율에 따라 카메라를 다르게 잡는다.
 *
 * 제주 전시의 손 화면은 세로로 세운 디스플레이 한 대를 통째로 쓴다.
 * 세로 화면에서 가로 기준 카메라를 그대로 쓰면 손이 좌우 여백에 눌려 작아진다.
 */
const FRAMING = {
  /** 세로 디스플레이. 손을 화면 가득 채운다 */
  portrait: { position: [0, 0.1, 7.4] as [number, number, number], fov: 40 },
  /** 가로 화면. 운영 모니터나 개발 중 확인용 */
  landscape: { position: [0, 0.35, 9.8] as [number, number, number], fov: 34 }
};

type VirtualHandProps = HandPose & {
  framing?: keyof typeof FRAMING;
};

export default function VirtualHand({ handState, orientation, framing = 'landscape' }: VirtualHandProps)
{
  const camera = FRAMING[framing];

  return (
    <div className="hand-stage" aria-label="관객이 함께 움직이는 로봇손">
      <Canvas shadows dpr={[1, 2]} camera={camera} gl={{ antialias: true }}>
        <Scene pose={{ handState, orientation }} />
      </Canvas>
    </div>
  );
}
