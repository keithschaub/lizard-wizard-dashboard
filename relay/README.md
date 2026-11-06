# Bug Report Relay (Cloudflare Worker)

This Cloudflare Worker receives bug reports from the Lizard Wizard web app and automatically files GitHub issues with attached game state and screenshots.

## Features

- **Rate limiting**: 10 reports per IP per hour
- **Size limit**: 25MB per report
- **Automatic GitHub issue creation** with label `bug-report`
- **File uploads** to `bug-reports` branch (game state JSON + screenshots)
- **CORS enabled** for web app access

## Setup (One-Time)

### Prerequisites

- Cloudflare account (free tier works)
- GitHub personal access token with `repo` scope
- Node.js and npm installed

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV Namespace for Rate Limiting

```bash
wrangler kv:namespace create "KV"
```

Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_ID_HERE"  # Replace this
```

### 3. Set Secrets

#### GitHub Token

Create a personal access token at https://github.com/settings/tokens with `repo` scope:

```bash
wrangler secret put GITHUB_TOKEN
# Paste your token when prompted
```

#### Optional: Relay Secret

For additional security (prevents unauthorized API usage):

```bash
wrangler secret put RELAY_SECRET
# Enter a random string
```

If you set RELAY_SECRET, update `app/js/bug-report.js` to send it in the request header.

### 4. Deploy

```bash
cd relay
wrangler deploy
```

Note the worker URL (e.g., `https://lw-bug-relay.YOUR_SUBDOMAIN.workers.dev`).

### 5. Update Client Configuration

In `app/js/bug-report.js`, update the RELAY_URL:

```javascript
export const RELAY_URL = 'https://YOUR_WORKER_URL.workers.dev/report';
```

Or set it via environment variable during build:

```bash
RELAY_URL=https://YOUR_WORKER_URL.workers.dev/report npm run build
```

## Testing

Test the relay locally:

```bash
wrangler dev
```

Then update `RELAY_URL` to `http://localhost:8787/report` for testing.

### Manual Test

```bash
curl -X POST http://localhost:8787/report \
  -F "description=Test bug report" \
  -F "metadata={\"timestamp\":\"2024-01-01T00:00:00Z\",\"commitSHA\":\"test\",\"userAgent\":\"test\",\"viewport\":{\"width\":1920,\"height\":1080,\"devicePixelRatio\":1},\"game\":{\"round\":1,\"phase\":\"play\",\"next\":\"Keith\",\"gameOver\":false},\"url\":\"http://localhost\"}" \
  -F "gameState={\"test\":\"state\"}"
```

## Monitoring

- View logs: `wrangler tail`
- Check KV storage: `wrangler kv:key list --namespace-id=YOUR_KV_ID`
- GitHub issues: https://github.com/keithschaub/lizard-wizard-dashboard/issues?q=label:bug-report

## Rate Limits

- **Per IP**: 10 reports per hour
- **Report size**: 25MB max
- **Cloudflare Workers free tier**: 100,000 requests/day

## Troubleshooting

### "Failed to create GitHub issue"

- Check that GITHUB_TOKEN is set: `wrangler secret list`
- Verify token has `repo` scope
- Check token hasn't expired

### "Rate limit exceeded"

- Wait 1 hour, or clear KV: `wrangler kv:key delete --namespace-id=YOUR_KV_ID "ratelimit:YOUR_IP"`

### "Bug-reports branch not created"

- The worker will create it automatically on first upload
- Check GitHub permissions

## Architecture

```
┌─────────────┐
│   Web App   │
│ (bug-report │
│    .js)     │
└──────┬──────┘
       │ POST /report
       │ (FormData: description, metadata, gameState, images)
       ▼
┌─────────────────────┐
│ Cloudflare Worker   │
│ - Rate limit check  │
│ - Parse form data   │
│ - Create GH issue   │
│ - Upload files      │
└─────────┬───────────┘
          │
          ▼
    ┌──────────┐
    │  GitHub  │
    │  - Issue │
    │  - Files │
    └──────────┘
```

## Cost

**Free tier is sufficient for most use cases:**

- Cloudflare Workers: 100,000 requests/day (free)
- KV operations: 100,000 reads/day + 1,000 writes/day (free)
- GitHub API: 5,000 requests/hour (free for authenticated)

With rate limiting (10 reports/hour/IP), you're well within limits.
