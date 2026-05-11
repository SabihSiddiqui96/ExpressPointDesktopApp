// One-off helper to reset a single PrimeroEdge system setting.
// Run with: npx ts-node scripts/reset-setting.ts TEROFFA 59
//
// Useful when a system_settings test bails out before its restore step and
// leaves a value stuck (e.g. TEROFFA at 1 instead of 59).
import { chromium } from '@playwright/test';
import { loginToPrimeroEdgeQa } from '../utils/primeroedge-web';
import { setSettings } from '../utils/primeroedge-settings';

async function main(): Promise<void> {
  const [, , code, value] = process.argv;
  if (!code || !value) {
    console.error('Usage: npx ts-node scripts/reset-setting.ts <CODE> <VALUE>');
    console.error('Example: npx ts-node scripts/reset-setting.ts TEROFFA 59');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newContext().then(ctx => ctx.newPage());
    await loginToPrimeroEdgeQa(page);
    const previous = await setSettings(page, { [code]: value });
    console.log(`✓ ${code} set to "${value}" (was "${previous[code]}")`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
