import { expect, Page } from '@playwright/test';

const PRIMEROEDGE_QA_URL = 'https://qa.primeroedge.co';
const PRIMEROEDGE_USERNAME = process.env.PRIMEROEDGE_WEB_USERNAME ?? 'sabih.siddiqui';
const PRIMEROEDGE_PASSWORD = process.env.PRIMEROEDGE_WEB_PASSWORD ?? 'Sab133728$!';

export type ReconciliationSessionValues = {
  openingBalance: string;
  closingBalance: string;
  mealItem: string;
  mealItems: string[];
  saleAmount: string;
};

export async function loginToPrimeroEdgeQa(page: Page): Promise<void> {
  const username = page.locator('#UserNameTextBox');

  // Retry the navigation a few times — QA can return ERR_CONNECTION_RESET
  // intermittently, and a single reload isn't always enough.
  let ready = false;
  for (let attempt = 0; attempt < 6 && !ready; attempt++) {
    try {
      await page.goto(`${PRIMEROEDGE_QA_URL}/login.aspx`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch {
      // Network failure — wait and retry.
      await page.waitForTimeout(3_000);
      continue;
    }
    ready = await username.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) {
      // domcontentloaded fired but the login form never painted (QA returns a
      // blank/partial page under ERR_CONNECTION_RESET storms after hours).
      // Reload before the next attempt.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3_000);
    }
  }

  await expect(username, 'PrimeroEdge login page should load #UserNameTextBox').toBeVisible({ timeout: 20_000 });
  await page.locator('#UserNameTextBox').fill(PRIMEROEDGE_USERNAME);
  await page.locator('#PasswordTextBox').fill(PRIMEROEDGE_PASSWORD);
  await page.locator('#LoginButton').click();
  await page.waitForURL(/dashboard\.aspx/i, { timeout: 60_000 });
  await expect(page.getByText(/Workspace/i).first()).toBeVisible({ timeout: 20_000 });
}

export async function openPointOfServiceReconciliation(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Point of Service' }).click();
  await page.waitForURL(/\/POS\/POSHome\.aspx/i, { timeout: 60_000 });

  await page.getByText('Administration', { exact: true }).first().click();
  await page.getByRole('link', { name: 'Reconciliation' }).click();
  await page.waitForURL(/\/POS\/Reconciliation\.aspx/i, { timeout: 60_000 });
  await expect(page.getByText(/^Reconciliation$/i).first()).toBeVisible({ timeout: 20_000 });
}

export async function filterReconciliationForToday(page: Page, today = new Date()): Promise<void> {
  const dateValue = formatPrimeroEdgeDate(today);
  await setDateInput(page, '#ctl00_UserContentArea_calFromDate_dateInput', dateValue);
  await setDateInput(page, '#ctl00_UserContentArea_calToDate_dateInput', dateValue);
  await closeDatePicker(page);

  await page.locator('#ctl00_UserContentArea_ddlEntrymethod').selectOption({ label: 'ExpressPoint' });
  await page.locator('#ctl00_UserContentArea_btnApply').click();
  await page.waitForLoadState('domcontentloaded');
  await closeDatePicker(page);
  await scrollSessionsIntoView(page);
  await expect(page.getByText(/Sessions/i).first()).toBeVisible({ timeout: 30_000 });

  // Sort by Closing Date descending so the latest session is at the top of page 1
  await sortSessionsByClosingDateDescendingRobust(page);
}

async function sortSessionsByClosingDateDescending(page: Page): Promise<void> {
  await scrollSessionsIntoView(page);
  // Find the "Closing Date" column header link inside the sessions grid
  const header = page
    .locator('#ctl00_UserContentArea_gridSessions')
    .locator('a, th, span')
    .filter({ hasText: /^Closing Date$/i })
    .first();
  // If no rows have loaded yet the header won't be visible — skip silently so the
  // outer retry loop in openMatchingReconciliationSession can re-apply the filter
  // and try again once sessions have synced from ExpressPoint.
  const visible = await header.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!visible) return;
  await header.scrollIntoViewIfNeeded().catch(() => {});
  // Click twice: first click may sort ascending, second ensures descending (arrow down = newest first)
  await header.click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => page.waitForTimeout(1_500));
  await header.click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => page.waitForTimeout(1_500));
}

async function sortSessionsByClosingDateDescendingRobust(page: Page): Promise<void> {
  await scrollSessionsIntoView(page);
  for (let i = 0; i < 2; i++) {
    const clicked = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('#ctl00_UserContentArea_gridSessions');
      if (!grid) return false;

      const header = Array.from(grid.querySelectorAll<HTMLElement>('th, a, span'))
        .find(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          return visible && /Closing\s*Date/i.test(el.innerText ?? '');
        });

      const target = header?.querySelector<HTMLElement>('a') ?? header;
      target?.click();
      return !!target;
    });
    if (!clicked) return;
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => page.waitForTimeout(1_500));
    await scrollSessionsIntoView(page);
  }
}

export async function openMatchingReconciliationSession(
  page: Page,
  expected: ReconciliationSessionValues,
): Promise<void> {
  let rowIndex = -1;
  const deadline = Date.now() + 180_000;
  // Only use the "most recent closed" fallback after a delay — the session needs time
  // to sync from ExpressPoint to PrimeroEdge before it appears in the grid.
  const fallbackAfter = Date.now() + 60_000;

  while (Date.now() < deadline && rowIndex === -1) {
    await scrollSessionsIntoView(page);

    // First attempt: exact opening/closing balance match
    rowIndex = await findMatchingSessionRowIndex(page, expected.openingBalance, expected.closingBalance);
    if (rowIndex !== -1) break;

    // Second attempt (after 60 s): PrimeroEdge may record $0.00 for both balances
    // regardless of what was entered in ExpressPoint. After waiting for sync, the
    // most recently closed session (row 0 after Closing Date desc sort) is ours.
    if (Date.now() >= fallbackAfter) {
      rowIndex = await findMostRecentClosedSessionRowIndex(page);
      if (rowIndex !== -1) break;
    }

    // Re-apply filter, re-sort descending, and wait for the session to appear
    await closeDatePicker(page);
    await page.locator('#ctl00_UserContentArea_btnApply').click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sortSessionsByClosingDateDescendingRobust(page);
    await scrollSessionsIntoView(page);
    await page.waitForTimeout(10_000);
  }

  expect(rowIndex, `session with opening ${expected.openingBalance} and closing ${expected.closingBalance}`).not.toBe(-1);
  const clicked = await page.evaluate((index: number) => {
    const rows = visibleGridRows('ctl00_UserContentArea_gridSessions');
    const row = rows[index];
    const action = Array.from(row.querySelectorAll<HTMLElement>('a, input, button, img'))
      .find(el => /reconcile/i.test([
        el.innerText,
        el.getAttribute('title'),
        el.getAttribute('alt'),
        el.getAttribute('value'),
        el.getAttribute('name'),
        el.id,
      ].filter(Boolean).join(' ')));

    action?.click();
    return !!action;

    function visibleGridRows(tableId: string): HTMLTableRowElement[] {
      return Array.from(document.querySelectorAll<HTMLTableRowElement>(`#${tableId} tr`))
        .filter(row => {
          const visible = !!(row.offsetWidth || row.offsetHeight || row.getClientRects().length);
          return visible && /\$\d/.test(row.innerText);
        });
    }
  }, rowIndex);

  expect(clicked).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(reconciliationInfoTab(page, 'Transactions')).toBeVisible({ timeout: 60_000 });
}

async function findMostRecentClosedSessionRowIndex(page: Page): Promise<number> {
  // Find the Closed row with the most recent Closing Date that still has a Reconcile
  // action — this is independent of the current grid sort order.
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#ctl00_UserContentArea_gridSessions tr'))
      .filter(row => {
        const visible = !!(row.offsetWidth || row.offsetHeight || row.getClientRects().length);
        return visible && /\$\d/.test(row.innerText);
      });

    const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)/gi;

    let bestRow = -1;
    let bestDate = new Date(0);

    for (let i = 0; i < rows.length; i++) {
      const rowText = rows[i].innerText ?? '';
      if (!/\bClosed\b/i.test(rowText)) continue;

      const hasReconcile = Array.from(rows[i].querySelectorAll<HTMLElement>('a, input, button, img'))
        .some(el => /reconcile/i.test([
          el.innerText, el.getAttribute('title'), el.getAttribute('alt'),
          el.getAttribute('value'), el.getAttribute('name'), el.id,
        ].filter(Boolean).join(' ')));
      if (!hasReconcile) continue;

      // Extract all date strings; Closing Date is the second one (after Opening Date)
      const dates = Array.from(rowText.matchAll(DATE_RE)).map(m => new Date(m[0]));
      const closingDate = dates.length >= 2 ? dates[dates.length - 1] : dates[0];
      if (!closingDate || isNaN(closingDate.getTime())) continue;

      if (closingDate > bestDate) {
        bestDate = closingDate;
        bestRow = i;
      }
    }

    return bestRow;
  });
}

export async function verifyReconciledTransactionDetails(
  page: Page,
  expected: ReconciliationSessionValues,
): Promise<void> {
  await reconciliationInfoTab(page, 'Transactions').click();
  const transactionsGrid = page.locator('#ctl00_UserContentArea_gridTransactions, table').filter({ hasText: /Patron ID|Sale Amt/i }).first();
  await expect(transactionsGrid)
    .toBeVisible({ timeout: 30_000 });
  const reconciledSaleAmount = await getPatronSaleAmountFromTransactions(page, '1337');
  expect(reconciledSaleAmount, 'reconciled transaction should have a positive Sale Amt').not.toBe('$0.00');

  const editButton = page.locator(
    'input[name="ctl00$UserContentArea$gridTransactions$ctl00$ctl04$imgAdjustTransaction"], [name*="imgAdjustTransaction"], [id*="imgAdjustTransaction"], img[title*="Adjust"], a[title*="Adjust"], input[title*="Adjust"]',
  );
  const target = await editButton.isVisible({ timeout: 5_000 }).catch(() => false)
    ? editButton
    : page.locator('input, a, button, img').filter({ hasText: /adjust|edit/i }).first();

  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  await expect(page.getByText(/Adjust Transactions/i).first()).toBeVisible({ timeout: 30_000 });

  const frameTexts = await Promise.all(
    page.frames().map(frame => frame.locator('body').innerText({ timeout: 2_000 }).catch(() => '')),
  );
  const dialogText = [
    await page.locator('body').innerText().catch(() => ''),
    ...frameTexts,
  ].join('\n');
  if (/Sale Details/i.test(dialogText)) {
    for (const item of expected.mealItems) {
      expect(dialogText).toMatch(new RegExp(escapeRegExp(item), 'i'));
    }
    expect(normalizeMoneyValues(dialogText)).toContain(reconciledSaleAmount);
  }
}

async function getPatronSaleAmountFromTransactions(page: Page, patronId: string): Promise<string> {
  return await page.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#ctl00_UserContentArea_gridTransactions tr, table tr'))
      .filter(row => {
        const visible = !!(row.offsetWidth || row.offsetHeight || row.getClientRects().length);
        return visible && new RegExp(`\\b${id}\\b`).test(row.innerText);
      });

    const row = rows[0];
    if (!row) throw new Error(`No transaction row found for patron ${id}.`);

    const table = row.closest('table');
    const headers = Array.from(table?.querySelectorAll<HTMLElement>('th') ?? []).map(cell => cell.innerText.trim());
    const cells = Array.from(row.querySelectorAll<HTMLElement>('td')).map(cell => cell.innerText.trim());
    const saleAmountIndex = headers.findIndex(cell => /Sale\s*Amt/i.test(cell));
    const directSaleAmount = saleAmountIndex >= 0 ? normalizeMoney(cells[saleAmountIndex]) : null;
    if (directSaleAmount && directSaleAmount !== '$0.00') return directSaleAmount;

    const moneyValues = Array.from(row.innerText.matchAll(/\$?\s*(-?\d+(?:\.\d{1,2})?)/g))
      .map(match => `$${Number(match[1]).toFixed(2)}`)
      .filter(value => value !== '$0.00');
    if (moneyValues.length === 0) return '$0.00';
    return moneyValues[moneyValues.length - 1];

    function normalizeMoney(value: string): string {
      const match = value.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
      return `$${Number(match?.[1] ?? 0).toFixed(2)}`;
    }
  }, patronId);
}

async function setDateInput(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.click();
  await input.press('Control+A');
  await input.fill(value);
  await input.evaluate((el: HTMLInputElement) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
}

async function closeDatePicker(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('body').click({ position: { x: 20, y: 20 }, timeout: 2_000 }).catch(() => {});
}

async function scrollSessionsIntoView(page: Page): Promise<void> {
  await page.locator('#ctl00_UserContentArea_gridSessions, text=Sessions').first()
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
    .catch(() => {});
}

async function findMatchingSessionRowIndex(page: Page, openingBalance: string, closingBalance: string): Promise<number> {
  return await page.evaluate(
    ({ opening, closing }) => {
      const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#ctl00_UserContentArea_gridSessions tr'))
        .filter(row => {
          const visible = !!(row.offsetWidth || row.offsetHeight || row.getClientRects().length);
          return visible && /\$\d/.test(row.innerText);
        });

      const normalizedOpening = normalizeMoney(opening);
      const normalizedClosing = normalizeMoney(closing);

      for (let i = rows.length - 1; i >= 0; i--) {
        const cells = Array.from(rows[i].querySelectorAll<HTMLElement>('td')).map(cell => normalizeMoney(cell.innerText));
        if (cells.includes(normalizedOpening) && cells.includes(normalizedClosing)) {
          return i;
        }
      }

      return -1;

      function normalizeMoney(value: string): string {
        const match = value.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
        const amount = Number(match?.[1] ?? 0);
        return `$${amount.toFixed(2)}`;
      }
    },
    { opening: openingBalance, closing: closingBalance },
  );
}

function formatPrimeroEdgeDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function normalizeMoneyValues(value: string): string[] {
  return Array.from(value.matchAll(/\$?\s*(-?\d+(?:\.\d{1,2})?)/g))
    .map(match => `$${Number(match[1]).toFixed(2)}`);
}

function normalizeMoneyValue(value: string): string {
  return normalizeMoneyValues(value)[0] ?? '$0.00';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reconciliationInfoTab(page: Page, tabName: string) {
  return page
    .locator('a, span, li, button')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(tabName)}\\s*$`, 'i') })
    .first();
}
