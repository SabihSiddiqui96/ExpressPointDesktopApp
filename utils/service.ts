import { expect, Page } from '@playwright/test';
import { WarningDialog } from './dialogs';

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

/**
 * Click YES on every visible confirmation that appears within `waitMs`.
 * Handles both ion-alert ("Are you sure?") and plain-DOM CONFIRM modals
 * ("Your closing balance is less than your starting balance").
 * Loops up to `maxIterations` times so chained confirms all get answered.
 */
export async function dismissAllYesConfirms(window: Page, waitMs = 12_000, maxIterations = 6): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const deadline = Date.now() + waitMs;
    let clicked = false;
    while (Date.now() < deadline) {
      clicked = await window.evaluate(() => {
        const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const isYes = (text: string) => /^yes$/i.test(text.trim());

        const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert')).filter(visible);
        for (const alert of alerts) {
          const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
          const yes = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'))
            .find(b => isYes(b.innerText || b.textContent || ''));
          if (yes) { yes.click(); return true; }
        }
        const yesBtn = Array.from(document.querySelectorAll<HTMLElement>('button, ion-button, [role="button"], a, span, div'))
          .find(b => visible(b) && isYes(b.innerText || b.textContent || ''));
        if (yesBtn) { yesBtn.click(); return true; }
        return false;
      }).catch(() => false);
      if (clicked) break;
      await window.waitForTimeout(300);
    }
    if (!clicked) break;
    await window.waitForTimeout(800);
  }
}

async function clickHamburger(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const button = window
    .locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click({ timeout: 15_000 });
}

async function clickSideMenuItem(window: Page, pattern: RegExp): Promise<void> {
  const item = window.locator('ion-menu ion-item, ion-item[detail]').filter({ hasText: pattern }).first();
  if (!await item.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await clickHamburger(window);
  }
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click({ timeout: 15_000 });
}

/**
 * Close the active service if one is open; no-op when the dashboard is already
 * on "Open Service". Centralises the close flow that was previously duplicated
 * across open_service.spec.ts and close_service.spec.ts.
 */
export async function ensureServiceClosed(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);

  const openItem = window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first();
  const continueItem = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();

  const sessionOpen = await continueItem.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!sessionOpen) {
    if (await openItem.isVisible({ timeout: 2_000 }).catch(() => false)) return;
  }

  await clickSideMenuItem(window, /^Close Service$/i);

  const closeBtn = window.locator('ion-button').filter({ hasText: /Close Service/i }).last();
  await expect(closeBtn).toBeVisible({ timeout: 10_000 });
  await closeBtn.evaluate((el: HTMLElement) => el.click());

  await dismissAllYesConfirms(window);

  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }

  await waitForLoadingOverlay(window);
  // The Square Authorization Warning often re-appears after the dashboard re-settles.
  await WarningDialog.dismiss(window, 3_000);
  await expect(openItem).toBeVisible({ timeout: 20_000 });
}
