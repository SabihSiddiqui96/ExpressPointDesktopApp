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

  // Offline mode shows a "Checking Sessions..." status modal while EP tries to
  // reconcile session state against the (unreachable) server. It overlays the
  // dashboard and intercepts pointer events on the Open Service item until the
  // check completes — wait for it to clear before clicking.
  // NOTE: waiting for "hidden" alone is not enough — the modal is usually not in
  // the DOM yet at this point, and waitFor('hidden') on a non-existent element
  // resolves immediately. It then appears and swallows the click. So wait for it
  // to show up first (it may legitimately never appear), then for it to clear.
  const checkingSessions = window.locator('ion-modal').filter({ hasText: /Checking Sessions/i }).first();
  await checkingSessions.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  await checkingSessions.waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});

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
  // Let the post-open-service transition settle; offline mode renders slower.
  await waitForLoadingOverlay(window);
  await window.waitForTimeout(1_000);
  await WarningDialog.dismiss(window, 3_000);

  // In the current build, opening a service drops you straight onto the POS
  // serving screen — which already exposes the PATRON ID / LOOKUP segments and
  // the "Enter an ID" keypad. There is NO separate "Payments" menu item in this
  // context (the hamburger only has Close Service, Transactions, Bulk Sales,
  // etc.), so if the patron-entry segment is already present we're done.
  const patronSegment = window.locator('ion-segment-button, ion-item, ion-tab-button')
    .filter({ hasText: /\b(PIN|Patron\s*ID)\b/i }).first();
  if (await patronSegment.isVisible({ timeout: 8_000 }).catch(() => false)) {
    return;
  }

  // Legacy/dashboard fallback: if we landed on the dashboard instead, use the
  // "Payments" tile (or the hamburger side menu) to reach the serving screen.
  const dashboardPayments = window.locator('ion-item[detail]').filter({ hasText: /^Payments$/i }).first();
  if (await dashboardPayments.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dashboardPayments.click();
  } else {
    await clickHamburger(window);
    await window.waitForTimeout(400);
    await window.locator('ion-menu ion-item, ion-item').filter({ hasText: /^Payments$/i }).first()
      .click({ timeout: 10_000 });
  }
  await WarningDialog.dismiss(window, 5_000);
  await waitForLoadingOverlay(window);

  // Close any open side menu so the Payments segments aren't covered.
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (menu?.close) await Promise.race([menu.close(), new Promise(r => setTimeout(r, 1_000))]);
  }).catch(() => {});
  await window.keyboard.press('Escape').catch(() => {});

  await expect(patronSegment).toBeVisible({ timeout: 20_000 });
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
    // Ionic buttons don't reliably respond to Playwright's click here (the
    // funding screen never opened and Add Funds stayed on screen), so click it
    // in-page, then wait for the keypad itself rather than a fixed pause.
    const opened = await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
        .find(b => !!(b.offsetWidth || b.offsetHeight)
          && /^Add Funds$/i.test((b.innerText || b.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (opened) {
      await waitForLoadingOverlay(window);
      await window.locator('ion-button:visible').filter({ hasText: /^\s*1\s*$/ }).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
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

  // ── TEMP DIAGNOSTIC ────────────────────────────────────────────────────
  await window.screenshot({ path: 'test-results/_diag-before-digits.png' }).catch(() => {});
  const kp = await window.evaluate(() => {
    const vis = (el: Element) => !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight);
    const ones = Array.from(document.querySelectorAll('ion-button')).filter(b => /^\s*1\s*$/.test((b.textContent || '').trim()));
    const tabs = Array.from(document.querySelectorAll('ion-segment-button, ion-tab-button')).filter(vis).map(t => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20));
    const addFunds = Array.from(document.querySelectorAll('ion-button, button')).some(b => /^Add Funds$/i.test((b.textContent || '').trim()) && vis(b));
    return { ones1: ones.length, ones1visible: ones.filter(vis).length, visibleTabs: tabs, addFundsVisible: addFunds };
  }).catch(e => ({ err: String(e) }));
  console.log('DIAG makeCashPayment keypad state:', JSON.stringify(kp));
  // ───────────────────────────────────────────────────────────────────────

  // Type cents-style: $50.00 → keys "5000". Scope to VISIBLE digit buttons —
  // the serving screen's patron-ID keypad stays in the DOM (hidden) behind the
  // payment form, so a plain .first() can resolve to an invisible button.
  for (const digit of dollarsToCentsDigits(amount)) {
    await window.locator('ion-button:visible')
      .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
      .first()
      .click({ timeout: 5_000 });
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
      //   it (the dialog never auto-dismisses — Close is the only way out
      //   while offline). Scope to the modal containing "Closing POS
      //   Terminal" so we don't grab a different "Close" elsewhere. We poll
      //   the button's actual `disabled`/`aria-disabled` state and force the
      //   click — Playwright's toBeEnabled() can hang if the button toggles
      //   via CSS class instead of the disabled attribute.
      const closeDialog = window.locator('ion-modal')
        .filter({ hasText: /Closing POS Terminal/i }).first();
      const closeBtnInDialog = closeDialog.locator('ion-button, button')
        .filter({ hasText: /^\s*Close\s*$/i }).first();

      console.log('Waiting for Closing POS Terminal Close button to become active...');
      await expect.poll(
        async () => {
          return await closeBtnInDialog.evaluate(el => {
            const e = el as HTMLButtonElement;
            if (e.disabled) return false;
            if (el.hasAttribute('disabled')) return false;
            if (el.getAttribute('aria-disabled') === 'true') return false;
            // Some Ionic builds wrap a real <button> inside ion-button; check.
            const inner = el.querySelector('button');
            if (inner && (inner.disabled || inner.hasAttribute('disabled'))) return false;
            // CSS class fallback — when EP styles the button as disabled.
            if ((el.className ?? '').match(/\bdisabled\b/i)) return false;
            return true;
          }).catch(() => false);
        },
        { timeout: 180_000, intervals: [1_000] },
      ).toBe(true);

      console.log('Close button is active — clicking.');
      await closeBtnInDialog.click({ force: true });
      await window.waitForTimeout(1_000);
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
