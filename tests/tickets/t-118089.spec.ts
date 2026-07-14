// Test Link (PBI): https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_workitems/edit/118089
// ExpressPoint > Planned Entrees quick a la carte.
//
// Feature (PBI 118089): a LONG PRESS (> 600 ms) of a planned-entree button
// quick-adds that button's LINKED Menu Item as an a la carte purchase, with a
// flashing-border animation on the button and the new cart line. A normal single
// press keeps its existing behaviour (adds the entree itself; a second add raises
// the "This is a second meal, do you want to continue?" confirm).
//
// Verified live at Site 103 BLUEFIELD ELEMENTRY SCHOOL_child care: long-pressing
// "Beef Stew" adds the linked item "Yemek - .01c" to the cart.
//
// Web preconditions (already ON in BLUEFIELD QA — see T-118089.txt on Desktop):
//   - DYNMENU = Yes (System > Manage Settings)
//   - Enable Dynamic Menus(Site) = "Planned Entrees Only" on the site (POS section)
//
// Non-destructive: the transaction is never charged; cleanup closes the app.

import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { dismissAllYesConfirms } from '../../utils/service';
import { ensureMealTypeSelected, dismissOpenPopovers } from '../../utils/serving';

test.describe.configure({ timeout: 300_000 });

const ENTREE = /Beef Stew/i;      // planned-entree button under test
const LINKED = /Yemek/i;          // its linked a la carte item (observed: "Yemek - .01c")

// ─── Core DOM helpers (mirrored from open_service.spec.ts) ─────────────────────

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
    for (const page of context.pages().filter(p => !p.isClosed())) {
      const isApp = await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false);
      if (isApp) return page;
    }
    await new Promise(r => setTimeout(r, 500));
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
  const menuItem = window.locator('ion-item').filter({ hasText: new RegExp(label, 'i') }).first();
  if (!await menuItem.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await clickMenuButton(window);
  }
  await expect(menuItem).toBeVisible({ timeout: 10_000 });
  await menuItem.click({ timeout: 15_000 });
  await WarningDialog.dismiss(window, 3_000);
}

async function clickDashboardItem(window: Page, label: string): Promise<void> {
  await waitForLoadingOverlay(window);
  const item = window
    .locator('ion-router-outlet .ion-page:not(.ion-page-hidden) ion-item[detail]')
    .filter({ hasText: new RegExp(label, 'i') })
    .first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click({ timeout: 15_000 });
  await WarningDialog.dismiss(window, 3_000);
}

async function clickVisibleIconButton(window: Page, iconName: string): Promise<void> {
  const clicked = await window.evaluate((name: string) => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('ion-button'));
    const button = buttons.find(el =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      && !!el.querySelector(`ion-icon[name="${name}"]`));
    button?.click();
    return !!button;
  }, iconName);
  expect(clicked).toBe(true);
}

// ─── Login + open service (mirrored from open_service.spec.ts) ─────────────────

async function login(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window);
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
  if (await input.inputValue() !== amount) await input.fill(amount);
  await expect.poll(() => input.inputValue(), { timeout: 5_000 }).toBe(amount);
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

async function enterServiceOrOpenFresh(window: Page, handle: ExpressPointHandle): Promise<Page> {
  await WarningDialog.dismiss(window, 2_000);
  const continueService = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueService.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await closeOpenService(window);
    await waitForLoadingOverlay(window);
    await WarningDialog.dismiss(window, 2_000);
  }
  const openItem = window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first();
  await expect(openItem).toBeVisible({ timeout: 20_000 });

  await openOpeningBalance(window);
  await waitForText(window, /Opening Balance/i);
  await expect(window.getByRole('button', { name: /cancel/i }).last()).toBeVisible();
  await fillOpeningAccountBalance(window, '1');
  await cancelOpeningBalance(window);

  await openOpeningBalance(window);
  await fillOpeningAccountBalance(window, '1');
  await waitForText(window, /Bills/i);
  await confirmOpenService(window);

  return await getAppWindow(handle);
}

// ─── Cart + long-press helpers ─────────────────────────────────────────────────

type CartItem = { name: string; qty: number; amount: string };
type Cart = { itemCount: number | null; items: CartItem[]; text: string };

/** Read the right-hand cart panel: Item Count + each (name, qty, $amount) row.
 * Parses the body-text region between "Item Count (N)" and "Total Amount Due"
 * so the grid buttons (which precede it and also read "Beef Stew"/"Yemek") are
 * excluded. body.innerText is deterministic here where element-scoping was flaky. */
async function readCart(window: Page): Promise<Cart> {
  return await window.evaluate(() => {
    const body = document.body.innerText || '';
    const m = body.match(/Item Count\s*\((\d+)\)/i);
    const start = body.search(/Item Count\s*\(\d+\)/i);
    const end = body.search(/Total Amount Due/i);
    const region = (start >= 0 && end > start) ? body.slice(start, end) : '';
    const lines = region.split('\n').map(s => s.trim()).filter(Boolean);
    const items: { name: string; qty: number; amount: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (/^\d+$/.test(lines[i]) && /^\$/.test(lines[i + 1] || '')) {
        items.push({ name: lines[i - 1], qty: Number(lines[i]), amount: lines[i + 1] });
      }
    }
    return { itemCount: m ? Number(m[1]) : null, items, text: region.slice(0, 1000) };
  });
}

/** Total quantity across cart lines whose name matches `re`. */
function qtyOf(cart: Cart, re: RegExp): number {
  return cart.items.filter(i => re.test(i.name)).reduce((s, i) => s + i.qty, 0);
}

/** Real long-press: mouse down on the button center, hold > 600 ms, release.
 * Samples the button's border color across the hold so the flashing-border
 * animation ("blue border line") can be detected despite being transient. */
async function longPress(window: Page, target: ReturnType<Page['locator']>, holdMs = 900): Promise<string[]> {
  const box = await target.boundingBox();
  if (!box) throw new Error('long-press target has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await window.mouse.move(cx, cy);
  await window.mouse.down();
  const samples: string[] = [];
  const start = Date.now();
  while (Date.now() - start < holdMs) {
    const c = await target.evaluate((el) => getComputedStyle(el as HTMLElement).borderColor).catch(() => null);
    if (c) samples.push(c);
    await window.waitForTimeout(120);
  }
  await window.mouse.up();
  return samples;
}

// ─── Test ──────────────────────────────────────────────────────────────────────

test.describe('T-118089', () => {
  test('Planned Entrees quick a la carte — long-press adds the linked item', async () => {
    const handle = await launchExpressPoint();
    let window: Page | null = null;
    try {
      await login(handle.window);
      window = await enterServiceOrOpenFresh(handle.window, handle);
      await ensureMealTypeSelected(window);
      await dismissOpenPopovers(window);

      // Look up patron 1337 and press play to load the serving screen.
      const idInput = window.locator('#pinInput input, input[placeholder="Enter an ID"]').first();
      await expect(idInput).toBeVisible({ timeout: 20_000 });
      await idInput.fill('1337');
      await clickVisibleIconButton(window, 'caret-forward-circle');
      await waitForText(window, /ID:\s*1337|Item Count/i);
      await dismissOpenPopovers(window);

      const entree = window.locator('ion-button, button').filter({ hasText: ENTREE }).first();
      await expect(entree, 'planned-entree "Beef Stew" button on the serving grid').toBeVisible({ timeout: 15_000 });

      // ── 1. LONG PRESS (> 600 ms) -> quick-adds the LINKED a la carte item ──
      //      (Beef Stew's linked item is "Yemek - .01c"), with a blue flashing
      //      border on the pressed button.
      const linkedBefore = qtyOf(await readCart(window), LINKED);
      const borderSamples = await longPress(window, entree, 900);
      const blueFlashSeen = borderSamples.some(c => /\b128,\s*255,\s*255\b/.test(c));
      console.log(`Long-press border samples: ${JSON.stringify([...new Set(borderSamples)])}`);
      expect(blueFlashSeen, 'the pressed entree should show the blue flashing border during a long press').toBe(true);

      await expect
        .poll(async () => qtyOf(await readCart(window!), LINKED), {
          timeout: 15_000,
          message: 'long-press on Beef Stew should quick-add its linked item "Yemek" to the cart',
        })
        .toBeGreaterThan(linkedBefore);

      // ── 2. SINGLE PRESS -> adds the entree itself (cart line "Beef Stew *"). ──
      //      Item Count is the reliable signal; the meal line's name also shows in
      //      the cart region (the triplet parser can miss it mid-flash, so match
      //      the raw region text for the name).
      const countBeforeSingle = (await readCart(window)).itemCount ?? 0;
      await entree.click({ timeout: 15_000 });

      await expect
        .poll(async () => (await readCart(window!)).itemCount ?? 0, {
          timeout: 15_000,
          message: 'a single press on Beef Stew should add a line to the cart (Item Count up)',
        })
        .toBeGreaterThan(countBeforeSingle);
      await expect
        .poll(async () => /Beef Stew/i.test((await readCart(window!)).text), {
          timeout: 15_000,
          message: 'the added cart line should be a Beef Stew entree',
        })
        .toBe(true);

      // ── 3. PRESS AGAIN while already added -> "second meal" confirm -> YES. ──
      const countBeforeSecond = (await readCart(window)).itemCount ?? 0;
      await entree.click({ timeout: 15_000 });

      const secondMealAlert = window.locator('ion-alert, .alert-wrapper')
        .filter({ hasText: /second meal/i }).first();
      await expect(secondMealAlert, 'pressing Beef Stew when one is already added should raise the "This is a SECOND MEAL. Do you want to continue?" confirm')
        .toBeVisible({ timeout: 8_000 });

      await window.locator('ion-alert button, .alert-button').filter({ hasText: /^\s*YES\s*$/i })
        .first().click({ timeout: 5_000 });

      await expect
        .poll(async () => (await readCart(window!)).itemCount ?? 0, {
          timeout: 15_000,
          message: 'confirming the second-meal prompt (YES) should add the second Beef Stew',
        })
        .toBeGreaterThan(countBeforeSecond);

      const finalCart = await readCart(window);
      console.log(`Final cart (${finalCart.itemCount}): ${JSON.stringify(finalCart.items)}`);
    } finally {
      // Non-destructive cleanup: never charged. Best-effort close the service so
      // no open session is left behind, then close the app.
      if (window) await closeOpenService(window).catch(() => {});
      await closeExpressPoint(handle);
    }
  });
});
