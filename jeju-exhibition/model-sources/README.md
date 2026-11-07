# 기준 손 모델

`reference_hand.glb`는 전시용 손 모델의 검지 원본과 포즈 분석 근거를 보존하는 제작 자료다. 앱은 `public/models/hand_exhibition.glb`를 읽으며 이 원본을 직접 내려받지 않는다.

- SHA-256: `ddda0a9da978214ab5372d0b81e23bb939cf5dc594fdb56f8cb182fcb6b9b8d5`
- 검지의 메시·재질·관절 내부 변환을 그대로 가져오기 위해 전체 기준 GLB를 보관한다.
- `scripts/build_exhibition_hand.py`와 `scripts/validate_hand_glb.py`가 이 경로를 기본 입력으로 사용한다.
- 기존 원본과 동일한 파일이며, 위치만 이동했다. 재생성 시 출력 경로로 덮어쓰지 않는다.

다른 입력인 `hand color.glb` 원본과 Blender 편집 파일은 로컬 제작 자료다. 일반 전시 실행에는 필요하지 않다. [모델 출처와 재생성 절차](../docs/hand-model.md)를 참고한다.
