# v11 배포 확인 및 세션 잔상 제거

## 원인 분석
사용자 화면의 완료 문구가 v10 코드의 문구와 일치하지 않았다.
v10은 `중복 제외` 및 `아래 게시판별 결과를 확인하세요` 문구가 있어야 하지만, 화면에는 이전 버전의 `중복` 문구만 표시되었다.

가능 원인:
1. Render가 최신 커밋을 실행하지 않음
2. GitHub 업로드 대상/브랜치가 다름
3. 브라우저 Streamlit session_state에 이전 status_message가 남아 있음

## 수정
- APP_VERSION = v11-deploy-check-dateback 추가
- 헤더 칩에 앱 버전 표시
- 앱 버전 변경 시 이전 status_message와 last_collect_report 초기화
- 게시판별 진단 expander를 항상 표시
- 완료 메시지에 APP_VERSION 명시
