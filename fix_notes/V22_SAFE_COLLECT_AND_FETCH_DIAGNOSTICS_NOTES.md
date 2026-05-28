# V22 Safe Collect and Fetch Diagnostics

## 원인
V21은 fetch 실패 원인을 보기 위해 node-fetch → https-ipv4 → curl-ipv4를 모든 게시판에 순차 적용했습니다.
게시판 14개 기준 최악의 경우 요청 시간이 수 분까지 늘어나 Render가 502 Bad Gateway를 반환할 수 있었습니다.

## 수정
- `/api/collect`는 빠르게 끝나도록 수집용 fetch를 node-fetch 1회로 제한했습니다.
- 게시판별 timeout과 전체 global timeout을 설정했습니다.
- 실패한 게시판은 오류를 boardResults에 기록하고 전체 API는 JSON을 반환합니다.
- 장시간 fallback 진단은 `/api/fetch-diagnostics`로 분리했습니다.
- React 화면에 `연결진단` 버튼을 추가했습니다.

## 확인
1. 빠른수집: 502 없이 JSON 응답이 와야 합니다.
2. 실패 게시판은 진단표 오류상세에 표시됩니다.
3. 연결진단: m_99 보도자료 1페이지에 대해 node-fetch / https-ipv4 / curl-ipv4를 각각 테스트합니다.
