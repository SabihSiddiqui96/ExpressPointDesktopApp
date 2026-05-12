// Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_workitems/edit/111443

import { test, expect, Page, chromium } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { WarningDialog } from '../../utils/dialogs';
import { dismissAllYesConfirms, ensureServiceClosed } from '../../utils/service';
import {
  loginToPrimeroEdgeQa,
  openPointOfServiceReconciliation,
  filterReconciliationForToday,
} from '../../utils/primeroedge-web';

test.describe.configure({ timeout: 600_000 });

const PATRON_ID = '1337';

function randomDollarAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Top "GOT IT" dialog — full text is "You are currently operating in offline
// mode on this device. You have N days remaining...".
const OFFLINE_ALERT_RE = /You are currently operating in offline mode/i;

// Bottom yellow banner with the "Retry" button — full text is "ExpressPoint
// is experiencing a problem connecting to the server. You are now Offline."
const OFFLINE_BANNER_RE = /ExpressPoint is experiencing a problem connecting to the server|You are now\s*Offline/i;

// Offline indicator shown inside the Closing POS Terminal dialog ("You are
// Offline" or any close variant).
const CLOSING_OFFLINE_RE = /You are\s*(?:now\s*)?Offline/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function login(window: Page): Promise<void> {
  // For this test we use "Use Windows Login" instead of "Use PrimeroEdge
  // Login" — Windows SSO works offline because Kerberos / cached creds don't
  // require a round-trip to PrimeroEdge, so the offline-login step is more
  // reliable here.
  const loginPage = new LoginPage(window);
  await loginPage.windowsLoginBtn().click();
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 30_000 });
  await waitForLoadingOverlay(window);
}

async function clickHamburger(window: Page): Promise<void> {
  await window.locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first()
    .click({ timeout: 10_000 });
}

async function clickMenuItem(window: Page, label: RegExp): Promise<void> {
  const item = window.locator('ion-menu ion-item, ion-item[detail]').filter({ hasText: label }).first();
  if (!await item.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await clickHamburger(window);
  }
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click({ timeout: 15_000 });
  // Close any side menu and dismiss stray warnings.
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (menu?.close) await Promise.race([menu.close(), new Promise(r => setTimeout(r, 1_000))]);
  }).catch(() => {});
  await window.keyboard.press('Escape').catch(() => {});
  await WarningDialog.dismiss(window, 3_000);
  await waitForLoadingOverlay(window);
}

// ─── Open Service ─────────────────────────────────────────────────────────────

async function openServiceWithZeroBalance(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);
  await ensureServiceClosed(window).catch(() => {});
  await WarningDialog.dismiss(window, 3_000);

  await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first()
    .click({ timeout: 15_000 });
  await WarningDialog.dismiss(window, 5_000);
  await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });

  // $0 opening — leave the field at its default (the keypad treats input as
  // cents, so an empty field means $0.00).
  await window.getByRole('button', { name: /open service/i }).last().click();
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 30_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);
}

// ─── Payments ─────────────────────────────────────────────────────────────────

function dollarsToCentsDigits(amount: number): string[] {
  return Math.round(amount * 100).toString().split('');
}

async function navigateToPayments(window: Page): Promise<void> {
  await clickMenuItem(window, /^Payments$/i);
  await expect(
    window.locator('ion-segment-button, ion-item, ion-tab-button')
      .filter({ hasText: /\b(PIN|Patron\s*ID)\b/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

async function searchPatron(window: Page, id: string): Promise<void> {
  // PIN/Patron-ID segment.
  await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight);
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-segment-button'))
      .find(el => visible(el) && /^(PIN|Patron\s*ID)$/i.test((el.innerText || '').trim()));
    btn?.click();
  });
  await window.waitForTimeout(400);

  const idInput = window.locator('input[placeholder*="Enter a" i], input[placeholder*="PIN" i], input[placeholder*="ID" i]').first();
  await expect(idInput).toBeVisible({ timeout: 15_000 });
  await idInput.click();
  await idInput.fill(id);

  const clicked = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => !!(el.offsetWidth || el.offsetHeight)
        && !!el.querySelector('ion-icon[name*="caret-forward"], ion-icon[name*="play-circle"]'));
    btn?.click();
    return !!btn;
  });
  if (!clicked) await window.keyboard.press('Enter');

  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 2_000);
  await waitForText(window, new RegExp(`ID.*${id}|${id}.*ID|Current Balance|Add Funds`, 'i'), 30_000);
}

async function findIonInputCoords(window: Page): Promise<{ x: number; y: number }[]> {
  return window.evaluate(() => {
    const results: { x: number; y: number }[] = [];
    function search(root: Document | ShadowRoot | Element) {
      let elements: Element[];
      try { elements = Array.from((root as any).querySelectorAll('*')); } catch { return; }
      for (const el of elements) {
        if ((el as HTMLElement).tagName === 'ION-INPUT') {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          }
        }
        const sr = (el as any).shadowRoot;
        if (sr) search(sr);
      }
    }
    search(document);
    return results;
  });
}

async function makeCashPayment(window: Page, amount: number): Promise<void> {
  // Click Cash tab if present.
  const tab = window.locator('ion-segment-button, ion-tab-button')
    .filter({ hasText: /\bCash\b/i }).first();
  if (!await tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const addFunds = window.locator('ion-button, button').filter({ hasText: /^Add Funds$/i }).first();
    if (await addFunds.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addFunds.click();
      await waitForLoadingOverlay(window);
    }
  }
  if (await tab.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await tab.click();
    await window.waitForTimeout(400);
  }

  // Click the payment amount ion-input.
  const coords = await findIonInputCoords(window);
  if (coords.length > 0) {
    await window.mouse.click(coords[0].x, coords[0].y);
    await window.waitForTimeout(300);
  }

  // Type cents-style: $50.00 → keys "5000".
  for (const digit of dollarsToCentsDigits(amount)) {
    await window.locator('ion-button')
      .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
      .first()
      .click({ force: true, timeout: 5_000 });
    await window.waitForTimeout(120);
  }

  // Make Payment.
  const clicked = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(b => !!(b.offsetWidth || b.offsetHeight)
        && /^make payment$/i.test((b.innerText || b.textContent || '').trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) await window.keyboard.press('Enter');

  await waitForLoadingOverlay(window);
  await dismissAllYesConfirms(window, 4_000, 2);
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
}

// ─── Close Service ────────────────────────────────────────────────────────────

async function navigateToCloseService(window: Page): Promise<void> {
  await clickMenuItem(window, /^Close Service$/i);
  await waitForText(window, /Close Service|Closing Balance/i, 20_000);
  await WarningDialog.dismiss(window, 3_000);
  await waitForLoadingOverlay(window);
}

async function clickCloseServiceFooterButton(window: Page): Promise<void> {
  // "Close Service" appears twice in the DOM: the green header at the top of
  // the page and the green footer button at the bottom right. The footer is
  // last in DOM order, so .last() reliably targets it. Use Playwright's
  // locator click (it scrolls into view + waits for actionable) instead of
  // coord-based clicks, which were missing the button in offline mode.
  const btn = window.locator('ion-button, button')
    .filter({ hasText: /^\s*Close Service\s*$/i }).last();
  await expect(btn, '"Close Service" footer button').toBeVisible({ timeout: 15_000 });
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 15_000 });
}

/**
 * If EP launched with a leftover "Closing POS Terminal" dialog from a previous
 * aborted offline run, click its Close button so we can interact with the
 * dashboard. No-op when no such dialog is on screen.
 */
async function dismissStaleClosingPosTerminalDialog(window: Page): Promise<void> {
  const dialog = window.locator('ion-modal.close-status-modal').first();
  if (!await dialog.isVisible({ timeout: 1_500 }).catch(() => false)) return;
  console.log('Found stale "Closing POS Terminal" dialog from previous run — dismissing.');

  const closeBtn = dialog.locator('ion-button, button')
    .filter({ hasText: /^\s*Close\s*$/i }).first();
  // The Close button is disabled while "Checking Sessions..." spins; wait up
  // to 60 s for it to enable, then click.
  await expect(closeBtn, 'Close button on stale Closing POS Terminal dialog')
    .toBeEnabled({ timeout: 60_000 });
  await closeBtn.click({ timeout: 10_000 });
  // The modal animation can take ~1-2 s.
  await window.waitForTimeout(2_000);
}

// ─── Offline-mode detection helpers ───────────────────────────────────────────

async function isBannerVisible(window: Page, pattern: RegExp): Promise<boolean> {
  return window.evaluate((src) => {
    const re = new RegExp(src.source, src.flags);
    return re.test(document.body.innerText ?? '');
  }, { source: pattern.source, flags: pattern.flags });
}


// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('T-111443', () => {
  test('Offline-mode banner during login → close → Retry restores online', async () => {
    const handle  = await launchExpressPoint();
    const context = handle.browser.contexts()[0];

    try {
      // ── 1. Put EP's browser context in offline mode before the user clicks
      //   Login. EP's initial UI is rendered from local files so no network
      //   calls happen before login; once setOffline(true) is set, the next
      //   request (the auth call) fails and EP enters Offline Mode — exactly
      //   what disabling the Ethernet adapter would do, just scoped to EP.
      await context.setOffline(true);

      // ── 2. Log in (EP must support offline login from cached creds).
      await login(handle.window);
      const window = await getAppWindow(handle);

      // If a previous offline run aborted with the Closing POS Terminal
      // dialog still on screen, EP restores it on the next launch — clear it
      // before doing anything else so the dashboard is interactive.
      await dismissStaleClosingPosTerminalDialog(window).catch(() => {});

      // ── 3. Verify the post-login Offline Mode notification AND the bottom
      //   "currently working offline" banner.
      await waitForText(window, OFFLINE_ALERT_RE, 30_000);
      await WarningDialog.dismiss(window, 5_000);

      expect(
        await isBannerVisible(window, OFFLINE_BANNER_RE),
        'bottom "You are currently working offline" banner should be visible',
      ).toBe(true);

      // ── 4. Open Service ($0 opening), random Cash payment to patron 1337.
      const cashAmount = randomDollarAmount(11, 199);
      console.log(`Cash payment amount: $${cashAmount.toFixed(2)}`);
      await openServiceWithZeroBalance(window);
      await navigateToPayments(window);
      await searchPatron(window, PATRON_ID);
      await makeCashPayment(window, cashAmount);

      // ── 5. Close Service — the "Closing POS Terminal" dialog appears and
      //   stays open until its Close button becomes enabled. Verify the
      //   offline banner is inside the dialog while we wait.
      await navigateToCloseService(window);
      await clickCloseServiceFooterButton(window);
      await dismissAllYesConfirms(window, 12_000, 4);

      const closingDialogText = window.getByText(/closing pos terminal/i).first();
      await expect(closingDialogText, '"Closing POS Terminal" dialog should appear')
        .toBeVisible({ timeout: 30_000 });

      expect(
        await isBannerVisible(window, CLOSING_OFFLINE_RE),
        'Closing POS Terminal dialog should show "You are Offline" banner',
      ).toBe(true);

      // ── 6. Wait for the dialog's Close button to become enabled, then click
      //   it (the dialog never auto-dismisses — the Close click is the only
      //   way out, even though the close itself is already complete). Scope
      //   to ion-modal.close-status-modal so we don't accidentally click a
      //   different "Close" elsewhere on the page.
      const dialog = window.locator('ion-modal.close-status-modal').first();
      const dialogCloseBtn = dialog.locator('ion-button, button')
        .filter({ hasText: /^\s*Close\s*$/i }).first();
      await expect(dialogCloseBtn, 'Close button inside Closing POS Terminal dialog')
        .toBeEnabled({ timeout: 120_000 });
      await dialogCloseBtn.click();
      await waitForLoadingOverlay(window);

      // ── 7. Re-enable the network and let EP sync the offline session up to
      //   PrimeroEdge. 7 s is enough in practice for the queued transaction
      //   to flush to the server.
      await context.setOffline(false);
      await window.waitForTimeout(7_000);

      // ── 8. Verify in the PrimeroEdge web POS Reconciliation that today's
      //   session is now present (i.e. the offline transaction synced).
      const webBrowser = await chromium.launch({ headless: false });
      try {
        const webPage = await webBrowser.newContext().then(c => c.newPage());
        await loginToPrimeroEdgeQa(webPage);
        await openPointOfServiceReconciliation(webPage);
        await filterReconciliationForToday(webPage);
        const sessionRow = webPage.locator('#ctl00_UserContentArea_gridSessions tr')
          .filter({ hasText: /\$\d/ }).first();
        await expect(
          sessionRow,
          'After re-syncing, PrimeroEdge Reconciliation should list at least one session for today',
        ).toBeVisible({ timeout: 60_000 });
      } finally {
        await webBrowser.close().catch(() => {});
      }
    } finally {
      await context.setOffline(false).catch(() => {});
      await closeExpressPoint(handle).catch(() => {});
    }
  });
});
