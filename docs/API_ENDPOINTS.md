# API Endpoints

Base URL examples:
- `http://127.0.0.1:<PORT>`
- `https://gateway.your-domain.tld` (with TLS)

Authentication:
- All `/v1/*` endpoints require `Authorization: Bearer <API_KEY>`

---

## GET /

Returns basic API metadata and discovery links.

### Response

```json
{
  "name": "crosspost-gateway",
  "version": "1.1.0",
  "docs": "/docs",
  "openapi": "/openapi.json",
  "status": "/status"
}
```

---

## GET /status

Public HTML health/status page that can be checked with `curl`.

### Response
- `200 text/html`

---

## GET /openapi.json

Returns the OpenAPI 3.1 document.

### Response
- `200 application/json`

---

## GET /v1/limits

Fetch platform compose limits for client-side validation.

### Auth
- Required

### Query Parameters
- `mastodonInstanceUrl` (optional, URL)
- `mastodonAccessToken` (optional string)

If `mastodonInstanceUrl` is provided, live limits are fetched from that instance.

### Example

```bash
curl -H "Authorization: Bearer <API_KEY>" \
  "http://127.0.0.1:<PORT>/v1/limits?mastodonInstanceUrl=https%3A%2F%2Fmastodon.social"
```

### Response

```json
{
  "x": {
    "maxCharacters": 280,
    "assumedUserTier": "non-premium"
  },
  "bluesky": {
    "maxCharacters": 300,
    "mediaRule": "either 1 video or 1-4 images per post segment"
  },
  "mastodon": {
    "instanceUrl": "https://mastodon.social",
    "maxCharacters": 500,
    "maxMediaAttachments": 4,
    "charactersReservedPerUrl": 23,
    "supportedMimeTypes": ["image/jpeg", "image/png"],
    "imageSizeLimit": 10485760,
    "videoSizeLimit": 41943040,
    "fetchedAt": "2026-02-17T10:00:00.000Z"
  }
}
```

---

## POST /v1/posts

Create an immediate post/thread or schedule one for future publishing.

### Auth
- Required

### Content Types
- `application/json` (text/thread only, no files)
- `multipart/form-data` (for media uploads)

### JSON Request Model

```json
{
  "text": "optional-single-post",
  "thread": [
    { "text": "segment one" },
    { "text": "segment two" }
  ],
  "scheduleAt": "2026-12-05T12:00:00Z",
  "clientRequestId": "ios-app-req-42",
  "targets": {
    "x": {
      "authToken": "X_AUTH_COOKIE",
      "client": "web"
    },
    "bluesky": {
      "identifier": "you.bsky.social",
      "pdsUrl": "https://bsky.social",
      "appPassword": "xxxx-xxxx-xxxx-xxxx"
    },
    "mastodon": {
      "instanceUrl": "https://mastodon.social",
      "accessToken": "MASTODON_TOKEN",
      "visibility": "public"
    }
  }
}
```

Rules:
- Provide either `text` or `thread` (not both).
- `thread` is an array of post segments.
- `scheduleAt` optional; if present, request is queued.

### Multipart Media Request Model

`multipart/form-data` with:
- `payload` field: JSON string using the same model above
- `media` file parts: one or more files

To map media to thread segments, use `payload.media`:

```json
{
  "thread": [{"text":"one"},{"text":"two"}],
  "targets": {"x":{"authToken":"..."}},
  "media": [
    {"threadIndex":0,"altText":"image for segment 1"},
    {"threadIndex":1,"altText":"image for segment 2"}
  ]
}
```

### Responses

- `201` full success (all targets succeeded)
- `207` partial success (some targets failed)
- `202` scheduled

#### 201 / 207 Example

```json
{
  "overall": "partial",
  "postedAt": "2026-02-17T10:30:00.000Z",
  "clientRequestId": "ios-app-req-42",
  "deliveries": {
    "x": {
      "ok": true,
      "platform": "x",
      "id": "1891234567890123456",
      "url": "https://x.com/user/status/1891234567890123456"
    },
    "bluesky": {
      "ok": false,
      "platform": "bluesky",
      "error": "..."
    }
  }
}
```

#### 202 Example

```json
{
  "scheduled": true,
  "job": {
    "id": "4bc46e65-68bd-41ab-b42b-1d3825c97b37",
    "createdAt": "2026-02-17T10:28:30.365Z",
    "runAt": "2026-12-05T12:00:00.000Z",
    "status": "scheduled",
    "attemptCount": 0
  }
}
```

---

## GET /v1/jobs

List scheduled/completed jobs.

### Auth
- Required

### Response

```json
{
  "jobs": [
    {
      "id": "4bc46e65-68bd-41ab-b42b-1d3825c97b37",
      "createdAt": "2026-02-17T10:28:30.365Z",
      "runAt": "2026-12-05T12:00:00.000Z",
      "status": "scheduled",
      "attemptCount": 0
    }
  ]
}
```

---

## GET /v1/jobs/:jobId

Fetch one job.

### Auth
- Required

### Response

```json
{
  "job": {
    "id": "4bc46e65-68bd-41ab-b42b-1d3825c97b37",
    "createdAt": "2026-02-17T10:28:30.365Z",
    "runAt": "2026-12-05T12:00:00.000Z",
    "status": "scheduled",
    "attemptCount": 0
  }
}
```

---

## DELETE /v1/jobs/:jobId

Cancel a pending scheduled job.

### Auth
- Required

### Response

```json
{
  "cancelled": true,
  "job": {
    "id": "4bc46e65-68bd-41ab-b42b-1d3825c97b37",
    "createdAt": "2026-02-17T10:28:30.365Z",
    "runAt": "2026-12-05T12:00:00.000Z",
    "status": "cancelled",
    "attemptCount": 0,
    "completedAt": "2026-02-17T10:28:38.509Z"
  }
}
```

---

## Error Model

Errors are returned as RFC 7807 problem details.

Example:

```json
{
  "type": "https://api.crosspost.local/problems/bluesky-length-exceeded",
  "title": "Bluesky character limit exceeded",
  "status": 400,
  "detail": "Thread segment 1 has 301 characters. Bluesky allows up to 300.",
  "instance": "/v1/posts"
}
```

Common status codes:
- `400` validation/preflight failure
- `401` invalid or missing API key
- `404` job not found
- `409` job cannot be cancelled
- `502` upstream platform or instance failure
- `500` internal error
