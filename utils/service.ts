import { expect, Page } from '@playwright/test';

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
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

  // Dismiss every "Are you sure?" / "closing balance is less" confirmation that pops up.
  for (let i = 0; i < 4; i++) {
    const alert = window.locator('ion-alert');
    const appeared = await alert.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!appeared) break;
    await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^yes$/i }).first().click({ timeout: 3_000 }).catch(() => {});
    await alert.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
  }

  const closingDialog = window.getByText(/closing pos terminal/i).first();
  if (await closingDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(closingDialog).toBeHidden({ timeout: 60_000 });
  }

  await waitForLoadingOverlay(window);
  await expect(openItem).toBeVisible({ timeout: 20_000 });
}
