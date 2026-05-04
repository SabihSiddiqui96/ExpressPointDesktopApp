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

  constructor() {
    this.rcWebhookUrl = process.env.RINGCENTRAL_WEBHOOK_URL ?? '';
  }

  async onBegin(_config: FullConfig, suite: Suite): Promise<void> {
    this.startTime = Date.now();
    this.tests = [];

    if (!this.rcWebhookUrl) return;

    const totalTests = suite.allTests().length;

    const message = {
      title: [
        '🚀 ExpressPoint Automation started on Sabih\'s local machine',
        'Results will be posted once tests complete',
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
    const formatTestLines = (prefix: string, tests: TestRecord[]) =>
      uniqueSpecTitles(tests).map(title => `${prefix} ${title}`).join('\n');

    const summaryLines = [
      `Passed: ${passed}`,
      `Failed: ${failed}`,
      `Total: ${total}`,
      skipped > 0 ? `Skipped: ${skipped}` : null,
    ].filter(Boolean);

    const detailLines = [
      failed > 0 ? `Failed Tests:\n${formatTestLines('Failed:', failedTests)}` : null,
      skipped > 0 ? `Skipped Tests:\n${formatTestLines('Skipped:', skippedTests)}` : null,
    ].filter(Boolean);

    const message = {
      title: [
        'ExpressPoint Automation completed. Below are the results',
        '',
        ...summaryLines,
        '',
        ...detailLines,
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

  return stripAutomationTag(`EP App - ${baseTitle}`);
}

function stripAutomationTag(title: string): string {
  return title
    .replace(/\s*\.?\s*\[(Automated|Automation)\]\s*$/i, '')
    .trim();
}

function uniqueSpecTitles(tests: TestRecord[]): string[] {
  return [...new Set(tests.map(t => t.specTitle))];
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
