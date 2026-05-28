# Render Board-by-board Collect V24

## 목적
Render에서 `/api/collect` 장기 요청이 502/503 HTML로 바뀌는 문제를 피하기 위해 수집을 게시판 단위로 분리했습니다.

## API

### POST /api/collect-preflight
m_99 보도자료 1페이지로 node-fetch / https-ipv4 / curl-ipv4를 테스트하고 사용할 방식을 선택합니다.

### POST /api/collect-board
게시판 1개만 수집합니다.

Body:
```json
{
  "mode": "fast",
  "startDate": "2026-05-01",
  "endDate": "2026-05-28",
  "board_id": "m_99",
  "fetchMethod": "curl-ipv4"
}
```

## 화면 동작
빠른수집/기간수집 버튼은 내부적으로:
1. 연결사전진단
2. 게시판 목록 조회
3. 게시판별 `/api/collect-board` 순차 호출
4. 결과표 누적 표시

## 판단 기준
- `연결사전진단`에서 fetch 방식이 선택되어야 합니다.
- 각 게시판 행에서 `HTML > 0`, `전체건=Y`, `ANCHOR/DATEBACK > 0`이면 수집 경로가 정상입니다.
- 특정 게시판만 실패하면 해당 행의 오류상세를 보면 됩니다.
