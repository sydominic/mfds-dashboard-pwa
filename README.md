# MFDS Regulatory PWA v21 Node/Render RSS Collect Fix

이 패키지는 **Node/React/Vite + Express 서버 + Render 배포용** 구조입니다.
Python/Streamlit 실행 구조가 아니며, `app.py`, `requirements.txt`, Streamlit 실행 명령은 포함하지 않았습니다.

## 실행 구조

- Frontend: `client/` React + Vite
- Backend: `server/src/index.js` Express API
- Render: `render.yaml`, `render-build.sh`
- 로컬 실행: `run_local.bat`

## v21 핵심 수정

1. 식약처 공식 RSS를 1차 수집 경로로 사용합니다.
2. 기존 HTML 게시판 파싱은 보조 경로로 유지합니다.
3. 빠른수집/기간수집 결과에 RSS 확인 건수, HTML 확인 건수, 최신 확인일, 오류 요약을 표시합니다.
4. `/api/health`의 `apiVersion`은 `v21-rss-primary-collect-fix`입니다.

## Render 배포

Render Web Service 기준은 기존과 동일합니다.

- Environment: Node
- Build Command: `bash render-build.sh`
- Start Command: `node server/src/index.js`
- Health Check Path: `/api/health`

## 로컬 확인

1. `run_local.bat` 실행
2. 브라우저에서 앱 접속
3. `/api/health`에서 `apiVersion` 확인
4. 기간을 `2026-05-21~2026-05-28` 등으로 설정 후 빠른수집/기간수집 확인

## Git commit message

```bash
fix: switch MFDS collection to official RSS in Node Render app
```
