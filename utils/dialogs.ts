import { Page } from '@playwright/test';

/**
 * Centralised handler for the recurring "Warning" alerts the app can show
 * (e.g. "Square Authorization token expires in N days"). The same dialog can
 * pop up after login, after Open Service, after Close Service, or any other
 * navigation, so every test calls into this helper at key transition points.
 */
export class WarningDialog {
  /**
   * Look for a visible Ionic warning alert and click its OK / Continue button.
   * Polls up to `waitMs` so callers can use this both as "dismiss now if any"
   * (waitMs ≈ 0) and "wait for and dismiss when it appears" (waitMs ≈ 5_000).
   *
   * Returns true if a dialog was dismissed.
   */
  static async dismiss(window: Page, waitMs = 2_000): Promise<boolean> {
    // Fast-path: check ONCE up-front whether a Warning is even present. If not,
    // return immediately so the test can continue — never block waiting for a
    // dialog that may never appear.
    const warningPresent = await window.evaluate(() => {
      const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert')).filter(visible);
      if (alerts.length > 0) return true;
      return /Square Authorization token/i.test(document.body.innerText);
    }).catch(() => false);
    if (!warningPresent) return false;

    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      // Find the smallest visible OK / Continue / Got it element and grab its
      // bounding box. We then mouse.click those coords — both DOM .click() and
      // synthetic events get swallowed by some Ionic alert overlays.
      const box = await window.evaluate(() => {
        const isOk = (t: string) => /^(ok|continue|got it)$/i.test(t.trim());
        const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

        // Pierce ion-alert shadow DOM first.
        for (const alert of Array.from(document.querySelectorAll<HTMLElement>('ion-alert')).filter(visible)) {
          const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
          const btn = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'))
            .find(b => isOk(b.innerText || b.textContent || ''));
          if (btn) {
            const r = btn.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }

        // Plain-DOM modal — pick the leaf-most element (smallest area).
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, ion-button, [role="button"], a, span, div, p'))
          .filter(b => visible(b) && isOk(b.innerText || b.textContent || ''));
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => {
          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
          return (ar.width * ar.height) - (br.width * br.height);
        });
        const r = candidates[0].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }).catch(() => null);

      if (!box) {
        // No OK button present — dialog is already gone (or never appeared).
        if (Date.now() >= deadline) break;
        await window.waitForTimeout(200);
        continue;
      }

      // Real mouse click at the OK button center.
      await window.mouse.click(box.x, box.y).catch(() => {});

      // Ionic alerts have a native dismiss() — call it as a backup if the click
      // didn't take effect.
      await window.evaluate(async () => {
        const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'))
          .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        for (const alert of alerts) {
          const dismiss = (alert as any).dismiss;
          if (typeof dismiss === 'function') {
            try { await dismiss.call(alert); } catch {}
          }
        }
      }).catch(() => {});

      // Wait briefly for the dismiss animation, then verify it's gone.
      const cleared = await window.waitForFunction(() => {
        const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
        const visibleAlert = alerts.some(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        if (visibleAlert) return false;
        return !/Square Authorization token/i.test(document.body.innerText);
      }, { timeout: 5_000 }).then(() => true).catch(() => false);

      if (cleared) return true;
      // Still there — loop and try again.
    } while (Date.now() < deadline);

    return false;
  }
}
