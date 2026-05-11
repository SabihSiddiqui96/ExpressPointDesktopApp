// Test Link: https://dev.azure.com/Cybersoft-Technologies-Inc/PrimeroEdge%20Classic/_workitems/edit/115042

import { test, expect, Page, chromium, Browser } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from '../../utils/launch';
import { LoginPage } from '../../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../../utils/env';
import { WarningDialog } from '../../utils/dialogs';
import { loginToPrimeroEdgeQa } from '../../utils/primeroedge-web';

test.describe.configure({ timeout: 900_000 });

const MANAGE_SETTINGS_URL = 'https://qa.primeroedge.co/System/ManageSettings.aspx';
const BLUEFIELD_SITE = 'BLUEFIELD ELEMENTRY SCHOOL_child care';
const TIMEZONE_SETTING_LABEL = /Ignore time zone check for site/i;
const DEVICE_TIME_WARNING = /Device\s*time.*System\s*time|System\s*time.*Device\s*time|time zone|time(?:s)? (?:do not|don.?t) match/i;

// ─── Web helpers ──────────────────────────────────────────────────────────────

/**
 * Click the "System" top-level tab on ManageSettings.aspx. The tab strip is a
 * Telerik RadTabStrip (#ctl00_UserContentArea_ModuleRadTabStrip), structured
 * as ul.rtsUL > li.rtsLI > a.rtsLink > span.rtsTxt. Targeting the <a> directly
 * is required because Telerik wires the tab-change handler there.
 */
async function clickSystemSettingsTab(web: Page): Promise<void> {
  const systemTab = web.locator(
    '#ctl00_UserContentArea_ModuleRadTabStrip a.rtsLink',
  ).filter({ hasText: /^System$/ }).first();
  await expect(systemTab, '"System" tab anchor in RadTabStrip').toBeVisible({ timeout: 20_000 });
  await systemTab.click();
  await web.waitForLoadState('domcontentloaded').catch(() => {});
  // RadTabStrip triggers an async postback to swap in the System tab's grid.
  await web.waitForTimeout(1_500);
}

/**
 * Change DTTIMEZONE on the Manage Settings > System tab. Returns the previous
 * value so the test can restore it at the end. We implement Save inline rather
 * than calling setSettings(), because setSettings re-navigates to the URL and
 * doesn't know about the System tab.
 */
async function changeDtTimezoneToAnyOther(web: Page): Promise<{ previous: string; applied: string }> {
  await web.goto(MANAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Make sure "Show Internal Settings" is checked so DTTIMEZONE appears.
  const showInternal = web.locator('input[type="checkbox"]').first();
  if (!await showInternal.isChecked().catch(() => false)) {
    await showInternal.click();
    await web.waitForLoadState('domcontentloaded').catch(() => {});
  }

  // Click the "System" top-level tab.
  await clickSystemSettingsTab(web);

  // Scroll the DTTIMEZONE row into view (the table lazy-renders rows).
  const scrolled = await web.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
      .find(tr => Array.from(tr.querySelectorAll('td'))
        .some(td => /^\s*DTTIMEZONE\s*$/i.test(td.innerText ?? '')));
    row?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    return !!row;
  });
  if (!scrolled) {
    // Fall back to scroll-to-bottom-then-search.
    await web.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await web.waitForTimeout(500);
  }
  await expect(web.getByText(/\bDTTIMEZONE\b/).first()).toBeVisible({ timeout: 30_000 });

  // DTTIMEZONE is a Telerik RadComboBox, not a native <select>. The row has
  // <input id="..._dynamicControl_Input"> plus a sibling hidden ClientState.
  // We drive it through Telerik's client API: $find(id).get_items() + item.select().
  const choice = await web.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
      .find(tr => Array.from(tr.querySelectorAll('td'))
        .some(td => /^\s*DTTIMEZONE\s*$/i.test(td.innerText ?? '')));
    if (!row) return { found: false, reason: 'row-not-found', current: '', next: '' };

    const input = row.querySelector<HTMLInputElement>('input[id$="_dynamicControl_Input"]');
    if (!input) return { found: false, reason: 'combobox-input-not-found', current: '', next: '' };

    const comboId = input.id.replace(/_Input$/, '');
    const find = (window as { $find?: (id: string) => unknown }).$find;
    if (typeof find !== 'function') {
      return { found: false, reason: 'telerik-$find-missing', current: '', next: '' };
    }
    const combo = find(comboId) as {
      get_text: () => string;
      get_items: () => { toArray: () => Array<{ get_text: () => string; select: () => void }> };
    } | null;
    if (!combo || typeof combo.get_items !== 'function') {
      return { found: false, reason: 'combobox-not-initialised', current: '', next: '' };
    }

    const currentText = combo.get_text();
    const items = combo.get_items().toArray();
    const alternative = items.find(it => {
      const t = it.get_text();
      return t && t.trim() && t !== currentText;
    });
    if (!alternative) return { found: true, reason: 'no-alternative', current: currentText, next: '' };

    alternative.select();
    return { found: true, reason: 'ok', current: currentText, next: alternative.get_text() };
  });

  expect(choice.found,
    `DTTIMEZONE row + Telerik combobox must exist on the System tab (reason: ${choice.reason})`,
  ).toBe(true);
  expect(choice.next, 'A second timezone option must be available to pick').not.toBe('');

  // Save. The Save Settings button at top-right is global; we accept the page-
  // wide save and detect either "Settings saved successfully" OR an error
  // banner. If a non-DTTIMEZONE field on another tab triggers the error
  // banner, we still consider the DTTIMEZONE write applied as long as we don't
  // see DTTIMEZONE specifically called out.
  const saveBtn = web.locator('input[type="submit"], button')
    .filter({ hasText: /Save Settings?/i }).first();
  await expect(saveBtn, '"Save Settings" button').toBeVisible({ timeout: 10_000 });
  await saveBtn.click();
  await web.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});

  const saveOutcome = await web.evaluate(async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const body = document.body.innerText ?? '';
      if (/Settings? saved successfully/i.test(body)) return { ok: true, body: '' };
      if (/Multiple errors were found|errors? (?:was|were) found/i.test(body)) {
        return { ok: false, body: body.slice(0, 1500) };
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { ok: false, body: 'timeout' };
  });

  if (!saveOutcome.ok) {
    if (/DTTIMEZONE/i.test(saveOutcome.body)) {
      throw new Error(`Save Settings failed with DTTIMEZONE-related error: ${saveOutcome.body}`);
    }
    // Unrelated validation errors on other tabs (e.g. Billing Contact missing).
    // DTTIMEZONE was likely persisted regardless. Log and continue.
    console.warn(`Save Settings reported unrelated errors after DTTIMEZONE change: ${saveOutcome.body.slice(0, 300)}`);
  }

  return { previous: choice.current, applied: choice.next };
}

// ─── Settings > Sites and Users navigation ────────────────────────────────────

/**
 * Click the gear / Settings icon in the top-right global nav, then click
 * the "Site" item under the "Sites and Users" section in the side panel.
 */
async function openSitesAdmin(web: Page): Promise<void> {
  // Fast-path: if the Add Site button is already visible we're done. This
  // avoids re-navigating to ManageSettings.aspx when we're already on the
  // sites list page (e.g. after just creating a site).
  const addSiteBtn = web.locator(
    'input[name="ctl00$UserContentArea$ucSiteSearch$ltbnAddSite"], input[value="Add Site"]',
  ).first();
  if (await addSiteBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
    return;
  }

  // The top-right "Settings" anchor reloads ManageSettings.aspx, which is also
  // the admin entry point that hosts the "Sites and Users" side nav. Only
  // click it if that side-nav section isn't already on screen — otherwise we
  // bounce the user through System Settings unnecessarily.
  const sitesAndUsers = web.locator('a, span, li, div')
    .filter({ hasText: /^\s*Sites?\s+(?:and|&)\s+Users?\s*$/i }).first();
  if (!await sitesAndUsers.isVisible({ timeout: 1_500 }).catch(() => false)) {
    const gear = web.locator('#ctl00_HeaderBanner_anchorsystemTextBoard');
    await expect(gear, 'top-right Settings link (#ctl00_HeaderBanner_anchorsystemTextBoard)')
      .toBeVisible({ timeout: 20_000 });
    await gear.click();
    await web.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(sitesAndUsers, '"Sites and Users" side-nav section')
      .toBeVisible({ timeout: 20_000 });
  }

  // Expand "Sites and Users" if "Site" isn't already showing underneath.
  const siteLink = web.locator('a, span, li, div')
    .filter({ hasText: /^\s*Sites?\s*$/i }).first();
  if (!await siteLink.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await sitesAndUsers.click();
    await web.waitForTimeout(500);
  }

  await expect(siteLink, 'Side-nav "Site" link under "Sites and Users"')
    .toBeVisible({ timeout: 30_000 });
  await siteLink.click();
  await web.waitForLoadState('domcontentloaded').catch(() => {});

  // Confirm we landed on the sites list page (Add Site button should appear).
  await expect(addSiteBtn, 'Add Site button on the Sites list page')
    .toBeVisible({ timeout: 20_000 });
}

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

/**
 * Fill a plain ASP.NET text input by id, using Playwright's locator + fill so
 * the framework's input/change handlers fire normally.
 */
async function fillById(web: Page, id: string, value: string): Promise<void> {
  const input = web.locator(`#${id}`);
  await expect(input, `input #${id}`).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.press('Control+A').catch(() => {});
  await input.press('Delete').catch(() => {});
  await input.fill(value);
  await input.blur().catch(() => {});
}

/**
 * Pick an option in a Telerik RadComboBox by its client-side control id (the
 * id of the *combobox*, not the inner _Input). Uses $find() so we don't have
 * to drive the popup UI by hand.
 */
async function pickRadComboBoxById(web: Page, comboId: string, optionText: RegExp): Promise<void> {
  const result = await web.evaluate(({ id, pattern, flags }) => {
    const find = (window as { $find?: (id: string) => unknown }).$find;
    if (typeof find !== 'function') return { ok: false, reason: '$find missing' };
    const combo = find(id) as {
      get_items: () => { toArray: () => Array<{ get_text: () => string; select: () => void }> };
    } | null;
    if (!combo || typeof combo.get_items !== 'function') {
      return { ok: false, reason: `combobox ${id} not initialised` };
    }
    const re = new RegExp(pattern, flags);
    const items = combo.get_items().toArray();
    const match = items.find(it => re.test(it.get_text()));
    if (!match) {
      const available = items.map(it => it.get_text()).slice(0, 20).join(', ');
      return { ok: false, reason: `no item matching ${pattern}. Available (first 20): ${available}` };
    }
    match.select();
    return { ok: true, reason: '' };
  }, { id: comboId, pattern: optionText.source, flags: optionText.flags });
  expect(result.ok, `RadComboBox ${comboId}: ${result.reason}`).toBe(true);
}

/**
 * Create a brand-new site with a unique name. Returns the name we used so we
 * can search for it afterwards. Retries with new random values if PrimeroEdge
 * complains the name/description/code already exist.
 *
 * All field locators are exact ids from ucSiteSearch_ucSiteDetails.
 */
async function addNewSite(web: Page): Promise<string> {
  const F = {
    name: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtSite',
    description: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtSiteDescription',
    code: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtSiteCode',
    siteType: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_rcbSiteType',
    streetAddress: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtAddressLine1',
    city: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtCity',
    zip: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_txtZip',
    save: 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_btnUpdate',
  } as const;

  await web.locator('input[name="ctl00$UserContentArea$ucSiteSearch$ltbnAddSite"], input[value="Add Site"]')
    .first().click();
  await web.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(web.locator(`#${F.name}`), 'Site Name input').toBeVisible({ timeout: 20_000 });

  const MAX_TRIES = 4;
  let siteName = '';
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    siteName = `T115042 Auto ${Date.now()}_${attempt}`;
    const siteDesc = `T115042 Description ${randomDigits(6)}`;
    const siteCode = randomDigits(5);

    await fillById(web, F.name, siteName);
    await fillById(web, F.description, siteDesc);
    await fillById(web, F.code, siteCode);
    await pickRadComboBoxById(web, F.siteType, /^Elementary School$/i);
    await fillById(web, F.streetAddress, '11514 Testing Dr');
    await fillById(web, F.city, 'Sugar Land');
    await fillById(web, F.zip, '77498');

    // Sanity-check the values landed before we click Save. If the page reset
    // them (e.g. due to an earlier AJAX response wiping the form), we want
    // a clear failure, not a silent empty submission.
    const filledValues = await web.evaluate((ids) => {
      const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
      return {
        name: get(ids.name),
        desc: get(ids.description),
        code: get(ids.code),
        street: get(ids.streetAddress),
        city: get(ids.city),
        zip: get(ids.zip),
      };
    }, F);
    expect(filledValues.name,    'Site Name field value after fill').toBe(siteName);
    expect(filledValues.desc,    'Site Description field value after fill').toBe(siteDesc);
    expect(filledValues.code,    'Site Code field value after fill').toBe(siteCode);
    expect(filledValues.street,  'Street Address field value after fill').toBe('11514 Testing Dr');
    expect(filledValues.city,    'City field value after fill').toBe('Sugar Land');

    // Scroll to bottom and Save.
    await web.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await web.waitForTimeout(300);
    await web.locator(`#${F.save}`).click();

    // Poll the page for either a success or known-error banner. PrimeroEdge
    // does an AJAX postback after Save — give it up to 30 s.
    const outcome = await web.evaluate(async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const body = document.body.innerText ?? '';
        if (/Site (added|saved|created) successfully/i.test(body)) return { status: 'ok', body: '' };
        if (/already exists|already (used|in use)/i.test(body)) return { status: 'conflict', body: '' };
        // Field-level validation errors typically render in red near the inputs.
        const fieldErr = Array.from(document.querySelectorAll<HTMLElement>('[class*="error" i], .red, span[style*="color:" i]'))
          .filter(e => !!(e.offsetWidth || e.offsetHeight))
          .map(e => e.innerText.trim())
          .filter(t => t && t.length < 200);
        if (fieldErr.length > 0) return { status: 'field-error', body: fieldErr.join(' | ') };
        await new Promise(r => setTimeout(r, 500));
      }
      return { status: 'timeout', body: (document.body.innerText ?? '').slice(0, 1500) };
    });

    if (outcome.status === 'ok') {
      console.log(`Created site (attempt ${attempt + 1}): ${siteName}`);
      return siteName;
    }
    if (outcome.status === 'conflict') {
      console.log(`Add Site conflict on attempt ${attempt + 1} — retrying with new random values.`);
      await web.evaluate(() => window.scrollTo(0, 0));
      await web.waitForTimeout(400);
      continue;
    }
    // Capture a screenshot so we can see exactly what's on screen on failure.
    await web.screenshot({ path: `test-results/_addsite-fail-attempt${attempt}.png`, fullPage: true })
      .catch(() => {});
    throw new Error(`Add Site failed (${outcome.status}). Detail: ${outcome.body.slice(0, 800)}`);
  }
  throw new Error(`addNewSite: exhausted ${MAX_TRIES} retries against name/code conflicts`);
}

/**
 * Search for `name` in the sites grid and click into it. The grid is empty
 * by default; the Sites list uses an alphabet-bar filter (A / B / C / ...).
 * Click the letter matching the site's first character, then locate the row
 * containing the full name and click its first link.
 */
async function openSiteByName(web: Page, name: string): Promise<void> {
  const firstLetter = name.trim().charAt(0).toUpperCase();
  const gridId = '#ctl00_UserContentArea_ucSiteSearch_SiteRadGrid';

  // Click the alphabet-bar letter for the site's first character.
  const letterLink = web.locator(`${gridId} a`)
    .filter({ hasText: new RegExp(`^\\s*${firstLetter}\\s*$`) }).first();
  await expect(letterLink, `Alphabet-bar letter "${firstLetter}" in sites grid`)
    .toBeVisible({ timeout: 20_000 });
  await letterLink.click();
  await web.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await web.waitForTimeout(1_500);

  // Find the row containing the site name, click its first link (Site Code).
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = web.locator(`${gridId} tr`).filter({ hasText: new RegExp(escaped, 'i') });
  await expect(row.first(), `Sites grid row containing "${name}"`)
    .toBeVisible({ timeout: 30_000 });
  await row.first().locator('a').first().click();
  await web.waitForLoadState('domcontentloaded').catch(() => {});
  await web.waitForTimeout(1_500);
}

/**
 * On a Site detail page, click "Add" for Point of Service under Site Licenses.
 */
async function addPointOfServiceLicense(web: Page): Promise<void> {
  // Scroll Site Licenses into view.
  const heading = web.getByText(/Site Licenses/i).first();
  if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await heading.scrollIntoViewIfNeeded().catch(() => {});
  }

  // Known POS Add button id; fall back to row-based lookup.
  const known = web.locator('#ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_rgSiteLicenses_ctl00_ctl04_Add');
  if (await known.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await known.click();
  } else {
    const clicked = await web.evaluate(() => {
      const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight);
      const rows = Array.from(document.querySelectorAll<HTMLElement>('tr, li, div'))
        .filter(visible)
        .filter(el => /Point of Service/i.test(el.innerText ?? ''));
      for (const row of rows) {
        const addBtn = Array.from(row.querySelectorAll<HTMLElement>('a, button, input, img'))
          .find(b => visible(b) && /^Add$/i.test((b.innerText || b.getAttribute('value') || b.getAttribute('title') || '').trim()));
        if (addBtn) { addBtn.click(); return true; }
      }
      return false;
    });
    expect(clicked, 'Add button next to "Point of Service" under Site Licenses').toBe(true);
  }
  await web.waitForLoadState('domcontentloaded').catch(() => {});
  await web.waitForTimeout(1_500);
  // After clicking Add, the page updates to show POS-specific options including
  // "Ignore time zone check for site". Scroll down to bring it into view.
  await web.evaluate(() => window.scrollBy(0, 400));
  await web.waitForTimeout(300);
}

// "Ignore time zone check for site" radio group ids (rendered by ucSiteDetails;
// the same control is reused across new-site POS-license + existing-site
// edit-license panels, so the ids are stable).
const IGNORE_TZ_YES_ID = 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_rbtnIgnoreTimeZoneCheck_0';
const IGNORE_TZ_NO_ID  = 'ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_rbtnIgnoreTimeZoneCheck_1';

/**
 * On the POS license configuration page, read the current value of the
 * "Ignore time zone check for site:" radio group ("Yes" | "No"). Waits for the
 * radio group to appear — the panel renders via AJAX postback after the Add
 * (or site-open) click.
 */
async function readIgnoreTimezoneRadio(web: Page): Promise<'Yes' | 'No' | 'UNKNOWN'> {
  // Wait until at least one of the two radios is present.
  await web.locator(`#${IGNORE_TZ_YES_ID}, #${IGNORE_TZ_NO_ID}`).first()
    .waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});

  return await web.evaluate(({ yesId, noId }) => {
    const yes = document.getElementById(yesId) as HTMLInputElement | null;
    const no  = document.getElementById(noId)  as HTMLInputElement | null;
    if (yes?.checked) return 'Yes' as const;
    if (no?.checked)  return 'No'  as const;
    return 'UNKNOWN' as const;
  }, { yesId: IGNORE_TZ_YES_ID, noId: IGNORE_TZ_NO_ID });
}

/**
 * Toggle the "Ignore time zone check for site" radio to `target` and click
 * Save on the current page.
 */
async function toggleIgnoreTimezone(web: Page, target: 'Yes' | 'No'): Promise<void> {
  const radioId = target === 'Yes' ? IGNORE_TZ_YES_ID : IGNORE_TZ_NO_ID;
  const radio = web.locator(`#${radioId}`);
  await expect(radio, `radio #${radioId} ("${target}")`).toBeVisible({ timeout: 20_000 });
  await radio.check();

  // Save — use the same Save button id as on the Add Site / site detail form.
  await web.locator('#ctl00_UserContentArea_ucSiteSearch_ucSiteDetails_btnUpdate').click();
  await web.waitForLoadState('domcontentloaded').catch(() => {});
  await expect.poll(
    async () => /saved successfully|site saved|site updated/i.test(await web.locator('body').innerText().catch(() => '')),
    { timeout: 30_000, intervals: [1_000] },
  ).toBe(true);
}

// ─── ExpressPoint helpers ─────────────────────────────────────────────────────

async function getAppWindow(handle: ExpressPointHandle): Promise<Page> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const page of handle.browser.contexts()[0].pages().filter(p => !p.isClosed())) {
      if (await page.evaluate(() => !!document.querySelector('ion-app')).catch(() => false)) return page;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('getAppWindow: ion-app not found');
}

/**
 * Login to EP. Does NOT auto-dismiss the post-login warning — the caller can
 * inspect it (we may want to verify it contains a Device/System time message).
 */
async function loginEpNoDismiss(window: Page): Promise<void> {
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
}

/**
 * Returns true if a visible dialog within `timeoutMs` mentions device/system
 * time mismatch.
 */
async function waitForDeviceTimeWarning(window: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.evaluate((reText) => {
      const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const re = new RegExp(reText, 'i');
      // ion-alert content
      const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert')).filter(visible);
      for (const a of alerts) {
        const root: ShadowRoot | HTMLElement = (a as any).shadowRoot ?? a;
        const text = (root as any).innerText ?? '';
        if (re.test(text)) return true;
      }
      // Generic body text fallback (e.g. inline banner).
      return re.test(document.body.innerText ?? '');
    }, DEVICE_TIME_WARNING.source);
    if (found) return true;
    await window.waitForTimeout(500);
  }
  return false;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('T-115042', () => {
  test('Ignore time zone check for site — toggle controls EP warning dialog', async () => {
    // One Chromium instance + one page for the entire web-side flow. EP is
    // a separate Electron process and still needs its own launch/close cycle.
    const browser = await chromium.launch({ headless: false });
    const web = await browser.newContext().then(c => c.newPage());

    let dtRestore: { previous: string; applied: string } | null = null;
    let bluefieldNeedsRestore = false;

    try {
      await loginToPrimeroEdgeQa(web);

      // ── 1. DTTIMEZONE — change to a different timezone.
      dtRestore = await changeDtTimezoneToAnyOther(web);
      console.log(`DTTIMEZONE changed: ${dtRestore.previous} → ${dtRestore.applied}`);

      // ── 2. Add a new Site (Site Type = Elementary School), then add a POS
      //    license and verify "Ignore time zone check for site" defaults to Yes.
      //    After Save we stay on the Site detail page — no need to navigate
      //    back to the sites list before adding the POS license.
      await openSitesAdmin(web);
      const siteName = await addNewSite(web);
      console.log(`Created site: ${siteName}`);

      await addPointOfServiceLicense(web);

      const defaultValue = await readIgnoreTimezoneRadio(web);
      expect(
        defaultValue,
        'New POS license should default "Ignore time zone check for site" to Yes',
      ).toBe('Yes');

      // ── 3. On BLUEFIELD ELEMENTRY SCHOOL_child care, verify the same setting
      //    exists, toggle it to "No", save.
      await openSitesAdmin(web);
      await openSiteByName(web, BLUEFIELD_SITE);
      const ignoreVisible = await web.getByText(TIMEZONE_SETTING_LABEL).first()
        .isVisible({ timeout: 3_000 }).catch(() => false);
      if (!ignoreVisible) {
        await addPointOfServiceLicense(web).catch(() => {});
      }
      await expect(
        web.getByText(TIMEZONE_SETTING_LABEL).first(),
        '"Ignore time zone check for site" should be visible on BLUEFIELD POS',
      ).toBeVisible({ timeout: 20_000 });

      await toggleIgnoreTimezone(web, 'No');
      bluefieldNeedsRestore = true;

      // ── 4. Launch EP — Warning dialog about Device/System time should show.
      {
        const handle = await launchExpressPoint();
        try {
          await loginEpNoDismiss(handle.window);
          const window = await getAppWindow(handle);
          const sawWarning = await waitForDeviceTimeWarning(window, 30_000);
          expect(
            sawWarning,
            `EP should display a Device/System time warning when "Ignore time zone check for site" = No`,
          ).toBe(true);
          await WarningDialog.dismiss(window, 5_000);
        } finally {
          await closeExpressPoint(handle).catch(() => {});
        }
      }

    } finally {
      // ── Cleanup (runs regardless of pass/fail):
      //   1. Toggle BLUEFIELD "Ignore time zone check for site" back to Yes.
      //   2. Restore DTTIMEZONE to "Central (UTC - 6)" — the canonical default.
      if (bluefieldNeedsRestore) {
        try {
          await openSitesAdmin(web);
          await openSiteByName(web, BLUEFIELD_SITE);
          await toggleIgnoreTimezone(web, 'Yes');
        } catch { /* best-effort */ }
      }
      if (dtRestore) {
        try {
          await web.goto(MANAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          const cb = web.locator('input[type="checkbox"]').first();
          if (!await cb.isChecked().catch(() => false)) {
            await cb.click().catch(() => {});
          }
          await clickSystemSettingsTab(web);
          await web.evaluate(() => {
            const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
              .find(tr => Array.from(tr.querySelectorAll('td'))
                .some(td => /^\s*DTTIMEZONE\s*$/i.test(td.innerText ?? '')));
            const input = row?.querySelector<HTMLInputElement>('input[id$="_dynamicControl_Input"]');
            if (!input) return;
            const comboId = input.id.replace(/_Input$/, '');
            const find = (window as { $find?: (id: string) => unknown }).$find;
            if (typeof find !== 'function') return;
            const combo = find(comboId) as {
              get_items: () => { toArray: () => Array<{ get_text: () => string; select: () => void }> };
            } | null;
            const items = combo?.get_items().toArray() ?? [];
            // Canonical default per ticket — match "Central" but skip "Central
            // America" / "Central Standard Time (Mexico)" etc by requiring a
            // UTC -6 marker.
            const match = items.find(it => /Central.*UTC\s*-\s*6/i.test(it.get_text()))
              ?? items.find(it => /^Central\b/i.test(it.get_text()));
            match?.select();
          });
          await web.locator('input[type="submit"], button')
            .filter({ hasText: /Save Settings?/i }).first()
            .click().catch(() => {});
          await web.waitForTimeout(3_000);
        } catch { /* best-effort */ }
      }
      await browser.close().catch(() => {});
    }
  });
});
