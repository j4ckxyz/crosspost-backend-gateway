# Crosspost Gateway Backend

A secure, standards-based API gateway for client applications (iOS, web, CLI) that publish content to:
- X (Twitter for Web) via `emusks`
- Bluesky via `@atproto/api`
- Mastodon via `masto`

## What This Supports

- Single posts and multi-segment threads
- Crossposting to one or many platforms in one request
- Media uploads with alt text
- Bluesky-safe media rules (1 video OR 1-4 images per post segment)
- Character-limit enforcement:
  - X: 280 (non-premium assumption)
  - Bluesky: 300
  - Mastodon: fetched live per instance
- Scheduled publishing with encrypted job payloads
- Bearer API-key authentication
- OpenAPI docs + RFC 7807 errors
- Curlable HTML status page
- Optional direct HTTPS support
- Global rate limiting and security headers

## API Standards

- REST-style HTTP endpoints
- OpenAPI 3.1: `GET /openapi.json`
- Interactive docs: `GET /docs`
- RFC 7807 problem details (`application/problem+json`)
- ISO 8601 / RFC 3339 timestamps

## Detailed Docs

- Feature reference: [`docs/FEATURES.md`](docs/FEATURES.md)
- Full endpoint documentation: [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)
- Hosting and security hardening: [`docs/HOSTING_AND_SECURITY.md`](docs/HOSTING_AND_SECURITY.md)
- Client app integration guide: [`docs/CLIENT_BUILDING_GUIDE.md`](docs/CLIENT_BUILDING_GUIDE.md)

## Requirements

- Node.js 20+
- npm 10+
- Linux or macOS

## Install

```bash
npm install
```

## Configuration

Use `.env.example` as reference.

Important variables:

- `API_KEYS` (comma-separated bearer keys)
- `SCHEDULER_ENCRYPTION_KEY` (required for persistent scheduled jobs across restarts)
- `PORT` (default `0` = random high port)
- `TLS_KEY_PATH` + `TLS_CERT_PATH` (optional direct HTTPS)

## Run

```bash
npm run dev
```

or

```bash
npm run build
npm start
```

## Common Endpoints

- `GET /status` (HTML status page)
- `GET /v1/limits` (platform limits for client-side composer validation)
- `POST /v1/posts` (single post or thread, immediate or scheduled)
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `DELETE /v1/jobs/:jobId`

## Quick Thread Example

```bash
curl -X POST http://127.0.0.1:<PORT>/v1/posts \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "thread": [
      {"text": "Thread 1/2"},
      {"text": "Thread 2/2"}
    ],
    "targets": {
      "x": {"authToken": "YOUR_X_AUTH_COOKIE"},
      "bluesky": {
        "identifier": "you.bsky.social",
        "pdsUrl": "https://bsky.social",
        "appPassword": "xxxx-xxxx-xxxx-xxxx"
      },
      "mastodon": {
        "instanceUrl": "https://mastodon.social",
        "accessToken": "YOUR_MASTODON_TOKEN"
      }
    }
  }'
```
