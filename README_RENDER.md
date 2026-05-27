# MFDS Regulatory Dashboard - Render 배포용 전체 세트

## 포함 파일

```text
app.py
requirements.txt
render.yaml
start.sh
runtime.txt
.streamlit/config.toml
README.md
README_RENDER.md
SECRETS_EXAMPLE.txt
.gitignore
data/.gitkeep
logs/.gitkeep
output/.gitkeep
```

## Render 배포 방법

### 1. GitHub 업로드
이 ZIP을 압축 해제한 뒤, 내부 파일 전체를 GitHub repository에 업로드합니다.

기존 repository를 쓰는 경우에는 기존 파일을 덮어씁니다.

### 2. Render Web Service 설정

Render에서 기존 Web Service를 쓰는 경우:

```text
Build Command
pip install -r requirements.txt
```

```text
Start Command
bash start.sh
```

또는 `render.yaml`을 Blueprint로 사용할 수 있습니다.

### 3. Environment Variables 설정

Render 서비스의 Environment 메뉴에서 아래 값을 넣습니다.

```text
DATABASE_URL
postgresql://postgres.프로젝트ref:DB비밀번호@pooler호스트:6543/postgres
```

```text
AUTO_COLLECT_ON_LOAD
false
```

권장값:

```text
AUTO_COLLECT_ON_LOAD=false
```

이렇게 해야 앱 접속 시 무조건 수집하지 않고, DB 조회 화면을 먼저 띄웁니다.

### 4. Supabase 연결 문자열

Render에서는 Supabase Direct connection보다 Transaction pooler 사용을 권장합니다.

형식:

```text
postgresql://postgres.프로젝트ref:DB비밀번호@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
```

주의:
- `[YOUR-PASSWORD]` 문구를 남기지 않습니다.
- 대괄호 `[` `]`를 넣지 않습니다.
- `postgres.postgresql`로 쓰지 않습니다.
- Direct connection인 `db.xxxxx.supabase.co:5432`가 아니라 pooler `:6543`을 사용합니다.

## 앱 사용 방법

### 조회
선택한 기간과 검색어 기준으로 Supabase DB에 이미 저장된 데이터만 조회합니다.
수집은 하지 않습니다.

### 빠른수집
각 식약처 게시판 첫 페이지만 확인하여 신규 게시물을 Supabase DB에 저장합니다.

### 기간수집
선택한 기간 전체를 여러 페이지까지 확인하여 누락을 줄입니다.
최초 구축 또는 장기간 보강 시 사용합니다.

## 문제 확인

Render에서 문제가 생기면:

```text
Render Service
→ Logs
```

에서 확인합니다.

DB 연결 문제는 앱 화면에도 안내가 표시되도록 되어 있습니다.


## v8 추가 안내
수집이 계속 5/22 등 과거 날짜에서 멈추는 경우, 빠른수집 후 `게시판별 수집 결과 보기`와 Render Logs를 같이 확인하십시오.

Render Logs 확인 문자열:
```text
MFDS m_99 page parse
MFDS m_74 page parse
```

`text=` 값이 1 이상이면 신규 fallback 파서가 동작한 것입니다.


## v9 수정사항
- 수집 확인 0건 문제를 추가 보정했습니다.
- text fallback 파서가 더 이상 `#contents` 등 추정 본문 영역에 의존하지 않고 전체 HTML 텍스트를 기준으로 게시번호→제목→날짜 패턴을 재구성합니다.
- 게시판별 수집 결과에 파서 진단 컬럼을 추가했습니다.
  - HTML크기
  - 라인수
  - 전체건표식
  - TR/CARD/TEXT 파서 건수
  - 오류
