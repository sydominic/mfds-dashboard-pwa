# MFDS Regulatory PWA - Render 무료 배포

## 서비스 종류
Render에서는 Static Site가 아니라 **Web Service**로 생성합니다.

## 필수 설정

Build Command:
```text
bash render-build.sh
```

Start Command:
```text
node server/src/index.js
```

Health Check Path:
```text
/api/health
```

## 필수 Environment Variables

```text
DATABASE_URL = Supabase PostgreSQL connection string
NODE_VERSION = 20.11.1
```

선택:
```text
AUTO_COLLECT_ON_LOAD = false
```

## 주의
- `PORT`는 Render가 자동으로 주입하므로 직접 넣지 않습니다.
- 이 앱은 Supabase API key가 아니라 PostgreSQL `DATABASE_URL`을 사용합니다.
- 기존 Streamlit v7에서 사용한 `DATABASE_URL` 또는 `SUPABASE_DB_URL`과 같은 값을 사용하면 됩니다.
