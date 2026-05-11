// Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_workitems/edit/115635


import { test, expect, Page, chromium, Browser } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { dismissAllYesConfirms, ensureServiceClosed } from '../../utils/service';
import { loginToPrimeroEdgeQa } from '../../utils/primeroedge-web';

test.describe.configure({ timeout: 600_000 });

const PATRON_ID = '1337';

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

async function clickMenuItem(window: Page, label: RegExp): Promise<void> {
  const item = window.locator('ion-menu ion-item, ion-item[detail]').filter({ hasText: label }).first();
  if (!await item.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await clickHamburger(window);
  }
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click({ timeout: 15_000 });
  await closeSideMenu(window);
  await WarningDialog.dismiss(window, 3_000);
  await waitForLoadingOverlay(window);
}

async function closeSideMenu(window: Page): Promise<void> {
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (menu?.close) await Promise.race([menu.close(), new Promise(resolve => setTimeout(resolve, 1_000))]);
  }).catch(() => {});
  await window.keyboard.press('Escape').catch(() => {});
  await window.waitForTimeout(250);
}

// ─── Money helpers ────────────────────────────────────────────────────────────

function randomDollarAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function dollarsToCentsDigits(amount: number): string[] {
  const cents = Math.round(amount * 100);
  return cents.toString().split('');
}

function randomCheckNumber(): string {
  // 4-digit check number (1000–9999) so it's always exactly 4 digits.
  return String(1000 + Math.floor(Math.random() * 9000));
}

// ─── Open Service ─────────────────────────────────────────────────────────────

async function openServiceWithBalance(window: Page, opening: number): Promise<void> {
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);

  // Always start from a clean state — close any leftover session so the check
  // count reflects only THIS test's payments.
  await ensureServiceClosed(window);
  await WarningDialog.dismiss(window, 3_000);

  await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first()
    .click({ timeout: 15_000 });
  await WarningDialog.dismiss(window, 5_000);
  await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
  await WarningDialog.dismiss(window, 2_000);

  // Enter the opening balance. The field is cents-style: every digit pushes
  // into cents, so typing "141" produces $1.41. Type the cents representation
  // ("14100") to get $141.00.
  const input = window.locator('input.input-label-opencloseBalance').first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await window.keyboard.press('Control+A');
  await window.keyboard.press('Backspace');
  const openingCents = Math.round(opening * 100);
  await window.keyboard.type(String(openingCents));
  await window.waitForTimeout(300);

  await window.getByRole('button', { name: /open service/i }).last().click();
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 30_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);
}

// ─── Payments page ────────────────────────────────────────────────────────────

async function navigateToPayments(window: Page): Promise<void> {
  await clickMenuItem(window, /^Payments$/i);
  await expect(
    window.locator('ion-segment-button, ion-item, ion-tab-button')
      .filter({ hasText: /\b(PIN|Patron\s*ID)\b/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

async function clickPinTab(window: Page): Promise<void> {
  await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-segment-button'))
      .find(el => visible(el) && /^(PIN|Patron\s*ID)$/i.test((el.innerText || '').trim()));
    btn?.click();
  });
  await window.waitForTimeout(400);
}

async function searchPatron(window: Page, id: string): Promise<void> {
  await clickPinTab(window);
  const idInput = window.locator('input[placeholder*="Enter a" i], input[placeholder*="PIN" i], input[placeholder*="ID" i]').first();
  await expect(idInput).toBeVisible({ timeout: 15_000 });
  await idInput.click();
  await idInput.fill(id);

  // Submit via forward-circle icon button or Enter.
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

async function clickPaymentTab(window: Page, method: 'Cash' | 'Check' | 'Card'): Promise<void> {
  await WarningDialog.dismiss(window, 2_000);

  // The Cash/Check/Card segment may be hidden behind an Add Funds button on
  // some builds — click Add Funds first if no segment is visible.
  // Using \b word boundary: matches "CASH", "Cash", " Cash ", etc.
  const tab = window.locator('ion-segment-button, ion-tab-button')
    .filter({ hasText: new RegExp(`\\b${method}\\b`, 'i') }).first();
  if (!await tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const addFunds = window.locator('ion-button, button')
      .filter({ hasText: /^Add Funds$/i }).first();
    if (await addFunds.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addFunds.click();
      await waitForLoadingOverlay(window);
      await WarningDialog.dismiss(window, 2_000);
    }
  }

  if (!await tab.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const dump = await window.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 800),
      segments: Array.from(document.querySelectorAll<HTMLElement>('ion-segment-button, ion-tab-button'))
        .filter(el => !!(el.offsetWidth || el.offsetHeight))
        .map(el => (el.innerText || '').trim().substring(0, 40))
        .filter(Boolean),
    }));
    console.log(`PAYMENT_TAB DEBUG (${method}):`, JSON.stringify(dump));
  }
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await window.waitForTimeout(500);
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
          const visible = !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight || rect.width || rect.height);
          if (visible && rect.width > 0 && rect.height > 0) {
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

async function clickPaymentAmountInput(window: Page): Promise<void> {
  // On Check tab the Check # input is auto-focused — click the Payment input first.
  const coords = await findIonInputCoords(window);
  if (coords.length > 0) {
    await window.mouse.click(coords[0].x, coords[0].y);
  } else {
    const paymentLabel = window.locator('ion-label, label, span, div').filter({ hasText: /^Payment$/i }).first();
    const box = await paymentLabel.boundingBox().catch(() => null);
    if (box) await window.mouse.click(box.x + box.width + 80, box.y + box.height / 2);
    else await window.keyboard.press('Shift+Tab');
  }
  await window.waitForTimeout(400);
}

async function clickKeypadDigits(window: Page, digits: string[]): Promise<void> {
  for (const digit of digits) {
    await window.locator('ion-button')
      .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
      .first()
      .click({ force: true, timeout: 5_000 });
    await window.waitForTimeout(150);
  }
}

async function clickCheckNumberInput(window: Page): Promise<void> {
  const points = await window.evaluate(() => {
    const directText = (el: Element) => Array.from(el.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const labels = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter(el => visible(el) && /^Check\s*#$/i.test(directText(el)))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
    const label = labels[0];
    if (!label) return [];
    const rect = label.getBoundingClientRect();
    const row = label.parentElement?.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    return [
      { x: rect.left + rect.width / 2, y },
      { x: Math.min(rect.right + 40, globalThis.innerWidth - 10), y },
      row ? { x: row.left + row.width / 2, y: row.top + row.height / 2 } : null,
    ].filter(Boolean) as { x: number; y: number }[];
  });
  if (points.length === 0) throw new Error('clickCheckNumberInput: Check # field not found');
  for (const point of points) {
    await window.mouse.click(point.x, point.y);
    await window.waitForTimeout(150);
  }
}

async function clickMakePayment(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const btn = btns.find(b =>
      !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
      && /^make payment$/i.test((b.innerText || b.textContent || '').trim()),
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) await window.keyboard.press('Enter');

  await waitForLoadingOverlay(window);
  // Large payments trigger a Yes/No confirm — click Yes if present.
  await dismissAllYesConfirms(window, 4_000, 2);
  // Success toast/alert may appear — dismiss any OK/Done.
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
}

async function makeCashPayment(window: Page, amount: number): Promise<void> {
  await clickPaymentTab(window, 'Cash');
  await clickPaymentAmountInput(window);
  await clickKeypadDigits(window, dollarsToCentsDigits(amount));
  await clickMakePayment(window);
}

async function makeCheckPayment(window: Page, amount: number, checkNumber: string): Promise<void> {
  await clickPaymentTab(window, 'Check');
  // 1. Click the $ amount field, enter the random amount.
  await clickPaymentAmountInput(window);
  await clickKeypadDigits(window, dollarsToCentsDigits(amount));
  // 2. Click the Check # field, enter the 4-digit check number.
  await clickCheckNumberInput(window);
  await clickKeypadDigits(window, checkNumber.split(''));
  // 3. Click Make Payment (large amounts trigger a confirm).
  await clickMakePayment(window);
}

// ─── Close service ────────────────────────────────────────────────────────────

async function navigateToCloseService(window: Page): Promise<void> {
  await clickMenuItem(window, /^Close Service$/i);
  await waitForText(window, /Close Service|Closing Balance/i, 20_000);
  await WarningDialog.dismiss(window, 3_000);
  await waitForLoadingOverlay(window);
}

/** Read "X Check(s) totaling $Y" from the close-service screen. */
async function readCheckTotal(window: Page): Promise<{ count: number; total: string }> {
  return window.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/(\d+)\s*Check\(s\)\s*totaling\s*\$([\d,]+\.\d{2})/i);
    if (!match) return { count: 0, total: '$0.00' };
    return { count: Number(match[1]), total: `$${match[2].replace(',', '')}` };
  });
}

async function readClosingBalance(window: Page): Promise<string> {
  return window.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Closing Balance\s*\$([\d,]+\.\d{2})/i);
    return match ? `$${match[1].replace(',', '')}` : '$0.00';
  });
}

async function clickCloseServiceFooterButton(window: Page): Promise<void> {
  // The Close Service confirm button is at the bottom-right of the close panel.
  const coords = await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const own = (el: HTMLElement) => Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent?.trim() ?? '').join(' ').trim();
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, [role="button"], span, ion-col, div'))
      .filter(el => visible(el))
      .filter(el => {
        const text = own(el) || (el.getAttribute('aria-label') ?? '').trim();
        const rect = el.getBoundingClientRect();
        return rect.top > document.documentElement.clientHeight * 0.45
          && rect.width > 8 && rect.height > 8
          && /^(Close Service|Close\s*S)$/i.test(text);
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(coords, 'Close Service button should be visible').not.toBeNull();
  await window.mouse.click(coords!.x, coords!.y);
}

// ─── PrimeroEdge web Reconciliation ──────────────────────────────────────────

async function findRecentSessionMatching(
  page: Page,
  expectedOpening: string,
  expectedClosing: string,
  timeoutMs: number,
): Promise<void> {
  // Open Reconciliation, filter for today, sort by Closing Date desc twice.
  // Use the same role-based locators as utils/primeroedge-web.ts.
  await page.getByRole('link', { name: 'Point of Service' }).click();
  await page.waitForURL(/\/POS\/POSHome\.aspx/i, { timeout: 60_000 });

  await page.getByText('Administration', { exact: true }).first().click();
  await page.getByRole('link', { name: 'Reconciliation' }).click();
  await page.waitForURL(/\/POS\/Reconciliation\.aspx/i, { timeout: 60_000 });
  await expect(page.getByText(/^Reconciliation$/i).first()).toBeVisible({ timeout: 30_000 });

  // Set From and To to today's date.
  const today = new Date();
  const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
  for (const sel of [
    '#ctl00_UserContentArea_calFromDate_dateInput',
    '#ctl00_UserContentArea_calToDate_dateInput',
  ]) {
    const inp = page.locator(sel).first();
    if (await inp.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await inp.click();
      await inp.press('Control+A');
      await inp.fill(dateStr);
      await inp.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
    }
  }
  await page.keyboard.press('Escape').catch(() => {});

  const entryMethodSel = page.locator('#ctl00_UserContentArea_ddlEntrymethod');
  if (await entryMethodSel.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await entryMethodSel.selectOption({ label: 'ExpressPoint' }).catch(() => {});
  }
  await page.locator('#ctl00_UserContentArea_btnApply').click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Click "Closing Date" header twice for descending order.
  for (let i = 0; i < 2; i++) {
    const clicked = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('#ctl00_UserContentArea_gridSessions');
      if (!grid) return false;
      const header = Array.from(grid.querySelectorAll<HTMLElement>('th, a, span'))
        .find(el => !!(el.offsetWidth || el.offsetHeight) && /Closing\s*Date/i.test(el.innerText ?? ''));
      const target = header?.querySelector<HTMLElement>('a') ?? header;
      target?.click();
      return !!target;
    });
    if (!clicked) break;
    await page.waitForTimeout(1_500);
  }

  // After the 2x Closing Date desc sort, the latest closed session is row 0.
  // Read its Opening / Closing Balance cells directly and assert they match
  // the values we entered/paid in ExpressPoint. Retry briefly while the grid
  // settles, but do NOT fall back to "accept whatever is there".
  const deadline = Date.now() + timeoutMs;
  let topRow: { opening: string; closing: string; rowText: string } | null = null;

  while (Date.now() < deadline) {
    topRow = await page.evaluate(() => {
      const norm = (v: string): string => {
        const m = v.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
        return m ? `$${Number(m[1]).toFixed(2)}` : '';
      };
      const grid = document.querySelector<HTMLElement>('#ctl00_UserContentArea_gridSessions');
      if (!grid) return null;

      // Find column indexes for Opening Balance and Closing Balance from the header.
      const headers = Array.from(grid.querySelectorAll<HTMLElement>('th'));
      const openingIdx = headers.findIndex(h => /Opening\s*Balance/i.test(h.innerText ?? ''));
      const closingIdx = headers.findIndex(h => /Closing\s*Balance/i.test(h.innerText ?? ''));

      const rows = Array.from(grid.querySelectorAll<HTMLTableRowElement>('tr'))
        .filter(row => !!(row.offsetWidth || row.offsetHeight) && /\$\d/.test(row.innerText));
      if (rows.length === 0) return null;

      const cells = Array.from(rows[0].querySelectorAll<HTMLElement>('td'));
      const rowText = (rows[0].innerText ?? '').replace(/\s+/g, ' ').trim();

      // Prefer header-indexed cells; fall back to "first two $-cells" if the
      // header layout doesn't expose Opening/Closing columns.
      let opening = openingIdx >= 0 ? norm(cells[openingIdx]?.innerText ?? '') : '';
      let closing = closingIdx >= 0 ? norm(cells[closingIdx]?.innerText ?? '') : '';
      if (!opening || !closing) {
        const monies = cells.map(c => norm(c.innerText)).filter(Boolean);
        if (!opening) opening = monies[0] ?? '';
        if (!closing) closing = monies[1] ?? '';
      }
      return { opening, closing, rowText };
    });

    if (topRow && topRow.opening && topRow.closing) break;

    await page.waitForTimeout(5_000);
    await page.locator('#ctl00_UserContentArea_btnApply').click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  expect(topRow, `Reconciliation grid should have at least one session row for today`).not.toBeNull();

  console.log(
    `Reconciliation latest session — opening=${topRow!.opening}, closing=${topRow!.closing} `
    + `(expected ${expectedOpening}/${expectedClosing}). Row: ${topRow!.rowText}`,
  );

  expect(
    topRow!.opening,
    `Reconciliation Opening Balance (latest session) should match ExpressPoint opening (${expectedOpening})`,
  ).toBe(expectedOpening);
  expect(
    topRow!.closing,
    `Reconciliation Closing Balance (latest session) should match ExpressPoint Check total (${expectedClosing})`,
  ).toBe(expectedClosing);
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('T-115635', () => {
  test('payments + open/close service balances reflect in PrimeroEdge Reconciliation', async () => {
    const opening = randomDollarAmount(1, 499);
    const cashAmount = randomDollarAmount(101, 499);
    const checkAmount = randomDollarAmount(101, 499);

    // Round opening to whole dollar so we can type it via the input pattern.
    const openingRounded = Math.round(opening);
    // Closing Balance on the Close Service screen reflects the check total
    // (denominations are entered by the cashier and default to $0; checks are
    // a separate line that auto-fills the closing balance display).
    const expectedClosing = checkAmount;
    const formatMoney = (n: number) => `$${n.toFixed(2)}`;

    const handle = await launchExpressPoint();
    let webBrowser: Browser | null = null;
    try {
      // ── 1. Login + open service with random opening balance.
      await login(handle.window);
      const window = await getAppWindow(handle);
      await openServiceWithBalance(window, openingRounded);

      // ── 2 & 3. Navigate to Payments, search 1337, make Cash + Check payments.
      // Cash first: enter random $ amount → Make Payment.
      await navigateToPayments(window);
      await searchPatron(window, PATRON_ID);
      await makeCashPayment(window, cashAmount);

      // Re-search for the same patron between methods (Payments clears state).
      // Check: click $ amount → enter amount → click Check # → enter 4-digit number → Make Payment.
      await navigateToPayments(window);
      await searchPatron(window, PATRON_ID);
      await makeCheckPayment(window, checkAmount, randomCheckNumber());

      // ── 4. Close service immediately and verify the Check total + closing balance.
      await navigateToCloseService(window);
      const checkTotal = await readCheckTotal(window);
      expect(checkTotal.count, 'exactly 1 check should be recorded').toBe(1);
      expect(
        checkTotal.total,
        `Check(s) totaling should match the Check amount paid (${formatMoney(checkAmount)})`,
      ).toBe(formatMoney(checkAmount));

      // Closing Balance should match the Check amount paid (denominations
      // default to $0 unless entered manually).
      const closingBalance = await readClosingBalance(window);
      expect(
        closingBalance,
        `Closing Balance should equal the Check amount paid (${formatMoney(checkAmount)})`,
      ).toBe(formatMoney(expectedClosing));

      // Click Close Service to finalize and return to the dashboard.
      await clickCloseServiceFooterButton(window);
      await dismissAllYesConfirms(window, 12_000, 4);
      const closingDialog = window.getByText(/closing pos terminal/i).first();
      if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(closingDialog).toBeHidden({ timeout: 60_000 });
      }
      await waitForLoadingOverlay(window);
      await WarningDialog.dismiss(window, 3_000);
      // Confirm we're back on the dashboard with "Open Service" available.
      await expect(
        window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first(),
        'after closing service the dashboard should expose "Open Service"',
      ).toBeVisible({ timeout: 30_000 });

      // ── 6. PrimeroEdge web Reconciliation — verify the latest session's
      // Opening + Closing balance match what ExpressPoint actually showed
      // on the Close Service screen (closingBalance comes from
      // "Closing Balance $X.XX", which mirrors "1 Check(s) totaling $X.XX").
      webBrowser = await chromium.launch({ headless: false });
      const webPage = await (await webBrowser.newContext()).newPage();
      await loginToPrimeroEdgeQa(webPage);
      await findRecentSessionMatching(
        webPage,
        formatMoney(openingRounded),
        closingBalance,
        180_000,
      );
    } finally {
      if (webBrowser) await webBrowser.close().catch(() => {});
      await closeExpressPoint(handle).catch(() => {});
    }
  });
});
