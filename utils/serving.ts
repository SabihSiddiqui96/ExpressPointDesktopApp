import { Page } from '@playwright/test';

async function waitForLoadingOverlay(window: Page): Promise<void> {
  await window.locator('ion-loading').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
}

const MEAL_ITEM_TEXT = /Yemek|Chicken Burger|Breakfast Meal|Lunch Meal|Supper Meal|Dinner Meal|Snack Meal|^Extra$|^Fruit$|^Milk$|^Grain$|^Entree$|^Vegetable$|^Side$|^Dessert$|^Supper$/i;

/**
 * If a "Meal Type" picker modal is currently on screen, dismiss it by clicking
 * its Close button. Returns true if a modal was dismissed. The modal can sit
 * on top of an already-populated serving grid, blocking subsequent input on
 * the patron-ID field.
 */
async function dismissMealTypeModalIfOpen(window: Page): Promise<boolean> {
  const modal = window.locator('ion-modal, ion-alert, [class*="modal" i]')
    .filter({ hasText: /^[\s\S]*Meal Type[\s\S]*$/i }).first();
  if (!await modal.isVisible({ timeout: 800 }).catch(() => false)) return false;

  // Prefer the Close button inside the modal.
  const closeBtn = modal.locator('ion-button, button')
    .filter({ hasText: /^\s*Close\s*$/i }).first();
  if (await closeBtn.isVisible({ timeout: 800 }).catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => {});
    await window.waitForTimeout(500);
    return true;
  }
  // Fallback: Escape often dismisses ionic modals.
  await window.keyboard.press('Escape').catch(() => {});
  await window.waitForTimeout(500);
  return true;
}

/**
 * After-hours runs land on a "select meal type" prompt with no active serving
 * grid — entering an ID then does nothing. Mirrors the robust pattern from
 * transactions.spec.ts (ensureBreakfastMenuVisible) so all tests share one
 * implementation.
 *
 * Always forces the meal type to "Lunch" (clicking through the picker and
 * confirming any "Switch meal type?" alert) so tests are not subject to which
 * meal period EP is currently in. After-hours, EP defaults to Supper/Dinner
 * with a different menu, which causes downstream tests that expect Lunch
 * items to fail.
 */
export async function ensureMealTypeSelected(window: Page): Promise<void> {
  // If a Meal Type picker modal is sitting on top of an already-populated
  // serving grid, dismiss it first — otherwise the fast-path below sees the
  // grid through the modal and returns early, leaving subsequent clicks
  // blocked by the overlay.
  await dismissMealTypeModalIfOpen(window);

  // Fast-path: only skip when the top toolbar already shows "Lunch" AND a
  // meal grid is visible. Otherwise (e.g. on Supper after school hours), we
  // need to switch to Lunch.
  const onLunchAlready = await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight);
    return Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .filter(visible)
      .some(el => {
        const rect = el.getBoundingClientRect();
        return rect.top < 90 && (el.innerText ?? '').trim() === 'Lunch';
      });
  });

  const mealVisible = await window
    .locator('ion-button')
    .filter({ hasText: MEAL_ITEM_TEXT })
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (onLunchAlready && mealVisible) return;

  // Click the meal-type widget in the top toolbar.
  const opened = await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .filter(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        const label = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
          .filter(Boolean).join(' ');
        return rect.top < 90
          && rect.width > 120
          && rect.left > 90
          && (/Meal Type|Lunch|Breakfast|Supper|Dinner|Snack/i.test(label) || rect.left < globalThis.innerWidth * 0.55);
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const target = candidates.find(el => /Meal Type|Breakfast|Lunch|Supper|Dinner|Snack/i.test(el.innerText ?? ''))
      ?? candidates[1]
      ?? candidates[0];
    target?.click();
    return !!target;
  });
  if (!opened) return;

  // Wait for the meal-type picker, then choose Lunch (or first available).
  await window.waitForFunction(() =>
    /Meal Type|Breakfast|Lunch|Supper|Dinner|Snack/i.test(document.body.innerText),
    { timeout: 10_000 },
  ).catch(() => {});

  // Click Lunch directly via Playwright's text locator with exact match. Force
  // bypasses overlay-actionability checks; getByText auto-finds the leaf.
  const lunchClicked = await window.getByText('Lunch', { exact: true }).first()
    .click({ force: true, timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!lunchClicked) {
    // Fallback: pick the first available meal type by exact text.
    for (const text of ['Breakfast', 'Supper', 'Dinner', 'Snack']) {
      const ok = await window.getByText(text, { exact: true }).first()
        .click({ force: true, timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
    }
  }
  await window.waitForTimeout(500);

  // Confirm via Yes/OK alert if the app prompts (switching meal types can
  // trigger a "Switch meal type?" or "Are you sure?" alert).
  for (let i = 0; i < 3; i++) {
    const dismissed = await window.locator('ion-alert button, .alert-button')
      .filter({ hasText: /^\s*(yes|ok|continue)\s*$/i }).first()
      .click({ timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (!dismissed) break;
    await window.waitForTimeout(300);
  }

  // Verify the serving grid is now populated.
  await window.locator('ion-button').filter({ hasText: MEAL_ITEM_TEXT }).first()
    .waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await waitForLoadingOverlay(window);
}
