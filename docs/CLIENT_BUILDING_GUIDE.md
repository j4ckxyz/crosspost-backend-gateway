# Client Building Guide

This gateway is designed as a backend-for-publishing that frontends can safely build on.

Supported client types:
- iOS / Android native apps
- Web apps
- CLI tools / automation scripts

## Core Client Flow

1. Fetch compose limits (`GET /v1/limits`) to configure your UI.
2. Let user compose `text` or `thread`.
3. If media exists, submit `multipart/form-data` with `payload` + `media` files.
4. If scheduling, include `scheduleAt`.
5. Store returned `job.id` or publish result IDs in your app state.

## iOS App Patterns

- Use `URLSessionUploadTask` for multipart media payloads.
- Add retry with exponential backoff for `429` and transient `5xx`.
- Persist `clientRequestId` per action to correlate logs/analytics.
- Validate character count and media rules client-side before submit.

## Web App Patterns

- Keep API keys server-side (BFF pattern) when possible.
- For direct browser-to-gateway use, protect keys with strict CSP and secure storage strategy.
- Build composer UI around `thread[]` segments and per-segment media attachments.
- Show partial delivery outcomes using the `deliveries` object.

## CLI Patterns

- Use JSON requests for text-only workflows.
- Use multipart for files and alt text metadata.
- Poll job status for scheduled posts: `GET /v1/jobs/:jobId`.
- Use non-zero exit code when `overall=partial` or target-specific failures occur.

## Suggested Client-Side Validation

Use `/v1/limits` and enforce before submit:
- X segment <= 280 chars
- Bluesky segment <= 300 chars
- Bluesky media per segment: 1 video or 1-4 images (no mixed)
- Mastodon segment <= instance `maxCharacters`

## Handling Responses

Immediate publish responses:
- `201`: all targets succeeded
- `207`: partial success

Scheduled responses:
- `202`: accepted and queued

Always parse `deliveries` per platform to display actionable status.

## Error Handling Contract

Errors are RFC 7807 problem details.

Client recommendations:
- Render `title` + `detail` to user.
- Log `type` for analytics.
- Map expected `type` values to user-friendly messages.
- Retry only when error class is transient (`429`, `502`, `500`).

## Security Guidance For Client Builders

- Never hardcode gateway API keys in distributed binaries when avoidable.
- For mobile/web products, proxy through your own app backend to protect keys.
- Rotate API keys and support revocation in your operational process.
- Avoid logging raw credentials and auth headers in client logs.
