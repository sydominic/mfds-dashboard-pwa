# v9 파서 수정 및 진단 강화

## 원인 가정
v8은 text fallback을 추가했지만 `mfds_main_area()`로 추정한 본문 영역 안에서만 텍스트를 분석했다.
Render에서 받은 HTML에서 #contents/.content가 실제 목록 영역과 어긋나면 전체 페이지에는 게시글이 있어도 파서 입력 영역에는 게시글이 없을 수 있다.

## 수정
- text fallback 파서는 전체 soup 기준으로 수행
- anchor index도 전체 soup 기준으로 구성
- 게시판별 수집 결과에 HTML크기, 라인수, 전체건표식, TR/CARD/TEXT 파서 건수, 오류 메시지 추가
- Render Logs에 html_len, lines, total_marker, tr/card/text/deduped, latest_date 기록

## 확인 방법
빠른수집 후 `게시판별 수집 결과 / 파서 진단 보기`를 확인한다.
- HTML크기 > 0
- 라인수 > 0
- 전체건표식 = Y
- TEXT 또는 TR/CARD 중 하나가 1 이상
- m_99 페이지최신일이 2026-05-27 근처인지 확인
