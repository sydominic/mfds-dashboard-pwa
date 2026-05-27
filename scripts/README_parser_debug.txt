v8 파서 보강 내용
- 식약처 HTML DOM block 파싱 실패 시 텍스트 라인 fallback 파서가 게시번호→제목→날짜 패턴을 직접 재구성합니다.
- Render Logs에는 MFDS m_XX page parse: tr=, card=, text=, deduped= 형태로 파서별 건수가 남습니다.
