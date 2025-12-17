# WookStars (MVP)

This starter project deploys to **Cloudflare Pages** and supports **anonymous video uploads**.

## What you get
- Static front page + feed
- Upload modal
- Cloudflare Pages Functions API:
  - `POST /api/upload/prepare` -> returns a signed R2 upload URL
  - `POST /api/upload/complete` -> marks upload ready
  - `GET /api/feed` -> latest uploads
  - `GET /api/video?id=...` -> signed playback URL

## Requirements
- Cloudflare account
- Cloudflare Pages project
- Cloudflare R2 bucket
- Cloudflare D1 database
- R2 Access Key + Secret (S3-compatible API tokens)

See the setup steps in the chat response.
