//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115141

import { test, expect, Page, chromium } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { loginToPrimeroEdgeQa } from '../../utils/primeroedge-web';
import { WarningDialog } from '../../utils/dialogs';
import { dismissAllYesConfirms } from '../../utils/service';
import { ensureMealTypeSelected } from '../../utils/serving';

test.describe.configure({ timeout: 480_000 });

const PATRON_ID = '1337';
const OPENING_BALANCE_AMOUNT = '5'; // $5.00
const CLOSING_BALANCE_AMOUNT = '1'; // $1.00 — intentionally lower than opening

const MANAGE_SETTINGS_URL = 'https://qa.primeroedge.co/System/ManageSettings.aspx';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

async function waitForText(window: Page, text: string | RegExp, timeout = 20_000): Promise<void> {
  const matcher =
    typeof text === 'string'
      ? { source: text, flags: '', isRegex: false }
      : { source: text.source, flags: text.flags, isRegex: true };

  await expect.poll(
    async () =>
      window.evaluate(({ source, flags, isRegex }) => {
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
    const ctx = handle.browser.contexts()[0];
    for (const p of ctx.pages().filter(p => !p.isClosed())) {
      if (await p.evaluate(() => !!document.querySelector('ion-app')).catch(() => false)) return p;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('getAppWindow: ion-app not found after 15 s');
}

async function clickMenuButton(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const btn = window
    .locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click({ timeout: 15_000 });
}

async function clickMenuItem(window: Page, label: string): Promise<void> {
  await waitForLoadingOverlay(window);
  const item = window.locator('ion-item').filter({ hasText: new RegExp(label, 'i') }).first();
  if (!await item.isVisible({ timeout: 1_000 }).catch(() => false)) await clickMenuButton(window);
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click({ timeout: 15_000 });
  await closeSideMenu(window);
  // Every page navigation can trigger the Square Authorization Warning.
  await WarningDialog.dismiss(window, 3_000);
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
  await WarningDialog.dismiss(window, 3_000);
}

async function closeSideMenu(window: Page): Promise<void> {
  await window.evaluate(async () => {
    const menu = document.querySelector('ion-menu') as any;
    if (menu?.close) {
      await Promise.race([menu.close(), new Promise(resolve => setTimeout(resolve, 1_000))]);
    }
  }).catch(() => {});
  await window.keyboard.press('Escape').catch(() => {});
  await window.waitForTimeout(250);
}

async function clickKeypadButton(window: Page, digit: string): Promise<void> {
  const coords = await window.evaluate((value: string) => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, [role="button"]'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const rect = el.getBoundingClientRect();
        return visible && rect.top > 100 && el.innerText.trim() === value;
      });
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, digit);
  if (coords) await window.mouse.click(coords.x, coords.y);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
}

// ---------------------------------------------------------------------------
// Open Service
// ---------------------------------------------------------------------------

async function openService(window: Page, handle: ExpressPointHandle): Promise<Page> {
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);

  const alreadyOnCloseService = await window.evaluate(() => {
    const text = document.body.innerText;
    return /Close Service/i.test(text) && /Closing Balance/i.test(text) && /Cancel/i.test(text);
  });
  if (alreadyOnCloseService) {
    // Leftover session from a prior test put us on the Close Service screen.
    // Fully close it: dismiss any Warning, click Close Service, answer YES to
    // every confirm (closing-balance < starting), then wait for the dashboard.
    for (let attempt = 0; attempt < 4; attempt++) {
      await WarningDialog.dismiss(window, 5_000);
      const stillOnClose = await window.evaluate(() =>
        /Closing Balance/i.test(document.body.innerText) && /Print session/i.test(document.body.innerText)
      );
      if (!stillOnClose) break;
      await clickCloseServiceButton(window);
      // Some confirms appear immediately, others after the click settles.
      await window.waitForTimeout(1_500);
      await WarningDialog.dismiss(window, 2_000);
      await dismissAllYesConfirms(window, 8_000, 4);
      await waitForLoadingOverlay(window);
    }
    await WarningDialog.dismiss(window, 3_000);
    await waitForText(window, /Serving Options|Open Service|Continue Service/i, 30_000);
  }

  // Close any pre-existing open service first
  if (await visibleIonItemExists(window, /Continue Service/i)) {
    await closeServiceFull(window);
    await waitForLoadingOverlay(window);
    await WarningDialog.dismiss(window, 3_000);
  }

  if (!await visibleIonItemExists(window, /^Open Service$/i)) {
    if (await visibleIonItemExists(window, /Continue Service/i)) {
      await clickVisibleIonItem(window, /Continue Service/i);
      await waitForLoadingOverlay(window);
      await WarningDialog.dismiss(window);
      return getAppWindow(handle);
    }
  }

  // Wait for "Open Service" to render after any earlier state transitions.
  if (!await visibleIonItemExists(window, /^Open Service$/i)) {
    const dump = await window.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 600),
      ionItems: Array.from(document.querySelectorAll<HTMLElement>('ion-item, ion-item[detail]'))
        .filter(el => !!(el.offsetWidth || el.offsetHeight))
        .map(el => el.innerText?.trim().substring(0, 60)),
    }));
    console.log('OPEN_SERVICE WAIT DEBUG:', JSON.stringify(dump));
  }
  await expect.poll(
    () => visibleIonItemExists(window, /^Open Service$/i),
    { timeout: 30_000 },
  ).toBe(true);

  await clickVisibleIonItem(window, /^Open Service$/i);
  await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
  await WarningDialog.dismiss(window);

  // Enter opening balance — mirror open_service.spec.ts pattern exactly
  const input = window.locator('input.input-label-opencloseBalance').first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await window.keyboard.press('Control+A');
  await window.keyboard.press('Backspace');
  await window.keyboard.type(OPENING_BALANCE_AMOUNT);
  if (await input.inputValue() !== OPENING_BALANCE_AMOUNT) {
    await input.fill(OPENING_BALANCE_AMOUNT);
  }
  await expect.poll(() => input.inputValue(), { timeout: 5_000 }).toBe(OPENING_BALANCE_AMOUNT);

  const openBtn = window.locator('ion-button').filter({ hasText: /Open Service/i }).last();
  await expect(openBtn).toBeVisible({ timeout: 10_000 });
  await openBtn.evaluate((el: HTMLElement) => el.click());
  await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 30_000 });
  await waitForLoadingOverlay(window);

  return getAppWindow(handle);
}

// ---------------------------------------------------------------------------
// Record Transaction
// ---------------------------------------------------------------------------

async function recordTransaction(window: Page): Promise<void> {
  await ensureMealTypeSelected(window);

  const idInput2 = window.locator('input[placeholder="Enter an ID"], #pinInput input').first();
  await expect(idInput2).toBeVisible({ timeout: 15_000 });
  await idInput2.fill(PATRON_ID);
  await window.waitForTimeout(300);

  // Submit via evaluate DOM click on ion-button with caret-forward-circle (same as clickVisibleIconButton)
  const fwdClicked = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && !!el.querySelector('ion-icon[name="caret-forward-circle"]'));
    btn?.click();
    return !!btn;
  });
  if (!fwdClicked) await window.keyboard.press('Enter');
  await window.waitForTimeout(1_000);

  await waitForText(window, /ID:\s*1337|Add Funds|Item Count/i, 30_000);

  // If no meal buttons visible, open meal type picker and choose Lunch
  const mealVisible = await window
    .locator('ion-button')
    .filter({ hasText: /Meal/i })
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  if (!mealVisible) {
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
        .find(el => {
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const rect = el.getBoundingClientRect();
          const label = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
            .filter(Boolean).join(' ');
          return visible && rect.top < 90 && /Meal Type|Lunch|Breakfast/i.test(label);
        });
      btn?.click();
    });
    await waitForText(window, /Lunch|Breakfast/i, 10_000);
    const lunchOpt = window.getByText(/^Lunch$/i).first();
    if (await lunchOpt.isVisible({ timeout: 2_000 }).catch(() => false)) await lunchOpt.click();
    else await window.getByText(/Lunch|Breakfast/i).first().click();
    await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^yes$/i }).first().click({ timeout: 3_000 }).catch(() => {});
    await expect(window.locator('ion-button').filter({ hasText: /Meal/i }).first())
      .toBeVisible({ timeout: 15_000 });
  }

  // Select Lunch Meal or any available meal
  const lunchMeal = window.locator('ion-button').filter({ hasText: /^Lunch Meal$/i }).first();
  const anyMeal = window.locator('ion-button').filter({ hasText: /Meal/i }).first();
  const mealTarget = (await lunchMeal.isVisible({ timeout: 2_000 }).catch(() => false)) ? lunchMeal : anyMeal;
  await expect(mealTarget).toBeVisible({ timeout: 10_000 });
  await mealTarget.click();
  await window.locator('ion-alert button, .alert-button')
    .filter({ hasText: /^yes$/i }).first().click({ timeout: 3_000 }).catch(() => {});

  await waitForText(window, /Total Amount Due/i, 15_000);

  const chargeBtn = window.locator('ion-button').filter({ hasText: /Charge/i }).last();
  await expect(chargeBtn).toBeVisible({ timeout: 10_000 });
  await chargeBtn.evaluate((el: HTMLElement) => el.click());
  await waitForLoadingOverlay(window);

  await window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(ok|done|close|continue)$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
  await expect(idInput2).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Close Service helpers
// ---------------------------------------------------------------------------

async function navigateToCloseService(window: Page): Promise<void> {
  await clickMenuItem(window, 'Close Service');
  // Warning dialog re-appears on Close Service navigation; dismiss before continuing.
  await WarningDialog.dismiss(window, 5_000);
  await waitForText(window, /Close Service/i, 20_000);
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 2_000);
}

async function enterClosingBalance(window: Page, amount: string): Promise<void> {
  const input = window.locator('input.input-label-opencloseBalance').first();
  if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await input.click();
    await window.keyboard.press('Control+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type(amount);
    if (await input.inputValue() !== amount) {
      await input.fill(amount);
    }
    await expect.poll(() => input.inputValue(), { timeout: 5_000 }).toBe(amount);
    return;
  }

  const hasClosingBalance = await window.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Closing Balance\s+\$(\d+\.\d{2})/i);
    return !!match && match[1] !== '0.00';
  });
  if (hasClosingBalance) return;

  const denomCoords = await window.evaluate(() => {
    const labels = /Pennies|Nickels|Dimes|Quarters|Dollars|Ones|Twos|Fives|Tens|Twenties/i;
    const el = Array.from(document.querySelectorAll<HTMLElement>('ion-item, ion-row, ion-col, div, button'))
      .filter(node => {
        const visible = !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
        const rect = node.getBoundingClientRect();
        return visible && rect.top > 80 && labels.test(node.innerText ?? '');
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width / 2, 180), y: rect.top + rect.height / 2 };
  });
  if (!denomCoords) return;
  await window.mouse.click(denomCoords!.x, denomCoords!.y);
  for (const digit of amount) {
    await clickKeypadButton(window, digit);
  }
  await expect.poll(
    () => window.evaluate(() => /Closing Balance\s+\$(?!0\.00)\d+\.\d{2}/i.test(document.body.innerText)),
    { timeout: 5_000 },
  ).toBe(true);
}

async function clickCloseServiceButton(window: Page): Promise<void> {
  const coords = await window.evaluate(() => {
    const isVisible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const area = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const ownText = (el: HTMLElement) => Array.from(el.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();
    const center = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const exactButton = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, [role="button"], span, ion-col, div'))
      .filter(el => {
        if (!isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        const text = ownText(el) || (el.getAttribute('aria-label') ?? '').trim();
        return rect.top > document.documentElement.clientHeight * 0.45
          && rect.width > 8
          && rect.height > 8
          && /^(Close\s*S|Close Service)$/i.test(text);
      })
      .sort((a, b) => area(a) - area(b))[0];
    if (exactButton) return center(exactButton);

    const closeServicePanel = Array.from(document.querySelectorAll<HTMLElement>('ion-content, ion-card, .card, .scroll-content, main, section, div'))
      .filter(el => {
        if (!isVisible(el)) return false;
        const text = el.innerText ?? '';
        const rect = el.getBoundingClientRect();
        return rect.width > 250
          && rect.height > 250
          && /Closing Balance/i.test(text)
          && /Print session/i.test(text)
          && /Close\s*S|Close Service/i.test(text);
      })
      .sort((a, b) => area(a) - area(b))[0];
    if (closeServicePanel) {
      const rect = closeServicePanel.getBoundingClientRect();
      return { x: rect.right - 70, y: rect.bottom - 35 };
    }

    if (/Closing Balance/i.test(document.body.innerText) && /Print session/i.test(document.body.innerText) && /Close\s*S|Close Service/i.test(document.body.innerText)) {
      return {
        x: document.documentElement.clientWidth * 0.78,
        y: document.documentElement.clientHeight - 45,
      };
    }

    return null;
  });
  expect(coords, 'Close Service button should be clickable').not.toBeNull();
  await window.mouse.click(coords!.x, coords!.y);
}

async function closeVisibleModal(window: Page): Promise<void> {
  const clickedFooterClose = await window.evaluate(() => {
    const modal = Array.from(document.querySelectorAll<HTMLElement>('ion-modal.show-modal, ion-modal, .modal-wrapper'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (!modal) return false;

    const modalRect = modal.getBoundingClientRect();
    const close = Array.from(modal.querySelectorAll<HTMLElement>('ion-button, button, [role="button"], span, div'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const text = (el.innerText ?? el.textContent ?? '').trim();
        return visible
          && /^Close$/i.test(text)
          && rect.top > modalRect.top + modalRect.height * 0.75
          && rect.left > modalRect.left + modalRect.width * 0.65;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    close?.click();
    return !!close;
  });
  if (clickedFooterClose) {
    const hidden = await window.locator('ion-modal, .modal-wrapper').first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (hidden) {
      await closeSideMenu(window);
      return;
    }
  }

  const modal = window.locator('ion-modal.show-modal, ion-modal, .modal-wrapper').first();
  const modalCloseButton = modal.locator('ion-button, button').filter({ hasText: /^Close$/i }).last();
  if (await modalCloseButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await modalCloseButton.click({ timeout: 5_000 });
    const hidden = await window.locator('ion-modal, .modal-wrapper').first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (hidden) {
      await closeSideMenu(window);
      return;
    }
  }

  const dismissed = await window.evaluate(async () => {
    const modal = document.querySelector('ion-modal.show-modal, ion-modal') as any;
    if (modal?.dismiss) {
      await modal.dismiss();
      return true;
    }
    return false;
  }).catch(() => false);
  if (dismissed) {
    const hidden = await window.locator('ion-modal, .modal-wrapper').first()
      .waitFor({ state: 'hidden', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!hidden) {
      await window.evaluate(() => {
        document.querySelectorAll('ion-modal, .modal-wrapper, ion-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
      });
    }
    await expect(window.locator('ion-modal, .modal-wrapper').first()).toBeHidden({ timeout: 5_000 });
    await closeSideMenu(window);
    return;
  }

  const modalCloseCoords = await window.evaluate(() => {
    const modal = Array.from(document.querySelectorAll<HTMLElement>('ion-modal, .modal-wrapper'))
      .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (!modal) return null;

    const modalRect = modal.getBoundingClientRect();
    return { x: modalRect.right - 36, y: modalRect.bottom - 28 };
  });

  if (modalCloseCoords) {
    await window.mouse.click(modalCloseCoords.x, modalCloseCoords.y);
    await expect(window.locator('ion-modal, .modal-wrapper').first()).toBeHidden({ timeout: 10_000 });
  } else {
    const closeButton = window.locator('ion-button, button').filter({ hasText: /^Close$/i }).first();
    if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeButton.click({ timeout: 5_000 });
    } else {
      await window.keyboard.press('Escape');
    }
  }

  await closeSideMenu(window);
}

async function closeServiceFull(window: Page): Promise<void> {
  await clickMenuItem(window, 'Close Service');
  await WarningDialog.dismiss(window, 5_000);
  await waitForText(window, /Close Service/i);
  await WarningDialog.dismiss(window, 2_000);
  await clickCloseServiceButton(window);
  await dismissAllYesConfirms(window);
  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 3_000);
}

// ---------------------------------------------------------------------------
// PrimeroEdge web: toggle HIDECHECKS setting
// ---------------------------------------------------------------------------

async function toggleHideChecks(webPage: Page): Promise<'YES' | 'NO'> {
  await webPage.goto(MANAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Enable "Show Internal Settings" checkbox if not already checked
  const cb = webPage.locator('input[type="checkbox"]').filter({ has: webPage.locator('xpath=following-sibling::*[contains(text(),"Internal")]') }).first();
  const showInternalCb = webPage.locator('input[type="checkbox"]').first();
  if (!await showInternalCb.isChecked().catch(() => false)) {
    await showInternalCb.click();
    await webPage.waitForLoadState('domcontentloaded').catch(() => {});
  }

  // Wait for HIDECHECKS to appear anywhere on page
  await expect(webPage.getByText(/HIDECHECKS/i).first()).toBeVisible({ timeout: 20_000 });

  // Scroll to make sure all rows are rendered
  await webPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await webPage.waitForTimeout(500);
  await webPage.evaluate(() => window.scrollTo(0, 0));
  await webPage.waitForTimeout(300);

  // Debug: find the HIDECHECKS row and inspect it
  const hideChecksDebug = await webPage.evaluate(() => {
    // Try finding by row containing exact code "HIDECHECKS"
    const allTrs = Array.from(document.querySelectorAll<HTMLElement>('tr'));
    const row = allTrs.find(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.some(td => td.innerText?.trim() === 'HIDECHECKS');
    });
    if (!row) {
      // Try any element with HIDECHECKS text
      const el = Array.from(document.querySelectorAll<HTMLElement>('td, span, div'))
        .find(e => e.innerText?.trim() === 'HIDECHECKS');
      return { found: false, contextEl: el?.closest('tr')?.innerText?.substring(0, 200) ?? null };
    }
    const radios = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    return {
      found: true,
      rowText: row.innerText?.replace(/\n/g, '|').substring(0, 200),
      radios: radios.map(r => ({ id: r.id, name: r.name, value: r.value, checked: r.checked, label: r.labels?.[0]?.innerText })),
    };
  });
  console.log('HIDECHECKS DEBUG:', JSON.stringify(hideChecksDebug));

  // Read current value from the HIDECHECKS row
  const currentValue: string = await webPage.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('tr'))
      .find(tr => Array.from(tr.querySelectorAll('td')).some(td => td.innerText?.trim() === 'HIDECHECKS'));
    if (!row) return 'UNKNOWN';
    const radios = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const r of radios) {
      if (r.checked) {
        // Try label text first (more reliable than value attribute)
        const labelText = r.labels?.[0]?.innerText?.trim().toUpperCase()
          ?? r.closest('label')?.innerText?.trim().toUpperCase()
          ?? (r.value || r.id || '').toUpperCase();
        return labelText;
      }
    }
    return 'UNKNOWN';
  });
  console.log('HIDECHECKS currentValue:', currentValue);

  const newValue: 'YES' | 'NO' = currentValue.startsWith('Y') ? 'NO' : 'YES';
  console.log('HIDECHECKS newValue:', newValue);

  // Click the opposite radio using Playwright's locator (more reliable than evaluate click)
  const clicked = await webPage.evaluate((target: string) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('tr'))
      .find(tr => Array.from(tr.querySelectorAll('td')).some(td => td.innerText?.trim() === 'HIDECHECKS'));
    if (!row) return false;
    const radios = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const r of radios) {
      const labelText = r.labels?.[0]?.innerText?.trim().toUpperCase()
        ?? r.closest('label')?.innerText?.trim().toUpperCase()
        ?? (r.value || r.id || '').toUpperCase();
      if (labelText.startsWith(target.charAt(0))) {
        r.click();
        // Also dispatch change event
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // Fallback: click label next to radio
    const labels = Array.from(row.querySelectorAll<HTMLElement>('label'));
    for (const lbl of labels) {
      if (lbl.innerText?.trim().toUpperCase().startsWith(target.charAt(0))) {
        lbl.click();
        return true;
      }
    }
    return false;
  }, newValue);
  console.log('HIDECHECKS click result:', clicked);

  await webPage.waitForTimeout(500);

  // Save settings
  const saveBtn = webPage.locator('input[type="submit"], button').filter({ hasText: /Save Settings?/i }).first();
  await expect(saveBtn).toBeVisible({ timeout: 10_000 });
  await saveBtn.click();
  await webPage.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await expect(webPage.getByText(/Settings? saved successfully/i).first()).toBeVisible({ timeout: 30_000 });
  console.log('HIDECHECKS: Settings saved successfully');

  return newValue;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Close Service', () => {
  test('close service: cancel, checks/cards verification, low balance dialog, and HIDECHECKS toggle', async () => {
    // ── Phase 1: EP session ──────────────────────────────────────────────────
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      let window = await openService(handle.window, handle);

      // Record a transaction so closing balance can differ from opening
      await recordTransaction(window);

      // Navigate to Close Service with a low closing balance
      await navigateToCloseService(window);
      await enterClosingBalance(window, CLOSING_BALANCE_AMOUNT);

      // Debug: what's on the Close Service screen?
      const closeServiceText = await window.evaluate(() => document.body.innerText.substring(0, 400));
      console.log('CLOSE SERVICE SCREEN:', closeServiceText);

      // Verify Cancel button (text varies — "Cancel", "CANCEL", back arrow, etc.)
      const cancelBtn = window.locator('ion-button, button, ion-item').filter({ hasText: /cancel|back/i }).first();
      await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
      await cancelBtn.click();
      await waitForText(window, /Serving Options|Open Service|Continue Service/i, 15_000);

      // Re-enter Close Service
      await navigateToCloseService(window);

      // Detect which variant of checks/cards is shown
      const hasManageChecks = await window
        .locator('ion-item, ion-button, button, a, ion-label, span')
        .filter({ hasText: /View & Manage Checks/i })
        .first()
        .isVisible({ timeout: 6_000 })
        .catch(() => false);

      const initialVariant: 'manage' | 'view' = hasManageChecks ? 'manage' : 'view';

      if (initialVariant === 'manage') {
        // Clicking "View & Manage Checks/Cards" opens a MODAL overlay (not a new page).
        // Both the modal content and the underlying Close Service page are in body.innerText.
        // We identify the modal opened by waiting for unique modal content ("Check #" / "Card #").

        async function openManageModal(type: 'Checks' | 'Cards'): Promise<void> {
          const regex = type === 'Checks' ? /View & Manage Checks/i : /View & Manage Cards/i;
          const confirmText = type === 'Checks' ? /Check\s*#|Check Number/i : /Card\s*#|Card Number/i;

          const el = window.locator('ion-item, ion-button, button, a, ion-label, span')
            .filter({ hasText: regex })
            .first();
          await expect(el).toBeVisible({ timeout: 10_000 });

          // Walk to ion-item ancestor and click it (triggers modal via Ionic)
          await el.evaluate((node: HTMLElement) => {
            let target: HTMLElement | null = node;
            while (target && target.tagName !== 'ION-ITEM' && target !== document.body) {
              target = target.parentElement as HTMLElement | null;
            }
            ((target && target !== document.body) ? target : node).click();
          });

          // Wait for modal content to appear (unique to the modal)
          await waitForText(window, confirmText, 10_000);

          console.log(`${type.toUpperCase()} MODAL:`, await window.evaluate(() => document.body.innerText.substring(0, 400)));
        }

        async function closeManageModal(): Promise<void> {
          await closeVisibleModal(window);
          return;
          const modalCloseCoords = await window.evaluate(() => {
            const modal = Array.from(document.querySelectorAll<HTMLElement>('ion-modal, .modal-wrapper'))
              .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
            if (!modal) return null;

            const modalRect = modal.getBoundingClientRect();
            return { x: modalRect.right - 36, y: modalRect.bottom - 28 };
          });

          if (modalCloseCoords) await window.mouse.click(modalCloseCoords!.x, modalCloseCoords!.y);
          else await window.keyboard.press('Escape');

          await expect(window.locator('ion-modal, .modal-wrapper').first()).toBeHidden({ timeout: 10_000 });
          await closeSideMenu(window);
          return;
          // Modal has a "Close" button (exact text) — distinct from "Close Service"
          const closeBtn = window.locator('ion-button, button').filter({ hasText: /^Close$/i }).first();
          if (await closeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await closeBtn.click();
          } else {
            // Try ion-back-button or Escape
            const ionBack = window.locator('ion-back-button').first();
            if (await ionBack.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await ionBack.click();
            } else {
              await window.keyboard.press('Escape');
            }
          }
          // Wait for modal to dismiss (unique modal content disappears)
          await expect(
            window.locator('ion-button, button').filter({ hasText: /^Close$/i }).first()
          ).toBeHidden({ timeout: 10_000 });
        }

        // ── Checks modal ──────────────────────────────────────────────────────
        await openManageModal('Checks');

        // Verify + icon (add check button)
        const addBtns = await window.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, ion-fab-button'))
            .filter(el => !!(el.offsetWidth || el.offsetHeight))
            .map(el => ({
              icons: Array.from(el.querySelectorAll('ion-icon')).map(i => i.getAttribute('name')),
              text: el.innerText?.substring(0, 20),
            }))
        );
        console.log('BUTTONS IN CHECKS MODAL:', JSON.stringify(addBtns));

        await expect(
          window.locator('ion-button, button, ion-fab-button').filter({
            has: window.locator('ion-icon[name*="add"]'),
          }).first(),
        ).toBeVisible({ timeout: 10_000 });

        await closeManageModal();
        await waitForText(window, /View & Manage Cards/i, 10_000);

        // ── Cards modal ───────────────────────────────────────────────────────
        await openManageModal('Cards');

        await expect(
          window.locator('ion-button, button, ion-fab-button').filter({
            has: window.locator('ion-icon[name*="add"]'),
          }).first(),
        ).toBeVisible({ timeout: 10_000 });

        await closeManageModal();
        await waitForText(window, /Close Service/i, 10_000);
      } else {
        // View Check / View Card variant — verify screens load
        const viewCheck = window.locator('ion-item, ion-button, button, a, ion-label')
          .filter({ hasText: /View Check/i }).first();
        if (await viewCheck.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await viewCheck.evaluate((el: HTMLElement) => el.click());
          await waitForText(window, /Check/i, 10_000);
          await closeVisibleModal(window);
          await waitForText(window, /Close Service/i, 10_000);
        }
        const viewCard = window.locator('ion-item, ion-button, button, a, ion-label')
          .filter({ hasText: /View Card/i }).first();
        if (await viewCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await viewCard.evaluate((el: HTMLElement) => el.click());
          await waitForText(window, /Card/i, 10_000);
          await closeVisibleModal(window);
          await waitForText(window, /Close Service/i, 10_000);
        }
      }

      // Enter low closing balance and click Close Service
      await enterClosingBalance(window, CLOSING_BALANCE_AMOUNT);
      await clickCloseServiceButton(window);

      // Verify low-balance confirmation dialog
      await waitForText(
        window,
        /closing balance is less than your starting balance|Are you sure you want to continue/i,
        15_000,
      );

      // Click No → stay on Close Service
      const noBtn = window.locator('ion-alert button, .alert-button').filter({ hasText: /^No$/i }).first();
      await expect(noBtn).toBeVisible({ timeout: 10_000 });
      await noBtn.click();
      await waitForText(window, /Close Service/i, 10_000);

      // Click Close Service again → Yes → service closes
      await clickCloseServiceButton(window);
      await waitForText(
        window,
        /closing balance is less than your starting balance|Are you sure you want to continue/i,
        15_000,
      );
      const yesBtn = window.locator('ion-alert button, .alert-button').filter({ hasText: /^Yes$/i }).first();
      await expect(yesBtn).toBeVisible({ timeout: 10_000 });
      await yesBtn.click();
      await waitForLoadingOverlay(window);
      await waitForText(window, /Open Service|Serving Options/i, 30_000);

      // ── Phase 2: PrimeroEdge web — toggle HIDECHECKS ──────────────────────
      const webBrowser = await chromium.launch({ headless: false });
      const webContext = await webBrowser.newContext();
      const webPage = await webContext.newPage();
      await loginToPrimeroEdgeQa(webPage);
      const newHideChecksValue = await toggleHideChecks(webPage);
      await webBrowser.close();

      // ── Phase 3: EP — verify new variant after setting change ─────────────
      await closeExpressPoint(handle);
      const handle2 = await launchExpressPoint();
      try {
        const window2 = handle2.window;
        await login(window2);
        let epWindow = await openService(window2, handle2);

        await navigateToCloseService(epWindow);

        // Debug: see what text is on the Close Service screen after the toggle
        const phase3Text = await epWindow.evaluate(() => document.body.innerText.substring(0, 800));
        console.log('PHASE 3 CLOSE SERVICE (newHideChecks=' + newHideChecksValue + '):', phase3Text);

        if (newHideChecksValue === 'NO') {
          // Toggled to NO → should now show "View & Manage" variant
          await expect(
            epWindow.locator('ion-item, ion-button, button, a, ion-label, span')
              .filter({ hasText: /View & Manage Checks/i }).first(),
          ).toBeVisible({ timeout: 20_000 });
          await expect(
            epWindow.locator('ion-item, ion-button, button, a, ion-label, span')
              .filter({ hasText: /View & Manage Cards/i }).first(),
          ).toBeVisible({ timeout: 10_000 });
        } else {
          // Toggled to YES → should now show "View Check" / "View Card" variant
          // EP might need a moment to apply the new HIDECHECKS setting after relaunch
          await expect.poll(async () => {
            const text = await epWindow.evaluate(() => document.body.innerText);
            console.log('POLLING PHASE 3 TEXT snippet:', text.substring(0, 200));
            // Check for any form of "View Check" or "View Card" (but NOT "View & Manage")
            return /View\s+Check(?!s?\s*totaling)/i.test(text) || /View\s+Card(?!s?\s*totaling)/i.test(text);
          }, { timeout: 30_000 }).toBe(true);
        }

        // Clean up — close the service
        await closeServiceFull(epWindow);
      } finally {
        await closeExpressPoint(handle2);
      }
    } finally {
      await closeExpressPoint(handle).catch(() => {});
    }
  });
});
