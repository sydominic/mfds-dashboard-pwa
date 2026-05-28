# V21 Node Fetch Fallback Diagnostics

## 원인
v20 진단 결과 모든 식약처 게시판에서 HTML=0, 라인=0, 오류=fetch failed가 확인되었습니다.
이는 파서나 Supabase 저장 문제가 아니라 Render Node 서버가 식약처 HTML을 받아오지 못하는 네트워크/fetch 계층 문제입니다.

## 수정
- Node 기본 fetch 실패 시 원인을 `err.cause`까지 기록합니다.
- 기본 fetch 실패 후 `node:https` IPv4 강제 요청을 fallback으로 수행합니다.
- 그래도 실패하면 `curl --ipv4` fallback을 수행합니다.
- 각 게시판별 진단표에 FETCH 방식과 오류상세를 표시합니다.
- Render Logs에 `[mfds-fetch]`, `[mfds-fetch-error]` 로그를 남깁니다.

## 확인
빠른수집 실행 후 진단표에서 아래를 확인합니다.
- FETCH가 `node-fetch`, `https-ipv4`, `curl-ipv4` 중 하나이면 HTML 수신 성공입니다.
- FETCH가 `none`이고 오류상세에 ECONNRESET/ETIMEDOUT/TLS/DNS 관련 메시지가 나오면 Render → 식약처 접속 문제입니다.
