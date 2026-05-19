import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

interface TestRecord {
  specTitle: string;
  status: 'passed' | 'failed' | 'skipped';
}

class WebhookReporter implements Reporter {
  private tests: TestRecord[] = [];
  private startTime = 0;
  private readonly rcWebhookUrl: string;
  private readonly mode: string;
  private readonly webhookEnabled: boolean;

  constructor() {
    this.rcWebhookUrl = process.env.RINGCENTRAL_WEBHOOK_URL ?? '';
    this.mode = (process.env.TEST_MODE ?? 'qa').toLowerCase();
    // Webhook only fires for regression runs. QA / dev iteration stays silent.
    this.webhookEnabled = this.mode === 'regression';
  }

  async onBegin(_config: FullConfig, suite: Suite): Promise<void> {
    this.startTime = Date.now();
    this.tests = [];

    if (!this.webhookEnabled) {
      console.log(`\n[webhook-reporter] TEST_MODE=${this.mode} - webhook disabled (only fires when TEST_MODE=regression).`);
      return;
    }

    if (!this.rcWebhookUrl) return;

    const totalTests = suite.allTests().length;

    const message = {
      title: [
        '🚀 ExpressPoint Automation started on Sabih\'s local machine',
        'Results will be posted once tests complete.... ',
      ].join('\n'),
      body: `Tests queued: ${totalTests}`,
    };

    try {
      await postJson(this.rcWebhookUrl, message);
    } catch {
      // Non-fatal
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const status =
      result.status === 'passed' ? 'passed'
        : result.status === 'failed' || result.status === 'timedOut' ? 'failed'
          : 'skipped';
    this.tests.push({
      specTitle: getSpecTitle(test),
      status,
    });
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (!this.webhookEnabled) return;
    if (!this.rcWebhookUrl) {
      console.log('\n[webhook-reporter] RINGCENTRAL_WEBHOOK_URL not set - skipping notification.');
      return;
    }

    const failedTests = this.tests.filter(t => t.status === 'failed');
    const skippedTests = this.tests.filter(t => t.status === 'skipped');
    const passed = this.tests.filter(t => t.status === 'passed').length;
    const failed = failedTests.length;
    const skipped = skippedTests.length;
    const total = this.tests.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const duration = formatDuration(Date.now() - this.startTime);

    // Pad labels so colons line up; right-align numbers in a 2-char field.
    const padLabel = (label: string) => `${label}:`.padEnd(9, ' ');
    const padNum   = (n: number) => n.toString().padStart(2, ' ');

    const statLines = [
      `✅ ${padLabel('Passed')} ${padNum(passed)} (${passRate}%)`,
      `❌ ${padLabel('Failed')} ${padNum(failed)}`,
      skipped > 0 ? `⏸ ${padLabel('Skipped')} ${padNum(skipped)}` : null,
      `📊 ${padLabel('Total')} ${padNum(total)}`,
      `⏱ ${padLabel('Duration')} ${duration}`,
    ].filter(Boolean);

    const formatTestLines = (tests: TestRecord[]) =>
      uniqueSpecTitles(tests).map(title => `  • ${title}`).join('\n');

    const detailBlocks = [
      failed > 0 ? `Failed Tests:\n${formatTestLines(failedTests)}` : null,
      skipped > 0 ? `Skipped Tests:\n${formatTestLines(skippedTests)}` : null,
    ].filter(Boolean);

    const message = {
      title: [
        'ExpressPoint Regression Tests Completed. See results below.',
        '',
        ...statLines,
        ...(detailBlocks.length > 0 ? ['', ...detailBlocks] : []),
      ].join('\n'),
    };

    try {
      await postJson(this.rcWebhookUrl, message);
      console.log('\n[webhook-reporter] Results sent to RingCentral');
    } catch (err) {
      console.error(`\n[webhook-reporter] Failed to send to RingCentral: ${(err as Error).message}`);
    }
  }
}

function getSpecTitle(test: TestCase): string {
  const titleParts = test.titlePath()
    .filter(part => part !== test.title && !part.endsWith('.spec.ts'));
  const titleFromDescribe = titleParts[titleParts.length - 1];

  const baseTitle = titleFromDescribe || path
    .basename(test.location.file)
    .replace(/\.spec\.ts$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  return stripAutomationTag(baseTitle);
}

function stripAutomationTag(title: string): string {
  return title
    .replace(/\s*\.?\s*\[(Automated|Automation)\]\s*$/i, '')
    .trim();
}

function uniqueSpecTitles(tests: TestRecord[]): string[] {
  return [...new Set(tests.map(t => t.specTitle))];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

export default WebhookReporter;
