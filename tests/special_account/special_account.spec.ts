//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115138


import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';

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
  { type: 'Staff',         methods: ['Cash', 'Check'] },
  { type: 'Visitor',       methods: ['Cash', 'Check'] },
];

const AMOUNT_DIGITS   = ['1', '0', '0']; // $1.00
const VALID_CHECK_NUM = '123';

// ─── Core DOM helpers ─────────────────────────────────────────────────────────

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

async function waitForText(window: Page, text: string | RegExp, timeout = 20_000): Promise<void> {
  const matcher = typeof text === 'string'
    ? { source: text, flags: '', isRegex: false }
    : { source: text.source, flags: text.flags, isRegex: true };

  await expect.poll(
    async () => window.evaluate(({ source, flags, isRegex }) => {
      const matches = isRegex
        ? (v: string) => new RegExp(source, flags).test(v)
        : (v: string) => v.includes(source);
      return Array.from(document.querySelectorAll<HTMLElement>('body *')).some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && matches(el.innerText?.trim() ?? '');
      });
    }, matcher),
    { timeout },
  ).toBe(true);
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

// ─── Warning popup ────────────────────────────────────────────────────────────

async function dismissWarningIfVisible(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
    // First try via ion-alert (piercing shadow DOM)
    const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
    for (const alert of alerts) {
      const visible = !!(alert.offsetWidth || alert.offsetHeight || alert.getClientRects().length);
      if (!visible) continue;
      const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
      const buttons = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'));
      const okBtn = buttons.find(b => /ok/i.test((b.innerText || b.textContent || '').trim()));
      if (okBtn) { okBtn.click(); return true; }
    }
    // Fallback: any visible button whose full text is exactly "OK"
    const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, ion-button'));
    const okBtn = allBtns.find(b => {
      const visible = !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
      return visible && /^ok$/i.test((b.innerText || b.textContent || '').trim());
    });
    if (okBtn) { okBtn.click(); return true; }
    return false;
  }).catch(() => false);
  if (clicked) {
    await window.locator('ion-alert').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

// ─── Login & navigation ───────────────────────────────────────────────────────

async function login(window: Page): Promise<void> {
const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await dismissWarningIfVisible(window);
}

// ─── Service helpers ──────────────────────────────────────────────────────────

async function openService(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);

  // If a service is already open, continue into it — no need to close and reopen
  const continueItem = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await continueItem.click({ timeout: 10_000 });
    await waitForLoadingOverlay(window);
    await dismissWarningIfVisible(window);
    return;
  }

  await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first()
    .click({ timeout: 15_000 });
  await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
  await dismissWarningIfVisible(window);
  await window.getByRole('button', { name: /open service/i }).last().click();
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
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
  // Wait for left-panel food items to appear
  await expect.poll(async () =>
    window.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
        .some(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const rect = el.getBoundingClientRect();
          return visible && rect.left < 1500 && rect.top > 50 && rect.width > 100;
        })
    ),
    { timeout: 20_000 }
  ).toBe(true);

  // The entree item is in the BOTTOM row (highest top value) — click it via real mouse event
  const coords = await window.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .filter(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const rect = el.getBoundingClientRect();
        return visible && rect.left < 1500 && rect.top > 50 && rect.width > 100;
      });
    if (items.length === 0) return null;
    // Bottom row = highest top value = main entree
    let chosen = items[0];
    for (const el of items) {
      if (el.getBoundingClientRect().top > chosen.getBoundingClientRect().top) chosen = el;
    }
    const r = chosen.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (coords) {
    await window.mouse.click(coords.x, coords.y);
  }

  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i }).first()
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

async function clickKeypadDigit(window: Page, digit: string): Promise<void> {
  await window.locator('ion-button')
    .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
    .first()
    .click({ force: true, timeout: 5_000 });
  await window.waitForTimeout(150);
}

async function enterPaymentAmount(window: Page): Promise<void> {
  // Traverse shadow DOM to find the first visible ion-input and click it,
  // ensuring focus lands on the Payment field (not the auto-focused Check # field).
  const coords = await window.evaluate(() => {
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
        if ((el as any).shadowRoot) search((el as any).shadowRoot);
      }
    }
    search(document);
    return results;
  });

  if (coords.length > 0) {
    await window.mouse.click(coords[0].x, coords[0].y);
  }
  await window.waitForTimeout(400);

  for (const digit of AMOUNT_DIGITS) {
    await clickKeypadDigit(window, digit);
  }
}

async function fillCheckNumber(window: Page): Promise<void> {
  const points = await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const directText = (el: Element) => Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent ?? '')
      .join(' ').replace(/\s+/g, ' ').trim();

    const labels = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter(el => visible(el) && /^Check\s*#$/i.test(directText(el)))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

    const label = labels[0];
    if (!label) return [];
    const rect = label.getBoundingClientRect();
    return [{ x: Math.min(rect.right + 40, globalThis.innerWidth - 10), y: rect.top + rect.height / 2 }];
  });

  if (points.length > 0) {
    await window.mouse.click(points[0].x, points[0].y);
    await window.waitForTimeout(200);
    for (const digit of VALID_CHECK_NUM.split('')) {
      await clickKeypadDigit(window, digit);
    }
  }
}

async function clickMakePayment(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /make payment/i.test((el.innerText || '').trim()),
      );
    btn?.click();
    return !!btn;
  });
  if (!clicked) {
    await window.locator('ion-button').filter({ hasText: /make payment/i }).last()
      .click({ force: true, timeout: 10_000 });
  }
  await waitForLoadingOverlay(window);
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 3_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
}

async function processPayment(window: Page, method: PaymentMethod): Promise<void> {
  await selectPaymentTab(window, method);

  if (method === 'Cash') {
    await enterPaymentAmount(window);
    await clickMakePayment(window);
  } else if (method === 'Check') {
    await enterPaymentAmount(window);
    await fillCheckNumber(window);
    await clickMakePayment(window);
  }
}

// ─── Void helpers ─────────────────────────────────────────────────────────────

async function voidCurrentTransaction(window: Page): Promise<void> {
  await expect.poll(
    () => window.evaluate(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .find(e =>
          !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
          && /^void$/i.test((e.innerText || '').trim())
          && (
            ['BUTTON', 'ION-BUTTON', 'A'].includes(e.tagName)
            || e.getAttribute('role') === 'button'
          ),
        );
      if (el) { el.click(); return true; }
      return false;
    }),
    { timeout: 10_000 },
  ).toBe(true);

  await waitForText(window, /void/i);
  const yesBtn = window.getByRole('button', { name: /^yes$/i }).last();
  await expect(yesBtn).toBeVisible({ timeout: 10_000 });
  await yesBtn.click();
  await waitForLoadingOverlay(window);
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
        await ensureServingGridSelected(window);
        await clickAccountType(window, type);
        await selectFirstMenuItem(window);
        await clickPay(window);

        // Verify all expected payment methods are present before processing any
        await verifyPaymentMethodsVisible(window, methods);

        for (const method of methods) {
          await processPayment(window, method);
        }

        await voidCurrentTransaction(window);
      }
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
