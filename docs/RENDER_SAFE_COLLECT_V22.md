# Render Safe Collect V22

## 목적
Render Web Service에서 `/api/collect` 요청이 오래 걸려 502 Bad Gateway가 발생하는 문제를 막기 위한 버전입니다.

## 주요 환경변수

```text
COLLECT_FETCH_TIMEOUT_MS=4500
COLLECT_GLOBAL_TIMEOUT_MS=42000
DIAGNOSTIC_FETCH_TIMEOUT_MS=12000
```

## 버튼 기능

### 조회
DB에 이미 저장된 데이터를 조회합니다. 수집하지 않습니다.

### 빠른수집
각 식약처 게시판 1페이지를 짧은 timeout으로 확인합니다.
실패해도 API 전체가 죽지 않고 게시판별 오류로 남깁니다.

### 기간수집
선택 기간 기준으로 여러 페이지를 확인하되, global timeout 안에서만 수행합니다.

### 연결진단
보도자료(m_99) 1페이지만 대상으로 3가지 요청 방식을 테스트합니다.
- node-fetch
- https-ipv4
- curl-ipv4

## 판단
- 빠른수집이 0건이고 연결진단도 모두 실패하면 Render outbound → 식약처 접속 차단/네트워크 문제 가능성이 큽니다.
- 연결진단 중 하나가 성공하면 수집용 fetch 방식을 해당 방식으로 바꾸는 v23을 만들 수 있습니다.
