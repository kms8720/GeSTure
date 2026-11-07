# 전시용 손 모델

`public/models/hand_exhibition.glb`는 제공된 `hand color.glb`의 손바닥·엄지·중지·약지·소지에, `model-sources/reference_hand.glb`의 검지를 결합한 전시 화면용 모델이다. 두 입력 모델은 읽기 전용 원본으로 보존한다.

## 구성과 수정

- 손바닥 1개, 네 손가락 각각 3마디, 엄지 2마디와 14개 회전 피벗을 사용한다.
- 검지는 기존 모델의 `index_03`, `index_02`, `index_01`과 세 피벗을 통째로 가져온다. 총 76,861개 삼각형이며 정점·법선·UV·면 인덱스, 재질, 관절 내부의 위치·회전·크기 데이터를 원본 그대로 GLB에 복사한다. 다시 자르거나 경량화하거나 마디별로 늘이지 않는다.
- 검지 전체를 감싸는 `legacy_index_alignment` 부모에서만 배율 0.97과 위치 이동을 적용한다. 이전 검지의 펴기 보정, 길이 보정, 추가 관절 커버는 적용하지 않는다. 굽힘축과 최대 각도도 기존 검지의 +X축 / `[1.08, 1.36, 1.08]` 라디안을 사용한다.
- 손바닥과 나머지 네 손가락은 앞서 다듬은 Meshy 원본의 서로 다른 부위를 유지한다. 엄지의 둥근 소켓 외피와 검지 앞 손바닥판은 고정 손바닥에 남는다.
- Meshy에서 추출한 부위는 UV 경계의 같은 위치 정점을 합친 뒤 경량화했다. 기존 검지는 이 처리에서 제외한다. 각 원본의 텍스처를 GLB 내부에 포함해 오프라인으로 표시한다.

`hand_exhibition.rig.json`에 다섯 손가락의 피벗 이름, 로컬 회전축, 최대 굽힘 각도가 들어 있다. 축은 GLB/Three.js 좌표이며, 앱은 원래 회전에 로컬 축 회전을 곱한다. 조종 값 100은 폄, 0은 설정된 최대 굽힘이다.

## 재생성

프로젝트 루트에서 Blender 5.2를 사용한다. 첫 인수는 Meshy 원본, 두 번째는 출력 경로다. 검지는 `jeju-exhibition/model-sources/reference_hand.glb`에서 읽으며 두 입력 파일을 출력 경로로 지정할 수 없다.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python jeju-exhibition/scripts/build_exhibition_hand.py -- '원본/hand color.glb' 'jeju-exhibition/public/models/hand_exhibition.glb'
```

편집 가능한 `data/model-work/hand_exhibition.blend`와 검증용 `rig_open.png`, `rig_half.png`, `rig_closed.png`, `rig_thumb_only.png`, `rig_index_only.png`도 함께 생성한다. `data/`는 Git에서 제외된 로컬 산출물이다. GLB 및 리그 JSON만 웹앱의 정적 자산이다.

검지 교체 전 모델·리그 JSON·Blender 파일·생성 스크립트는 `data/model-work/before-legacy-index/`에 보관했다. `cutChecks`는 Meshy에서 분리한 부위의 절단 기록이며, 가져온 기존 검지의 검증에는 원본 데이터와의 직접 비교를 사용한다.

## 검증과 범위

Meshy 원본 SHA-256은 `a9fc3b4cbce849f6101ee870daacb093d96948a5d4c551d8f4697e7471a09912`, 기존 손 모델 SHA-256은 `ddda0a9da978214ab5372d0b81e23bb939cf5dc594fdb56f8cb182fcb6b9b8d5`다. 리그 JSON 버전 2는 12개 Meshy 부위와 3개 기존 검지 부위의 출처를 나눠 기록한다. Meshy 분할 개수는 **다듬기와 경량화 이전**의 추출 증거이며, 서로 다른 두 입력의 개수를 원본 한 개의 삼각형 수와 동일시하지 않는다.

검증기는 두 원본 해시, 관절 계층, 내장 텍스처, 기존 검지의 형상 데이터와 내부 변환값 보존을 확인한다. 실제 전시장 투사 환경 및 모든 조합 자세의 물리 충돌은 별도 검수 대상이다.

교체본은 외피 394,620개 삼각형, 내장 텍스처 4개다. 두 입력의 동일한 이미지 바이트는 공유해 용량을 줄였고 기존 검지의 재질 설정은 유지했다. 전체 손 13장과 검지 단독 7장의 확대 렌더, 앱 조종기의 100·50·0 값에서 동작을 확인했다. 검수 이미지는 `data/model-work/legacy-index-check/`에 있다. 기존 검지에 원래 있던 작은 파편과 내부 빈 공간은 원형 보존 요청에 따라 수정하지 않았다.

```powershell
python jeju-exhibition/scripts/validate_hand_glb.py --source '원본/hand color.glb'
```

이 모델은 원본 외형을 살린 실시간 전시용 강체 관절 리그다. 새로 조형한 제작용 CAD나 전면 리토폴로지 모델은 아니다. 원본 AI 메시의 표면 요철, 비정형 내부 배선과 일부 외피의 비대칭은 남아 있다. 극단적인 조합 자세의 접촉은 물리 시뮬레이션으로 해결하지 않는다. 다른 원본에 이 스크립트를 적용하려면 손가락 영역과 관절 좌표를 다시 맞춰야 한다.
