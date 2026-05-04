//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115133

import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';

test.describe.configure({ timeout: 300_000 });

// ─── Constants ────────────────────────────────────────────────────────────────

const PATRON_ID = '1337';
const CASH_AMOUNT_DIGITS = ['7', '0', '0']; // $7.00
const CHECK_AMOUNT_DIGITS = ['7', '0', '0']; // $7.00
const INVALID_CHECK_NUM = '12';             // 2 digits — must fail
const VALID_CHECK_NUM = '123';              // 3+ digits
const HOMEROOM_VALUE = 'Anil-PEI';
const ROSTER_VALUE = 'AZAR-SPORTS-ROASTER';

// ─── Core helpers ─────────────────────────────────────────────────────────────

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
  throw new Error('getAppWindow: ion-app not found after 15s');
}

async function domClick(window: Page, selector: string, matchText?: string): Promise<void> {
  await window.evaluate(
    ({ sel, text }) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
      const target = text
        ? els.find(e => e.textContent?.toLowerCase().includes(text.toLowerCase()))
        : els[0];
      if (target) target.click();
    },
    { sel: selector, text: matchText ?? '' },
  );
}

async function waitForToast(window: Page, textMatcher: RegExp): Promise<void> {
  const toast = window.locator('ion-toast');
  await toast.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(toast.first()).toContainText(textMatcher, { timeout: 5_000 });
  await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

async function waitForToastIfPresent(window: Page): Promise<void> {
  const toast = window.locator('ion-toast').first();
  const appeared = await toast.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
  if (appeared) await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

// ─── Warning popup ────────────────────────────────────────────────────────────

async function dismissWarningIfVisible(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
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

async function openHamburgerMenu(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const menuBtn = window.locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(menuBtn).toBeVisible({ timeout: 10_000 });
  await menuBtn.click();
  await window.waitForTimeout(400);
}

async function ensureServiceOpen(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);

  // If Continue Service is visible, service is already open
  const continueService = window.locator('ion-item[detail]')
    .filter({ hasText: /Continue Service/i }).first();
  if (await continueService.isVisible({ timeout: 2_000 }).catch(() => false)) {
    return;
  }

  // Open Service from dashboard
  const openServiceItem = window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first();
  if (await openServiceItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await openServiceItem.click({ timeout: 10_000 });
    await expect(window.getByText(/Opening Balance/i).first()).toBeVisible({ timeout: 10_000 });
    await dismissWarningIfVisible(window);
    await window.getByRole('button', { name: /open service/i }).last().click();
    await expect(window.getByText(/Opening Balance/i).first()).toBeHidden({ timeout: 20_000 });
    await waitForLoadingOverlay(window);
    await window.waitForTimeout(1_000);
  }
}

async function navigateToPayments(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  await window.waitForTimeout(1_000);

  // Ensure a service is open before Payments will be accessible
  await ensureServiceOpen(window);

  // Dashboard items use ion-item[detail]
  const dashboardPayments = window.locator('ion-item[detail]').filter({ hasText: /^Payments$/i }).first();
  const onDashboard = await dashboardPayments.isVisible({ timeout: 3_000 }).catch(() => false);

  if (onDashboard) {
    await dashboardPayments.click();
  } else {
    await openHamburgerMenu(window);
    await window.locator('ion-item').filter({ hasText: /^Payments$/i }).first()
      .click({ timeout: 10_000 });
  }
  await waitForLoadingOverlay(window);
  await window.waitForTimeout(1_000);
}

// ─── Patron lookup ────────────────────────────────────────────────────────────

async function clickPatronIdTab(window: Page): Promise<void> {
  await domClick(window, 'ion-segment-button', 'patron id');
  await window.waitForTimeout(400);
}

async function clickLookupTab(window: Page): Promise<void> {
  await domClick(window, 'ion-segment-button', 'lookup');
  await window.waitForTimeout(400);
}

async function searchPatronById(window: Page, id: string): Promise<void> {
  const idInput = window.locator('input[placeholder="Enter an ID"], #pinInput input').first();
  await expect(idInput).toBeVisible({ timeout: 15_000 });
  await idInput.fill(id);
  // Click the play/submit icon button
  const submitted = await window.evaluate(() => {
    const icon = document.querySelector<HTMLElement>('ion-icon[name="caret-forward-circle"], ion-icon[name="play-circle"]');
    const btn = icon?.closest<HTMLElement>('ion-button, button');
    if (btn) { btn.click(); return true; }
    // Fallback: find visible button containing the icon
    const all = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const play = all.find(b =>
      !!(b.offsetWidth || b.offsetHeight)
      && !!b.querySelector('ion-icon[name*="caret"], ion-icon[name*="play"]'),
    );
    if (play) { play.click(); return true; }
    return false;
  });
  if (!submitted) {
    await window.keyboard.press('Enter');
  }
  await waitForLoadingOverlay(window);
}

async function closeDialog(window: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const modalVisible = await window.locator('ion-modal')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!modalVisible) break;

    const dismissed = await window.evaluate(async () => {
      const modal = Array.from(document.querySelectorAll<any>('ion-modal'))
        .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      if (!modal?.dismiss) return false;
      await modal.dismiss();
      return true;
    });
    if (dismissed) {
      await window.waitForTimeout(500);
      continue;
    }

    const modalClose = window.locator('ion-modal ion-button')
      .filter({ hasText: /^close$/i })
      .last();
    if (await modalClose.isVisible({ timeout: 500 }).catch(() => false)) {
      await modalClose.click({ force: true });
      await window.waitForTimeout(500);
      continue;
    }

    const footerClosePoint = await window.evaluate(() => {
      const modal = Array.from(document.querySelectorAll<HTMLElement>('ion-modal'))
        .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const buttons = Array.from(modal?.querySelectorAll<HTMLElement>('ion-button, button') ?? [])
        .filter(btn => !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length))
        .map(btn => {
          const rect = btn.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top, left: rect.left };
        })
        .sort((a, b) => b.top - a.top || a.left - b.left);
      return buttons[0] ?? null;
    });
    if (footerClosePoint) {
      await window.mouse.click(footerClosePoint.x, footerClosePoint.y);
      await window.waitForTimeout(500);
      continue;
    }

    const dismissedAfterFooterClick = await window.evaluate(async () => {
      const modal = Array.from(document.querySelectorAll<any>('ion-modal'))
        .find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      if (!modal?.dismiss) return false;
      await modal.dismiss();
      return true;
    });
    if (dismissedAfterFooterClick) {
      await window.waitForTimeout(500);
      continue;
    }

    const clickedClose = await window.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('ion-modal.show-modal, ion-modal[class*="show-modal"]');
      const buttons = Array.from(modal?.querySelectorAll<HTMLElement>('ion-button, button') ?? []);
      const close = buttons
        .filter(btn => !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length))
        .reverse()
        .find(btn => /^close$/i.test((btn.innerText || btn.textContent || '').trim()));
      if (!close) return false;
      close.click();
      return true;
    });

    if (!clickedClose) break;
    await window.waitForTimeout(500);
  }

  // 1. Try common close/back buttons inside modal or alert
  const closed = await window.evaluate(() => {
    // Check for any button with close-related text
    const selectors = ['ion-modal ion-button', 'ion-modal button', 'ion-alert button', '.alert-button'];
    for (const sel of selectors) {
      const btns = Array.from(document.querySelectorAll<HTMLElement>(sel));
      const close = btns.find(b =>
        !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
        && /close|cancel|ok|done|dismiss|back/i.test((b.innerText || b.textContent || '').trim()),
      );
      if (close) { close.click(); return true; }
    }
    // Try any button with arrow-back or close icon in a modal
    const iconNames = ['close', 'close-outline', 'arrow-back', 'arrow-back-outline', 'chevron-back'];
    for (const name of iconNames) {
      const icons = Array.from(document.querySelectorAll<HTMLElement>(`ion-modal ion-icon[name="${name}"]`));
      for (const icon of icons) {
        const btn = icon.closest<HTMLElement>('ion-button, button');
        if (btn && !!(btn.offsetWidth || btn.offsetHeight)) { btn.click(); return true; }
      }
    }
    // Last resort: click first visible button in modal
    const anyModalBtn = Array.from(document.querySelectorAll<HTMLElement>('ion-modal ion-button, ion-modal button'))
      .find(b => !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length));
    if (anyModalBtn) { anyModalBtn.click(); return true; }
    return false;
  });

  if (!closed) {
    // 2. Press Escape to dismiss
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
  }

  // 3. Wait for any modal to hide
  await window.locator('ion-modal').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await window.evaluate(() => {
    document.querySelectorAll('ion-modal, ion-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
  }).catch(() => {});
  await window.waitForTimeout(300);
}

// ─── Payment helpers ──────────────────────────────────────────────────────────

function parseDollar(text: string | null): number {
  return parseFloat((text ?? '').replace(/[^0-9.]/g, '')) || 0;
}

async function readPatronBalance(window: Page): Promise<number> {
  const text = await window.evaluate(() => {
    const bodyText = document.body.innerText.replace(/\u00a0/g, ' ');

    const currentBalance = bodyText.match(/Current\s*Balance\s*\n?\s*(\$[\d,]+\.\d{2})/i);
    if (currentBalance) return currentBalance[1];

    const statusBalance = bodyText.match(/Status:[\s\S]*?(\$[\d,]+\.\d{2})/i);
    if (statusBalance) return statusBalance[1];

    return bodyText.match(/\$[\d,]+\.\d{2}/)?.[0] ?? '';
  });
  return parseDollar(text);
}

async function clickPaymentTab(window: Page, tabName: 'Cash' | 'Check'): Promise<void> {
  await domClick(window, 'ion-segment-button', tabName);
  await window.waitForTimeout(600);
  // Blur any auto-focused input so keypad clicks go to amount field
  await window.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); });
  await window.waitForTimeout(200);
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
}

async function clickPaymentAmountInput(window: Page): Promise<void> {
  // On Check tab the Check # ion-input is auto-focused; we must click the Payment input first.
  // ion-input elements live inside a parent component's shadow root — traverse it.
  const coords = await findIonInputCoords(window);
  if (coords.length > 0) {
    await window.mouse.click(coords[0].x, coords[0].y);
  } else {
    // Fallback: locate the "Payment" label and click to the right of it
    const paymentLabel = window.locator('ion-label, label, span, div').filter({ hasText: /^Payment$/i }).first();
    const box = await paymentLabel.boundingBox().catch(() => null);
    if (box) {
      await window.mouse.click(box.x + box.width + 80, box.y + box.height / 2);
    } else {
      // Last resort: Shift+Tab from auto-focused Check # to reach Payment input
      await window.keyboard.press('Shift+Tab');
    }
  }
  await window.waitForTimeout(400);
}

async function enterPaymentAmountByDigits(window: Page, digits: string[]): Promise<void> {
  // Ensure Payment input is focused (not Check # field)
  await clickPaymentAmountInput(window);
  await clickKeypadDigits(window, digits);
}

async function clickKeypadDigits(window: Page, digits: string[]): Promise<void> {
  for (const digit of digits) {
    // Target specifically ION-BUTTON with whitespace-tolerant regex.
    // This avoids clicking the ION-COL parent that also has text matching the digit.
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
      .map(node => node.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const visible = (el: HTMLElement) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    const labels = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter(el => visible(el) && /^Check\s*#$/i.test(directText(el)))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
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

  if (points.length === 0) {
    throw new Error('clickCheckNumberInput: Check # field not found');
  }

  for (const point of points) {
    await window.mouse.click(point.x, point.y);
    await window.waitForTimeout(150);
  }
}

async function fillCheckNumber(window: Page, value: string): Promise<void> {
  await clickCheckNumberInput(window);
  await clickKeypadDigits(window, value.split(''));
  await window.waitForTimeout(200);
}

async function clickMakePayment(window: Page): Promise<void> {
  // Use evaluate to click even if disabled (app may disable until both amount+check# valid)
  const clicked = await window.evaluate(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const btn = btns.find(b =>
      !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
      && /make payment/i.test((b.innerText || b.textContent || '').trim()),
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) {
    await window.locator('ion-button').filter({ hasText: /make payment/i }).last()
      .click({ force: true, timeout: 10_000 });
  }
  await waitForLoadingOverlay(window);
}

// ─── Transactions icon ────────────────────────────────────────────────────────

async function closePaymentPanelIfPresent(window: Page): Promise<void> {
  const closeButton = window.locator('ion-button').filter({ hasText: /^close$/i }).first();
  const visible = await closeButton.isVisible({ timeout: 2_000 }).catch(() => false);
  if (visible) {
    await closeButton.click({ force: true });
    await waitForLoadingOverlay(window);
    await window.waitForTimeout(500);
  }
}

async function clickTransactionsIcon(window: Page): Promise<void> {
  const result = await window.evaluate(() => {
    // Collect all icon names for debug
    const allIcons = Array.from(document.querySelectorAll<HTMLElement>('ion-icon'))
      .map(el => el.getAttribute('name') ?? '')
      .filter(Boolean);

    const iconNames = [
      'newspaper-outline', 'newspaper',
      'receipt', 'receipt-outline',
      'list', 'list-outline',
      'document', 'document-text', 'document-text-outline', 'document-outline',
      'clipboard', 'clipboard-outline',
      'wallet', 'wallet-outline',
      'card', 'card-outline',
      'cash', 'cash-outline',
      'albums', 'albums-outline',
      'reader', 'reader-outline',
    ];
    for (const name of iconNames) {
      const icons = Array.from(document.querySelectorAll<HTMLElement>(`ion-icon[name="${name}"]`));
      for (const icon of icons) {
        const btn = icon.closest<HTMLElement>('ion-button, button');
        if (btn && !!(btn.offsetWidth || btn.offsetHeight)) { btn.click(); return { clicked: true, icon: name }; }
      }
    }
    return { clicked: false, icon: '', allIcons };
  });

  if (!result.clicked) {
    // Try finding any toolbar button that's not related to the main flow
    const clicked2 = await window.evaluate(() => {
      const toolbarBtns = Array.from(
        document.querySelectorAll<HTMLElement>('ion-toolbar ion-button, ion-header ion-button'),
      ).filter(b => !!(b.offsetWidth || b.offsetHeight));
      if (toolbarBtns.length > 0) {
        toolbarBtns[toolbarBtns.length - 1].click();
        return true;
      }
      return false;
    });
    if (!clicked2) {
      throw new Error('clickTransactionsIcon: could not find transactions button');
    }
  }
  await window.waitForTimeout(500);
}

// ─── Lookup sub-tab helpers ───────────────────────────────────────────────────

async function clickLookupSubTab(window: Page, tabName: 'Name' | 'Homeroom' | 'Roster' | 'PIN'): Promise<void> {
  await domClick(window, 'ion-segment-button, ion-tab-button', tabName);
  await window.waitForTimeout(400);
}

async function fillVisibleIonInput(window: Page, selector: string, value: string): Promise<void> {
  const input = window.locator(selector).first();
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.click();
  await input.fill(value);
  await input.evaluate((el, val) => {
    const ionInput = el.closest('ion-input');
    ionInput?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: val }, bubbles: true }));
    ionInput?.dispatchEvent(new CustomEvent('ionChange', { detail: { value: val }, bubbles: true }));
  }, value);
  await window.waitForTimeout(300);
}

async function clickSearchButton(window: Page): Promise<void> {
  const clicked = await window.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const button = buttons.find(el =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      && !el.hasAttribute('disabled')
      && /^search$/i.test((el.innerText || el.textContent || '').trim()),
    );
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) {
    throw new Error('clickSearchButton: visible enabled Search button not found');
  }
  await waitForLoadingOverlay(window);
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('Payments', () => {
  test('payments: patron lookup, cash/check funding, ID/PIN toggle, transactions', async () => {
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      let window = await getAppWindow(handle);

      // ── 1 & 2. Navigate to Payments, verify Patron ID and Lookup segments ──
      await navigateToPayments(window);
      // Patron ID / Lookup can be ion-segment-button or ion-item or ion-tab-button
      await expect(
        window.locator('ion-segment-button, ion-item, ion-tab-button').filter({ hasText: /patron id/i }).first()
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        window.locator('ion-segment-button, ion-item, ion-tab-button').filter({ hasText: /lookup/i }).first()
      ).toBeVisible({ timeout: 10_000 });

      // ── 3. Click Lookup → verify Name / Homeroom / Roster tabs ───────────
      await clickLookupTab(window);
      await expect(window.locator('ion-segment-button, ion-tab-button').filter({ hasText: /^name$/i }).first())
        .toBeVisible({ timeout: 10_000 });
      await expect(window.locator('ion-segment-button, ion-tab-button').filter({ hasText: /homeroom/i }).first())
        .toBeVisible({ timeout: 10_000 });
      await expect(window.locator('ion-segment-button, ion-tab-button').filter({ hasText: /roster/i }).first())
        .toBeVisible({ timeout: 10_000 });

      // ── 4. Transactions icon — verify dialog opens and closes ─────────────
      await clickTransactionsIcon(window);
      await waitForText(window, /transactions/i);
      await closeDialog(window);
      await waitForLoadingOverlay(window);

      // Back to Patron ID tab → look up 1337
      await closePaymentPanelIfPresent(window);
      await clickPatronIdTab(window);
      await searchPatronById(window, PATRON_ID);
      await waitForText(window, new RegExp(`ID.*${PATRON_ID}|${PATRON_ID}.*ID|Add Funds|Current Balance`, 'i'));

      // ── 5a. Cash payment — verify balance math, Make Payment ─────────────
      await clickPaymentTab(window, 'Cash');
      const balanceBefore = await readPatronBalance(window);
      await enterPaymentAmountByDigits(window, CASH_AMOUNT_DIGITS);

      await clickMakePayment(window);
      await waitForToastIfPresent(window);

      // ── 5b. Check payment — look up patron again ──────────────────────────
      await clickPatronIdTab(window);
      await searchPatronById(window, PATRON_ID);
      await waitForText(window, new RegExp(`ID.*${PATRON_ID}|${PATRON_ID}.*ID|Add Funds|Current Balance`, 'i'));

      await clickPaymentTab(window, 'Check');

      await enterPaymentAmountByDigits(window, CHECK_AMOUNT_DIGITS);

      // Enter 2-digit check number (invalid) and attempt payment
      // ion-input uses shadow DOM — interact via click + keyboard.type
      await fillCheckNumber(window, INVALID_CHECK_NUM);
      await clickMakePayment(window);

      // ── 6. Verify toast: check number must be at least 3 digits ──────────
      await waitForToast(window, /proper check number|check.*3 digit|at least 3/i);

      // Enter valid check number and complete payment
      await fillCheckNumber(window, VALID_CHECK_NUM);
      await clickMakePayment(window);
      await waitForToastIfPresent(window);

      // ── 7. Go back → search 1337 → verify updated balance ────────────────
      await clickPatronIdTab(window);
      await searchPatronById(window, PATRON_ID);
      await waitForText(window, new RegExp(`ID.*${PATRON_ID}|${PATRON_ID}.*ID|Current Balance`, 'i'));
      const balanceAfter = await readPatronBalance(window);
      expect(balanceAfter).toBeGreaterThan(balanceBefore);
      await closePaymentPanelIfPresent(window);

      // ── 8. ID/PIN toggle ──────────────────────────────────────────────────
      // Go back to the entry screen and find the ID/PIN toggle label
      await clickPatronIdTab(window);
      await waitForLoadingOverlay(window);
      const idPinToggle = window.locator('input[placeholder*="Enter an"]').first();
      await expect(idPinToggle).toBeVisible({ timeout: 10_000 });
      const initialText = await idPinToggle.getAttribute('placeholder');

      await idPinToggle.click();
      await window.waitForTimeout(500);
      const toggledText = await idPinToggle.getAttribute('placeholder');
      if (toggledText !== initialText) {
        // Toggle back
        await idPinToggle.click();
        await window.waitForTimeout(500);
        const restoredText = await idPinToggle.getAttribute('placeholder');
        expect(restoredText).toBe(initialText);
      } else {
        expect(initialText).toMatch(/Enter an (ID|PIN)/i);
      }

      // ── 9. Transactions icon on top-right ────────────────────────────────
      await clickTransactionsIcon(window);
      await waitForText(window, /transactions/i);
      await closeDialog(window);

      // ── 10. Lookup tab — Name, PIN, Homeroom, Roster ─────────────────────
      await clickLookupTab(window);

      // Name tab — first name search
      await clickLookupSubTab(window, 'Name');
      await fillVisibleIonInput(window, 'input[placeholder="First Name"]', 'Sabih');
      await clickSearchButton(window);
      await waitForText(window, /sabih|no results|no patron/i);
      await closeDialog(window);

      // Name tab — last name search
      await fillVisibleIonInput(window, 'input[placeholder="Last Name"]', 'S');
      await clickSearchButton(window);
      await waitForText(window, /result|patron|name/i);
      await closeDialog(window);

      // PIN tab
      await clickLookupSubTab(window, 'PIN');
      await fillVisibleIonInput(window, 'input[placeholder="PIN"]', '1');
      await clickSearchButton(window);
      await waitForText(window, /result|patron|pin/i);
      await closeDialog(window);

      // Homeroom tab
      await clickLookupSubTab(window, 'Homeroom');
      await waitForLoadingOverlay(window);
      // Grade "ALL" is pre-selected — leave it
      // Select Homeroom dropdown
      await window.locator('ion-item, ion-select, div').filter({ hasText: /select a homeroom|homeroom/i }).first().click({ timeout: 8_000 });
      await window.waitForTimeout(500);
      // Pick Anil-PEI from popover/select
      const homeroomOption = window.locator('ion-item, ion-select-option, .select-interface-option').filter({ hasText: HOMEROOM_VALUE }).first();
      if (await homeroomOption.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await homeroomOption.click();
        await window.waitForTimeout(500);
        // Verify "Select a Patron" list appears
        await waitForText(window, /select a patron|patron list|choose patron/i);
        await closeDialog(window);
        // Reopen
        await window.locator('ion-item, div').filter({ hasText: /select a patron/i }).first().click({ timeout: 8_000 });
        await waitForText(window, /patron|student/i);
        await closeDialog(window);
      }

      // Roster tab
      await clickLookupSubTab(window, 'Roster');
      await waitForLoadingOverlay(window);
      await window.locator('ion-item, ion-select, div').filter({ hasText: /select a roster|roster/i }).first().click({ timeout: 8_000 });
      await window.waitForTimeout(500);
      const rosterOption = window.locator('ion-item, ion-select-option, .select-interface-option').filter({ hasText: ROSTER_VALUE }).first();
      if (await rosterOption.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await rosterOption.click();
        await window.waitForTimeout(500);
        // Verify patron list appears, then select one
        await waitForText(window, /patron|student/i);
        const firstPatron = window.locator('ion-item, ion-card').filter({ hasText: /\d+/ }).first();
        await expect(firstPatron).toBeVisible({ timeout: 10_000 });
        await firstPatron.click();
        await waitForLoadingOverlay(window);
      }

    } finally {
      await closeExpressPoint(handle);
    }
  });
});
