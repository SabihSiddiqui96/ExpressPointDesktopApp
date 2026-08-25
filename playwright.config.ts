import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./reporter/webhook-reporter.ts'],
  ],
  use: {
    // Without this, Playwright's default action timeout is 0 (wait forever): a
    // click on a control that never appears hangs until the test's multi-minute
    // hard timeout and then reports a misleading "Target page ... has been
    // closed" from teardown. Fail fast with the real locator error instead.
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
