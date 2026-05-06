//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115140

import { test, expect, Page, chromium } from '@playwright/test';
import { loginToExpressPoint, closeExpressPoint } from '../../utils/helpers';
import { launchExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { ensureMealTypeSelected } from '../../utils/serving';
import {
  filterReconciliationForToday,
  loginToPrimeroEdgeQa,
  openMatchingReconciliationSession,
  openPointOfServiceReconciliation,
  ReconciliationSessionValues,
  verifyReconciledTransactionDetails,
} from '../../utils/primeroedge-web';

const SUMMARY_SALE_PARAMS = {
  mealType: 'Breakfast',
  menuItem: 'Breakfast Meal',
} as const;

const PATRON_ID = '1337';

test.describe.configure({ timeout: 360_000 });

// ---------------------------------------------------------------------------
// Core DOM helpers
// ---------------------------------------------------------------------------

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await expect.poll(
    () => window.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('ion-loading'))
        .every(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const style = getComputedStyle(el);
          const hidden = el.getAttribute('aria-hidden') === 'true'
            || el.classList.contains('overlay-hidden')
            || style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0';
          return !visible || hidden;
        });
    }),
    { timeout: 30_000 },
  ).toBe(true);
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
  const menuItemIsVisible = async () => window.evaluate((pattern: string) => {
    const regex = new RegExp(pattern, 'i');
    return Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText);
      });
  }, label);

  if (!await menuItemIsVisible()) {
    await clickMenuButton(window);
  }

  await expect.poll(
    menuItemIsVisible,
    { timeout: 10_000 },
  ).toBe(true);

  const clicked = await window.evaluate((pattern: string) => {
    const regex = new RegExp(pattern, 'i');
    const item = Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText);
      });
    item?.click();
    return !!item;
  }, label);
  expect(clicked).toBe(true);
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (!menu?.close) return;
    await Promise.race([
      menu.close(),
      new Promise(resolve => setTimeout(resolve, 1_000)),
    ]);
  }).catch(() => { });
  await window.keyboard.press('Escape').catch(() => { });
  await window.mouse.click(500, 500).catch(() => { });
  await waitForLoadingOverlay(window);
}

async function closeSideMenuIfOpen(window: Page): Promise<void> {
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (!menu?.close) return;
    await Promise.race([
      menu.close(),
      new Promise(resolve => setTimeout(resolve, 1_000)),
    ]);
  }).catch(() => { });
  await window.keyboard.press('Escape').catch(() => { });
}

async function clickIonButton(window: Page, label: string | RegExp): Promise<void> {
  const clicked = await tryClickIonButton(window, label, 10_000);
  expect(clicked).toBe(true);
}

async function tryClickIonButton(window: Page, label: string | RegExp, timeout: number): Promise<boolean> {
  const matcher = typeof label === 'string'
    ? { source: label, flags: 'i' }
    : { source: label.source, flags: label.flags || 'i' };

  const visible = await expect.poll(
    () => window.evaluate(({ source, flags }) => {
      const regex = new RegExp(source, flags);
      return Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
        .some(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          return visible && regex.test(el.innerText);
        });
    }, matcher),
    { timeout },
  ).toBe(true).then(() => true).catch(() => false);

  if (!visible) return false;

  const clicked = await window.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    const button = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText);
      });
    button?.click();
    return !!button;
  }, matcher);
  return clicked;
}

async function clickKeypadButton(window: Page, digit: string): Promise<void> {
  // Use real mouse click so Angular/Ionic receives trusted pointer events
  const coords = await window.evaluate((value: string) => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, td, [role="button"]'));
    const btn = candidates.find(el => {
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return visible && el.innerText.trim() === value;
    });
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, digit);
  if (coords) {
    await window.mouse.click(coords.x, coords.y);
  }
}

async function clickIconKeypadButton(window: Page, iconName: string): Promise<void> {
  const clicked = await window.evaluate((name: string) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && !!el.querySelector(`ion-icon[name="${name}"]`);
      });
    button?.click();
    return !!button;
  }, iconName);
  expect(clicked).toBe(true);
}

async function visibleIonItemExists(window: Page, label: RegExp): Promise<boolean> {
  return await window.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    return Array.from(document.querySelectorAll<HTMLElement>('ion-router-outlet ion-item, ion-content ion-item'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText);
      });
  }, { source: label.source, flags: label.flags });
}

async function clickVisibleIonItem(window: Page, label: RegExp): Promise<void> {
  await expect.poll(
    () => visibleIonItemExists(window, label),
    { timeout: 20_000 },
  ).toBe(true);

  const clicked = await window.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    const item = Array.from(document.querySelectorAll<HTMLElement>('ion-router-outlet ion-item, ion-content ion-item'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText);
      });
    item?.click();
    return !!item;
  }, { source: label.source, flags: label.flags });
  expect(clicked).toBe(true);
}

// ---------------------------------------------------------------------------
// Summary Sale helpers
// ---------------------------------------------------------------------------

async function navigateToSummarySale(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const dashboardItem = window
    .locator('ion-router-outlet .ion-page:not(.ion-page-hidden) ion-item[detail]')
    .filter({ hasText: /Summary Sale/i })
    .first();
  const onDashboard = await dashboardItem.isVisible({ timeout: 2_000 }).catch(() => false);

  if (onDashboard) {
    await dashboardItem.click({ timeout: 10_000 });
  } else {
    await clickMenuItem(window, 'Summary Sale');
  }

  await waitForText(window, /Summary Sales?|Go to Summary Sale|Select a Meal Type/i);
}

async function expectDashboard(window: Page): Promise<void> {
  await expect(window.getByText('Serving Options for', { exact: false }).first())
    .toBeVisible({ timeout: 20_000 });
}

async function verifyOpeningBalanceKeypad(window: Page): Promise<void> {
  await waitForText(window, /Summary Sales/i);
  await waitForText(window, /Opening Balance/i);
  await WarningDialog.dismiss(window, 5_000);

  const openingBalance = window.locator('#openingBalance');
  await expect(openingBalance).toBeVisible({ timeout: 10_000 });
  await expect(openingBalance).toHaveValue('$0.00');

  await WarningDialog.dismiss(window, 2_000);
  await window.locator('input.input-label-opencloseBalance').first().click({ timeout: 10_000 });
  await clickKeypadButton(window, '2');
  await expect.poll(() => openingBalance.inputValue(), { timeout: 5_000 }).toBe('$0.02');

  await clickIconKeypadButton(window, 'backspace');
  await expect.poll(() => openingBalance.inputValue(), { timeout: 5_000 }).toBe('$0.00');
}

async function cancelOpeningBalance(window: Page): Promise<void> {
  await clickIonButton(window, /Cancel/i);
  await expectDashboard(window);
}

async function openSummarySaleSession(window: Page): Promise<void> {
  await navigateToSummarySale(window);
  const openingBalance = window.locator('#openingBalance');
  if (await openingBalance.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await clickIonButton(window, /Go to Summary Sale/i);
  }

  await waitForText(window, /Select a Meal Type|Summary Sale/i);
}

async function openServiceFromMenuIfAvailable(window: Page): Promise<void> {
  await clickMenuItem(window, 'Open Service|Continue Service');
  await WarningDialog.dismiss(window);

  const openingBalance = window.locator('#openingBalance');
  if (await openingBalance.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await WarningDialog.dismiss(window);
    await clickIonButton(window, /Open Service|Continue Service|Go to Summary Sale/i);
  }

  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window);
}

async function chooseFromPopover(window: Page, triggerText: string | RegExp, optionText: string): Promise<void> {
  await window.getByText(triggerText, { exact: false }).first().click({ timeout: 10_000 });
  const popover = window.locator('ion-popover');
  await expect(popover).toBeVisible({ timeout: 10_000 });

  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await popover
    .locator('ion-item')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
    .first()
    .click({ timeout: 10_000 });

  await popover.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
}

async function selectBreakfastMeal(window: Page): Promise<void> {
  await chooseFromPopover(window, /Select a Meal Type|Breakfast/i, SUMMARY_SALE_PARAMS.mealType);
  await expect(window.getByText(/You are serving at Breakfast/i).first()).toBeVisible({ timeout: 10_000 });

  await chooseFromPopover(window, /Select a Menu Item|Breakfast Meal/i, SUMMARY_SALE_PARAMS.menuItem);
  await expect(window.getByText(/Breakfast Meal/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/Student/i).first()).toBeVisible({ timeout: 10_000 });
}

function studentMealCountInput(window: Page) {
  return window.locator('input[id="0"]').first();
}

async function activeMealCountValue(window: Page): Promise<string> {
  return await window.evaluate(() => {
    const activeInput = document.querySelector<HTMLInputElement>('input.active-input-label');
    const firstInput = document.querySelector<HTMLInputElement>('app-summary-sale input[id="0"], app-summary-sale input.inactive-input-label');
    return (activeInput ?? firstInput)?.value ?? '';
  });
}

async function activateStudentMealCount(window: Page): Promise<void> {
  const input = studentMealCountInput(window);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.evaluate((el: HTMLInputElement) => el.focus());
  await expect.poll(
    () => input.evaluate(el => el.className),
    { timeout: 5_000 },
  ).toContain('active-input-label');
}

async function verifyMealCountInput(window: Page, options: { verifyKeyboard: boolean }): Promise<void> {
  await activateStudentMealCount(window);

  if (options.verifyKeyboard) {
    await window.keyboard.press('Digit2');
    const digitWorked = await activeMealCountValue(window).then(value => value === '2').catch(() => false);
    if (!digitWorked) {
      await window.keyboard.press('Numpad2');
    }
    await expect.poll(() => activeMealCountValue(window), { timeout: 5_000 }).toBe('2');

    await clickIconKeypadButton(window, 'backspace');
    await expect.poll(() => activeMealCountValue(window), { timeout: 5_000 }).toBe('0');
  }

  await clickKeypadButton(window, '3');
  await expect.poll(() => activeMealCountValue(window), { timeout: 5_000 }).toBe('3');
}

async function clearSelection(window: Page): Promise<void> {
  await clickIonButton(window, /Clear Selection/i);
  await expect(window.getByText(/Select a Meal Type/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/Select a Menu Item/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/No Person Types/i).first()).toBeVisible({ timeout: 10_000 });
}

async function recordSummarySale(window: Page): Promise<void> {
  const recordButton = window.locator('ion-button').filter({ hasText: /Record Sales/i }).first();
  await expect(recordButton).toBeEnabled({ timeout: 10_000 });
  await recordButton.evaluate((el: HTMLElement) => el.click());
  await waitForText(window, /Close Service|Closing Balance/i, 30_000);
}

async function closeService(window: Page): Promise<void> {
  const clickedCloseService = await tryClickIonButton(window, /Close Service/i, 10_000);
  if (!clickedCloseService) {
    const alreadyClosed = await isServiceClosed(window);
    if (alreadyClosed) return;

    const bodyText = await window.locator('body').innerText().catch(() => '');
    if (/closing pos terminal|closing service|please wait/i.test(bodyText)) {
      await expect(window.getByText(/closing pos terminal|closing service|please wait/i).first())
        .toBeHidden({ timeout: 60_000 })
        .catch(() => { });
    await waitForLoadingOverlay(window);
      await expectServiceClosed(window);
      return;
    }

    throw new Error('Close Service button was not visible.');
  }

  for (let i = 0; i < 4; i++) {
    if (window.isClosed()) return;

    const alert = window.locator('ion-alert');
    const appeared = await alert.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!appeared) break;

    await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^(yes|ok|continue|close)$/i })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => { });
    await alert.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
  }

  if (window.isClosed()) return;

  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }

  await waitForLoadingOverlay(window);
  await expectServiceClosed(window);
}

async function expectServiceClosed(window: Page): Promise<void> {
  await expect.poll(
    () => isServiceClosed(window),
    { timeout: 90_000 },
  ).toBe(true);
}

async function isServiceClosed(window: Page): Promise<boolean> {
  return await window.evaluate(() => {
    const visibleText = Array.from(document.querySelectorAll<HTMLElement>('ion-router-outlet .ion-page:not(.ion-page-hidden) *'))
      .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map(el => el.innerText ?? '')
      .join('\n');

    return /Serving Options for/i.test(visibleText);
  }).catch(() => false);
}

// ---------------------------------------------------------------------------
// Patron sale reconciliation helpers
// ---------------------------------------------------------------------------

async function closeLocalOpenSessionsForSetup(window: Page): Promise<void> {
  await window.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('_pouch_EXP_TRANSACTIONS');
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('by-sequence', 'readwrite');
        const store = tx.objectStore('by-sequence');
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const doc = cursor.value;
          if (/^OpenSession--/.test(doc._doc_id_rev ?? '') && doc.isStillOpen === true) {
            doc.isStillOpen = false;
            cursor.update(doc);
          }

          cursor.continue();
        };

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
    });
  }).catch(() => { });
}

async function loginToExpressPointWithoutSeededSession(): Promise<ExpressPointHandle> {
  const handle = await launchExpressPoint();
  await closeLocalOpenSessionsForSetup(handle.window);

  const loginPage = new LoginPage(handle.window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expectDashboard(handle.window);

  return handle;
}

async function openFreshServiceForPatronSale(window: Page): Promise<string> {
  if (await visibleIonItemExists(window, /Continue Service/i)) {
    await clickVisibleIonItem(window, /Close Service/i);
    await waitForText(window, /Close Service/i);
    await closeService(window);
    await expectDashboard(window);
  }

  await waitForLoadingOverlay(window);
  await clickVisibleIonItem(window, /Open Service/i);
  await WarningDialog.dismiss(window);

  await waitForText(window, /Opening Balance/i);
  await waitForText(window, /Coins|Bills/i);

  const openingBalance = await selectRandomBalanceFromCoinsOrBills(window);

  await clickIonButton(window, /Open Service/i);
  await waitForLoadingOverlay(window);
  await expect(window.locator('#pinInput input, input[placeholder="Enter an ID"]').first())
    .toBeVisible({ timeout: 30_000 });

  return openingBalance;
}

async function completePatronMealSale(
  window: Page,
): Promise<Pick<ReconciliationSessionValues, 'mealItem' | 'mealItems' | 'saleAmount'>> {
  await ensureMealTypeSelected(window);
  const idInput = window.locator('#pinInput input, input[placeholder="Enter an ID"]').first();
  await expect(idInput).toBeVisible({ timeout: 20_000 });
  await idInput.click();
  for (const digit of PATRON_ID) {
    await clickKeypadButton(window, digit);
  }
  await clickIconKeypadButton(window, 'caret-forward-circle');

  await waitForText(window, /ID:\s*1337|Add Funds|Item Count/i, 30_000);

  const mealItems = await selectRandomPaidPatronItems(window);

  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i })
    .first()
    .click({ timeout: 3_000 })
    .catch(() => { });

  await waitForText(window, /Total Amount Due/i, 20_000);
  const saleAmount = await extractTotalAmountDue(window);
  expect(await orderHasSelectedPaidItem(window), 'patron sale should have a selected paid item before charging').toBe(true);
  expect(saleAmount, 'patron sale should not charge $0.00').not.toBe('$0.00');

  const chargeButton = window.locator('ion-button').filter({ hasText: /Charge/i }).last();
  await expect(chargeButton).toBeVisible({ timeout: 10_000 });
  await chargeButton.evaluate((el: HTMLElement) => el.click());

  await waitForLoadingOverlay(window);
  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => { });
  await waitForLoadingOverlay(window);

  return { mealItem: mealItems[0], mealItems, saleAmount };
}

async function selectRandomPaidPatronItems(window: Page): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const yemekItems = await selectRandomYemekItems(window);
    if (await orderHasSelectedPaidItem(window)) return yemekItems;

    await clearLingeringRestriction(window);

    const chickenItems = await selectRandomChickenBurgerItems(window);
    if (await orderHasSelectedPaidItem(window)) return chickenItems;

    await clearLingeringRestriction(window);
    const fallbackItems = await selectFallbackPaidItem(window);
    if (await orderHasSelectedPaidItem(window)) return fallbackItems;
  }

  throw new Error('No paid patron item stayed selected in the order panel.');
}

async function selectRandomYemekItems(window: Page): Promise<string[]> {
  await expect.poll(
    () => visibleSaleItemLabels(window, /^Yemek\b/i).then(items => items.length),
    { timeout: 20_000 },
  ).toBeGreaterThanOrEqual(1);

  const availableItems = await visibleSaleItemLabels(window, /^Yemek\b/i);
  const randomSeed = Date.now();
  const clickCount = 1 + (randomSeed % 5);
  const selectedItems: string[] = [];

  for (let i = 0; i < clickCount; i++) {
    const item = availableItems[(randomSeed + i) % availableItems.length];
    const accepted = await clickSaleItemAndCheckAccepted(window, item);
    if (!accepted) {
      break;
    }

    selectedItems.push(item);
  }

  return selectedItems.filter((item, index, all) => all.indexOf(item) === index);
}

async function selectRandomChickenBurgerItems(window: Page, preferredClickCount?: number): Promise<string[]> {
  await expect.poll(
    () => visibleSaleItemLabels(window, /^Chicken Burger$/i).then(items => items.length),
    { timeout: 20_000 },
  ).toBeGreaterThanOrEqual(1);

  const [chickenBurger] = await visibleSaleItemLabels(window, /^Chicken Burger$/i);
  const clickCount = preferredClickCount ?? (1 + (Date.now() % 5));
  let acceptedCount = 0;

  for (let i = 0; i < clickCount; i++) {
    const accepted = await clickSaleItemAndCheckAccepted(window, chickenBurger);
    if (!accepted) break;
    acceptedCount++;
  }

  return acceptedCount > 0 ? [chickenBurger] : [];
}

async function selectFallbackPaidItem(window: Page): Promise<string[]> {
  const fallbackPatterns = [/^Chicken Burger$/i, /^Yemek - \$5$/i, /^Yemek - \$1$/i, /^Yemek - \.02c$/i, /^Yogurt Milk$/i, /^Ext\. Milk$/i, /^Bread/i, /^Adult Lunch/i, /^Lunch Meal/i];

  for (const pattern of fallbackPatterns) {
    const items = await visibleSaleItemLabels(window, pattern);
    if (items.length === 0) continue;

    const accepted = await clickSaleItemAndCheckAccepted(window, items[0]);
    if (accepted) return [items[0]];
  }

  throw new Error('No paid patron item could be selected. Every paid fallback was either restricted or did not add to the transaction.');
}

async function clickSaleItemAndCheckAccepted(window: Page, item: string): Promise<boolean> {
  await clearLingeringRestriction(window);

  const beforeAmount = await extractTotalAmountDue(window).catch(() => '$0.00');
  const beforeItemCount = await extractItemCount(window);
  await clickSaleItem(window, item);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await acknowledgeSiteRestrictionIfVisible(window)) return false;
    await confirmSaleAlertIfVisible(window);

    const currentAmount = await extractTotalAmountDue(window).catch(() => '$0.00');
    const currentItemCount = await extractItemCount(window);
    if ((currentItemCount > beforeItemCount || (currentAmount !== beforeAmount && currentAmount !== '$0.00'))
      && await orderHasSelectedPaidItem(window)) {
      await waitForLoadingOverlay(window);
      return true;
    }

    await window.waitForTimeout(250);
  }

  await acknowledgeSiteRestrictionIfVisible(window);
  await waitForLoadingOverlay(window);
  return false;
}

async function orderHasSelectedPaidItem(window: Page): Promise<boolean> {
  await waitForLoadingOverlay(window);
  return await window.evaluate(() => {
    const bodyText = document.body.innerText;
    const totalMatch = bodyText.match(/Total Amount Due\s*:?\s*\$?\s*(\d+(?:\.\d{2})?)/i);
    const total = Number(totalMatch?.[1] ?? 0);
    if (total <= 0) return false;

    return !/No items selected/i.test(bodyText);
  }).catch(() => false);
}

async function clickSaleItem(window: Page, item: string): Promise<void> {
  const button = window.locator('ion-button')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(item)}\\s*$`, 'i') })
    .first();

  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();

  if (box) {
    await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return;
  }

  await button.click({ force: true });
}

async function clearLingeringRestriction(window: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!await acknowledgeSiteRestrictionIfVisible(window)) return;
    await window.waitForTimeout(250);
  }
}

async function confirmSaleAlertIfVisible(window: Page): Promise<void> {
  const alert = window.locator('ion-alert').first();
  if (!await alert.isVisible({ timeout: 500 }).catch(() => false)) return;

  const alertText = await alert.innerText().catch(() => '');
  if (/site restriction|restricted|not allowed|cannot be sold|not available/i.test(alertText)) return;

  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^(yes|ok|continue)$/i })
    .first()
    .click({ timeout: 2_000 })
    .catch(() => { });
  await alert.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => { });
}

async function acknowledgeSiteRestrictionIfVisible(window: Page): Promise<boolean> {
  const restrictionText = /site restriction|restricted|not allowed|cannot be sold|not available/i;
  const alert = window.locator('ion-alert').filter({ hasText: restrictionText }).first();
  if (await alert.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^(ok|close|continue)$/i })
      .first()
      .click({ timeout: 3_000 })
      .catch(() => { });
    await alert.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => { });
    return true;
  }

  const toast = window.locator('ion-toast, .toast-message, .toast-container, simple-snack-bar, snack-bar-container, .mat-snack-bar-container')
    .filter({ hasText: restrictionText })
    .first();
  if (await toast.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await window.getByRole('button', { name: /^close$/i }).click({ timeout: 2_000 }).catch(() => { });
    await toast.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => { });
    return true;
  }

  const bodyHasRestriction = await window.locator('body').innerText()
    .then(text => restrictionText.test(text))
    .catch(() => false);
  if (bodyHasRestriction) {
    await window.getByRole('button', { name: /^close$/i }).click({ timeout: 2_000 }).catch(() => { });
    return true;
  }

  return false;
}

async function visibleSaleItemLabels(window: Page, itemPattern: RegExp): Promise<string[]> {
  return await window.evaluate(({ source, flags }) => {
    const pattern = new RegExp(source, flags);
    return Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .map(button => ({
        text: button.innerText.trim().replace(/\s+/g, ' '),
        visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
      }))
      .filter(({ text, visible }) => visible && pattern.test(text))
      .map(({ text }) => text)
      .filter((text, index, all) => all.indexOf(text) === index);
  }, { source: itemPattern.source, flags: itemPattern.flags });
}

async function extractItemCount(window: Page): Promise<number> {
  return await window.evaluate(() => {
    const match = document.body.innerText.match(/Item Count\s*:?\s*(\d+)/i);
    return Number(match?.[1] ?? 0);
  }).catch(() => 0);
}

async function closePatronSaleService(window: Page, openingBalance: string, saleAmount: string): Promise<string> {
  if (!await isCloseServiceScreen(window)) {
    await clickMenuItem(window, 'Close Service');
  }
  await closeSideMenuIfOpen(window);
  await waitForText(window, /Closing Balance|Close Service/i, 20_000);
  await waitForText(window, /Coins|Bills/i, 20_000);

  const closingBalance = await selectRandomBalanceFromCoinsOrBills(window);

  await closeSideMenuIfOpen(window);
  await closeService(window);
  await window.waitForTimeout(5_000);
  return closingBalance;
}

async function selectRandomBalanceFromCoinsOrBills(window: Page): Promise<string> {
  // Click the first denomination input — same approach as verifyOpeningBalanceKeypad (confirmed working)
  const denomInput = window.locator('input.input-label-opencloseBalance').first();
  await expect(denomInput).toBeVisible({ timeout: 10_000 });
  await denomInput.click();
  await window.waitForTimeout(300);

  // Enter a count via the on-screen keypad (confirmed working in verifyOpeningBalanceKeypad)
  const count = String(1 + (Date.now() % 3)); // "1", "2", or "3"
  for (const digit of count) {
    await clickKeypadButton(window, digit);
    await window.waitForTimeout(200);
  }
  await window.waitForTimeout(500);

  // Strategy 1: find an input with a $ dollar value (opening screen has #openingBalance)
  const dollarInputVal = await window.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    return inputs
      .filter(el => /^\$/.test(el.value))
      .map(el => ({
        id: el.id,
        value: el.value,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      }));
  });
  for (const inp of dollarInputVal) {
    const normalized = normalizeMoney(inp.value);
    if (normalized !== '$0.00') return normalized;
  }

  // Strategy 2: closing balance screen may display the total as non-input text
  const dollarTextElems = await window.evaluate(() => {
    const results: { tag: string; text: string; cls: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (/^\$\d+\.\d{2}$/.test(ownText)) {
        results.push({ tag: el.tagName, text: ownText, cls: el.className.substring(0, 40) });
      }
    }
    return results;
  });
  for (const el of dollarTextElems) {
    const normalized = normalizeMoney(el.text);
    if (normalized !== '$0.00') return normalized;
  }

  // Strategy 3: infer from denomination count — first denomination (Pennies) = $0.01 per count
  const penniesCount = await window.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('input.active-input-label-opencloseBalance, input.input-label-opencloseBalance');
    return Number(el?.value ?? 0);
  });
  if (penniesCount > 0) return `$${(penniesCount * 0.01).toFixed(2)}`;

  throw new Error('Unable to find a non-zero dollar balance total.');
}


async function isCloseServiceScreen(window: Page): Promise<boolean> {
  return await window.evaluate(() => {
    const visibleText = Array.from(document.querySelectorAll<HTMLElement>('ion-router-outlet .ion-page:not(.ion-page-hidden) *'))
      .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map(el => el.innerText ?? '')
      .join('\n');

    return /Closing Balance/i.test(visibleText)
      || (/Close Service/i.test(visibleText) && /Opening Balance|Closing POS Terminal/i.test(visibleText));
  }).catch(() => false);
}

async function createClosedPatronSaleSession(window: Page): Promise<ReconciliationSessionValues> {
  const openingBalance = await openFreshServiceForPatronSale(window);
  const sale = await completePatronMealSale(window);
  const closingBalance = await closePatronSaleService(window, openingBalance, sale.saleAmount);
  return { openingBalance, closingBalance, ...sale };
}

function sumMoney(...values: string[]): string {
  const total = values.reduce((sum, value) => {
    const match = value.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
    return sum + Number(match?.[1] ?? 0);
  }, 0);

  return `$${total.toFixed(2)}`;
}

function normalizeMoney(value: string): string {
  const match = value.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
  return `$${Number(match?.[1] ?? 0).toFixed(2)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createExpressPointDataForReconciliation(): Promise<ReconciliationSessionValues> {
  const summarySaleHandle = await loginToExpressPoint();
  try {
    const { window } = summarySaleHandle;

    await navigateToSummarySale(window);
    await verifyOpeningBalanceKeypad(window);
    await cancelOpeningBalance(window);

    await openServiceFromMenuIfAvailable(window);
    await openSummarySaleSession(window);

    await selectBreakfastMeal(window);
    await verifyMealCountInput(window, { verifyKeyboard: true });
    await clearSelection(window);

    await selectBreakfastMeal(window);
    await verifyMealCountInput(window, { verifyKeyboard: false });
    await recordSummarySale(window);
    await closeService(window);
  } finally {
    await closeExpressPoint(summarySaleHandle);
  }

  const patronSaleHandle = await loginToExpressPointWithoutSeededSession();
  try {
    return await createClosedPatronSaleSession(patronSaleHandle.window);
  } finally {
    await closeExpressPoint(patronSaleHandle);
  }
}

async function createPrimeroEdgeWebPage() {
  // ExpressPoint is always visible because it is an Electron app. The web
  // browser would normally be headless, so keep it visible during local runs.
  const browser = await chromium.launch({ headless: process.env.CI === 'true' });
  const page = await browser.newPage();
  return { browser, page };
}

async function extractTotalAmountDue(window: Page): Promise<string> {
  return await window.evaluate(() => {
    const bodyText = document.body.innerText;
    const directMatch = bodyText.match(/Total Amount Due\s*:?\s*\$?\s*(\d+(?:\.\d{2})?)/i);
    if (directMatch) return `$${Number(directMatch[1]).toFixed(2)}`;

    const dollarMatches = Array.from(bodyText.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g));
    return dollarMatches.length > 0
      ? `$${Number(dollarMatches[dollarMatches.length - 1][1]).toFixed(2)}`
      : '$0.00';
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Summary Sale', () => {
  test('records summary sale and verifies patron sale in PrimeroEdge reconciliation', async () => {
    const expected = await createExpressPointDataForReconciliation();

    const { browser, page: webPage } = await createPrimeroEdgeWebPage();
    try {
      await loginToPrimeroEdgeQa(webPage);
      await openPointOfServiceReconciliation(webPage);
      await filterReconciliationForToday(webPage);
      await openMatchingReconciliationSession(webPage, expected);
      await verifyReconciledTransactionDetails(webPage, expected);
    } finally {
      await webPage.close();
      await browser.close();
    }
  });
});
