//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115134

import { test, expect, Page, Locator } from '@playwright/test';
import { loginToExpressPoint, closeExpressPoint } from '../../utils/helpers';
import { WarningDialog } from '../../utils/dialogs';
import { ensureServiceClosed } from '../../utils/service';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOMEROOM_PARAMS = {
  grade: 'ALL',
  homeroom: 'Anil-PEI',
  mealType: 'Breakfast',
  item: 'Breakfast Meal',
} as const;

const ROSTER_PARAMS = {
  roster: 'AZAR-SPORTS-ROASTER',
  mealType: 'Breakfast',
  item: 'Breakfast Meal',
} as const;

const ALA_CARTE = { category: 'Fruits-test', item: 'Apple' } as const;
const ADD_FUNDS_KEYS = ['7', '0', '0'];

test.describe.configure({ timeout: 180_000 });

// ─── Types ────────────────────────────────────────────────────────────────────

type BulkSalesMode = 'homeroom' | 'roster';

// ─── Core DOM helpers ─────────────────────────────────────────────────────────
// ion-button and custom dropdowns use shadow DOM — evaluate-based clicks are
// more reliable than Playwright's actionability checks for Ionic components.

/** Click an element found by querySelectorAll + optional text match. */
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

/**
 * Click a custom dropdown item (ion-item inside app-classroom-sale ion-list)
 * that contains labelContains in its text, then pick optionText from the
 * ion-popover that opens.
 *
 * The app uses a custom app-all-popup popover — not ion-select.
 */
async function chooseFromDropdown(
  window: Page,
  labelContains: string,
  optionText: string,
): Promise<void> {
  // Click the dropdown row — prefer inside a visible modal, fall back to main form
  await window.evaluate((label: string) => {
    // Check for open modal first (ala carte / add funds modals)
    const modal = document.querySelector<HTMLElement>('ion-modal.show-modal, ion-modal[class*="show"]');
    const scope: Element = modal ?? document.querySelector('app-classroom-sale') ?? document.body;
    const items = Array.from(scope.querySelectorAll<HTMLElement>('ion-list ion-item'));
    const target = items.find(el =>
      el.textContent?.toLowerCase().includes(label.toLowerCase()),
    );
    if (target) target.click();
  }, labelContains);

  // Wait for the popover overlay
  const popover = window.locator('ion-popover');
  const popoverOpened = await popover.waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!popoverOpened) {
    // Dump the state that actually explains this failure: which segment tab is
    // selected and which dropdown rows exist in scope. (A modal innerText dump
    // is useless here — the bulk-sales form is not inside a modal.)
    const state = await window.evaluate(() => {
      const segments = Array.from(document.querySelectorAll('ion-segment-button')).map(el => ({
        value: el.getAttribute('value'),
        ariaSelected: el.getAttribute('aria-selected'),
        className: el.className,
        disabled: el.hasAttribute('disabled'),
      }));
      const modal = document.querySelector<HTMLElement>('ion-modal.show-modal, ion-modal[class*="show"]');
      const scope: Element = modal ?? document.querySelector('app-classroom-sale') ?? document.body;
      const rows = Array.from(scope.querySelectorAll<HTMLElement>('ion-list ion-item'))
        .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
      return { scope: modal ? 'modal' : (document.querySelector('app-classroom-sale') ? 'app-classroom-sale' : 'body'), segments, rows };
    }).catch(() => null);
    console.log(`[chooseFromDropdown] state: ${JSON.stringify(state, null, 2)}`);
    throw new Error(`Dropdown did not open for label: ${labelContains}`);
  }

  // Use Playwright locator click so Ionic receives proper pointer events.
  // Exact match: text must be the whole trimmed content of the ion-item.
  const optionRegex = new RegExp(`^\\s*${optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  await popover
    .locator('ion-item')
    .filter({ hasText: optionRegex })
    .first()
    .click({ timeout: 5_000 });

  // Wait for popover to dismiss
  await popover.waitFor({ state: 'hidden', timeout: 8_000 });
}

/** Extract a numeric dollar amount from an element's text. "$3.50" → 3.5 */
function parseDollarAmount(text: string | null): number {
  return parseFloat((text ?? '').replace(/[^0-9.]/g, '')) || 0;
}

async function modalDollarAmount(modal: Locator, label: string): Promise<number> {
  const value = await modal.evaluate((root, targetLabel) => {
    const directText = (el: Element) => Array.from(el.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const labels = Array.from(root.querySelectorAll<HTMLElement>('*'));
    const labelEl = labels.find(el => directText(el).toLowerCase() === targetLabel.toLowerCase());
    const sibling = labelEl?.nextElementSibling as HTMLElement | null;
    if (sibling) {
      const siblingText = directText(sibling);
      if (siblingText) return siblingText;
      if (sibling.textContent) return sibling.textContent;
    }

    const parentChildren = labelEl?.parentElement
      ? Array.from(labelEl.parentElement.children) as HTMLElement[]
      : [];
    const labelIndex = labelEl ? parentChildren.indexOf(labelEl) : -1;
    return labelIndex >= 0 ? parentChildren[labelIndex + 1]?.textContent ?? '' : '';
  }, label);

  return parseDollarAmount(value);
}

/** Student cards live in the custom-list row, not in ion-item rows. */
function firstStudentCard(window: Page): Locator {
  return window.locator('ion-row[custom-list] ion-card').first();
}

function firstSelectableStudentCard(window: Page): Locator {
  return window
    .locator('ion-row[custom-list] ion-card')
    .filter({ has: window.locator('ion-checkbox') })
    .first();
}

function studentActionButton(window: Page, iconName: 'add' | 'logo-usd'): Locator {
  return firstStudentCard(window)
    .locator('ion-button')
    .filter({ has: window.locator(`ion-icon[name="${iconName}"]`) })
    .first();
}

async function servedStudentCount(window: Page): Promise<number> {
  return await window.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('ion-row[custom-list] ion-card'));
    return cards.filter(card =>
      card.querySelector('ion-icon[name*="checkmark"], ion-icon[aria-label*="checkmark"], [aria-label*="checkmark"]')
      || !card.querySelector('ion-checkbox'),
    ).length;
  });
}

async function waitForToastIfPresent(window: Page): Promise<void> {
  const toast = window.locator('ion-toast').first();
  const appeared = await toast.waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => { });
  }
}

async function seedOpenSessionForToday(window: Page): Promise<number> {
  return await window.evaluate(async () => {
    const now = new Date();
    const openDate = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

    return await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('_pouch_EXP_TRANSACTIONS');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('by-sequence', 'readwrite');
        const store = tx.objectStore('by-sequence');
        let updated = 0;

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const doc = cursor.value;
          if (
            /^OpenSession--/.test(doc._doc_id_rev ?? '') &&
            doc.isStillOpen === true
          ) {
            doc.OpenDate = openDate;
            doc.OpenDateWithTime = now.getTime();
            doc.OpenSessionDate = now.getTime();
            cursor.update(doc);
            updated += 1;
          }

          cursor.continue();
        };

        tx.oncomplete = () => {
          db.close();
          resolve(updated);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  });
}

// ─── Site selection ───────────────────────────────────────────────────────────

// Site 103 is spelled "BLUEFIELD" (or the typo'd "BLUEFILED" depending on build);
// match either so the short-circuit + the Switch Sites filter both work.
const TARGET_SITE_REGEX = /103\s*-\s*BLUEFI(?:E|I)LD/i;
const TARGET_SITE_SEARCH = '103 - BLUEFIELD';

/**
 * Bulk Sales for this scenario must run against site 103. If a leftover
 * service is open from a prior test, close it first (Switch Sites is disabled
 * while a service is open). Then open the hamburger menu, click Switch Sites,
 * search for "103 - BLUEFILED ...", click the result, and confirm.
 */
async function isAlreadyOnTargetSite(window: Page): Promise<boolean> {
  // The dashboard shows "Serving Options for <site name>...". If <site name>
  // already matches "103 - BLUEFILED", skip the whole switch-site dance.
  return window.evaluate((source: string) => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const regex = new RegExp(`Serving Options for[\\s\\S]*?${source}`, 'i');
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .some(el => visible(el) && regex.test((el.innerText || '').replace(/\s+/g, ' ')));
  }, TARGET_SITE_REGEX.source).catch(() => false);
}

async function switchToBluefieldSite(window: Page): Promise<void> {
  await WarningDialog.dismiss(window, 3_000);

  // Short-circuit: if the dashboard already shows "Serving Options for 103 -
  // BLUEFILED ...", we're on the right site — nothing to switch.
  if (await isAlreadyOnTargetSite(window)) return;

  // 1. Close any open service (Switch Sites is disabled when one is open).
  await ensureServiceClosed(window);
  await WarningDialog.dismiss(window, 3_000);

  // Re-check after closing — closing the service can navigate to a dashboard
  // that already shows the target site.
  if (await isAlreadyOnTargetSite(window)) return;

  // 2. Open hamburger → Switch Sites.
  const hamburger = window
    .locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(hamburger).toBeVisible({ timeout: 10_000 });
  await hamburger.click();

  const switchItem = window.locator('ion-menu ion-item, ion-item').filter({ hasText: /Switch Sites?/i }).first();
  await expect(switchItem).toBeVisible({ timeout: 10_000 });
  await switchItem.click();

  // 3. Switch Sites is a plain div overlay — wait for the search bar.
  const searchBar = window.locator('input[placeholder*="SEARCH SCHOOL" i], input[placeholder*="Search School" i], input[placeholder*="Search" i]').first();
  await expect(searchBar).toBeVisible({ timeout: 10_000 });

  // 4. Type "103 - BLUEFILED" into the search bar to filter the list.
  await searchBar.click();
  await searchBar.fill(TARGET_SITE_SEARCH);
  await window.waitForTimeout(500);

  // 5. Click the matching row (smallest visible element with the target text).
  const clicked = await window.evaluate((source: string) => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const regex = new RegExp(source, 'i');
    const matches = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(el => visible(el) && regex.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()));
    if (matches.length === 0) return false;
    matches.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
    matches[0].click();
    return true;
  }, TARGET_SITE_REGEX.source);
  expect(clicked, 'site row "103 - BLUEFILED" should be clickable in Switch Sites dialog').toBe(true);

  // 6. Confirm dialog → click Yes.
  const yesBtn = window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(yes|confirm|ok)$/i })
    .first();
  await expect(yesBtn).toBeVisible({ timeout: 10_000 });
  await yesBtn.click();
  await window.waitForTimeout(1_500);
  await WarningDialog.dismiss(window, 3_000);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

async function navigateToBulkSales(window: Page): Promise<void> {
  const bulkSalesForm = window.locator('ion-segment-button[value="by_homeroom"]');

  // Wait for the menu to settle — service state loads asynchronously (~3s).
  await window.waitForTimeout(3_000);
  await seedOpenSessionForToday(window);

  // "Bulk Sales" is always in the menu (service open or not for today).
  // Use Playwright locator click (.first() guards against strict-mode errors)
  // to properly fire pointer events that Ionic Angular's router needs.
  await window.locator('ion-item[detail]').filter({ hasText: 'Bulk Sales' }).first().click();
  await window.waitForTimeout(3_000);
  await WarningDialog.dismiss(window);

  // If Opening Balance screen appeared, confirm it to open today's service.
  const hasOpenBalance = await window
    .getByRole('heading', { name: 'Opening Balance' })
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (hasOpenBalance) {
    await WarningDialog.dismiss(window);
    // Click the "Open Service" ion-button via Playwright locator
    await window.getByRole('button', { name: /open service/i }).last().click();
    await window.waitForTimeout(4_000);
    await WarningDialog.dismiss(window);
    const stillOpeningBalance = await window
      .getByRole('heading', { name: 'Opening Balance' })
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (stillOpeningBalance) {
      await window.getByRole('button', { name: /open service/i }).last().click();
      await window.waitForTimeout(4_000);
    }

    const alreadyOnBulkSales = await bulkSalesForm.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!alreadyOnBulkSales) {
      await window.locator('ion-item[detail]').filter({ hasText: 'Bulk Sales' }).first().click();
      await WarningDialog.dismiss(window, 3_000);
    }
  }

  await expect(bulkSalesForm).toBeVisible({ timeout: 20_000 });
}

// ─── Load Students ────────────────────────────────────────────────────────────

async function loadStudentsByHomeroom(
  window: Page,
  params: typeof HOMEROOM_PARAMS,
): Promise<void> {
  await window.locator('ion-segment-button[value="by_homeroom"]').click();
  await window.waitForTimeout(500);

  await chooseFromDropdown(window, 'Grade', params.grade);
  await chooseFromDropdown(window, 'Homeroom', params.homeroom);
  await chooseFromDropdown(window, 'Meal Type', params.mealType);
  await chooseFromDropdown(window, 'Item', params.item);

  await domClick(window, 'ion-button', 'load students');
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
}

/**
 * Return to the selection form (segment tabs + Grade/Homeroom/Roster dropdowns).
 * Loading students replaces that form with the student list, so after a completed
 * flow the tabs are gone and a tab click silently does nothing. Cancel goes back.
 * No-op when the form is already showing.
 */
async function ensureSelectionForm(window: Page): Promise<void> {
  // Recording an ala carte sale can leave an ion-alert open; its backdrop
  // intercepts every click, so dismiss it before touching anything else.
  await WarningDialog.dismiss(window, 3_000);

  const segment = window.locator('ion-segment-button').first();
  if (await segment.isVisible({ timeout: 2_000 }).catch(() => false)) return;

  // Cancel returns to the form, but when selections exist the app first asks
  // "CONFIRM EXP05305: ... Are you sure you wish to cancel bulk sales entry?".
  // That alert must be answered — its backdrop blocks every subsequent click.
  await domClick(window, 'ion-button', 'cancel');

  const confirmYes = window
    .locator('ion-alert button, .alert-button')
    .filter({ hasText: /^\s*Yes\s*$/i })
    .first();
  if (await confirmYes.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // The alert re-renders as it settles, so a plain click can hit a detached
    // node; fall back to an in-page click on the Yes button.
    await confirmYes.click({ timeout: 5_000 }).catch(async () => {
      await window.evaluate(() => {
        const alert = document.querySelector('ion-alert');
        const btn = Array.from(alert?.querySelectorAll<HTMLElement>('button, .alert-button') ?? [])
          .find(b => /^\s*yes\s*$/i.test(b.textContent ?? ''));
        btn?.click();
      });
    });
  }

  if (await segment.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) return;

  const state = await window.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
    menuItems: Array.from(document.querySelectorAll<HTMLElement>('ion-item[detail]'))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    heading: (document.querySelector('ion-title, h1, h2')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    // The blocking overlay: what it says and which buttons it offers is the
    // whole question — WarningDialog.dismiss does not recognise this one.
    alerts: Array.from(document.querySelectorAll<HTMLElement>('ion-alert')).map(a => ({
      id: a.id,
      className: a.className,
      text: (a.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      buttons: Array.from(a.querySelectorAll<HTMLElement>('button, .alert-button'))
        .map(b => (b.textContent ?? '').trim()).filter(Boolean),
    })),
  })).catch(() => null);
  throw new Error(`Could not return to the bulk-sales selection form. State: ${JSON.stringify(state)}`);
}

async function loadStudentsByRoster(
  window: Page,
  params: typeof ROSTER_PARAMS,
): Promise<void> {
  // Let the app settle after the previous flow before switching tabs
  await window.waitForTimeout(1_500);
  await ensureSelectionForm(window);

  // Use evaluate-based click — Ionic segment buttons need it same as ion-button
  await domClick(window, 'ion-segment-button[value="by_specialroster"]');
  await window.waitForTimeout(800);

  // Verify the tab actually switched before choosing dropdowns
  // Ionic marks the active segment with the `segment-button-checked` class and
  // does NOT set aria-selected on the host — asserting that attribute could
  // never pass, and the old `.catch()` hid it, so the flow carried on regardless
  // and failed three calls later with a misleading "Dropdown did not open".
  const rosterTab = window.locator('ion-segment-button[value="by_specialroster"]');
  await expect(rosterTab)
    .toHaveClass(/segment-button-checked/, { timeout: 5_000 })
    .catch(async () => {
      // Retry once if the first click didn't register, then re-assert for real.
      await domClick(window, 'ion-segment-button[value="by_specialroster"]');
      await window.waitForTimeout(500);
      await expect(rosterTab).toHaveClass(/segment-button-checked/, { timeout: 5_000 });
    });

  await chooseFromDropdown(window, 'Roster', params.roster);
  await chooseFromDropdown(window, 'Meal Type', params.mealType);
  await chooseFromDropdown(window, 'Item', params.item);

  await domClick(window, 'ion-button', 'load students');
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
}

// ─── Step Helpers ─────────────────────────────────────────────────────────────

/** Step 2 — verify Cancel returns to the form, then reload students. */
async function verifyCancelAndLoadExistingSelection(window: Page): Promise<void> {
  await domClick(window, 'ion-button', 'cancel');
  await expect(window.getByText(/Perform meal sales/i)).toBeVisible({ timeout: 8_000 });
  await domClick(window, 'ion-button', 'load students');
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
}

/** Step 3 — check first student checkbox, record sale, verify success toast. */
async function recordSaleForOneStudent(window: Page): Promise<void> {
  const servedBefore = await servedStudentCount(window);
  const selectableStudents = window
    .locator('ion-row[custom-list] ion-card')
    .filter({ has: window.locator('ion-checkbox') });
  const selectableCount = await selectableStudents.count();

  if (selectableCount === 0) {
    expect(servedBefore).toBeGreaterThan(0);
    return;
  }

  const student = firstSelectableStudentCard(window);
  await expect(student).toBeVisible({ timeout: 10_000 });

  const checkbox = student.locator('ion-checkbox').first();
  await expect(checkbox).toBeVisible({ timeout: 10_000 });
  await checkbox.evaluate((el: HTMLElement) => el.click());
  await expect.poll(
    async () => await checkbox.evaluate(el => el.getAttribute('aria-checked')),
    { timeout: 5_000 },
  ).toBe('true');

  await domClick(window, 'ion-button', 'record sales');

  await waitForToastIfPresent(window);

  // After recording, the app navigates back to the bulk sales form.
  // Reload students so subsequent steps (add funds, ala carte) can find the cards.
  const backOnForm = await window.getByText(/Perform meal sales/i)
    .isVisible({ timeout: 3_000 }).catch(() => false);
  if (backOnForm) {
    await domClick(window, 'ion-button', 'load students');
  }
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
}

/**
 * Step 4 — click the $ button on the first student, enter amount via keypad,
 * verify newBalance = currentBalance + payment + bonus, then confirm.
 */
async function addFundsToStudent(window: Page, digits: string[]): Promise<void> {
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
  const fundBtn = studentActionButton(window, 'logo-usd');
  await expect(fundBtn).toBeVisible({ timeout: 10_000 });
  await fundBtn.evaluate((el: HTMLElement) => el.click());

  const modal = window.locator('ion-modal').first();
  await expect(modal).toBeVisible({ timeout: 8_000 });

  const currentBalance = await modalDollarAmount(modal, 'Current Balance');

  for (const digit of digits) {
    await modal.getByRole('button', { name: digit, exact: true }).click();
  }

  const paymentAmount = Number(digits.join('')) / 100;

  // EP updates the modal's running total asynchronously after each keypress.
  // Wait until the displayed New Balance reflects the full payment before
  // reading the final value, otherwise we can race a stale intermediate value
  // (e.g. only the first digit registered).
  await expect.poll(
    () => modalDollarAmount(modal, 'New Balance'),
    { timeout: 5_000, intervals: [200, 200, 300, 500, 500] },
  ).toBeGreaterThanOrEqual(currentBalance + paymentAmount - 0.005);

  const newBalance = await modalDollarAmount(modal, 'New Balance');
  // newBalance must be at least currentBalance + paymentAmount (any bonus on
  // top is acceptable — flat or percentage). This is mode-agnostic.
  expect(
    newBalance,
    `newBalance ($${newBalance}) should be >= currentBalance ($${currentBalance}) + paymentAmount ($${paymentAmount})`,
  ).toBeGreaterThanOrEqual(currentBalance + paymentAmount - 0.005);

  await modal.getByRole('button', { name: /make payment/i }).click();
  await waitForToastIfPresent(window);
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 10_000 });
}

/** Step 5 — click the + button, pick category + item, record ala carte sale. */
async function serveAlaCarteItem(
  window: Page,
  category: string,
  item: string,
): Promise<void> {
  await expect(firstStudentCard(window)).toBeVisible({ timeout: 15_000 });
  const alaCarteBtn = studentActionButton(window, 'add');
  await expect(alaCarteBtn).toBeVisible({ timeout: 10_000 });
  await alaCarteBtn.evaluate((el: HTMLElement) => el.click());

  const modal = window.locator('ion-modal').first();
  await expect(modal).toBeVisible({ timeout: 8_000 });

  await modal.getByText(category, { exact: true }).click();
  await modal.getByText(item, { exact: true }).click({ timeout: 10_000 });

  await domClick(window, 'ion-button', 'record sales');
  await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await waitForToastIfPresent(window);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function runBulkSalesFlow(window: Page, mode: BulkSalesMode): Promise<void> {
  const loadFn = mode === 'homeroom'
    ? () => loadStudentsByHomeroom(window, HOMEROOM_PARAMS)
    : () => loadStudentsByRoster(window, ROSTER_PARAMS);

  await loadFn();
  await verifyCancelAndLoadExistingSelection(window);
  await recordSaleForOneStudent(window);
  await addFundsToStudent(window, ADD_FUNDS_KEYS);
  await serveAlaCarteItem(window, ALA_CARTE.category, ALA_CARTE.item);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Bulk Sales', () => {
  test('Full bulk sales flow via Homeroom and Roster', async () => {
    const handle = await loginToExpressPoint();
    try {
      // Bulk Sales for this scenario must run from site 103 (Bluefield Elementary).
      // Close any open service if needed, then Switch Sites → 103 - BLUEFILED.
      await switchToBluefieldSite(handle.window);

      await navigateToBulkSales(handle.window);
      await runBulkSalesFlow(handle.window, 'homeroom');

      // Re-acquire the real app window in case the CDP page reference drifted
      const pages = handle.browser.contexts()[0].pages()
        .filter(p => !p.isClosed() && !p.url().includes('electron-browser-storage'));
      if (pages.length > 0) handle.window = pages[0];

      await runBulkSalesFlow(handle.window, 'roster');
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
