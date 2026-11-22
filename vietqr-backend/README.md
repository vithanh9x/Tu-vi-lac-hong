# Tử Vi Lạc Hồng — VietQR API

This is a separate API-only Vercel project rooted at `vietqr-backend/`.
It does not replace the main website.

## Routes

- `GET /api/health`
- `POST /api/token_generate` — callback token endpoint for VietQR Merchant
- `POST /api/bank/api/transaction-sync` — VietQR credit callback
- `POST /api/payment/create` — create a dynamic QR order
- `GET /api/payment/status?orderId=...` — poll order and retrieve signed TV27 license

## Required Vercel environment variables

`VIETQR_MERCHANT_NAME`, `VIETQR_PUBLIC_ORIGIN`, `VIETQR_BASE_PATH`,
`VIETQR_API_BASE`, `VIETQR_API_USERNAME`, `VIETQR_API_PASSWORD`,
optional `VIETQR_API_KEY`, `VIETQR_BANK_CODE`, `VIETQR_BANK_ACCOUNT`,
`VIETQR_ACCOUNT_NAME`, `VIETQR_CALLBACK_USERNAME`,
`VIETQR_CALLBACK_PASSWORD`, `VIETQR_CALLBACK_JWT_SECRET`,
`ORDER_TOKEN_SECRET`, `LICENSE_RSA_PRIVATE_KEY_B64`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_ORIGIN`.

Never commit secrets, credentials, Redis tokens, or RSA private keys.
Connect an Upstash Redis store through the Vercel Marketplace so order state
persists across serverless invocations.

The main website project should proxy its `/vqr/*` paths to this API project's
production deployment URL only after health checks and test transactions pass.
