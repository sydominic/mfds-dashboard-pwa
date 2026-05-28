# V24 Board-by-board JSON Collect

## 원인 재정리
직전 화면의 `서버가 JSON이 아닌 응답`은 `/api/collect` 한 번에 전체 게시판 수집을 처리하다가 Render가 HTML 오류 페이지를 반환한 상황입니다.
핵심 문제는 식약처 파서보다 먼저, 수집 API가 긴 작업 중에도 JSON 응답을 안정적으로 유지하지 못하는 구조입니다.

## 수정
- `/api/collect-preflight` 추가: 수집 전 m_99 1페이지로 사용 가능한 fetch 방식 확인
- `/api/collect-board` 추가: 게시판 1개만 수집하고 항상 JSON으로 결과 반환
- React 수집 버튼은 더 이상 `/api/collect` 한 번으로 전체 수집하지 않고, 게시판별 API를 순차 호출
- 수집 중 `n/전체` 진행상황 표시
- `/api/*` 미등록 경로는 HTML이 아니라 JSON 404 반환
- Express 에러 핸들러는 route/apiVersion 포함 JSON만 반환

## 확인
빠른수집 클릭 후 진단표가 게시판별로 한 줄씩 누적되어야 합니다.
만약 특정 게시판이 실패해도 전체 API가 HTML 에러로 바뀌지 않고 해당 게시판 행에 오류가 남아야 합니다.
