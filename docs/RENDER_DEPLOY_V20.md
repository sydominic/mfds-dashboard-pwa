# Render Deploy V20

## 배포 전 확인
이 버전은 Node/React Render 서비스용입니다. Streamlit `app.py`는 사용하지 않습니다.

Render 설정:

```text
Build Command: bash render-build.sh
Start Command: node server/src/index.js
```

환경변수:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
AUTO_COLLECT_ON_LOAD=false
```

## 배포 후 확인
1. 화면 상단 메타 영역에 `v20-node-mfds-parser-diagnostics` 표시
2. 빠른수집 실행
3. `게시판별 수집 결과 / 파서 진단` 표 확인
4. m_99 보도자료의 `DATEBACK` 또는 `ANCHOR`가 1 이상인지 확인
5. Render Logs에서 `[mfds-parse] m_99` 검색
