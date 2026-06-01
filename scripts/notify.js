// Standalone RingCentral webhook poster.
//
// The Playwright webhook-reporter can only post on a test run's begin/end.
// This script posts a one-off message BETWEEN runs — used by the
// "Full suite + Fixtests" flow to announce "now fixing the failed tests"
// after the full-suite completion webhook but before the fix/re-run starts.
//
// Usage:
//   node scripts/notify.js fix-start --count 5 --tests "Test A|Test B|Test C"
//   node scripts/notify.js message "Any custom title line"
//
// Honors the same gating as the reporter: only posts when TEST_MODE=regression
// (reads TEST_MODE + RINGCENTRAL_WEBHOOK_URL from .env, not the shell).
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---- read .env (no dotenv dependency; same plain-fs style as set-mode.js) ----
function readEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// ---- parse args ----
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function buildTitle({ positional, flags }) {
  const command = positional[0];
  const tests = typeof flags.tests === 'string'
    ? flags.tests.split('|').map(t => t.trim()).filter(Boolean)
    : [];
  const count = flags.count != null ? parseInt(flags.count, 10) : tests.length;
  const bullets = tests.map(t => `  • ${t}`).join('\n');

  if (command === 'fix-start') {
    const noun = count === 1 ? 'test' : 'tests';
    const header = `🔧 ExpressPoint Regression — ${count} ${noun} failed. Fix in progress…`;
    return tests.length > 0 ? `${header}\n\nFailed tests:\n${bullets}` : header;
  }

  // Generic: `node scripts/notify.js message "Some title"`
  if (command === 'message') {
    const text = positional.slice(1).join(' ');
    return tests.length > 0 ? `${text}\n\n${bullets}` : text;
  }

  return null;
}

function postJson(endpoint, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const payload = JSON.stringify(body);
    const options = {
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

(async () => {
  const env = readEnv();
  const mode = (env.TEST_MODE || 'qa').toLowerCase();
  const webhookUrl = env.RINGCENTRAL_WEBHOOK_URL || '';

  const title = buildTitle(parseArgs(process.argv.slice(2)));
  if (!title) {
    console.error('Usage: node scripts/notify.js fix-start --count <n> --tests "A|B|C"');
    console.error('       node scripts/notify.js message "Custom title" [--tests "A|B"]');
    process.exit(2);
  }

  // Same gating as the reporter: only post for regression runs.
  if (mode !== 'regression') {
    console.log(`[notify] TEST_MODE=${mode} - skipping webhook (only posts when TEST_MODE=regression).`);
    process.exit(0);
  }
  if (!webhookUrl) {
    console.log('[notify] RINGCENTRAL_WEBHOOK_URL not set - skipping.');
    process.exit(0);
  }

  try {
    await postJson(webhookUrl, { title });
    console.log('[notify] Message sent to RingCentral.');
  } catch (err) {
    console.error(`[notify] Failed to send: ${err.message}`);
    process.exit(1);
  }
})();
