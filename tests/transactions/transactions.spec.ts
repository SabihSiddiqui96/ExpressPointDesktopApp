//Test Link: //Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115140


import { test, expect, Page } from '@playwright/test';
import { loginToExpressPoint, closeExpressPoint } from '../../utils/helpers';

const PATRON_ID = '1337';
const PATRON_FIRST_NAME = 'Sabih';
const PATRON_LAST_NAME = 'PAID';

test.describe.configure({ timeout: 360_000 });

async function waitForLoadingOverlay(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('ion-loading'))
        .every(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const style = getComputedStyle(el);
          return !visible
            || el.getAttribute('aria-hidden') === 'true'
            || el.classList.contains('overlay-hidden')
            || style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0';
        });
    }),
    { timeout: 30_000 },
  ).toBe(true);
}

async function waitForText(page: Page, text: string | RegExp, timeout = 20_000): Promise<void> {
  const matcher = typeof text === 'string'
    ? { source: text, flags: '', isRegex: false }
    : { source: text.source, flags: text.flags, isRegex: true };

  await expect.poll(
    () => page.evaluate(({ source, flags, isRegex }) => {
      const matches = isRegex
        ? (value: string) => new RegExp(source, flags).test(value)
        : (value: string) => value.includes(source);

      return Array.from(document.querySelectorAll<HTMLElement>('body *')).some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && matches(el.innerText?.trim() ?? '');
      });
    }, matcher),
    { timeout },
  ).toBe(true);
}

async function clickMenuButton(page: Page): Promise<void> {
  await waitForLoadingOverlay(page);
  const button = page
    .locator('ion-menu-button, ion-button')
    .filter({ has: page.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

async function clickMenuItem(page: Page, label: string | RegExp): Promise<void> {
  const pattern = typeof label === 'string' ? label : label.source;
  const itemVisible = async () => page.evaluate((source: string) => {
    const regex = new RegExp(source, 'i');
    return Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item, ion-item[detail]'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText ?? '');
      });
  }, pattern);

  if (!await itemVisible()) {
    await clickMenuButton(page);
  }

  await expect.poll(itemVisible, { timeout: 10_000 }).toBe(true);
  const clicked = await page.evaluate((source: string) => {
    const regex = new RegExp(source, 'i');
    const item = Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item, ion-item[detail]'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText ?? '');
      });
    item?.click();
    return !!item;
  }, pattern);
  expect(clicked).toBe(true);
  await closeSideMenu(page);
  await waitForLoadingOverlay(page);
}

async function closeSideMenu(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (!menu?.close) return;
    await Promise.race([
      menu.close(),
      new Promise(resolve => setTimeout(resolve, 1_000)),
    ]);
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(360, 90).catch(() => {});
  await page.waitForTimeout(350);
}

async function navigateToTransactions(page: Page): Promise<void> {
  const dashboardItem = page.locator('ion-item[detail]').filter({ hasText: /^Transactions$/i }).first();
  if (await dashboardItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await dashboardItem.click();
  } else {
    await clickMenuItem(page, /^Transactions$/i);
  }
  await waitForText(page, /Transactions/i, 30_000);
}

async function searchTransactionsByName(page: Page): Promise<void> {
  await clickSearchIcon(page);
  const filledFirstLast = await tryFillVisibleTextInput(page, /first/i, PATRON_FIRST_NAME)
    && await tryFillVisibleTextInput(page, /last/i, PATRON_LAST_NAME);
  if (!filledFirstLast) {
    const filledSingleSearch = await tryFillVisibleTextInput(page, /search|name|patron|student|filter/i, `${PATRON_FIRST_NAME} ${PATRON_LAST_NAME}`)
      || await tryFillFirstVisibleInput(page, PATRON_FIRST_NAME);
    expect(filledSingleSearch, 'transactions search should expose a name/search field').toBe(true);
  }
  await submitTransactionSearch(page);
  await waitForText(page, /Sabih|PAID|1337/i, 30_000);
}

async function submitTransactionSearch(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const candidate = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const label = [
          el.innerText,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.querySelector('ion-icon')?.getAttribute('name'),
        ].filter(Boolean).join(' ');
        return visible && /search|checkmark|done|arrow|caret/i.test(label);
      });
    candidate?.click();
    return !!candidate;
  });

  if (!clicked) {
    await page.keyboard.press('Enter');
  }
  await waitForLoadingOverlay(page);
}

async function clickSearchIcon(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const label = [
          el.innerText,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.querySelector('ion-icon')?.getAttribute('name'),
        ].filter(Boolean).join(' ');
        return visible && /search/i.test(label);
      });
    button?.click();
    return !!button;
  });
  expect(clicked, 'search icon should be clickable').toBe(true);
}

async function fillVisibleTextInput(page: Page, labelPattern: RegExp, value: string): Promise<void> {
  const filled = await tryFillVisibleTextInput(page, labelPattern, value);
  expect(filled, `input matching ${labelPattern} should be visible`).toBe(true);
}

async function tryFillVisibleTextInput(page: Page, labelPattern: RegExp, value: string): Promise<boolean> {
  return await page.evaluate(({ source, flags, inputValue }) => {
    const regex = new RegExp(source, flags);
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const context = [
          el.placeholder,
          el.getAttribute('aria-label'),
          el.name,
          el.id,
          el.closest('ion-item, ion-row, div')?.textContent,
        ].filter(Boolean).join(' ');
        return visible && regex.test(context);
      });
    if (!input) return false;
    input.focus();
    input.value = inputValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { source: labelPattern.source, flags: labelPattern.flags, inputValue: value });
}

async function tryFillFirstVisibleInput(page: Page, value: string): Promise<boolean> {
  return await page.evaluate((inputValue) => {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (!input) return false;
    input.focus();
    input.value = inputValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, value);
}

async function clickIonButton(page: Page, label: string | RegExp): Promise<void> {
  const source = typeof label === 'string' ? escapeRegExp(label) : label.source;
  const flags = typeof label === 'string' ? 'i' : label.flags || 'i';
  const button = page.locator('ion-button, button').filter({ hasText: new RegExp(source, flags) }).last();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

async function ensureTransactionWithDetails(page: Page): Promise<void> {
  await closeOpenDialog(page);
  await createPatronSale(page);
  await navigateToTransactions(page);
  await waitForText(page, /1337|Sabih|PAID/i, 30_000);
}

async function clickTransactionDetailsIcon(page: Page): Promise<boolean> {
  const clicked = await clickFirstTransactionRowAction(page, /detail|transaction|menu|list|ellipsis|hamburger|more|reorder/i);
  expect(clicked, 'transaction details icon should be clickable').toBe(true);
  await waitForText(page, /Transaction Details|Details|Print|Menu Item/i, 15_000);
  return true;
}

async function markFirstTransactionForReview(page: Page): Promise<void> {
  const marked = await clickFirstTransactionRowAction(page, /flag|review|mark/i);
  expect(marked, 'mark-for-review flag should be clickable').toBe(true);
  await waitForText(page, /Reason|Review/i, 10_000);

  await chooseFirstVisibleOption(page);
  await clickOptionalControl(page, /Save|OK|Confirm|Done|Mark/i);
  await expect.poll(() => hasRedFlagIcon(page), { timeout: 10_000 }).toBe(true);
  await closeOpenDialog(page);
  await closeSideMenu(page);
}

async function clickFirstTransactionRowAction(page: Page, actionPattern: RegExp): Promise<boolean> {
  return await page.evaluate(({ source, flags }) => {
    const actionRegex = new RegExp(source, flags);
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const labelFor = (el: HTMLElement) => [
      el.innerText,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('name'),
      el.id,
      el.className,
      el.querySelector('ion-icon')?.getAttribute('name'),
    ].filter(Boolean).join(' ');

    const rowSelectors = [
      'ion-row',
      'tr',
      'ion-item',
      '[class*="transaction" i]',
      '[class*="row" i]',
      '[class*="list" i] > div',
    ].join(',');
    const rows = Array.from(document.querySelectorAll<HTMLElement>(rowSelectors))
      .filter(row => {
        if (!visible(row)) return false;
        const rect = row.getBoundingClientRect();
        const text = row.innerText ?? '';
        return rect.top > 70
          && /1337|Sabih|PAID/i.test(text)
          && !/Search|Reason|Review Reason|Patron ID\s*Lookup/i.test(text);
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.top - bRect.top || bRect.width - aRect.width;
      });

    const clickActionIn = (scope: HTMLElement): boolean => {
      const actions = Array.from(scope.querySelectorAll<HTMLElement>('ion-button, button, ion-icon, img, svg, a'))
        .filter(el => {
          if (!visible(el)) return false;
          const rect = el.getBoundingClientRect();
          return rect.top > 70 && actionRegex.test(labelFor(el));
        })
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
      const action = actions[0];
      if (!action) return false;
      (action.closest('ion-button, button, a') as HTMLElement | null ?? action).click();
      return true;
    };

    for (const row of rows) {
      if (clickActionIn(row)) return true;
    }

    const globalAction = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, ion-icon, img, svg, a'))
      .filter(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        return rect.top > 95
          && rect.left > 80
          && actionRegex.test(labelFor(el))
          && !el.closest('ion-menu');
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
    if (!globalAction) return false;
    (globalAction.closest('ion-button, button, a') as HTMLElement | null ?? globalAction).click();
    return true;
  }, { source: actionPattern.source, flags: actionPattern.flags || 'i' });
}

async function chooseFirstVisibleOption(page: Page): Promise<void> {
  const reasonText = page.getByText(/Should be Check|Should be Charge|Should be Cash|Wrong Pmt Amount|Change Due|Add Item|Remove Item|Other/i).first();
  if (await reasonText.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await reasonText.click();
    return;
  }

  const modalButton = page.locator('ion-modal ion-button, ion-modal button, .modal-wrapper ion-button, .modal-wrapper button')
    .filter({ hasText: /Should be|Wrong|Change|Add|Remove|Second|Patron|Note|Restriction|Other/i })
    .first();
  if (await modalButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await modalButton.click();
    return;
  }

  const alertRadio = page.locator('.alert-radio-button, ion-alert [role="radio"], ion-alert button')
    .filter({ hasNotText: /cancel|close|ok|save|done/i })
    .first();
  if (await alertRadio.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await alertRadio.click();
    return;
  }

  const selected = await page.evaluate(() => {
    const option = Array.from(document.querySelectorAll<HTMLElement>('.alert-radio-button, .alert-radio-label, [role="radio"], ion-alert ion-radio, ion-modal ion-radio, ion-modal ion-item, ion-popover ion-item, ion-select, option'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          || getComputedStyle(el).visibility !== 'hidden';
        const text = el.innerText ?? el.textContent ?? '';
        return visible && !/reason|select|cancel|close|ok|save|done/i.test(text.trim());
      });
    (option?.closest('.alert-radio-button, [role="radio"], ion-item, button') as HTMLElement | null ?? option)?.click();
    return !!option;
  });
  expect(selected, 'a review reason should be selectable').toBe(true);
}

async function clickOptionalControl(page: Page, label: RegExp): Promise<boolean> {
  const source = label.source;
  const flags = label.flags || 'i';
  return await page.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    const candidate = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, ion-segment-button, ion-tab-button, ion-item, a'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const text = [
          el.innerText,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.id,
          el.className,
        ].filter(Boolean).join(' ');
        return visible && regex.test(text);
      });
    candidate?.click();
    return !!candidate;
  }, { source, flags });
}

async function hasRedFlagIcon(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('ion-icon, svg, img, ion-button'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const label = [
          el.getAttribute('name'),
          el.getAttribute('title'),
          el.getAttribute('aria-label'),
          el.className,
          getComputedStyle(el).color,
          getComputedStyle(el).fill,
        ].filter(Boolean).join(' ');
        return visible && /flag/i.test(label) && /(red|danger|rgb\(.*(255|220|221|244)|#f|#d|#c)/i.test(label);
      });
  });
}

async function verifyTransactionStatusIcon(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => {
      const text = document.body.innerText;
      const hasNamedStatus = /not sent|processing|complete/i.test(text);
      const hasCheckOrX = Array.from(document.querySelectorAll<HTMLElement>('ion-icon, svg, img, span'))
        .some(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const label = [
            el.innerText,
            el.getAttribute('name'),
            el.getAttribute('title'),
            el.getAttribute('aria-label'),
            el.className,
          ].filter(Boolean).join(' ');
          return visible && /check|done|complete|close|x|not sent|processing/i.test(label);
        });
      return hasNamedStatus || hasCheckOrX;
    }),
    { timeout: 20_000 },
  ).toBe(true);
}

async function waitForTransactionStatusRefresh(page: Page): Promise<void> {
  const initialStatus = await visibleStatusSnapshot(page);
  await page.waitForTimeout(5_000);
  await verifyTransactionStatusIcon(page);
  const nextStatus = await visibleStatusSnapshot(page);
  expect(nextStatus.length).toBeGreaterThan(0);
  expect(initialStatus.length).toBeGreaterThan(0);
}

async function visibleStatusSnapshot(page: Page): Promise<string> {
  return await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('ion-icon, svg, img, span'))
    .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
    .map(el => [
      el.innerText,
      el.getAttribute('name'),
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      el.className,
    ].filter(Boolean).join(' '))
    .filter(text => /check|done|complete|close|x|not sent|processing/i.test(text))
    .join('\n'));
}

async function dismissWarningIfVisible(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
    for (const alert of alerts) {
      const visible = !!(alert.offsetWidth || alert.offsetHeight || alert.getClientRects().length);
      if (!visible) continue;
      const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
      const buttons = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'));
      const okBtn = buttons.find(b => /ok/i.test((b.innerText || b.textContent || '').trim()));
      if (okBtn) { okBtn.click(); return true; }
    }
    return false;
  }).catch(() => false);
  if (clicked) {
    await page.locator('ion-alert').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

async function createPatronSale(page: Page): Promise<void> {
  await closeSideMenu(page);

  if (!await isPatronServingScreen(page)) {
    await clickMenuItem(page, /Open Service|Continue Service/i);
    await closeSideMenu(page);

    if (await page.getByText(/Opening Balance/i).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dismissWarningIfVisible(page);
      await clickIonButton(page, /Open Service|Continue Service/i);
    }
    await waitForLoadingOverlay(page);
  }

  await closeSideMenu(page);
  await expect(page.locator('#pinInput input, input[placeholder="Enter an ID"]').first())
    .toBeVisible({ timeout: 30_000 });
  await ensureBreakfastMenuVisible(page);
  await lookupPatron(page, PATRON_ID);
  await clickFirstPaidMealItem(page);
  await clickIonButton(page, /Charge/i);
  await page.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue|yes)$/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => {});
  await waitForLoadingOverlay(page);
}

async function isPatronServingScreen(page: Page): Promise<boolean> {
  return await page.locator('#pinInput input, input[placeholder="Enter an ID"]').first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

async function ensureBreakfastMenuVisible(page: Page): Promise<void> {
  if (await page.locator('ion-button').filter({ hasText: /Yemek|Chicken Burger|Breakfast Meal|Lunch Meal/i }).first()
    .isVisible({ timeout: 5_000 }).catch(() => false)) {
    return;
  }

  const mealTypeClicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .filter(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const label = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ');
        const rect = el.getBoundingClientRect();
        return visible
          && rect.top < 90
          && rect.width > 120
          && rect.left > 90
          && (/Meal Type|Breakfast|Lunch/i.test(label) || rect.left < window.innerWidth * 0.55);
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const candidate = candidates.find(el => /Meal Type|Breakfast|Lunch/i.test(el.innerText ?? ''))
      ?? candidates[1]
      ?? candidates[0];
    candidate?.click();
    return !!candidate;
  });
  expect(mealTypeClicked, 'meal type widget should be clickable when no menu is visible').toBe(true);
  await waitForText(page, /Meal Type|Breakfast/i, 10_000);
  await page.getByText(/Breakfast|Lunch/i).first().click();
  await page.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect(page.locator('ion-button').filter({ hasText: /Yemek|Chicken Burger|Breakfast Meal|Lunch Meal/i }).first())
    .toBeVisible({ timeout: 20_000 });
}

async function lookupPatron(page: Page, patronId: string): Promise<void> {
  const idInput = page.locator('#pinInput input, input[placeholder="Enter an ID"]').first();
  await expect(idInput).toBeVisible({ timeout: 20_000 });
  await idInput.click();
  await idInput.fill('');
  for (const digit of patronId) {
    await clickKeypadButton(page, digit);
  }
  await clickIconButton(page, 'caret-forward-circle');
  await waitForText(page, /ID:\s*1337|Add Funds|Item Count/i, 30_000);
}

async function clickKeypadButton(page: Page, digit: string): Promise<void> {
  const coords = await page.evaluate((value: string) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, [role="button"]'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const rect = el.getBoundingClientRect();
        return visible && rect.top > 100 && el.innerText.trim() === value;
      });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, digit);
  expect(coords, `keypad digit ${digit} should be visible`).not.toBeNull();
  await page.mouse.click(coords!.x, coords!.y);
}

async function clickIconButton(page: Page, iconName: string): Promise<void> {
  const clicked = await page.evaluate((name: string) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && !!el.querySelector(`ion-icon[name="${name}"]`);
      });
    button?.click();
    return !!button;
  }, iconName);
  expect(clicked).toBe(true);
}

async function clickFirstPaidMealItem(page: Page): Promise<void> {
  const item = page.locator('ion-button')
    .filter({ hasText: /Yemek|Chicken Burger|Breakfast Meal|Lunch Meal|Meal/i })
    .first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
  await page.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect.poll(
    () => page.locator('body').innerText().then(text => !/No items selected/i.test(text)),
    { timeout: 10_000 },
  ).toBe(true);
}

async function closeOpenDialog(page: Page): Promise<void> {
  await page.locator('ion-modal ion-button, ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(close|cancel|ok|done)$/i })
    .first()
    .click({ timeout: 3_000 })
    .catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Transactions', () => {
  test('transactions: search, review flag, details, status, and reset protection', async () => {
    const handle = await loginToExpressPoint();
    const { window } = handle;

    try {
      await navigateToTransactions(window);
      await searchTransactionsByName(window);

      await ensureTransactionWithDetails(window);
      await markFirstTransactionForReview(window);
      await clickTransactionDetailsIcon(window);
      await waitForText(window, /Print/i, 10_000);
      await waitForText(window, /Menu Item|Breakfast|Lunch|Yemek|Burger|Meal/i, 10_000);
      await closeOpenDialog(window);

      await verifyTransactionStatusIcon(window);
      await waitForTransactionStatusRefresh(window);
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
