# GeSTure

각자의 휴대폰으로 화면 속 손가락 하나를 조종하고, 함께 만든 손 모양에서 단어와 문장을 만드는 제주 참여형 전시 프로젝트다.

## 시작하기

현재 전시 앱은 **[`jeju-exhibition/`](jeju-exhibition/README.md)** 이다. 손가락 조종 → 400ms 자세 유지 → 손 모양 6개 기록 → 단어 생성 → 단어 궤도와 문장 모이기로 이어진다.

실행·모델·실기 테스트는 Mac mini에서 진행한다. 기존 개발 Mac에서는 전시 서버를 켜지 않는다. 새 설치와 이어받기는 다음 문서를 확인한다.

- [작업 규칙](AGENTS.md): 변경 사항을 GitHub `main`까지 반영
- [최신 인수인계](HANDOFF.md): 변경 내용과 검증 기록
- [Mac mini 준비 절차](jeju-exhibition/docs/mac-mini-handoff.md): 설치·실행·현장 점검
- [제주 앱 안내](jeju-exhibition/README.md): 화면과 기능
- [네트워크·QR 준비](jeju-exhibition/docs/network-setup.md): 관객 Wi-Fi와 고정 접속 주소

## 전시 화면

서버 기본 포트는 `3002`다. `localhost`는 실행한 Mac mini에서만 사용하며, 관객 QR에는 휴대폰에서 접속할 수 있는 고정 LAN 주소를 넣는다.

| 경로 | 용도 |
| --- | --- |
| `/exhibition` | 손·최근 단어·워드클라우드·조종기 5개 모아보기 |
| `/display/hand` | 손 전용 디스플레이 |
| `/display/word` | 단어 궤도와 문장 모이기 |
| `/word-cloud/` | 별도 디자인의 워드클라우드 |
| `/display/latest-word` | 최근 생성 단어와 입력 진행 |
| `/join/qr` | 손가락별 QR 5개와 Wi-Fi 안내 |
| `/join?finger=thumb` 등 | 관객 휴대폰 조종 |
| `/monitor` | 운영자 확인·복구 |

모아보기의 조종기도 실제 관객 자리를 배정받는다. 관객에게 넘길 때는 각 조종기의 ‘조종 자리 비우기’를 사용한다.

## 저장소 구성

```text
GeSTure/
├── AGENTS.md
├── README.md
├── HANDOFF.md
└── jeju-exhibition/
    ├── client/           손·단어·QR·조종기·운영 화면
    ├── server/           참가자 세션·자모 인식·단어/문장 생성·저장
    ├── shared/           전시 주제와 공유 데이터 형식
    ├── public/models/    앱에서 사용하는 전시용 손 GLB와 리그
    ├── public/word-cloud/ 별도 워드클라우드 화면
    ├── model-sources/    검지 재생성에 사용하는 기준 손 모델
    ├── reference/        포즈 도출에 사용하는 실측 자모 자료
    ├── scripts/          설치·네트워크 점검·모델 제작·자료 분석
    └── docs/             운영·인수인계·인식/모델 근거
```

[손 모델의 출처와 재생성](jeju-exhibition/docs/hand-model.md), [실측 자료](jeju-exhibition/reference/README.md), [포즈 도출 과정](jeju-exhibition/docs/pose-derivation.md)을 함께 보관한다. 일반 실행에는 저장소에 포함된 전시용 GLB를 사용하므로 Blender나 외부 모델 원본이 필요 없다.

`.env`, 운영자 키, Wi-Fi 비밀번호, 관객 기록과 로컬 검수 자료는 Git에 포함하지 않는다. GitHub에 코드가 반영된 것과 Mac mini·현장 실기 검증 완료는 각각 구분해 기록한다.
