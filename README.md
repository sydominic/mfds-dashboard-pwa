# MFDS Regulatory Dashboard - Supabase 운영형

## 핵심 변경
- Supabase PostgreSQL을 외부 DB로 사용합니다.
- 앱 접속 시 무조건 수집하지 않습니다.
- DB에 저장된 데이터를 먼저 빠르게 표시합니다.
- [수동 재수집]을 누르면 선택 기간을 수집하여 Supabase에 신규 항목만 누적합니다.
- `AUTO_COLLECT_ON_LOAD = true`를 설정하면 1일 1회 자동 수집도 가능합니다.

## GitHub 업로드 파일
아래 4개 파일만 GitHub repository에 드래그 업로드하면 됩니다.

```text
app.py
requirements.txt
README.md
SECRETS_EXAMPLE.txt
```

## Streamlit Cloud 설정
- Repository: 본 GitHub repository
- Branch: `main`
- Main file path: `app.py`
- Python version: `3.11` 또는 `3.12` 권장

## Supabase 사용 방법

### 1. Supabase 프로젝트 생성
1. Supabase에 로그인합니다.
2. New project를 만듭니다.
3. Database password를 설정합니다.
4. 프로젝트 생성이 끝날 때까지 기다립니다.

### 2. Connection string 복사
Supabase Project 화면에서 아래 경로로 이동합니다.

```text
Project Settings > Database > Connection string
```

Streamlit Cloud 같은 환경은 연결이 짧게 반복될 수 있으므로, Supabase의 pooler connection string 사용을 권장합니다.

예시 형식:

```text
postgresql://postgres.xxxxxx:YOUR_PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
```

`YOUR_PASSWORD`를 실제 DB password로 바꿉니다.

### 3. Streamlit Secrets 입력
Streamlit Cloud 앱 생성 또는 앱 Settings에서 Secrets에 아래처럼 입력합니다.

```toml
DATABASE_URL = "postgresql://postgres.xxxxxx:YOUR_PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres"
AUTO_COLLECT_ON_LOAD = false
```

처음에는 `AUTO_COLLECT_ON_LOAD = false`를 권장합니다.
이렇게 하면 접속할 때 오래 수집하느라 멈추지 않고, DB에 저장된 자료부터 바로 보여줍니다.

### 4. 최초 데이터 수집
앱이 배포되면 화면에서 기간을 선택하고 [수동 재수집]을 누릅니다.

추천 최초 수집:
```text
직접 선택: 2026-01-01 ~ 오늘
수동 재수집 클릭
```

수집된 데이터는 Supabase DB에 저장됩니다.
이후 접속자는 DB 데이터를 바로 조회합니다.

## 자동 수집을 켜고 싶을 때
Secrets에서 아래처럼 바꿉니다.

```toml
AUTO_COLLECT_ON_LOAD = true
```

이 경우 하루에 한 번, 첫 접속자가 최근 14일 기준 수집을 수행합니다.
다만 그 접속자는 수집이 끝날 때까지 로딩을 기다릴 수 있습니다.

## 주의
실제 DB 비밀번호는 GitHub에 올리지 마세요.
Secrets는 Streamlit Cloud Settings에서만 입력합니다.


## v2 수정사항
- 수동 재수집 시 최근 7일/14일은 각 식약처 게시판 1페이지만 빠르게 확인하도록 변경했습니다.
- 15~31일은 3페이지, 32~90일은 8페이지, 그 이상은 20페이지까지 확인합니다.
- HTTP timeout과 retry 횟수를 줄여 Streamlit Cloud에서 로딩이 오래 멈추는 문제를 완화했습니다.
- 수집 완료 후 자동으로 화면을 갱신합니다.

## 운영 권장
- 평소에는 `최근 7일` 또는 `최근 14일` 기준으로 수동 재수집하세요.
- 1/1부터 오늘까지 같은 장기 수집은 최초 1회 또는 필요할 때만 실행하세요.


## v3 수정사항
- [조회] 버튼을 추가했습니다.
  - 기간/검색어를 바꾼 뒤 [조회]를 눌러야 Supabase DB 조회 조건이 적용됩니다.
  - [조회]는 절대 재수집하지 않습니다.
- [빠른수집]과 [기간수집]을 분리했습니다.
  - 빠른수집: 선택 기간 기준, 각 식약처 게시판 첫 페이지만 확인합니다.
  - 기간수집: 선택 기간 기준, 여러 페이지를 날짜 기준으로 확인하여 누락을 줄입니다.
- 14일 초과 기간을 선택해도 자동 재수집하지 않고, Supabase DB에 저장된 데이터만 조회합니다.
- 수집은 반드시 [빠른수집] 또는 [기간수집] 버튼을 눌렀을 때만 실행됩니다.

## 권장 사용
1. 평소 확인: 기간/검색어 선택 → [조회]
2. 오늘 또는 최근 신규 확인: 기간 선택 → [빠른수집]
3. 2026-01-01부터 오늘까지 등 전체 보강: 직접 선택 → [기간수집]


## v4 수정사항
- 앱 시작 직후 DB 연결에서 멈춰 흰 로딩 화면만 보이는 문제를 완화했습니다.
- 화면 구성 후 DB 연결을 확인하도록 변경했습니다.
- Supabase 연결 실패 시 전체 Traceback 대신 DATABASE_URL 점검 안내를 표시합니다.
- PostgreSQL 연결에 `connect_timeout=8`, `sslmode=require`를 적용했습니다.
- DB 조회/수집 중 오류가 나면 원인 메시지를 화면에 표시하고 앱을 안전하게 중단합니다.


## v4.1 수정사항
- [조회] 버튼 스타일을 [빠른수집], [기간수집] 버튼과 동일한 primary 버튼 형태로 통일했습니다.


## v4.2 수정사항
- [조회], [빠른수집], [기간수집] 버튼에 마우스 오버 설명을 추가했습니다.
- 조회: Supabase DB 저장 데이터만 조회
- 빠른수집: 각 게시판 첫 페이지만 신규 확인
- 기간수집: 선택 기간 전체를 여러 페이지까지 수집


## v5 수정사항
- 식약처 게시판 파서를 보강했습니다.
- 기존 `li` 전체 탐색 방식 대신 `tr` 목록형 파서를 우선 적용하고, 카드형 `li/div` 파서를 보조 적용합니다.
- 미리보기/다운받기/첨부파일/메뉴성 링크가 제목으로 잡히지 않도록 제외 조건을 강화했습니다.
- 빠른수집에서 5/26, 5/27 등 최신 1페이지 게시물이 누락되는 문제를 줄였습니다.
- 수집 후 게시판별 확인/신규/중복/최신게시일 결과를 화면에서 확인할 수 있도록 추가했습니다.


## Render 배포 참고
Render 배포용 전체 설명은 `README_RENDER.md`를 확인하십시오.

필수 실행 설정:
```text
Build Command: pip install -r requirements.txt
Start Command: bash start.sh
```


## V7 Render Fullset

이번 세트는 Render 배포용 전체 구성입니다.
단순 4개 파일 세트가 아니라 Render 실행 파일, 환경변수 예시, Supabase schema, 문서, 로컬 점검 BAT까지 포함합니다.

주의:
이 세트는 React/Node(client/server) 구조가 아니라 Streamlit + Supabase + Render 구조입니다.


## v8 수정사항
- 식약처 수집 누락 원인 대응: 텍스트 라인 fallback 파서를 추가했습니다.
- 제목→담당부서/조회수→첨부파일→날짜로 펼쳐지는 식약처 목록 구조를 직접 재구성합니다.
- 기존 tr/card 파서가 실패해도 게시번호→제목→날짜 패턴으로 보도자료, 공지 등 최신글을 잡도록 보강했습니다.
- Render Logs에 파서별 수집 건수 로그를 남깁니다.


## v9 수정사항
- 수집 확인 0건 문제를 추가 보정했습니다.
- text fallback 파서가 더 이상 `#contents` 등 추정 본문 영역에 의존하지 않고 전체 HTML 텍스트를 기준으로 게시번호→제목→날짜 패턴을 재구성합니다.
- 게시판별 수집 결과에 파서 진단 컬럼을 추가했습니다.
  - HTML크기
  - 라인수
  - 전체건표식
  - TR/CARD/TEXT 파서 건수
  - 오류
