import { expect, Page } from '@playwright/test';

const MANAGE_SETTINGS_URL = 'https://qa.primeroedge.co/System/ManageSettings.aspx';

export type SettingValue = string;
export type SettingsMap = Record<string, SettingValue>;

/**
 * Navigate to ManageSettings.aspx, enable "Show Internal Settings" if needed,
 * then set every entry in `settings` to its requested value, and click Save
 * once. Returns the previous values so callers can restore them at the end.
 */
export async function setSettings(webPage: Page, settings: SettingsMap): Promise<SettingsMap> {
  await webPage.goto(MANAGE_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Enable "Show Internal Settings" if its checkbox isn't already checked.
  const showInternalCb = webPage.locator('input[type="checkbox"]').first();
  if (!await showInternalCb.isChecked().catch(() => false)) {
    await showInternalCb.click();
    await webPage.waitForLoadState('domcontentloaded').catch(() => {});
  }

  // Wait for one of the settings codes to appear so we know the page is rendered.
  const firstName = Object.keys(settings)[0];
  await expect(webPage.getByText(new RegExp(`\\b${firstName}\\b`, 'i')).first())
    .toBeVisible({ timeout: 30_000 });

  // Scroll once to force lazy rows to render.
  await webPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await webPage.waitForTimeout(500);
  await webPage.evaluate(() => window.scrollTo(0, 0));
  await webPage.waitForTimeout(300);

  const previous: SettingsMap = {};

  // Process each setting one at a time: locate its row, scroll it into view,
  // toggle/select/fill the value, then move on to the next. Save once at the end.
  for (const [name, target] of Object.entries(settings)) {
    // 1. Locate the row containing the setting code. The grid lazy-renders
    //    rows as you scroll, so a single scrollIntoView only works if the
    //    row is already in the DOM. Walk the page top-to-bottom until the
    //    row appears, then scroll it to center.
    const found = await scrollUntilSettingFound(webPage, name);
    if (!found) {
      // Best-effort: scroll back to top so the next setting starts fresh.
      await webPage.evaluate(() => window.scrollTo(0, 0));
      await webPage.waitForTimeout(150);
    }

    // 2. Detect input kind + capture previous value + apply the change.
    const result = await webPage.evaluate(
      ({ code, want }) => {
        const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
          .find(tr => Array.from(tr.querySelectorAll('td'))
            .some(td => td.innerText?.trim() === code));
        if (!row) return { previous: 'NOT_FOUND', applied: false, kind: 'none' as const };

        const labelOf = (r: HTMLInputElement): string =>
          r.labels?.[0]?.innerText?.trim()
          ?? r.closest('label')?.innerText?.trim()
          ?? r.value
          ?? r.id
          ?? '';

        const radios = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

        // ── Dropdown row (<select>) — pick option whose text matches.
        if (radios.length === 0) {
          const select = row.querySelector<HTMLSelectElement>('select');
          if (select) {
            const wantUpper = want.trim().toUpperCase();
            const previous = (select.options[select.selectedIndex]?.text ?? select.value).toUpperCase();
            const option = Array.from(select.options).find(opt => {
              const text = (opt.text || opt.value || '').trim().toUpperCase();
              return text === wantUpper || text.includes(wantUpper);
            });
            if (!option) return { previous, applied: false, kind: 'select' as const };
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { previous, applied: true, kind: 'select' as const };
          }

          // ── Text-input row (TEROFFA, BONUSTHRES, BONUSAMT, etc) — fill inline.
          const textInput = row.querySelector<HTMLInputElement>('input[type="text"], input:not([type]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])');
          if (!textInput) return { previous: 'NO_INPUT', applied: false, kind: 'none' as const };
          const previous = textInput.value || 'EMPTY';
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          proto?.set?.call(textInput, want);
          textInput.dispatchEvent(new Event('input', { bubbles: true }));
          textInput.dispatchEvent(new Event('change', { bubbles: true }));
          textInput.blur();
          return { previous, applied: true, kind: 'text' as const };
        }

        // ── Radio row — Yes/No.
        const previousLabel = radios.find(r => r.checked);
        const previous = previousLabel ? labelOf(previousLabel).toUpperCase() : 'UNKNOWN';

        const wantUpper = want.trim().toUpperCase();
        const matching = radios.find(r => {
          const lbl = labelOf(r).toUpperCase();
          return lbl === wantUpper || lbl.startsWith(wantUpper.charAt(0));
        });
        if (!matching) return { previous, applied: false, kind: 'radio' as const };
        if (matching.checked) return { previous, applied: true, kind: 'radio' as const };

        matching.click();
        matching.dispatchEvent(new Event('change', { bubbles: true }));

        const lbl = matching.labels?.[0] as HTMLLabelElement | undefined;
        if (lbl && visible(lbl)) lbl.click();

        return { previous, applied: true, kind: 'radio' as const };
      },
      { code: name, want: target },
    );

    if (result.previous === 'NOT_FOUND') {
      throw new Error(`setSettings: setting "${name}" not found on ManageSettings.aspx`);
    }
    if (!result.applied) {
      throw new Error(`setSettings: could not apply value "${target}" for setting "${name}"`);
    }
    previous[name] = result.previous;
    // Brief pause between settings so the page can re-render between toggles.
    await webPage.waitForTimeout(200);
  }

  await webPage.waitForTimeout(400);

  // Save once. Confirmation banner reads "Settings saved successfully".
  const saveBtn = webPage.locator('input[type="submit"], button')
    .filter({ hasText: /Save Settings?/i }).first();
  await expect(saveBtn).toBeVisible({ timeout: 10_000 });
  await saveBtn.click();
  await webPage.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await expect(webPage.getByText(/Settings? saved successfully/i).first())
    .toBeVisible({ timeout: 30_000 });

  return previous;
}

/**
 * The Manage Settings grid lazy-renders rows as you scroll, so a single
 * scroll-to-bottom doesn't guarantee a given setting's row is in the DOM at
 * search time. Walk top-to-bottom in increments, checking after each scroll
 * whether the target code's row has appeared. Returns true if found (and
 * centers it), false if we hit the bottom without finding it.
 */
async function scrollUntilSettingFound(webPage: Page, code: string): Promise<boolean> {
  // Try top first — many settings render immediately.
  await webPage.evaluate(() => window.scrollTo(0, 0));
  await webPage.waitForTimeout(100);

  const STEP = 600;
  const MAX_STEPS = 50;
  for (let i = 0; i < MAX_STEPS; i++) {
    const result = await webPage.evaluate((c: string) => {
      const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
        .find(tr => Array.from(tr.querySelectorAll('td'))
          .some(td => td.innerText?.trim() === c));
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        return { found: true, atBottom: false };
      }
      const atBottom = (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 5;
      return { found: false, atBottom };
    }, code);

    if (result.found) {
      await webPage.waitForTimeout(150);
      return true;
    }
    if (result.atBottom) return false;

    await webPage.evaluate((step: number) => window.scrollBy(0, step), STEP);
    await webPage.waitForTimeout(150);
  }
  return false;
}
