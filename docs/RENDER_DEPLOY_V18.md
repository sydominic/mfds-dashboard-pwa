# MFDS Regulatory PWA v18 - Render 배포 방법

## 1. GitHub 저장소
새 repository를 만들거나 기존 MFDS regulatory PWA repository를 사용합니다.
압축을 푼 폴더 안의 내용물을 repository 루트에 업로드합니다.

GitHub에 올리면 안 되는 파일:
- `.env`
- `node_modules/`
- `client/node_modules/`
- `server/node_modules/`
- `client/dist/`
- `*.log`

## 2. Render 서비스 종류
Render에서는 **Static Site가 아니라 Web Service**를 선택합니다.

## 3. Render 설정

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

Instance Type:
```text
Free
```

## 4. Environment Variables

권장 방식: Supabase REST mode
```text
SUPABASE_URL = https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY = service_role 또는 secret key
NODE_VERSION = 20.11.1
AUTO_COLLECT_ON_LOAD = false
```

대체 방식: PostgreSQL connection string
```text
DATABASE_URL = postgresql://...
NODE_VERSION = 20.11.1
AUTO_COLLECT_ON_LOAD = false
```

주의:
- `PORT`는 넣지 않습니다. Render가 자동으로 제공합니다.
- `VITE_API_BASE_URL`도 넣지 않습니다.
- `SUPABASE_SERVICE_KEY`는 GitHub에 올리지 말고 Render 환경변수에만 넣습니다.

## 5. 배포 후 확인
```text
https://생성된주소.onrender.com/api/health
```

정상 예시:
```json
{
  "ok": true,
  "apiVersion": "v18-render-ready-no-ui-version"
}
```

## 6. 제약뉴스 PWA와 연결
이 앱이 Render에 올라가면, 제약뉴스 PWA의 Render Environment Variables에 아래 값을 추가합니다.

```text
REGULATORY_DASHBOARD_URL = https://이앱주소.onrender.com
```

그 뒤 제약뉴스 PWA를 재배포하면 `규제기관 공식자료` 버튼으로 연결됩니다.
