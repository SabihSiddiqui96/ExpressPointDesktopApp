import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';

test.describe.configure({ timeout: 300_000 });

// ---------------------------------------------------------------------------
// Core DOM helpers
// ---------------------------------------------------------------------------

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
        ? (value: string) => new RegExp(source, flags).test(value)
        : (value: string) => value.includes(source);
      return Array.from(document.querySelectorAll<HTMLElement>('body *')).some(el => {
        const value = el.innerText?.trim() ?? '';
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && matches(value);
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
  throw new Error('getAppWindow: ion-app not found after 15 s');
}

async function clickMenuButton(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const menuButton = window
    .locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(menuButton).toBeVisible({ timeout: 10_000 });
  await menuButton.click({ timeout: 15_000 });
}

async function clickMenuItem(window: Page, label: string): Promise<void> {
  await waitForLoadingOverlay(window);
  const menuItem = window.locator('ion-item').filter({ hasText: new RegExp(label, 'i') }).first();
  const alreadyVisible = await menuItem.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!alreadyVisible) await clickMenuButton(window);
  await expect(menuItem).toBeVisible({ timeout: 10_000 });
  await menuItem.click({ timeout: 15_000 });
}

async function clickVisibleIconButton(window: Page, iconName: string): Promise<void> {
  const clicked = await window.evaluate((name: string) => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const button = buttons.find(el =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      && !!el.querySelector(`ion-icon[name="${name}"]`),
    );
    button?.click();
    return !!button;
  }, iconName);
  expect(clicked).toBe(true);
}

// ---------------------------------------------------------------------------
// Login and service helpers
// ---------------------------------------------------------------------------

async function login(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
}

async function openService(window: Page, handle: ExpressPointHandle): Promise<Page> {
  await waitForLoadingOverlay(window);
  const continueService = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueService.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await continueService.click();
    // Dismiss any confirmation dialog that may appear
    await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^yes$/i })
      .first()
      .click({ timeout: 4_000 })
      .catch(() => {});
    await waitForLoadingOverlay(window);
  } else {
    // Fresh open — click "Open Service" from the dashboard
    await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first()
      .click({ timeout: 15_000 });
    await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
    await window.getByRole('button', { name: /open service/i }).last().click();
    await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 20_000 });
    await waitForLoadingOverlay(window);
  }
  return getAppWindow(handle);
}

async function closeService(window: Page): Promise<void> {
  await clickMenuItem(window, 'Close Service');
  await waitForText(window, /Close Service/i);
  const closeBtn = window.locator('ion-button').filter({ hasText: /Close Service/i }).last();
  await expect(closeBtn).toBeVisible({ timeout: 10_000 });
  await closeBtn.evaluate((el: HTMLElement) => el.click());
  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }
}

// ---------------------------------------------------------------------------
// Patron lookup helpers
// ---------------------------------------------------------------------------

async function lookupPatron(window: Page, id: string): Promise<void> {
  const idInput = window.locator('input[placeholder="Enter an ID"], #pinInput input').first();
  await expect(idInput).toBeVisible({ timeout: 20_000 });
  await idInput.fill(id);
  await clickVisibleIconButton(window, 'caret-forward-circle');
}

async function selectMealItem(window: Page): Promise<void> {
  // Wait for patron info screen
  await waitForText(window, /ID:\s*1337|Add Funds|Item Count/i);

  const mealName = await window.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .filter(btn => !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length));
    const meal = buttons.find(btn => /^Lunch Meal/i.test((btn.innerText || '').trim()))
      ?? buttons.find(btn => /Meal/i.test((btn.innerText || '').trim()));
    meal?.click();
    return meal ? (meal.innerText || '').trim() : '';
  });
  expect(mealName).toMatch(/Meal/i);
}

async function verifyItemCountUpdated(window: Page): Promise<void> {
  // After selecting a meal, "Item Count" value should be at least 1
  await expect.poll(
    async () => window.evaluate(() => {
      const text = document.body.innerText;
      // Look for "Item Count" followed by a positive number
      const match = text.match(/Item\s*Count\D*(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    }),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
}

async function clickVoidButton(window: Page): Promise<void> {
  // Void appears as a non-ion-button element in the action bar.
  // Use evaluate to find any visible clickable element with "Void" text.
  await expect.poll(
    () => window.evaluate(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .find(e =>
          !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
          && /^void$/i.test((e.innerText || '').trim())
          && ['BUTTON', 'ION-BUTTON', 'A'].includes(e.tagName)
            || (e.getAttribute('role') === 'button' && /^void$/i.test((e.innerText || '').trim())),
        );
      if (el) { el.click(); return true; }
      return false;
    }),
    { timeout: 10_000 },
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Void Transactions', () => {
  test('void transaction: No cancels void, Yes completes void and returns to ID screen', async () => {
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      let window = await openService(handle.window, handle);

      // Step 1 — look up student 1337
      await lookupPatron(window, '1337');

      // Step 2 — verify student info appears
      await waitForText(window, /ID:\s*1337|Add Funds|Item Count/i);

      // Step 3 — select a meal item and verify Item Count updates
      await selectMealItem(window);
      await verifyItemCountUpdated(window);

      // Step 4 — click Void → click No → verify still on checkout screen
      await clickVoidButton(window);
      await waitForText(window, /void/i); // confirmation dialog appears
      // Click No in the confirmation dialog
      const noBtn = window.getByRole('button', { name: /^no$/i }).last();
      await expect(noBtn).toBeVisible({ timeout: 10_000 });
      await noBtn.click();
      // Verify still showing patron/cart (Item Count still present)
      await verifyItemCountUpdated(window);

      // Step 5 — click Void again → click Yes → verify back on ID entry screen
      await clickVoidButton(window);
      await waitForText(window, /void/i); // confirmation dialog appears again
      const yesBtn = window.getByRole('button', { name: /^yes$/i }).last();
      await expect(yesBtn).toBeVisible({ timeout: 10_000 });
      await yesBtn.click();
      // Verify returned to patron ID entry screen
      await expect(
        window.locator('input[placeholder="Enter an ID"], #pinInput input').first()
      ).toBeVisible({ timeout: 20_000 });

      // Clean up — close service
      await closeService(window);
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
