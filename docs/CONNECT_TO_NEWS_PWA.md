# 제약뉴스 PWA와 연결 방법

MFDS 공식자료 앱 배포가 끝나면 Render URL이 생성됩니다.
예:
```text
https://mfds-regulatory-pwa.onrender.com
```

기존 제약뉴스 PWA Render 서비스로 이동합니다.

Environment Variables에 아래 값을 추가하거나 수정합니다.

```text
REGULATORY_DASHBOARD_URL = https://mfds-regulatory-pwa.onrender.com
```

그 다음 제약뉴스 PWA 서비스를 재시작 또는 재배포합니다.

```text
Manual Deploy > Deploy latest commit
```

이후 제약뉴스 PWA의 `규제기관 공식자료` 버튼을 누르면 MFDS 공식자료 앱이 새 창으로 열려야 합니다.
