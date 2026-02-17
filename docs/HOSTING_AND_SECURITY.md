# Hosting And Security

## Recommended Deployment Modes

## 1. Local Network Only

Use this when all clients are on your LAN.

1. Bind to local/private interface:
   - `HOST=0.0.0.0`
   - `PORT=0` (or fixed high port)
2. Restrict inbound at firewall/router to trusted subnets only.
3. Set strong `API_KEYS`.
4. Set `SCHEDULER_ENCRYPTION_KEY`.

## 2. Tailscale (Recommended For Personal/Self-Hosted)

Use a private tailnet and avoid public exposure.

1. Install Tailscale on the host.
2. Run gateway normally.
3. Access gateway via `http://<tailscale-ip>:<port>` or MagicDNS.
4. Use Tailscale ACLs to restrict which devices/users can reach the port.
5. Keep API key auth enabled (defense-in-depth).

## 3. Public Internet

Use only behind TLS and a hardened reverse proxy.

Recommended setup:
- Reverse proxy: Caddy, Nginx, or Traefik
- TLS certs via Let's Encrypt
- Upstream gateway on local loopback or private interface
- WAF/rate limiting at proxy + app-level rate limiting

You can also run direct HTTPS with:
- `TLS_KEY_PATH=/absolute/path/key.pem`
- `TLS_CERT_PATH=/absolute/path/cert.pem`

## Required Security Controls

Always set:
- `API_KEYS` to long random values
- `SCHEDULER_ENCRYPTION_KEY` to a stable secret

Recommended:
- `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` tuned for your workload
- Process manager (`systemd`, `pm2`, Docker restart policy)
- Centralized logs and alerting
- Frequent dependency updates (`npm audit` + upgrade cadence)

## Credential Handling Model

- Credentials arrive per request from client apps.
- Immediate publishes use credentials in-memory only.
- Scheduled publishes store encrypted payloads (AES-256-GCM) at rest.
- Media files for scheduled jobs are stored in `.data/scheduled-media` until execution/cancel.

## Operational Hardening Checklist

- Run as non-root user.
- Put `.data` on encrypted disk where possible.
- Restrict file permissions on `.env` and key material.
- If public, enforce HTTPS only (no plain HTTP listener exposed).
- Rotate API keys on a schedule.
- Monitor repeated `401` / `429` / `502` spikes.
- Keep host OS patched.
- Backup `jobs.json` if scheduled jobs are business-critical.

## Example systemd Unit (Linux)

```ini
[Unit]
Description=Crosspost Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/crosspost-backend
Environment=NODE_ENV=production
Environment=API_KEYS=replace-with-secret
Environment=SCHEDULER_ENCRYPTION_KEY=replace-with-secret
Environment=HOST=127.0.0.1
Environment=PORT=38081
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
User=crosspost
Group=crosspost
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/crosspost-backend/.data

[Install]
WantedBy=multi-user.target
```

## Public Reverse Proxy Example (Caddy)

```caddy
crosspost.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:38081
}
```

Add firewall rules so only ports `80/443` are public, with app port private.
