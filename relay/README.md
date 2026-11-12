# Bug Report Relay

Source of record for the deployed Worker at
`https://lw-bug-relay.keithschaub.workers.dev`.

The app POSTs `multipart/form-data` with `description`, JSON `metadata`,
`gameState`, and optional `image_0..N` files. The Worker creates a labelled
GitHub issue and stores the state/screenshots on `bug-reports`. Configure only
the `GITHUB_TOKEN` Worker secret; never commit it.

When a game ends the app also POSTs `kind=game`, `gameId`, JSON `summary` and
`gameState` (no description, no images). The Worker stores those under
`games/<ISO time>-<gameId>/` (`game-state.json`, `summary.json`) on `bug-reports`
without filing an issue, and skips a game id it already has. `node
tools/test_relay.mjs` covers both kinds; deploy with `wrangler deploy` from this
folder.

The remaining notes document the original one-time deployment setup.

## Features

- **Rate limiting**: 10 reports per IP per hour
- **Size limit**: 25MB per report
- **Automatic GitHub issue creation** with label `bug-report`
- **File uploads** to `bug-reports` branch (game state JSON + screenshots)
- **CORS enabled** for web app access

## Setup (One-Time)

### Prerequisites

- **Cloudflare account** (free tier works) - Sign up at https://dash.cloudflare.com/sign-up
- **GitHub fine-grained personal access token** with permissions:
  - **Repository**: `keithschaub/lizard-wizard-dashboard`
  - **Repository permissions**:
    - **Issues**: Read and write
    - **Contents**: Read and write
  - Create at: https://github.com/settings/personal-access-tokens/new
  - ⚠️ **Do NOT use classic tokens with full `repo` scope** - use fine-grained tokens with minimal permissions
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

Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new:

1. **Token name**: `lizard-wizard-bug-relay`
2. **Expiration**: Choose your preference (90 days recommended)
3. **Repository access**: Only select repositories → `keithschaub/lizard-wizard-dashboard`
4. **Repository permissions**:
   - Issues: **Read and write**
   - Contents: **Read and write**
5. Click "Generate token" and copy it

Then set the secret:

```bash
wrangler secret put GITHUB_TOKEN
# Paste your fine-grained token when prompted
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
- Verify token is a **fine-grained token** with:
  - Repository access to `keithschaub/lizard-wizard-dashboard`
  - **Issues** permission: Read and write
  - **Contents** permission: Read and write
- Check token hasn't expired
- Verify repository name matches exactly

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
