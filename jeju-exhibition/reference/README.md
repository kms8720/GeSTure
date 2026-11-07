# 실측 자모 자료

`reference_samples.jsonl`은 `server/poseClasses.ts`의 포즈 후보를 도출할 때 사용한 사람 손의 실측 자료다.

- 촬영일: 2026-06-02
- 구성: 한글 자모 31개 × 20개 샘플, 총 620개
- 손 구분: Left 600개, Right 20개
- 각 샘플: 라벨·촬영 시각, MediaPipe 21개 좌표, 정규화 좌표와 특징값
- 포맷 식별자: `metadata.format = "gesture-reference-v1"`

폴더 이동과 포맷 식별자 정리 외에 측정값·라벨·촬영 시각을 수정하지 않았다. 전시 앱은 이 파일을 매번 읽는 대신 도출된 `server/poseClasses.ts`를 사용한다.

`scripts/analyze_poses.py`는 이 파일의 경로를 스크립트 위치 기준으로 찾는다. 분석에는 NumPy가 필요하다. [포즈 도출 과정](../docs/pose-derivation.md)에 계산과 근거를 정리했다.
