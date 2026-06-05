# Marketplace Sales Sync

Local agent flow:

1. Open a channel-specific persistent Chrome profile.
2. Log in with the configured ID/password.
3. Complete second-factor auth automatically.
   - WCONCEPT: read the latest Gmail verification code.
   - MUSINSA/29CM: generate a TOTP code from the local secret.
4. Open the order list page, select a date range, and download Excel.
5. POST the downloaded file to the existing dashboard upload parser.

The dashboard button calls `POST /api/influencer/agent-proxy` with endpoint
`/sales-sync`. The local agent then calls `DASHBOARD_UPLOAD_BASE_URL/api/upload`.

## Required Local Agent Env

Set these in `local-agent/.env`. Keep credentials local; do not put them in
Vercel env unless you intentionally run a trusted private browser worker.

```env
DASHBOARD_UPLOAD_BASE_URL=http://localhost:3000
MARKETPLACE_CHROME_PROFILE_ROOT=/Users/yourname/.paulvice-marketplace-agent

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

WCONCEPT_LOGIN_URL=
WCONCEPT_ORDERS_URL=
WCONCEPT_LOGIN_ID=
WCONCEPT_LOGIN_PASSWORD=
WCONCEPT_ID_SELECTOR=
WCONCEPT_PASSWORD_SELECTOR=
WCONCEPT_LOGIN_BUTTON_SELECTOR=
WCONCEPT_EMAIL_CODE_SELECTOR=
WCONCEPT_EMAIL_CODE_SUBMIT_SELECTOR=
WCONCEPT_GMAIL_REFRESH_TOKEN=
WCONCEPT_GMAIL_QUERY=from:(wconcept) newer_than:10m
WCONCEPT_DATE_START_SELECTOR=
WCONCEPT_DATE_END_SELECTOR=
WCONCEPT_SEARCH_BUTTON_SELECTOR=
WCONCEPT_DOWNLOAD_BUTTON_SELECTOR=

MUSINSA_LOGIN_URL=
MUSINSA_ORDERS_URL=
MUSINSA_LOGIN_ID=
MUSINSA_LOGIN_PASSWORD=
MUSINSA_TOTP_SECRET=
MUSINSA_ID_SELECTOR=
MUSINSA_PASSWORD_SELECTOR=
MUSINSA_LOGIN_BUTTON_SELECTOR=
MUSINSA_OTP_SELECTOR=
MUSINSA_OTP_SUBMIT_SELECTOR=
MUSINSA_DATE_START_SELECTOR=
MUSINSA_DATE_END_SELECTOR=
MUSINSA_SEARCH_BUTTON_SELECTOR=
MUSINSA_DOWNLOAD_BUTTON_SELECTOR=

CM29_LOGIN_URL=
CM29_ORDERS_URL=
CM29_LOGIN_ID=
CM29_LOGIN_PASSWORD=
CM29_TOTP_SECRET=
CM29_ID_SELECTOR=
CM29_PASSWORD_SELECTOR=
CM29_LOGIN_BUTTON_SELECTOR=
CM29_OTP_SELECTOR=
CM29_OTP_SUBMIT_SELECTOR=
CM29_DATE_START_SELECTOR=
CM29_DATE_END_SELECTOR=
CM29_SEARCH_BUTTON_SELECTOR=
CM29_DOWNLOAD_BUTTON_SELECTOR=
```

Selectors can be CSS selectors or Playwright text selectors such as
`text=엑셀 다운로드`.
