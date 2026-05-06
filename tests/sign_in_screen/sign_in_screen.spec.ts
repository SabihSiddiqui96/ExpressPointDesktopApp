//Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_testPlans/define?planId=115128&suiteId=115131

import { test, expect, Page } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { ensureServiceClosed } from '../../utils/service';
import { WarningDialog } from '../../utils/dialogs';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';

test.describe.configure({ timeout: 240_000 });

const PASSWORD_SAMPLE = 'TestPassword123!';

// ---------------------------------------------------------------------------
// Core DOM helpers
// ---------------------------------------------------------------------------

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
    const context = handle.browser.contexts()[0];
    const pages = context.pages().filter(page => !page.isClosed());
    for (const page of pages) {
      const isApp = await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false);
      if (isApp) return page;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('getAppWindow: ion-app not found after 15s');
}

async function clickMenuButton(window: Page): Promise<void> {
  await waitForLoadingOverlay(window);
  const button = window
    .locator('ion-menu-button, ion-button')
    .filter({ has: window.locator('ion-icon[name="menu"], ion-icon[name="menu-outline"]') })
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click({ timeout: 15_000 });
}

async function clickMenuItem(window: Page, label: string | RegExp): Promise<void> {
  const pattern = typeof label === 'string' ? label : label.source;
  const flags = typeof label === 'string' ? 'i' : label.flags;
  const itemVisible = async () => window.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    return Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item, ion-item[detail]'))
      .some(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText ?? '');
      });
  }, { source: pattern, flags });

  if (!await itemVisible()) {
    await clickMenuButton(window);
  }
  await expect.poll(itemVisible, { timeout: 10_000 }).toBe(true);

  const clicked = await window.evaluate(({ source, flags }) => {
    const regex = new RegExp(source, flags);
    const item = Array.from(document.querySelectorAll<HTMLElement>('ion-menu ion-item, ion-item[detail]'))
      .find(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return visible && regex.test(el.innerText ?? '');
      });
    item?.click();
    return !!item;
  }, { source: pattern, flags });
  expect(clicked).toBe(true);
  await closeSideMenu(window);
  await waitForLoadingOverlay(window);
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

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await expect(loginPage.servingOptionsHeading().first()).toBeVisible({ timeout: 20_000 });
  await waitForLoadingOverlay(window);
  await WarningDialog.dismiss(window, 5_000);
}

// ---------------------------------------------------------------------------
// Sign-in screen helpers
// ---------------------------------------------------------------------------

async function getPasswordInputType(window: Page): Promise<string> {
  return window.evaluate(() => {
    const ionInput = document.querySelector<HTMLElement>('ion-input[placeholder="Password"]');
    const input = ionInput?.querySelector<HTMLInputElement>('input');
    return input?.type ?? '';
  });
}

async function clickPasswordEyeIcon(window: Page): Promise<boolean> {
  return window.evaluate(() => {
    const ionInput = document.querySelector<HTMLElement>('ion-input[placeholder="Password"]');
    if (!ionInput) return false;
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    const candidates: HTMLElement[] = [];
    const ionInputRect = ionInput.getBoundingClientRect();

    // Search the password ion-input and its siblings/parent for an eye icon.
    const scopes: HTMLElement[] = [
      ionInput,
      ionInput.parentElement as HTMLElement,
      ionInput.closest('ion-item') as HTMLElement,
    ].filter(Boolean) as HTMLElement[];

    for (const scope of scopes) {
      const icons = Array.from(scope.querySelectorAll<HTMLElement>('ion-icon'));
      for (const icon of icons) {
        if (!visible(icon)) continue;
        const name = (icon.getAttribute('name') ?? '').toLowerCase();
        if (/eye/.test(name)) candidates.push(icon);
      }
    }

    // Fallback: any visible eye icon vertically aligned with the password field.
    if (candidates.length === 0) {
      const icons = Array.from(document.querySelectorAll<HTMLElement>('ion-icon'));
      for (const icon of icons) {
        if (!visible(icon)) continue;
        const name = (icon.getAttribute('name') ?? '').toLowerCase();
        if (!/eye/.test(name)) continue;
        const rect = icon.getBoundingClientRect();
        const overlapsVertically = rect.top < ionInputRect.bottom && rect.bottom > ionInputRect.top;
        if (overlapsVertically) candidates.push(icon);
      }
    }

    const target = candidates[0];
    if (!target) return false;
    const clickable = target.closest('ion-button, button, [role="button"]') as HTMLElement | null;
    (clickable ?? target).click();
    return true;
  });
}

// ---------------------------------------------------------------------------
// Switch Sites helpers
// ---------------------------------------------------------------------------

function extractSiteName(text: string): string {
  // innerText preserves visual line breaks — work line-by-line so we don't pick
  // up adjacent menu/button text when the heading shares a parent with them.
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const idx = lines.findIndex(s => /Serving Options for/i.test(s));
  if (idx === -1) return '';

  const onSameLine = lines[idx].match(/Serving Options for\s+(.+)$/i);
  if (onSameLine) return onSameLine[1].replace(/\.+$/, '').trim();

  // Heading wraps and the site name sits on the next line.
  const next = lines[idx + 1];
  if (next && !/^(open service|continue service|close service|transactions|bulk sales|summary sale|orders|payments|device information)$/i.test(next)) {
    return next.replace(/\.+$/, '').trim();
  }
  return '';
}

async function readCurrentSiteName(window: Page): Promise<string> {
  // Walk every visible element matching the heading pattern, pick the one with
  // the smallest text — that's the heading element itself, not an ancestor that
  // also contains menu items, button labels, etc.
  const texts = await window.evaluate(() => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!visible(el)) continue;
      const text = (el.innerText ?? '').trim();
      if (!/Serving Options for/i.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  });

  for (const text of texts.sort((a, b) => a.length - b.length)) {
    const name = extractSiteName(text);
    if (name && !/^for$/i.test(name)) return name;
  }
  return '';
}

interface SwitchSiteCandidate {
  name: string;
  searchTerm: string;
}

function searchBarLocator(window: Page) {
  return window.locator('input[placeholder*="SEARCH SCHOOL" i], input[placeholder*="Search School" i], input[placeholder*="Search" i]').first();
}

async function openSwitchSitesDialog(window: Page): Promise<void> {
  await clickMenuItem(window, /Switch Sites?/i);
  // The Switch Sites dialog is a plain div overlay (not an ion-modal/ion-alert).
  // Identify it by the unique search input placeholder.
  await expect(searchBarLocator(window)).toBeVisible({ timeout: 10_000 });
}

async function pickAlternateSite(window: Page, currentSite: string): Promise<SwitchSiteCandidate | null> {
  return window.evaluate((current: string) => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    // Site rows display as "<id> - <name>" (e.g. "102 - BLUEFILED MIDDLE SCHOOL").
    const seen = new Set<string>();
    const matches: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!visible(el)) continue;
      const text = (el.innerText ?? '').replace(/\s+/g, ' ').trim();
      if (!/^[A-Za-z0-9]\S*\s+-\s+\S/.test(text)) continue;
      if (text.length > 120) continue;
      if (text.includes('\n')) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      if (text.toLowerCase() === current.toLowerCase()) continue;
      if (current && text.toLowerCase().includes(current.toLowerCase())) continue;
      matches.push(text);
    }
    if (matches.length === 0) return null;

    const name = matches[0];
    const tail = name.replace(/^.*?\s+-\s+/, '');
    const searchTerm = tail.split(/\s+/).slice(0, 2).join(' ') || tail;
    return { name, searchTerm };
  }, currentSite);
}

async function searchAndSelectSite(window: Page, candidate: SwitchSiteCandidate): Promise<void> {
  const searchBar = searchBarLocator(window);
  await expect(searchBar).toBeVisible({ timeout: 10_000 });
  await searchBar.click();
  await searchBar.fill(candidate.searchTerm);
  await window.waitForTimeout(500);

  // List rows are bare divs/spans — pick the smallest visible element whose
  // text exactly equals the candidate's "<id> - <name>" string and click it.
  const clicked = await window.evaluate((target: string) => {
    const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const matches = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(visible)
      .filter(el => (el.innerText ?? '').replace(/\s+/g, ' ').trim() === target);
    if (matches.length === 0) return false;
    matches.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
    matches[0].click();
    return true;
  }, candidate.name);
  expect(clicked, `Switch Sites row "${candidate.name}" should be clickable`).toBe(true);
}

async function confirmSwitchSite(window: Page): Promise<void> {
  await waitForText(window, /confirm|are you sure|switch/i, 10_000);
  const yesBtn = window.locator('ion-alert button, .alert-button, ion-button')
    .filter({ hasText: /^(yes|confirm|ok)$/i })
    .first();
  await expect(yesBtn).toBeVisible({ timeout: 10_000 });
  await yesBtn.click();
  await waitForLoadingOverlay(window);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sign In Screen', () => {
  test('password eye icon toggles visibility on the PrimeroEdge login form', async () => {
    const handle = await launchExpressPoint();
    try {
      const loginPage = new LoginPage(handle.window);

      await loginPage.clickPrimeroEdgeLogin();
      await loginPage.passwordInput().waitFor({ state: 'visible', timeout: 10_000 });
      await loginPage.passwordInput().click();
      await loginPage.passwordInput().fill(PASSWORD_SAMPLE);
      await expect.poll(() => loginPage.passwordInput().inputValue(), { timeout: 5_000 }).toBe(PASSWORD_SAMPLE);

      // Password is hidden by default
      expect(await getPasswordInputType(handle.window)).toBe('password');

      // Eye icon must be visible next to the password field
      const eyeClicked = await clickPasswordEyeIcon(handle.window);
      expect(eyeClicked, 'eye icon should be present on the password field').toBe(true);

      // After clicking the eye, the password becomes visible
      await expect.poll(() => getPasswordInputType(handle.window), { timeout: 5_000 }).toBe('text');
    } finally {
      await closeExpressPoint(handle);
    }
  });

  test('switch sites updates the Serving Options heading to the selected site', async () => {
    const handle = await launchExpressPoint();
    try {
      await login(handle.window);
      const window = await getAppWindow(handle);

      // Switch Sites is disabled while a service is open — close any leftover session first.
      await ensureServiceClosed(window);

      // The Square Authorization Warning often re-appears after the dashboard re-settles.
      await WarningDialog.dismiss(window, 5_000);

      // Site name may render slightly after the "Serving Options for" prefix.
      await expect.poll(
        () => readCurrentSiteName(window),
        { timeout: 15_000 },
      ).not.toBe('');
      const originalSite = await readCurrentSiteName(window);

      await WarningDialog.dismiss(window, 1_000);
      await openSwitchSitesDialog(window);

      const candidate = await pickAlternateSite(window, originalSite);
      expect(candidate, 'an alternate site should be available in the Switch Sites dialog').not.toBeNull();

      await searchAndSelectSite(window, candidate!);
      await confirmSwitchSite(window);

      await expect.poll(
        () => readCurrentSiteName(window),
        { timeout: 30_000 },
      ).not.toBe(originalSite);

      const newSite = await readCurrentSiteName(window);
      expect(newSite.toLowerCase()).toContain(candidate!.searchTerm.toLowerCase());
    } finally {
      await closeExpressPoint(handle);
    }
  });
});
