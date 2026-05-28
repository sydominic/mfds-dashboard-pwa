# V23 Auto Fetch Method Collect

## 원인 재정의
V22 결과는 `timeout 4500ms`가 모든 수집 실패의 최종 원인이라는 뜻이 아니다.
정확한 실패 지점은 Render Node 서버가 식약처 HTML을 수신하지 못하는 단계이다.

## V23 목표
오류 문구를 없애는 것이 아니라, Render 환경에서 실제로 식약처 HTML을 받을 수 있는 fetch 방식을 먼저 확정한 뒤 그 방식으로 수집한다.

## 수정
- `/api/collect` 시작 시 m_99 보도자료 1페이지로 사전 연결진단(preflight)을 수행한다.
- preflight 순서:
  1. node-fetch
  2. https-ipv4
  3. curl-ipv4
- HTML 수신에 성공하고 `전체 n건` 표식이 있으면 해당 방식을 수집 기본 방식으로 선택한다.
- 선택된 fetch 방식으로 전체 게시판 수집을 수행한다.
- preflight 결과를 `연결사전진단` 행으로 게시판별 진단표에 표시한다.
- 수집 완료 메시지에 선택된 FETCH 방식을 표시한다.

## 주요 환경변수
```text
COLLECT_METHOD=auto
PREFLIGHT_FETCH_TIMEOUT_MS=10000
COLLECT_FETCH_TIMEOUT_MS=12000
COLLECT_GLOBAL_TIMEOUT_MS=90000
```

`COLLECT_METHOD`를 `https-ipv4` 또는 `curl-ipv4`로 지정하면 preflight 없이 해당 방식을 바로 사용한다.

## 판단 기준
- 연결사전진단에서 FETCH가 `https-ipv4` 또는 `curl-ipv4`로 선택되고 HTML > 0이면 Render 접속경로는 복구 가능하다.
- 연결사전진단이 none이면 Render에서 어떤 방식으로도 식약처 HTML을 받지 못한 것이다.
