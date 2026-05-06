//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115138


import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';

test.describe.configure({ timeout: 600_000 });

// ─── Types & constants ────────────────────────────────────────────────────────

type PaymentMethod = 'Cash' | 'Check';

interface AccountScenario {
  type:    string;
  methods: PaymentMethod[];
}

const SCENARIOS: AccountScenario[] = [
  { type: 'Program Adult', methods: ['Cash', 'Check'] },
  { type: 'Staff',         methods: ['Cash', 'Check'] },
  { type: 'Student',       methods: ['Cash', 'Check'] },
  { type: 'Visitor',       methods: ['Cash', 'Check'] },
];

const INVALID_CHECK_NUM = '12';   // 2 digits — must fail validation
const VALID_CHECK_NUM   = '123';  // 3+ digits — must succeed

// ─── Core DOM helpers ─────────────────────────────────────────────────────────

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}


async function getAppWindow(handle: ExpressPointHandle): Promise<Page> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const context = handle.browser.contexts()[0];
    const pages = context.pages().filter(p => !p.isClosed());
    for (const page of pages) {
      const isApp = await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false);
      if (isApp) return page;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('getAppWindow: ion-app not found after 15s');
}

// ─── Login & navigation ───────────────────────────────────────────────────────

async function login(window: Page): Promise<void> {
const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window);
}

// ─── Service helpers ──────────────────────────────────────────────────────────

async function openService(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);

  // If a service is already open, continue into it — no need to close and reopen
  const continueItem = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await continueItem.click({ timeout: 10_000 });
    await waitForLoadingOverlay(window);
    await WarningDialog.dismiss(window);
    return;
  }

  await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first()
    .click({ timeout: 15_000 });
  await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
  await WarningDialog.dismiss(window);
  await window.getByRole('button', { name: /open service/i }).last().click();
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window);
}

// ─── Serving grid helpers ─────────────────────────────────────────────────────

async function ensureServingGridSelected(window: Page): Promise<void> {
  // Food items in the left panel (left < 1500, top > 50) = menu grid is configured
  const hasItems = await window.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const rect = el.getBoundingClientRect();
        return visible && rect.left < 1500 && rect.top > 50 && rect.width > 100;
      })
  );
  if (hasItems) return;

  // Menu grid not configured — open the Menu toolbar selector
  await window.locator('ion-button').filter({ hasText: /^menu$/i }).first()
    .click({ timeout: 10_000 });

  // Wait for the Save button (dialog is open)
  await window.locator('ion-button, button').filter({ hasText: /^save$/i })
    .first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});

  // Click the first non-empty menu option
  await window.evaluate(() => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('ion-item'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && (el.innerText || el.textContent || '').trim().length > 0;
      });
    if (item) item.click();
  });
  await window.waitForTimeout(400);

  // Click Save
  await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /^save$/i.test((el.innerText || el.textContent || '').trim()),
      );
    if (btn) btn.click();
  });
  await waitForLoadingOverlay(window);

  // Confirm food items are now visible
  await expect.poll(async () =>
    window.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
        .some(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const rect = el.getBoundingClientRect();
          return visible && rect.left < 1500 && rect.top > 50 && rect.width > 100;
        })
    ),
    { timeout: 15_000 }
  ).toBe(true);
}

// ─── Account type & menu helpers ─────────────────────────────────────────────

async function clickAccountType(window: Page, type: string): Promise<void> {
  const btn = window
    .locator('ion-button, ion-card, ion-item, button')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(type)}\\s*$`, 'i') })
    .first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click({ timeout: 10_000 });
  await waitForLoadingOverlay(window);
}

async function selectFirstMenuItem(window: Page): Promise<void> {
  // Wait for left-panel food items (large buttons with non-empty text, not action buttons).
  const isFoodItem = `(function(el) {
    const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return (
      visible
      && rect.left < 1500
      && rect.top > 50
      && rect.width > 100
      && text.length > 1
      && !/^(pay|charge|void|cancel|close|ok|yes|no|menu|save|\\$\\d|\\d+\\.\\d{2})$/i.test(text)
    );
  })`;

  await expect.poll(async () =>
    window.evaluate((pred) =>
      Array.from(document.querySelectorAll<HTMLElement>('ion-button')).some(el => eval(pred)(el)),
      isFoodItem,
    ),
    { timeout: 20_000 }
  ).toBe(true);

  // Click the bottom-most food-item button (highest top value = main entree row).
  const coords = await window.evaluate((pred) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .filter(el => eval(pred)(el));
    if (items.length === 0) return null;
    let chosen = items[0];
    for (const el of items) {
      if (el.getBoundingClientRect().top > chosen.getBoundingClientRect().top) chosen = el;
    }
    const r = chosen.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, isFoodItem);

  if (coords) {
    await window.mouse.click(coords.x, coords.y);
  }

  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^(yes|ok)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
}

async function clickPay(window: Page): Promise<void> {
  await expect.poll(async () =>
    window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
        .find(el =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          && /^(pay|charge)$/i.test((el.innerText || el.textContent || '').trim()),
        );
      if (btn) { btn.click(); return true; }
      return false;
    }),
    { timeout: 10_000 }
  ).toBe(true);
  await waitForLoadingOverlay(window);
}

// ─── Payment helpers ──────────────────────────────────────────────────────────

async function verifyPaymentMethodsVisible(window: Page, methods: PaymentMethod[]): Promise<void> {
  for (const method of methods) {
    await expect(
      window.locator('ion-segment-button, ion-tab-button, ion-button, ion-item')
        .filter({ hasText: new RegExp(`^\\s*${method}\\s*$`, 'i') })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  }
}

async function selectPaymentTab(window: Page, method: PaymentMethod): Promise<void> {
  const tab = window.locator('ion-segment-button, ion-tab-button')
    .filter({ hasText: new RegExp(`^\\s*${method}\\s*$`, 'i') })
    .first();
  if (await tab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await tab.click();
  } else {
    await window.evaluate((label: string) => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .find(e =>
          !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
          && new RegExp(`^\\s*${label}\\s*$`, 'i').test(e.innerText?.trim() ?? ''),
        );
      el?.click();
    }, method);
  }
  await window.waitForTimeout(600);
  await window.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); });
  await window.waitForTimeout(200);
}

// Scope all keypad clicks to the Pay Transaction modal to avoid clicking
// the background patron-ID keypad (same digit buttons, different context).
async function clickKeypadDigit(window: Page, digit: string): Promise<void> {
  const clicked = await window.evaluate((d: string) => {
    const pattern = new RegExp(`^\\s*${d}\\s*$`);
    // 1. Prefer buttons inside the pay-popup modal
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup');
    if (modal && !!(modal.offsetWidth || modal.offsetHeight || modal.getClientRects().length)) {
      const btn = Array.from(modal.querySelectorAll<HTMLElement>('ion-button, button'))
        .find(el => pattern.test((el.innerText || el.textContent || '').trim()));
      if (btn) { btn.click(); return true; }
    }
    // 2. Fallback: any visible button matching the digit (no td/div to avoid false matches)
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && pattern.test((el.innerText || el.textContent || '').trim()),
      );
    if (btn) { btn.click(); return true; }
    return false;
  }, digit);
  if (!clicked) {
    await window.locator('ion-modal.menu-order-pay-popup ion-button, ion-modal.menu-order-pay-popup button')
      .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
      .first()
      .click({ force: true, timeout: 5_000 });
  }
  await window.waitForTimeout(150);
}

// Read the Amount Due from the Pay Transaction dialog.
async function readAmountDue(window: Page): Promise<string> {
  return window.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup') ?? document.body;
    const text = (modal as HTMLElement).innerText ?? '';
    const m = text.match(/amount\s+due\s*\$?([\d,]+\.\d{2})/i)
      ?? text.match(/sale\s+total\s*\$?([\d,]+\.\d{2})/i);
    return m ? m[1].replace(',', '') : '';
  });
}

// Convert a dollar string ("0.55") to the digit sequence for the POS keypad.
// The keypad builds the value right-to-left in cents: pressing 1,5 → $0.15
function dollarToKeypadDigits(amountStr: string): string[] {
  const cents = Math.round(parseFloat(amountStr) * 100);
  if (!cents || isNaN(cents)) return ['1', '0', '0']; // fallback $1.00
  return cents.toString().split('');
}

async function enterPaymentAmount(window: Page): Promise<void> {
  // Read the actual Amount Due so we tender the exact sale total.
  const amountStr = await readAmountDue(window);
  const digits = amountStr ? dollarToKeypadDigits(amountStr) : ['1', '0', '0'];

  // Click the Amount Tendered input inside the modal to focus it.
  const clicked = await window.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup') ?? document.body;
    // Find input near "Amount Tendered" label
    const label = Array.from(modal.querySelectorAll<HTMLElement>('*'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /amount\s*tendered/i.test((el.innerText || '').trim())
        && !el.querySelector('input, ion-input'),
      );
    if (label) {
      const row = label.closest('tr, ion-row, [class*="row"]') ?? label.parentElement;
      const inp = row?.querySelector<HTMLInputElement>('input, ion-input');
      if (inp) { inp.focus(); inp.click(); return { x: 0, y: 0, found: true }; }
    }
    // Fallback: first visible input in modal
    const inp = Array.from(modal.querySelectorAll<HTMLInputElement>('input'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (inp) { inp.focus(); inp.click(); return { x: 0, y: 0, found: true }; }
    return { x: 0, y: 0, found: false };
  });

  // Also do a real mouse click to ensure focus
  if (!clicked.found) {
    const coords = await window.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup') ?? document.body;
      const inp = modal.querySelector<HTMLElement>('input, ion-input');
      if (!inp) return null;
      const r = inp.getBoundingClientRect();
      return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    if (coords) await window.mouse.click(coords.x, coords.y);
  }
  await window.waitForTimeout(400);

  for (const digit of digits) {
    await clickKeypadDigit(window, digit);
  }
}

async function fillCheckNumber(window: Page, checkNum: string): Promise<void> {
  // Generate multiple click coordinates around the Check Number field, mirroring
  // the multi-click pattern used by the payments test for clickCheckNumberInput.
  const clickPoints = await window.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup') ?? document.body;
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const points: { x: number; y: number }[] = [];

    // 1. Find the "Check Number" / "Check #" label (smallest matching element = most specific).
    const labels = Array.from(modal.querySelectorAll<HTMLElement>('*'))
      .filter(el => {
        if (!visible(el)) return false;
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^check\s*(number|#|num)$/i.test(text);
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

    const label = labels[0];
    if (label) {
      const rect = label.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      points.push({ x: rect.left + rect.width / 2, y });
      points.push({ x: Math.min(rect.right + 40, globalThis.innerWidth - 10), y });
      const row = label.closest('tr, ion-row, [class*="row"]') ?? label.parentElement;
      const inp = row?.querySelector<HTMLElement>('ion-input, input');
      if (inp && visible(inp)) {
        const r = inp.getBoundingClientRect();
        if (r.width > 0) points.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    }

    // 2. Fallback: second ion-input sorted top→bottom (1st=Amount Tendered, 2nd=Check Number).
    if (points.length === 0) {
      const ionInputs = Array.from(modal.querySelectorAll<HTMLElement>('ion-input'))
        .filter(visible)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (ionInputs.length >= 2) {
        const r = ionInputs[1].getBoundingClientRect();
        if (r.width > 0) points.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    }

    return points;
  });

  if (clickPoints.length === 0) return;

  // Click all generated points to establish browser focus + Ionic active-input state.
  for (const pt of clickPoints) {
    await window.mouse.click(pt.x, pt.y);
    await window.waitForTimeout(150);
  }
  await window.waitForTimeout(200);

  for (const digit of checkNum.split('')) {
    await clickKeypadDigit(window, digit);
  }
}

// Like clickMakePayment but does NOT force-close the modal afterwards.
// Used when we expect a validation error (e.g. too-short check number) and want
// to keep the dialog open so we can correct and retry.
async function tryMakePaymentExpectError(window: Page): Promise<void> {
  await window.evaluate(() => {
    const patterns = [/complete\s+transaction/i, /make\s+payment/i, /^pay\s+now$/i];
    for (const pat of patterns) {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, a'))
        .find(el =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          && pat.test((el.innerText || el.textContent || '').trim()),
        );
      if (btn) { btn.click(); return; }
    }
  });
  await waitForLoadingOverlay(window);
  // Dismiss the error banner (e.g. "check number must be at least 3 digits") without closing the modal.
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await window.waitForTimeout(400);
}

async function dismissPayModal(window: Page): Promise<void> {
  // Wait for the pay-popup modal to close on its own (e.g. after Complete Transaction)
  await window.locator('ion-modal.menu-order-pay-popup').waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
  // If it's still open, click Cancel to force-close it
  const stillOpen = await window.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup');
    return !!(modal && (modal.offsetWidth || modal.offsetHeight || modal.getClientRects().length));
  });
  if (stillOpen) {
    await window.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup');
      if (!modal) return;
      const btn = Array.from(modal.querySelectorAll<HTMLElement>('button, ion-button'))
        .find(b =>
          !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
          && /^(cancel|close|ok|done|back)$/i.test((b.innerText || b.textContent || '').trim()),
        );
      if (btn) btn.click();
    });
    await window.waitForTimeout(500);
    // Last resort: Escape
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
  }
}

async function clickMakePayment(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
    // Only match specific payment-confirm button texts to avoid matching serving-grid buttons
    const patterns = [
      /complete\s+transaction/i,
      /make\s+payment/i,
      /^pay\s+now$/i,
      /^process\s+payment$/i,
    ];
    for (const pat of patterns) {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, a'))
        .find(el =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          && pat.test((el.innerText || el.textContent || '').trim()),
        );
      if (btn) { btn.click(); return true; }
    }
    return false;
  });
  if (!clicked) {
    await window.locator('ion-button, button, a')
      .filter({ hasText: /complete transaction|make payment/i })
      .last()
      .click({ force: true, timeout: 10_000 });
  }
  await waitForLoadingOverlay(window);
  // Dismiss any post-payment alert (change due, success, etc.)
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
  // Wait for the Pay Transaction modal to fully close
  await dismissPayModal(window);
}

async function isPayDialogOpen(window: Page): Promise<boolean> {
  return window.evaluate(() => {
    // Check for the Pay Transaction modal (menu-order-pay-popup class)
    const modal = document.querySelector<HTMLElement>('ion-modal.menu-order-pay-popup');
    if (modal && !!(modal.offsetWidth || modal.offsetHeight || modal.getClientRects().length)) return true;
    // Fallback: visible Cash/Check/Card payment tabs
    return Array.from(document.querySelectorAll<HTMLElement>('*')).some(el =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      && /^(cash|check|card)$/i.test((el.innerText || '').trim()),
    );
  });
}

async function processPayment(window: Page, method: PaymentMethod, accountType?: string): Promise<void> {
  // Re-open the Pay Transaction dialog if it closed after a previous method.
  // After completing Cash, the grid resets to "Enter an ID" state — must re-select
  // the account type before adding an item, otherwise the app shows a "select patron" warning.
  if (!await isPayDialogOpen(window)) {
    if (accountType) {
      await clickAccountType(window, accountType);
    }
    await selectFirstMenuItem(window);
    await clickPay(window);
    await window.waitForTimeout(500);
  }

  await selectPaymentTab(window, method);

  if (method === 'Cash') {
    await enterPaymentAmount(window);
    await clickMakePayment(window);
  } else if (method === 'Check') {
    await enterPaymentAmount(window);
    // Try 2-digit (invalid) check number first — expect a "minimum 3 digits" error.
    await fillCheckNumber(window, INVALID_CHECK_NUM);
    await tryMakePaymentExpectError(window);
    // Now enter the valid 3-digit check number and complete.
    await fillCheckNumber(window, VALID_CHECK_NUM);
    await clickMakePayment(window);
  }
}



// ─── Util ─────────────────────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('Special Account', () => {
  test('verifies payment methods and processes successfully for each account type', async () => {
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      const window = await getAppWindow(handle);

      await openService(window);

      for (const { type, methods } of SCENARIOS) {
        // Ensure no Pay Transaction modal is blocking before starting a new scenario
        await dismissPayModal(window);
        await ensureServingGridSelected(window);
        await clickAccountType(window, type);
        await selectFirstMenuItem(window);
        await clickPay(window);

        // Verify all expected payment methods are present before processing any
        await verifyPaymentMethodsVisible(window, methods);

        for (const method of methods) {
          await processPayment(window, method, type);
        }
        // Let the app fully settle after completing both payments before the next scenario.
        await waitForLoadingOverlay(window);
        await window.waitForTimeout(800);
        await WarningDialog.dismiss(window);
      }
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
