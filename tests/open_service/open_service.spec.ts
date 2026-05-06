//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115132


import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { dismissAllYesConfirms } from '../../utils/service';
import { ensureMealTypeSelected } from '../../utils/serving';

test.describe.configure({ timeout: 240_000 });

// ---------------------------------------------------------------------------
// Core DOM helpers
// ---------------------------------------------------------------------------

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => { });
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
    const pages = context.pages().filter(page => !page.isClosed());
    for (const page of pages) {
      const isApp = await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false);
      if (isApp) return page;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Could not find the ExpressPoint app window.');
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
  const menuItem = window
    .locator('ion-item')
    .filter({ hasText: new RegExp(label, 'i') })
    .first();
  const alreadyVisible = await menuItem.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!alreadyVisible) {
    await clickMenuButton(window);
  }
  await expect(menuItem).toBeVisible({ timeout: 10_000 });
  await menuItem.click({ timeout: 15_000 });
}

async function clickDashboardItem(window: Page, label: string): Promise<void> {
  await waitForLoadingOverlay(window);
  const item = window
    .locator('ion-router-outlet .ion-page:not(.ion-page-hidden) ion-item[detail]')
    .filter({ hasText: new RegExp(label, 'i') })
    .first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click({ timeout: 15_000 });
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
  await WarningDialog.dismiss(window);
}

async function enterServiceOrOpenFresh(window: Page, handle: ExpressPointHandle): Promise<{ window: Page; openedFresh: boolean }> {
  await WarningDialog.dismiss(window, 2_000);

  const continueService = window
    .locator('ion-item[detail]')
    .filter({ hasText: /Continue Service/i })
    .first();

  if (await continueService.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // A session is already open (e.g. leftover from bulk_sales test) — close it
    // first so this test always works against a clean, freshly opened service.
    await closeOpenService(window);
    await waitForLoadingOverlay(window);
    await WarningDialog.dismiss(window, 2_000);
  }

  // Wait for the Open Service item to appear before clicking it.
  const openItem = window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first();
  if (!await openItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await window.screenshot({ path: 'debug-dashboard.png', fullPage: true });
    const dump = await window.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 1000),
      visibleAlerts: Array.from(document.querySelectorAll<HTMLElement>('ion-alert'))
        .filter(el => !!(el.offsetWidth || el.offsetHeight)).length,
      ionItems: Array.from(document.querySelectorAll<HTMLElement>('ion-item[detail]'))
        .filter(el => !!(el.offsetWidth || el.offsetHeight))
        .map(el => el.innerText?.trim().substring(0, 50)),
    }));
    console.log('DASHBOARD DEBUG:', JSON.stringify(dump));
  }
  await expect(openItem).toBeVisible({ timeout: 20_000 });

  await openOpeningBalance(window);
  await waitForText(window, /Opening Balance/i);
  await expect(window.getByRole('button', { name: /cancel/i }).last()).toBeVisible();
  await fillOpeningAccountBalance(window, '1');
  await cancelOpeningBalance(window);

  await openOpeningBalance(window);
  await fillOpeningAccountBalance(window, '1');
  await waitForText(window, /Bills/i);
  await waitForText(window, /Twos/i);
  await confirmOpenService(window);

  return { window: await getAppWindow(handle), openedFresh: true };
}

async function openOpeningBalance(window: Page): Promise<void> {
  await clickDashboardItem(window, 'Open Service');
  await waitForText(window, /Opening Balance/i);
  await WarningDialog.dismiss(window);
}

async function fillOpeningAccountBalance(window: Page, amount: string): Promise<void> {
  const input = window.locator('input.input-label-opencloseBalance').first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await window.keyboard.press('Control+A');
  await window.keyboard.press('Backspace');
  await window.keyboard.type(amount);

  const typedValue = await input.inputValue();
  if (typedValue !== amount) {
    await input.fill(amount);
  }

  await expect.poll(
    () => input.inputValue(),
    { timeout: 5_000 },
  ).toBe(amount);
}

async function cancelOpeningBalance(window: Page): Promise<void> {
  const cancelButton = window.getByRole('button', { name: /cancel/i }).last();
  await expect(cancelButton).toBeVisible({ timeout: 10_000 });
  await cancelButton.click();
  await waitForText(window, /Serving Options for/i);
}

async function confirmOpenService(window: Page): Promise<void> {
  const openButton = window.locator('ion-button').filter({ hasText: /Open Service/i }).last();
  await expect(openButton).toBeVisible({ timeout: 10_000 });
  await openButton.evaluate((el: HTMLElement) => el.click());
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 30_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window);
}

async function completeLunchTransaction(window: Page): Promise<void> {
  await ensureMealTypeSelected(window);

  const idInput = window.locator('#pinInput input, input[placeholder="Enter an ID"]').first();
  await expect(idInput).toBeVisible({ timeout: 20_000 });
  await idInput.fill('1337');

  await clickVisibleIconButton(window, 'caret-forward-circle');

  await waitForText(window, /ID:\s*1337|Add Funds|Item Count/i);

  // Use Playwright's click (generates real pointer events) — evaluate-based
  // el.click() only fires a DOM click and Ionic may not register it.
  const mealButton = window.locator('ion-button')
    .filter({ hasText: /^Lunch Meal$/i })
    .first();
  const anyMeal = window.locator('ion-button').filter({ hasText: /Meal/i }).first();
  const haslunchMeal = await mealButton.isVisible({ timeout: 3_000 }).catch(() => false);
  const target = haslunchMeal ? mealButton : anyMeal;
  await expect(target).toBeVisible({ timeout: 10_000 });
  await target.click();
  // Dismiss "SECOND MEAL" confirmation if it appears
  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i })
    .first()
    .click({ timeout: 3_000 })
    .catch(() => {});
  await waitForText(window, /Total Amount Due/i);

  const chargeButton = window.locator('ion-button').filter({ hasText: /Charge/i }).last();
  await expect(chargeButton).toBeVisible({ timeout: 10_000 });
  await chargeButton.evaluate((el: HTMLElement) => el.click());

  await waitForLoadingOverlay(window);

  // After charging, the app may briefly show a success/confirmation dialog.
  // Dismiss it if present before waiting for the patron-lookup screen.
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => {});

  await waitForLoadingOverlay(window);
  await expect(idInput).toBeVisible({ timeout: 30_000 });
}

async function closeOpenService(window: Page): Promise<void> {
  await clickMenuItem(window, 'Close Service');
  await WarningDialog.dismiss(window, 5_000);
  await waitForText(window, /Close Service/i);
  await WarningDialog.dismiss(window, 2_000);
  const closeButton = window.locator('ion-button').filter({ hasText: /Close Service/i }).last();
  await expect(closeButton).toBeVisible({ timeout: 10_000 });
  await closeButton.evaluate((el: HTMLElement) => el.click());

  await dismissAllYesConfirms(window);

  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);
}

async function logoutWithOpenServiceWarning(window: Page, handle: ExpressPointHandle): Promise<Page> {
  await waitForLoadingOverlay(window);
  await clickMenuButton(window);
  // Menu item is "Sign out" (not "Logout") when service is open
  const logoutEl = window.getByText(/^(logout|sign\s*out)$/i).first();
  await expect(logoutEl).toBeVisible({ timeout: 10_000 });
  await logoutEl.click();
  await waitForText(window, /You have a session open/i);
  await waitForText(window, /please close it before exiting/i);

  const continueButton = window.getByRole('button', { name: /continue/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();
  // Logout navigates to the login landing page — re-attach and verify the
  // "Use PrimeroEdge Login" button is visible (username input appears later).
  const loginWindow = await getAppWindow(handle);
  await expect(loginWindow.locator('ion-button', { hasText: 'Use PrimeroEdge Login' })).toBeVisible({ timeout: 20_000 });
  return loginWindow;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Open Service', () => {
  test('opens service, validates opening balance, and preserves open session on logout', async () => {
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      let { window } = await enterServiceOrOpenFresh(handle.window, handle);

      await completeLunchTransaction(window);
      window = await logoutWithOpenServiceWarning(window, handle);

      await login(window);
      await waitForText(window, /Continue Service/i);
      await waitForText(window, /Close Service/i);
      await closeOpenService(window);
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
