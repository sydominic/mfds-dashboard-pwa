# V20 Node/Render parser diagnostics fix

## 원인
현재 Render 서비스는 Streamlit `app.py`가 아니라 Node 서버(`server/src/index.js`)와 React 클라이언트(`client/src/App.jsx`) 구조로 실행된다. 기존 수집 실패 원인은 Python 코드가 아니라 Node 서버의 MFDS 파서가 식약처 목록 구조를 안정적으로 읽지 못한 문제였다.

기존 Node 파서는 `li`를 우선 선택하고 `li`가 있으면 `tr`를 보지 않았다. 식약처 페이지에는 메뉴/푸터/첨부/페이지네이션 등에도 `li`가 많아 게시글 목록을 안정적으로 잡지 못할 수 있다.

## 수정
- `server/src/index.js`
  - API_VERSION을 `v20-node-mfds-parser-diagnostics`로 변경
  - 기존 `li` 우선 파서 폐기
  - view 링크 기반 `anchor` 파서 추가
  - 순수 등록일 라인 기준 역방향 제목 탐색 `dateback` 파서 추가
  - 수집 시 게시판별 insert 수행
  - 게시판별 진단값 반환: HTML크기, 라인수, 전체건표식, ANCHOR, DATEBACK, 최신일, 오류
  - Render Logs에 `[mfds-parse]` 로그 출력
- `client/src/App.jsx`
  - API 버전 표시
  - 수집 결과 진단표 표시
  - 수집 완료 메시지에 API 버전 포함
- `client/src/styles.css`
  - 진단표 스타일 추가

## 확인
1. Render 배포 후 상단 메타에 `v20-node-mfds-parser-diagnostics` 표시 확인
2. 빠른수집 실행
3. 게시판별 수집 결과 / 파서 진단에서 m_99, m_74 확인
4. Render Logs에서 `[mfds-parse] m_99` 로그 확인
