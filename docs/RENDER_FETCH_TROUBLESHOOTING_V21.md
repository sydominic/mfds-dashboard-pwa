# Render Fetch Troubleshooting V21

## 진단표 해석

| 컬럼 | 의미 |
|---|---|
| FETCH | 성공한 HTML 요청 방식 |
| HTML | Render가 받은 HTML 길이 |
| 라인 | HTML 텍스트 라인 수 |
| 전체건 | 식약처 목록의 `전체 n건` 표식 존재 여부 |
| 오류상세 | 모든 fetch 방식 실패 시 실제 원인 |

## 오류별 의미

- `ECONNRESET`: 식약처 서버 또는 중간 보안장비가 연결을 끊음
- `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT`: Render에서 식약처까지 연결 지연/실패
- `ENOTFOUND`: DNS 실패
- `CERT_*` / `TLS`: 인증서 또는 TLS handshake 문제
- `curl failed`: Node 방식과 curl 방식 모두 실패

## 다음 조치
v21에서도 모든 방식이 실패하면 Render outbound IP/정부 사이트 차단 가능성이 큽니다.
그 경우 수집만 Render 밖에서 수행하거나 GitHub Actions/로컬 배치/Supabase Edge Function 등 별도 수집기로 분리하는 방향을 검토합니다.
