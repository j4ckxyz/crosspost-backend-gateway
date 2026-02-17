# Features

## 1. Multi-Platform Gateway

The API accepts a single publish request and fans out to one or more targets:
- X via `auth_token` cookie (`emusks` client)
- Bluesky via identifier + PDS URL + app password (`@atproto/api`)
- Mastodon via instance URL + access token (`masto`)

The response includes per-platform delivery details so clients can show success/failure per network.

## 2. Single Posts + Threads

A request can contain:
- `text` for a single post
- `thread` for multiple segments

Thread behavior by platform:
- X: each segment is posted as a reply to the previous segment.
- Bluesky: each segment is posted with proper `reply.root` and `reply.parent` references.
- Mastodon: each segment is posted with `inReplyToId` pointing to the previous segment.

## 3. Media + Alt Text

Media is submitted with `multipart/form-data` and a JSON `payload` field.

Each media metadata item can include:
- `altText`
- `threadIndex` (which thread segment this media belongs to)

This allows attaching different media to different thread segments in one API request.

## 4. Character Limit Enforcement

Preflight validation blocks invalid requests before any platform publishing starts.

Current limits enforced:
- X: 280 characters per segment (non-premium assumption)
- Bluesky: 300 characters per segment
- Mastodon: fetched from the actual target instance (`/api/v2/instance`) per request

## 5. Bluesky Media Rule Enforcement

Bluesky has stricter media rules, enforced per thread segment:
- Either exactly 1 video (`video/mp4`) OR 1-4 images
- No mixed image+video in the same segment

This is validated before publish to avoid partial failures.

## 6. Scheduled Publishing

If `scheduleAt` is provided, the request is queued.

Scheduler behavior:
- Job metadata stored in `.data/jobs.json`
- Credentials + text payload encrypted at rest (AES-256-GCM)
- Uploaded media persisted to `.data/scheduled-media/<jobId>/`
- Background worker executes due jobs and updates status
- Jobs can be listed, fetched by ID, and cancelled

## 7. API Security Model

Security mechanisms built in:
- Bearer API key authentication on `/v1/*`
- Constant-time API key comparison
- Security headers via `@fastify/helmet`
- Global rate limits via `@fastify/rate-limit`
- Optional direct HTTPS with `TLS_KEY_PATH` + `TLS_CERT_PATH`
- Redaction of credential fields in request logs

## 8. Client-Focused API Design

The gateway is designed for app developers:
- Stable JSON contracts for iOS/web/CLI clients
- Per-platform delivery result structure
- `clientRequestId` passthrough for client-side request correlation
- `/v1/limits` endpoint to drive compose UIs with live limit data
- RFC 7807 problem details for consistent error handling

## 9. Operational Visibility

- `GET /status` returns a simple HTML status page suitable for `curl`
- OpenAPI docs at `/openapi.json` and `/docs`
- Structured logs include job lifecycle and request outcomes
