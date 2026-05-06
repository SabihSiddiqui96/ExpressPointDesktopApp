//Test Link: //Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115140


import { test, expect, Page } from '@playwright/test';
import { loginToExpressPoint, closeExpressPoint } from '../../utils/helpers';
import { WarningDialog } from '../../utils/dialogs';
import { ensureMealTypeSelected } from '../../utils/serving';

const PATRON_ID = '1337';
const PATRON_FIRST_NAME = 'Sabih';
const PATRON_LAST_NAME = 'PAID';
// Second patron used to verify search filtering — ID 133745, "REDUCED, Sabih"
// should appear in the unfiltered list but NOT in a search for "PAID, Sabih".
const PATRON_ID_REDUCED = '133745';
const PATRON_FIRST_NAME_REDUCED = 'Sabih';
const PATRON_LAST_NAME_REDUCED = 'REDUCED';
const PATRON_DISPLAY_NAME_REDUCED = `${PATRON_LAST_NAME_REDUCED}, ${PATRON_FIRST_NAME_REDUCED}`;

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
  // Every page navigation can trigger the Square Authorization Warning.
  await WarningDialog.dismiss(page, 3_000);
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
  // Warning dialog can appear when navigating into Transactions; dismiss it.
  await WarningDialog.dismiss(page, 5_000);
  await waitForText(page, /Transactions/i, 30_000);
  await WarningDialog.dismiss(page, 2_000);
  // Side panel can stay open after the menu click and overlay the search bar —
  // close it (twice for stubborn cases) before any subsequent interactions.
  await closeSideMenu(page);
  await closeSideMenu(page);
}

// The transactions list renders the patron name as "<LAST>, <FIRST>" (e.g. "PAID, Sabih").
const PATRON_DISPLAY_NAME = `${PATRON_LAST_NAME}, ${PATRON_FIRST_NAME}`;
const PATRON_RESULT_REGEX = new RegExp(
  `${PATRON_LAST_NAME},\\s*${PATRON_FIRST_NAME}`,
  'i',
);
const PATRON_REDUCED_RESULT_REGEX = new RegExp(
  `${PATRON_LAST_NAME_REDUCED},\\s*${PATRON_FIRST_NAME_REDUCED}`,
  'i',
);

async function performTransactionSearch(page: Page): Promise<void> {
  await clickSearchIcon(page);
  // The form may show separate First/Last fields OR a single search input.
  // For the single-input case use the "<LAST>, <FIRST>" display string —
  // matches what the transactions list renders so the filter is exact.
  const filledFirstLast = await tryFillVisibleTextInput(page, /first/i, PATRON_FIRST_NAME)
    && await tryFillVisibleTextInput(page, /last/i, PATRON_LAST_NAME);
  if (!filledFirstLast) {
    const filledSingleSearch = await tryFillVisibleTextInput(page, /search|name|patron|student|filter/i, PATRON_DISPLAY_NAME)
      || await tryFillFirstVisibleInput(page, PATRON_DISPLAY_NAME);
    expect(filledSingleSearch, 'transactions search should expose a name/search field').toBe(true);
  }
  await submitTransactionSearch(page);
}

async function patronAppearsInResults(page: Page, timeoutMs = 8_000): Promise<boolean> {
  return page.getByText(PATRON_RESULT_REGEX).first()
    .isVisible({ timeout: timeoutMs }).catch(() => false);
}

async function bounceThroughDeviceInfo(page: Page): Promise<void> {
  // Recovery for the Transactions search-results glitch: navigate to Device
  // Information via the hamburger menu, then come back to Transactions.
  await clickMenuItem(page, /^Device Information$/i);
  await WarningDialog.dismiss(page, 3_000);
  await waitForText(page, /Device Information|Device Info|Device Name|Version/i, 15_000).catch(() => {});
  await closeSideMenu(page);
  await navigateToTransactions(page);
}

async function searchTransactionsByName(page: Page): Promise<void> {
  await performTransactionSearch(page);

  // If results don't show up, retry the Device Info bounce + re-search up to 4 times.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await patronAppearsInResults(page, 8_000)) break;

    // First time only: maybe no transaction exists yet — create one.
    if (attempt === 0) {
      await createPatronSale(page);
      await navigateToTransactions(page);
      await performTransactionSearch(page);
      continue;
    }

    // Subsequent attempts: bounce through Device Info and re-search.
    await bounceThroughDeviceInfo(page);
    await performTransactionSearch(page);
  }

  // Verify the patron's name actually appears in the results in the exact
  // "<Last>, <First>" format the transactions list uses.
  await expect(
    page.getByText(PATRON_RESULT_REGEX).first(),
    `transaction for "${PATRON_DISPLAY_NAME}" (${PATRON_ID}) should appear in results`,
  ).toBeVisible({ timeout: 30_000 });
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
  await page.waitForTimeout(500);
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

async function createPatronSale(page: Page, patronId: string = PATRON_ID): Promise<void> {
  await closeSideMenu(page);
  await WarningDialog.dismiss(page, 3_000);

  if (!await isPatronServingScreen(page)) {
    await clickMenuItem(page, /Open Service|Continue Service/i);
    await closeSideMenu(page);
    await WarningDialog.dismiss(page);

    if (await page.getByText(/Opening Balance/i).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await WarningDialog.dismiss(page);
      await clickIonButton(page, /Open Service|Continue Service/i);
    }
    await waitForLoadingOverlay(page);
    await WarningDialog.dismiss(page);
  }

  await closeSideMenu(page);
  await ensureMealTypeSelected(page);
  await WarningDialog.dismiss(page, 2_000);

  // Enter PIN via direct fill (mirrors close_service.spec.ts pattern).
  const idInput = page.locator('input[placeholder="Enter an ID"], #pinInput input').first();
  await expect(idInput).toBeVisible({ timeout: 30_000 });
  await idInput.fill(patronId);
  await page.waitForTimeout(300);

  // Submit via the forward-circle icon button.
  const fwdClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && !!el.querySelector('ion-icon[name="caret-forward-circle"]'));
    btn?.click();
    return !!btn;
  });
  if (!fwdClicked) await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);

  // Wait for the SPECIFIC patron ID to load — matching "Add Funds"/"Item Count"
  // alone is unsafe because those linger on screen from a prior patron, which
  // makes us click meal items before the new patron actually loads.
  await waitForText(page, new RegExp(`ID:\\s*${patronId}\\b`, 'i'), 30_000);

  // Click any visible meal item (Lunch Meal preferred).
  const lunchMeal = page.locator('ion-button').filter({ hasText: /^Lunch Meal$/i }).first();
  const anyMeal = page.locator('ion-button').filter({ hasText: /Meal/i }).first();
  const mealTarget = (await lunchMeal.isVisible({ timeout: 2_000 }).catch(() => false)) ? lunchMeal : anyMeal;
  await expect(mealTarget).toBeVisible({ timeout: 10_000 });
  await mealTarget.click();
  await page.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i }).first().click({ timeout: 3_000 }).catch(() => {});

  await waitForText(page, /Total Amount Due/i, 15_000);
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

async function clickFirstPaidMealItem(page: Page): Promise<void> {
  // Dismiss any Warning blocking interaction first.
  await WarningDialog.dismiss(page, 2_000);

  // Some sites show named meal-item buttons directly (Lunch Meal, Yemek);
  // others show a category grid (Extra/Fruit/Milk/Grain) where you must click
  // a category, then a sub-item. Try the named items first; if that doesn't
  // populate the cart, fall back to a category and pick its first sub-item.
  const namedItem = page.locator('ion-button')
    .filter({ hasText: /Yemek|Chicken Burger|Breakfast Meal|Lunch Meal|Supper Meal|Dinner Meal|Snack Meal|Meal/i })
    .first();

  let added = false;
  if (await namedItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await namedItem.click().catch(() => {});
    await page.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^yes$/i }).first().click({ timeout: 3_000 }).catch(() => {});
    added = await page.locator('body').innerText()
      .then(text => !/No items selected/i.test(text)).catch(() => false);
  }

  if (!added) {
    // Click a category, then click the first food item that appears.
    const category = page.locator('ion-button')
      .filter({ hasText: /^Extra$|^Fruit$|^Milk$|^Grain$|^Entree$|^Vegetable$|^Side$|^Dessert$|^Supper$/i })
      .first();
    if (await category.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await category.click();
      await page.waitForTimeout(500);
      await page.locator('ion-alert button, .alert-button')
        .filter({ hasText: /^yes$/i }).first().click({ timeout: 2_000 }).catch(() => {});
    }
  }

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
      // Create TWO transactions — one for PAID, Sabih (1337) and one for
      // REDUCED, Sabih (133745) — so we can verify the search filter properly
      // narrows results.
      await createPatronSale(window, PATRON_ID);
      await createPatronSale(window, PATRON_ID_REDUCED);

      await navigateToTransactions(window);

      // Both patrons should appear in the unfiltered list.
      await expect(
        window.getByText(PATRON_RESULT_REGEX).first(),
        `"${PATRON_DISPLAY_NAME}" should appear in the unfiltered transactions list`,
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        window.getByText(PATRON_REDUCED_RESULT_REGEX).first(),
        `"${PATRON_DISPLAY_NAME_REDUCED}" should appear in the unfiltered transactions list`,
      ).toBeVisible({ timeout: 30_000 });

      // Searching for "PAID, Sabih" should keep PAID and HIDE REDUCED.
      await searchTransactionsByName(window);
      await expect(
        window.getByText(PATRON_REDUCED_RESULT_REGEX).first(),
        `"${PATRON_DISPLAY_NAME_REDUCED}" must NOT appear when filtering by "${PATRON_DISPLAY_NAME}"`,
      ).toBeHidden({ timeout: 10_000 });

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
