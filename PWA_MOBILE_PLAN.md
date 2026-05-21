MFDS Regulatory Dashboard - PWA / Mobile Plan
============================================

최종 목표
---------
제약뉴스 PWA와 같은 구조로 다음을 지원합니다.

1. PC판
   - 전체 조회조건 노출
   - 식약처 정보 / 구분별 정보 / 공식 게시판 탭
   - 표 중심 상세조회

2. 모바일판
   - 조회조건 기본 숨김
   - [조회조건] 버튼 클릭 후 하단 패널에서 조건 입력
   - 주요 KPI는 2x2 카드
   - 게시물 목록은 카드형 1열
   - 공식 게시판은 버튼형 진입

3. PWA
   - manifest / icon / service worker
   - Android: Chrome 앱 설치 또는 홈 화면 추가
   - iPhone: Safari 공유 버튼 > 홈 화면에 추가
   - Render HTTPS 배포 후 설치성 확인

진행 순서
---------
1. v3: 로컬 실행/로그 안정화
2. v4: PC 화면 기능 보정 및 수집 안정화
3. v5: 모바일 레이아웃 1차
4. v6: PWA 설치 안내 및 manifest/icon/service worker 정리
5. v7: Render 배포용 정리
6. v8: 제약뉴스 PWA REGULATORY_DASHBOARD_URL 연결
