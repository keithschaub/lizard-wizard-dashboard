/**
 * Cloudflare Worker: Bug Report Relay
 * 
 * Receives bug reports from the Lizard Wizard web app and files GitHub issues.
 * Reports include description, game state JSON, screenshots, and metadata.
 * 
 * Rate limiting: 10 reports per IP per hour
 * Size limit: 25MB per report
 * 
 * Required secrets (set via wrangler secret put):
 * - GITHUB_TOKEN: Personal access token with repo scope for keithschaub/lizard-wizard-dashboard
 * - RELAY_SECRET: Shared secret to prevent spam (optional but recommended)
 */

const GITHUB_OWNER = 'keithschaub';
const GITHUB_REPO = 'lizard-wizard-dashboard';
const GITHUB_BRANCH = 'bug-reports';
const RATE_LIMIT = 10; // reports per hour per IP
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    if (!request.url.endsWith('/report')) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    try {
      // Check rate limit
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = `ratelimit:${ip}`;
      const count = parseInt(await env.KV?.get(rateLimitKey) || '0');
      
      if (count >= RATE_LIMIT) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Parse form data
      const contentType = request.headers.get('Content-Type') || '';
      if (!contentType.includes('multipart/form-data')) {
        return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const formData = await request.formData();
      const description = formData.get('description');
      const metadataStr = formData.get('metadata');
      const gameState = formData.get('gameState');

      if (!description || !metadataStr || !gameState) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const metadata = JSON.parse(metadataStr);

      // Collect images
      const images = [];
      for (const [key, value] of formData.entries()) {
        if (key.startsWith('image_') && value instanceof File) {
          images.push({
            name: value.name,
            buffer: await value.arrayBuffer(),
            type: value.type,
          });
        }
      }

      // Create GitHub issue
      const issueNumber = await createGitHubIssue(env, {
        description,
        metadata,
        gameState,
        images,
        ip,
      });

      // Update rate limit
      if (env.KV) {
        await env.KV.put(rateLimitKey, String(count + 1), { expirationTtl: 3600 });
      }

      return new Response(JSON.stringify({
        success: true,
        issueNumber,
        message: 'Bug report submitted successfully',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      console.error('Error processing bug report:', err);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: err.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

/**
 * Create GitHub issue with bug report
 */
async function createGitHubIssue(env, report) {
  const { description, metadata, gameState, images, ip } = report;

  // Format issue body
  const timestamp = new Date(metadata.timestamp).toLocaleString();
  const issueBody = `## Bug Report

**Reported:** ${timestamp}
**Round:** ${metadata.game.round} | **Phase:** ${metadata.game.phase} | **Next:** ${metadata.game.next}
**Commit:** \`${metadata.commitSHA}\`

### Description

${description}

### Metadata

- **User Agent:** ${metadata.userAgent}
- **Viewport:** ${metadata.viewport.width}×${metadata.viewport.height} @ ${metadata.viewport.devicePixelRatio}x
- **URL:** ${metadata.url}
- **IP:** ${ip}

### Game State

<details>
<summary>Full game state JSON (click to expand)</summary>

\`\`\`json
${gameState.slice(0, 10000)}${gameState.length > 10000 ? '\n... (truncated, see bug-reports branch)' : ''}
\`\`\`

</details>

### Screenshots

${images.length} screenshot(s) attached

---

*This issue was automatically created by the in-game bug reporter.*
`;

  // Create issue
  const issueResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `🐛 ${description.slice(0, 80)}${description.length > 80 ? '...' : ''}`,
        body: issueBody,
        labels: ['bug-report'],
      }),
    }
  );

  if (!issueResponse.ok) {
    const error = await issueResponse.text();
    throw new Error(`Failed to create GitHub issue: ${error}`);
  }

  const issue = await issueResponse.json();
  const issueNumber = issue.number;

  // Upload full game state and images to bug-reports branch
  try {
    await uploadToBugReportsBranch(env, issueNumber, gameState, images);
  } catch (err) {
    console.error('Failed to upload files to bug-reports branch:', err);
    // Don't fail the whole request if upload fails
    await addCommentToIssue(env, issueNumber, `⚠️ Failed to upload files: ${err.message}`);
  }

  return issueNumber;
}

/**
 * Upload game state and screenshots to bug-reports branch
 */
async function uploadToBugReportsBranch(env, issueNumber, gameState, images) {
  const reportDir = `report-${issueNumber}`;

  // Get the SHA of the bug-reports branch
  const branchResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
    {
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
      },
    }
  );

  let baseSha;
  if (branchResponse.ok) {
    const branchData = await branchResponse.json();
    baseSha = branchData.object.sha;
  } else {
    // Branch doesn't exist, create it from main
    const mainResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/main`,
      {
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Lizard-Wizard-Bug-Relay',
        },
      }
    );
    const mainData = await mainResponse.json();
    baseSha = mainData.object.sha;

    // Create bug-reports branch
    await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Lizard-Wizard-Bug-Relay',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: `refs/heads/${GITHUB_BRANCH}`,
          sha: baseSha,
        }),
      }
    );
  }

  // Create blobs for game state and images
  const blobs = [];

  // Game state
  const stateBlob = await createBlob(env, gameState);
  blobs.push({ path: `${reportDir}/game-state.json`, sha: stateBlob });

  // Images
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const base64 = arrayBufferToBase64(img.buffer);
    const imgBlob = await createBlob(env, base64, 'base64');
    blobs.push({ path: `${reportDir}/${img.name}`, sha: imgBlob });
  }

  // Create tree
  const treeResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base_tree: baseSha,
        tree: blobs.map(b => ({
          path: b.path,
          mode: '100644',
          type: 'blob',
          sha: b.sha,
        })),
      }),
    }
  );

  const tree = await treeResponse.json();

  // Create commit
  const commitResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Bug report #${issueNumber}: Upload game state and screenshots`,
        tree: tree.sha,
        parents: [baseSha],
      }),
    }
  );

  const commit = await commitResponse.json();

  // Update branch reference
  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sha: commit.sha }),
    }
  );

  // Add comment to issue with links
  const links = blobs.map(b =>
    `- [${b.path.split('/').pop()}](https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${b.path})`
  ).join('\n');

  await addCommentToIssue(env, issueNumber, `Files uploaded to [\`${GITHUB_BRANCH}\`](https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/tree/${GITHUB_BRANCH}/${reportDir}):\n\n${links}`);
}

/**
 * Create a GitHub blob
 */
async function createBlob(env, content, encoding = 'utf-8') {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, encoding }),
    }
  );

  const blob = await response.json();
  return blob.sha;
}

/**
 * Add comment to GitHub issue
 */
async function addCommentToIssue(env, issueNumber, body) {
  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lizard-Wizard-Bug-Relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  );
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
