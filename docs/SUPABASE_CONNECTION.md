# Supabase 연결 가이드

## 반드시 pooler URL 사용
Render에서는 Direct connection(`db.xxxxx.supabase.co:5432`)보다 pooler URL을 사용합니다.

형식:
```text
postgresql://postgres.PROJECT_REF:DB_PASSWORD@POOLER_HOST:6543/postgres
```

주의:
- `postgres.postgresql` 아님
- `[YOUR-PASSWORD]` 문구 남기지 않음
- 대괄호 `[` `]` 넣지 않음
- DB 비밀번호는 Render Environment에만 입력

## 앱 동작
- 조회: Supabase DB 조회만 수행
- 빠른수집: 각 게시판 첫 페이지 수집
- 기간수집: 선택 기간 여러 페이지 수집
