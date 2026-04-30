/**
 * Local webhook server — receives Playwright results from webhook-reporter
 * and forwards a formatted summary to RingCentral Team Messaging.
 *
 * Usage:
 *   npx ts-node webhook-server.ts
 *
 * Set RINGCENTRAL_WEBHOOK_URL in your .env file before starting.
 */

import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const PORT = parseInt(process.env.WEBHOOK_PORT ?? '5678', 10);
const RC_WEBHOOK = process.env.RINGCENTRAL_WEBHOOK_URL ?? '';

if (!RC_WEBHOOK) {
  console.error('[webhook-server] ERROR: RINGCENTRAL_WEBHOOK_URL is not set in .env');
  process.exit(1);
}

interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  status: string;
}

function formatRingCentralMessage(s: RunSummary): object {
  const allPassed = s.failed === 0;
  const icon = allPassed ? '✅' : '❌';
  const secs = (s.durationMs / 1000).toFixed(1);

  const lines = [
    `**Total:** ${s.total}`,
    `**Passed:** ${s.passed} ✅`,
    `**Failed:** ${s.failed} ${s.failed > 0 ? '❌' : ''}`.trim(),
    s.skipped > 0 ? `**Skipped:** ${s.skipped} ⏭` : null,
    `**Duration:** ${secs}s`,
  ].filter(Boolean).join('\n');

  return {
    title: `${icon} Playwright Test Results — ${allPassed ? 'All Passed' : `${s.failed} Failed`}`,
    body: lines,
  };
}

function postJson(endpoint: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(endpoint);
    const payload = JSON.stringify(body);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/results') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const summary: RunSummary = JSON.parse(raw);
        const { total, passed, failed, durationMs } = summary;
        console.log(`[webhook-server] Received: total=${total} passed=${passed} failed=${failed} (${(durationMs / 1000).toFixed(1)}s)`);

        const message = formatRingCentralMessage(summary);
        await postJson(RC_WEBHOOK, message);
        console.log('[webhook-server] Sent to RingCentral ✓');

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (err) {
        console.error('[webhook-server] Error:', (err as Error).message);
        res.writeHead(500);
        res.end('Error');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[webhook-server] Listening on http://localhost:${PORT}/results`);
  console.log(`[webhook-server] Will forward results to RingCentral`);
});
