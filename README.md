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
