# Motor Control

실제 전시용 로봇손 모터 제어 코드가 들어갈 예정 영역이다. 현재 발표용 mock-up은 `virtual-hand-rigged-final/` 웹앱의 가상 손으로 동작하며, 실제 하드웨어 제어는 아직 구현하지 않았다.

## 목표

웹앱 또는 별도 controller에서 만든 손가락 상태를 실제 모터/actuator 명령으로 변환한다.

```txt
web handState / gesture command
  -> motor-control bridge
  -> hardware protocol
  -> finger actuator movement
  -> safety / neutral return
```

## 들어올 수 있는 구성

- Arduino, RP2040, ESP32 등 microcontroller firmware
- serial, BLE, CAN, PWM 등 통신/제어 bridge
- finger별 calibration 값
- min/max angle, speed, torque 제한
- emergency stop / safe neutral pose
- 웹앱 handState와 실제 모터 명령을 연결하는 adapter

## 아직 결정되지 않은 것

- 최종 모터/actuator 종류
- 통신 방식
- 전원/안전 회로
- 손가락별 기구 limit
- 5m 전시 스케일에서 controller와 손 사이를 유선/무선 중 무엇으로 연결할지

## 다음 작업

1. 실제 전시용 손의 actuator와 controller 후보를 확정한다.
2. 손가락 1개만 움직이는 최소 firmware/protocol을 먼저 만든다.
3. neutral pose 복귀와 emergency stop을 가장 먼저 검증한다.
4. 이후 웹앱 `handState`를 실제 모터 명령으로 연결한다.
