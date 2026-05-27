# Render 배포 절차

## 1. GitHub 업로드
ZIP 압축을 풀고 파일 전체를 repository root에 업로드합니다.

## 2. Render Web Service
기존 서비스를 쓰는 경우 아래 설정을 확인합니다.

Build Command:
```bash
pip install -r requirements.txt
```

Start Command:
```bash
bash start.sh
```

## 3. Environment Variables
Render > Service > Environment에서 입력합니다.

```text
DATABASE_URL=postgresql://postgres.PROJECT_REF:DB_PASSWORD@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
AUTO_COLLECT_ON_LOAD=false
PYTHON_VERSION=3.11.15
```

## 4. 배포
Manual Deploy 또는 GitHub push 자동 배포를 사용합니다.
