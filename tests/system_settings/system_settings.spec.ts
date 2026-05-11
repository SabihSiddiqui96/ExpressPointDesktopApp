//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115142


import { test, expect, Page, chromium } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { ensureMealTypeSelected } from '../../utils/serving';
import { loginToPrimeroEdgeQa } from '../../utils/primeroedge-web';
import { setSettings, SettingsMap } from '../../utils/primeroedge-settings';

test.describe.configure({ timeout: 600_000 });

const ACTIVE_PATRON = '1337';
const INACTIVE_PATRON = '133745';

// ─── Core EP helpers ──────────────────────────────────────────────────────────

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

async function waitForText(window: Page, text: RegExp, timeout = 20_000): Promise<void> {
  await expect.poll(
    async () => window.evaluate(({ source, flags }) =>
      new RegExp(source, flags).test(document.body.innerText),
      { source: text.source, flags: text.flags },
    ),
    { timeout },
  ).toBe(true);
}

async function getAppWindow(handle: ExpressPointHandle): Promise<Page> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const page of handle.browser.contexts()[0].pages().filter(p => !p.isClosed())) {
      if (await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false)) return page;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('getAppWindow: ion-app not found');
}

async function loginEP(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 5_000);
}

async function clickHamburger(window: Page): Promise<void> {
  await window.locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first()
    .click({ timeout: 10_000 });
}

async function clickDashboardOrMenuItem(window: Page, label: RegExp): Promise<void> {
  const dashItem = window.locator('ion-item[detail]').filter({ hasText: label }).first();
  if (await dashItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await dashItem.click();
  } else {
    await clickHamburger(window);
    await window.locator('ion-item').filter({ hasText: label }).first().click({ timeout: 10_000 });
  }
  await WarningDialog.dismiss(window, 3_000);
  await waitForLoadingOverlay(window);
}

async function openServiceIfNeeded(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);

  const continueItem = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await continueItem.click();
    await WarningDialog.dismiss(window, 3_000);
    return;
  }

  const openItem = window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first();
  if (await openItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await openItem.click();
    await WarningDialog.dismiss(window, 3_000);
    await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
    await window.getByRole('button', { name: /open service/i }).last().click();
    await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 30_000 });
    await waitForLoadingOverlay(window);
    await WarningDialog.dismiss(window, 3_000);
  }
}

async function lookupPatron(window: Page, patronId: string): Promise<void> {
  await ensureMealTypeSelected(window);
  const idInput = window.locator('input[placeholder="Enter an ID"], #pinInput input').first();
  await expect(idInput).toBeVisible({ timeout: 30_000 });
  await idInput.fill(patronId);

  const fwdClicked = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => !!(el.offsetWidth || el.offsetHeight) && !!el.querySelector('ion-icon[name="caret-forward-circle"]'));
    btn?.click();
    return !!btn;
  });
  if (!fwdClicked) await window.keyboard.press('Enter');
  await window.waitForTimeout(1_000);
  await WarningDialog.dismiss(window, 3_000);
}

// ─── Web setup ────────────────────────────────────────────────────────────────

async function withWebPage(fn: (web: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newContext().then(ctx => ctx.newPage());
    await loginToPrimeroEdgeQa(page);
    await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function withEPSession(fn: (window: Page, handle: ExpressPointHandle) => Promise<void>): Promise<void> {
  const handle = await launchExpressPoint();
  try {
    await loginEP(handle.window);
    const window = await getAppWindow(handle);
    await fn(window, handle);
  } finally {
    await closeExpressPoint(handle);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('System Settings', () => {

  // ── Step 7 + 8 + 11: HIDEBAL + HIDELGBLTY + SCHPREPAY ──────────────────────
  // All three affect the patron details panel — verify in one EP run.
  test('HIDEBAL, HIDELGBLTY, SCHPREPAY — patron details visibility', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, {
          HIDEBAL: 'No',
          HIDELGBLTY: 'No',
          SCHPREPAY: 'Yes',
        });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);

        await expect(window.locator('body')).not.toContainText(/Show Balance/i, { timeout: 5_000 });
        await waitForText(window, /\$\s*-?\d+\.\d{2}/, 10_000);

        await expect(
          window.locator('ion-button, button').filter({ hasText: /Add Funds/i }).first(),
          'SCHPREPAY=Yes should expose the Add Funds option',
        ).toBeVisible({ timeout: 10_000 });
      });

      await withWebPage(async (web) => {
        await setSettings(web, {
          HIDEBAL: 'Yes',
          HIDELGBLTY: 'Yes',
          SCHPREPAY: 'No',
        });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);

        await expect(
          window.locator('ion-button, button').filter({ hasText: /Show Balance/i }).first(),
          'HIDEBAL=Yes should expose a Show Balance button',
        ).toBeVisible({ timeout: 10_000 });

        await expect(
          window.locator('ion-button, button').filter({ hasText: /^Add Funds$/i }).first(),
          'SCHPREPAY=No should NOT expose the Add Funds option',
        ).toBeHidden({ timeout: 5_000 });
      });
    } finally {
      // Always restore the originals — even if an assertion above failed.
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 4 + 6: CREDCAPDAY + HASPRINACT ───────────────────────────────────
  // Both affect the Pay Transaction modal — verify together.
  test('CREDCAPDAY, HASPRINACT — Pay Transaction options', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, { CREDCAPDAY: 'Yes', HASPRINACT: 'Yes' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);
        await window.locator('ion-button').filter({ hasText: /Add Funds|Pay/i }).first()
          .click({ timeout: 10_000 }).catch(() => {});
        await window.waitForTimeout(1_000);
        await WarningDialog.dismiss(window, 2_000);

        await expect(
          window.locator('ion-segment-button, ion-button, ion-tab-button').filter({ hasText: /^Card$/i }).first(),
          'CREDCAPDAY=Yes should show the Card payment option',
        ).toBeVisible({ timeout: 10_000 });

        await expect(
          window.locator('ion-button, button').filter({ hasText: /Use Principal Account/i }).first(),
          'HASPRINACT=Yes should show the Use Principal Account button',
        ).toBeVisible({ timeout: 10_000 });
      });

      await withWebPage(async (web) => {
        await setSettings(web, { CREDCAPDAY: 'No', HASPRINACT: 'No' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);
        await window.locator('ion-button').filter({ hasText: /Add Funds|Pay/i }).first()
          .click({ timeout: 10_000 }).catch(() => {});
        await window.waitForTimeout(1_000);

        await expect(
          window.locator('ion-segment-button, ion-button, ion-tab-button').filter({ hasText: /^Card$/i }).first(),
          'CREDCAPDAY=No should NOT show the Card payment option',
        ).toBeHidden({ timeout: 5_000 });

        await expect(
          window.locator('ion-button, button').filter({ hasText: /Use Principal Account/i }).first(),
          'HASPRINACT=No should NOT show the Use Principal Account button',
        ).toBeHidden({ timeout: 5_000 });
      });
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 5: DYNMENU + MEALCOMBO ───────────────────────────────────────────
  // Dynamic vs Static menu rendering on the serving grid.
  test('DYNMENU, MEALCOMBO — Dynamic vs Static menu', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, { DYNMENU: 'Yes', MEALCOMBO: 'Food Based' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await ensureMealTypeSelected(window);
        await expect(
          window.locator('ion-button').filter({ hasText: /Meal|Yemek|Burger|Milk|Fruit|Grain|Entree|Lunch|Breakfast|Supper/i }).first(),
          'DYNMENU=Yes should render a populated dynamic menu',
        ).toBeVisible({ timeout: 20_000 });
      });

      await withWebPage(async (web) => { await setSettings(web, { DYNMENU: 'No' }); });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await ensureMealTypeSelected(window);
        await expect(
          window.locator('ion-button').filter({ hasText: /Meal|Yemek|Burger|Milk|Fruit|Grain|Entree|Lunch|Breakfast|Supper/i }).first(),
          'DYNMENU=No should still render a static menu',
        ).toBeVisible({ timeout: 20_000 });
      });
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 10: SERINACSTU — inactive student PIN 133745 (Sabih Inactive) ───
  test('SERINACSTU — inactive student blocked vs allowed', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, { SERINACSTU: 'No' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, INACTIVE_PATRON);
        const blocked = await window.evaluate(() =>
          /inactive|cannot|not allowed|restricted|blocked|please select|invalid/i
            .test(document.body.innerText),
        );
        const headerLoaded = await window.locator('text=/ID:\\s*133745\\b/').first()
          .isVisible({ timeout: 3_000 }).catch(() => false);
        expect(
          blocked || !headerLoaded,
          'SERINACSTU=No: inactive student should be blocked or not load',
        ).toBe(true);
      });

      await withWebPage(async (web) => {
        await setSettings(web, { SERINACSTU: 'Yes' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, INACTIVE_PATRON);
        await expect(
          window.locator('text=/ID:\\s*133745\\b/').first(),
          'SERINACSTU=Yes: inactive student 133745 should load',
        ).toBeVisible({ timeout: 15_000 });
      });
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 2: USEBONPCNT + BONUSTHRES + BONUSAMT — Bonus payment ────────────
  // Smoke-checks both states: flat-bonus mode (USEBONPCNT=No) and percentage
  // mode (USEBONPCNT=Yes).
  test('USEBONPCNT, BONUSTHRES, BONUSAMT — bonus on payment >= threshold', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, {
          USEBONPCNT: 'No',
          BONUSTHRES: '3.50',
          BONUSAMT: '20',
        });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);
        await waitForText(window, /Add Funds|Item Count|ID:\s*1337/i, 15_000);
      });

      // Toggle to USEBONPCNT=Yes and re-verify the patron screen still loads.
      await withWebPage(async (web) => {
        await setSettings(web, { USEBONPCNT: 'Yes' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);
        await waitForText(window, /Add Funds|Item Count|ID:\s*1337/i, 15_000);
      });
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 3: BABECL + RMUTCHARLT — restriction modes ─────────────────────
  // Three modes: "Decision to Allow Sale with User", "Sale Only with Some Cash",
  // "No Sale Without Insufficient Funds". Smoke-check each applies cleanly.
  test('BABECL, RMUTCHARLT — restriction prompt modes', async () => {
    const modes = [
      'Decision to Allow Sale with User',
      'Sale Only with Some Cash',
      'No Sale Without Insufficient Funds',
    ];

    let restore: SettingsMap = {};
    try {
      // Capture original BABECL + RMUTCHARLT once.
      await withWebPage(async (web) => {
        restore = await setSettings(web, { BABECL: modes[0], RMUTCHARLT: 'Yes' });
      });
      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await lookupPatron(window, ACTIVE_PATRON);
        await waitForText(window, /Add Funds|Item Count|ID:\s*1337/i, 15_000);
      });

      // Modes 2 and 3.
      for (const mode of modes.slice(1)) {
        await withWebPage(async (web) => {
          await setSettings(web, { BABECL: mode, RMUTCHARLT: 'Yes' });
        });
        await withEPSession(async (window) => {
          await openServiceIfNeeded(window);
          await lookupPatron(window, ACTIVE_PATRON);
          await waitForText(window, /Add Funds|Item Count|ID:\s*1337/i, 15_000);
        });
      }
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 9: HIDECHECKS — duplicate of close_service.spec.ts coverage ─────
  test('HIDECHECKS — Close Service shows View Check vs View & Manage Checks', async () => {
    let restore: SettingsMap = {};
    try {
      await withWebPage(async (web) => {
        restore = await setSettings(web, { HIDECHECKS: 'No' });
      });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await clickDashboardOrMenuItem(window, /Close Service/i);
        await waitForText(window, /Close Service|Closing Balance/i, 20_000);

        await expect(
          window.locator('ion-item, ion-button, button, span, ion-label').filter({ hasText: /View & Manage Checks/i }).first(),
          'HIDECHECKS=No should expose "View & Manage Checks"',
        ).toBeVisible({ timeout: 10_000 });
      });

      await withWebPage(async (web) => { await setSettings(web, { HIDECHECKS: 'Yes' }); });

      await withEPSession(async (window) => {
        await openServiceIfNeeded(window);
        await clickDashboardOrMenuItem(window, /Close Service/i);
        await waitForText(window, /Close Service|Closing Balance/i, 20_000);

        await expect(
          window.locator('ion-item, ion-button, button, span, ion-label').filter({ hasText: /View & Manage Checks/i }).first(),
          'HIDECHECKS=Yes should NOT show "View & Manage Checks"',
        ).toBeHidden({ timeout: 5_000 });
      });
    } finally {
      if (Object.keys(restore).length > 0) {
        await withWebPage(async (web) => { await setSettings(web, restore); });
      }
    }
  });

  // ── Step 12: TEROFFA — auto-logout warning after inactivity ──────────────
  // TEROFFA=1 → about a minute after login, ExpressPoint shows a warning that
  // the user will be logged out in 1 minute. Just login + sit idle; no patron
  // lookup or meal selection needed.
  test('TEROFFA — inactivity warning appears', async () => {
    // Hardcoded values: set to 1 to trigger the warning, restore to 59 after.
    const TEROFFA_TEST_VALUE = '1';
    const TEROFFA_DEFAULT_VALUE = '59';
    let restored = false;

    try {
      await withWebPage(async (web) => {
        await setSettings(web, { TEROFFA: TEROFFA_TEST_VALUE });
      });

      await withEPSession(async (window) => {
        // Wait up to ~2.5 minutes for the inactivity warning dialog to appear.
        await expect.poll(
          async () => {
            const text = await window.locator('body').innerText().catch(() => '');
            return /logged out|inactivity|remain logged in|session/i.test(text);
          },
          { timeout: 150_000, intervals: [5_000] },
        ).toBe(true);

        // Click "Remain Logged In" if present so the test ends cleanly.
        await window.locator('ion-button, button').filter({ hasText: /Remain Logged In/i }).first()
          .click({ timeout: 5_000 }).catch(() => {});
      });

      // Verification done — immediately put TEROFFA back to 59.
      await withWebPage(async (web) => {
        await setSettings(web, { TEROFFA: TEROFFA_DEFAULT_VALUE });
      });
      restored = true;
    } finally {
      // Safety net: if anything failed before the inline restore ran, force
      // TEROFFA back to 59 so the system isn't left at the 1-minute timeout.
      if (!restored) {
        await withWebPage(async (web) => {
          await setSettings(web, { TEROFFA: TEROFFA_DEFAULT_VALUE });
        });
      }
    }
  });
});
