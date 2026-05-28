# Render Auto Fetch Method V23

## 목적
Render에서 식약처 수집이 실패할 때 단순 timeout 조정이 아니라, 실제 성공 가능한 HTML 요청 방식을 자동으로 선택하기 위한 버전입니다.

## 동작 방식

### 1. 수집 전 사전진단
빠른수집 또는 기간수집을 누르면 먼저 보도자료(m_99) 1페이지를 대상으로 아래 순서로 테스트합니다.

```text
node-fetch → https-ipv4 → curl-ipv4
```

### 2. 성공 방식 선택
HTML이 수신되고 `전체 n건` 표식이 있으면 해당 방식을 수집 방식으로 선택합니다.

### 3. 전체 게시판 수집
선택된 방식으로 전체 식약처 게시판을 수집합니다.

## 화면 확인
게시판별 진단표의 첫 행에 `연결사전진단`이 표시됩니다.

| 결과 | 의미 |
|---|---|
| FETCH=node-fetch | Node 기본 fetch로 수집 가능 |
| FETCH=https-ipv4 | IPv4 강제 HTTPS 방식으로 수집 가능 |
| FETCH=curl-ipv4 | curl IPv4 방식으로 수집 가능 |
| FETCH=none | Render에서 식약처 HTML 수신 실패 |

## 환경변수

```text
COLLECT_METHOD=auto
PREFLIGHT_FETCH_TIMEOUT_MS=10000
COLLECT_FETCH_TIMEOUT_MS=12000
COLLECT_GLOBAL_TIMEOUT_MS=90000
```

강제로 특정 방식을 쓰려면:

```text
COLLECT_METHOD=https-ipv4
```

또는

```text
COLLECT_METHOD=curl-ipv4
```
