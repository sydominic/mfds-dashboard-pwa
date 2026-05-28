# 식약처 공식자료 대시보드 - React/Node/Render 전환 v1

Streamlit v7 `app.py` 기능을 기준으로 React + Node/Express + Render Web Service 구조로 전환한 버전입니다.

## 주요 기능
- 식약처 게시판 14개 수집
- 조회 / 빠른수집 / 기간수집
- Supabase PostgreSQL 누적 저장
- 식약처 정보 탭
- 구분별 정보 탭
- 공식 게시판 바로가기 탭
- Render 무료 Web Service 배포 구조

## API
- `GET /api/health`
- `GET /api/options`
- `GET /api/stats`
- `GET /api/items`
- `POST /api/collect`
- `GET /api/boards`

## 배포
`docs/RENDER_DEPLOY.md`를 참고하세요.

## 제약뉴스 PWA 연결
`docs/CONNECT_TO_NEWS_PWA.md`를 참고하세요.


## V20 Node/Render parser diagnostics
- Render에서 실제 실행되는 Node 서버 기준으로 식약처 파서를 수정했습니다.
- `server/src/index.js`의 수집 로직을 `anchor` + `dateback` 방식으로 변경했습니다.
- React 화면에 게시판별 수집 결과 / 파서 진단표를 추가했습니다.
- API version: `v20-node-mfds-parser-diagnostics`


## V21 변경사항
- Render에서 식약처 `fetch failed`가 발생하는 문제를 진단하기 위해 Node fetch fallback을 추가했습니다.
- 요청 순서: node-fetch → node:https IPv4 → curl IPv4
- 게시판별 진단표에 `FETCH` 및 `오류상세` 컬럼을 추가했습니다.
- Render Logs에서 `[mfds-fetch]`, `[mfds-fetch-error]`를 확인할 수 있습니다.


## V22 변경사항
- Render 502 방지를 위해 수집과 연결진단을 분리했습니다.
- `/api/collect`는 짧은 timeout으로 JSON 응답을 반환하도록 변경했습니다.
- `/api/fetch-diagnostics` 엔드포인트와 React `연결진단` 버튼을 추가했습니다.
- 연결진단은 m_99 보도자료 1개 게시판만 대상으로 node-fetch/https-ipv4/curl-ipv4를 테스트합니다.


## V23 변경사항
- 수집 전 m_99 보도자료 1페이지로 fetch 방식 사전진단을 수행합니다.
- `node-fetch → https-ipv4 → curl-ipv4` 순서로 실제 HTML 수신 가능 방식을 자동 선택합니다.
- 선택된 방식으로 전체 게시판 수집을 수행합니다.
- 게시판별 진단표 첫 행에 `연결사전진단` 결과를 표시합니다.
- 수집 완료 메시지에 선택된 FETCH 방식을 표시합니다.


## V24 변경사항
- Render 502/503 HTML 응답 문제를 줄이기 위해 수집을 게시판 단위로 분리했습니다.
- React 수집 버튼은 `/api/collect-preflight` 후 `/api/collect-board`를 게시판별로 순차 호출합니다.
- API 미등록/오류 상황에서도 HTML 대신 JSON 응답을 반환하도록 보강했습니다.
- 수집 중 진행상황과 게시판별 진단표를 누적 표시합니다.
