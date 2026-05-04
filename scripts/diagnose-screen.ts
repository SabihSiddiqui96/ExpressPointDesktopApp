/**
 * Diagnostic: dumps visible buttons and ion-items after login + openService
 * Run with: npx ts-node scripts/diagnose-screen.ts
 */
import { chromium } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint } from '../utils/launch';
import { LoginPage } from '../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../utils/env';

(async () => {
  const handle = await launchExpressPoint();
  const { window } = handle;

  // Login
  const loginPage = new LoginPage(window);
  await loginPage.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
  await window.waitForTimeout(3000);

  // Dismiss warning if present
  await window.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
    for (const alert of alerts) {
      const visible = !!(alert.offsetWidth || alert.offsetHeight || alert.getClientRects().length);
      if (!visible) continue;
      const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
      const buttons = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'));
      const okBtn = buttons.find(b => /ok/i.test((b.innerText || b.textContent || '').trim()));
      if (okBtn) { okBtn.click(); }
    }
  });
  await window.waitForTimeout(1000);

  // Continue or Open Service
  const continueItem = window.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
  if (await continueItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('>> Clicking Continue Service');
    await continueItem.click();
  } else {
    console.log('>> Clicking Open Service');
    await window.locator('ion-item[detail]').filter({ hasText: /^Open Service$/i }).first().click({ timeout: 10000 });
    await window.waitForTimeout(1500);
    await window.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
      for (const alert of alerts) {
        const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
        const btn = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'))
          .find(b => /ok/i.test((b.innerText || b.textContent || '').trim()));
        if (btn) btn.click();
      }
    });
    await window.waitForTimeout(500);
    await window.getByRole('button', { name: /open service/i }).last().click().catch(() => {});
  }

  await window.waitForTimeout(2000);
  await window.screenshot({ path: 'diagnose-initial.png' });
  console.log('>> Screenshot: diagnose-initial.png');

  // Dismiss warning if present
  await window.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll<HTMLElement>('ion-alert'));
    for (const alert of alerts) {
      const root: ShadowRoot | HTMLElement = (alert as any).shadowRoot ?? alert;
      const btn = Array.from(root.querySelectorAll<HTMLElement>('.alert-button, button'))
        .find(b => /ok/i.test((b.innerText || b.textContent || '').trim()));
      if (btn) { btn.click(); return; }
    }
    // fallback
    const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, ion-button'));
    const okBtn = allBtns.find(b =>
      !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
      && /^ok$/i.test((b.innerText || b.textContent || '').trim()),
    );
    if (okBtn) okBtn.click();
  });
  await window.waitForTimeout(1000);

  // Step 1: Click the "Menu" toolbar button (coordinate-based)
  const menuBtn = window.locator('ion-button').filter({ hasText: /^menu$/i }).first();
  await menuBtn.waitFor({ state: 'visible', timeout: 5000 });
  await menuBtn.click();
  console.log('>> Clicked Menu toolbar button');

  // Step 2: Wait for the Save button to confirm the dialog opened
  const saveBtn = window.locator('ion-button, button').filter({ hasText: /^save$/i }).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => console.log('Save btn not visible'));

  // Dump what's in the dialog
  const dlgItems = await window.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('ion-item'))
      .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map(el => ({ text: (el.innerText || el.textContent || '').trim(), tag: el.tagName }));
  });
  console.log('>> Dialog ion-items:', JSON.stringify(dlgItems));

  // Step 3: Click the first non-empty ion-item (the Supper-9 option)
  const clicked = await window.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('ion-item'))
      .filter(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const text = (el.innerText || el.textContent || '').trim();
        return visible && text.length > 0;
      });
    if (items.length > 0) { items[0].click(); return (items[0].innerText || items[0].textContent || '').trim(); }
    return null;
  });
  console.log('>> Clicked menu item:', clicked);
  await window.waitForTimeout(500);

  // Step 4: Click Save
  const saved = await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /^save$/i.test((el.innerText || el.textContent || '').trim()),
      );
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('>> Clicked Save:', saved);
  await window.waitForTimeout(2000);

  await window.screenshot({ path: 'diagnose-after-menu-grid.png' });
  console.log('>> Screenshot: diagnose-after-menu-grid.png');

  // Dump buttons to see if toolbar changed
  const toolbar = await window.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.top < 80 && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      })
      .map(el => (el.innerText || el.textContent || '').trim());
  });
  console.log('>> Toolbar buttons after save:', toolbar);

  // Step 5: Click Program Adult
  await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /program adult/i.test((el.innerText || el.textContent || '').trim()),
      );
    if (btn) btn.click();
  });
  console.log('>> Clicked Program Adult');
  await window.waitForTimeout(2000);
  await window.screenshot({ path: 'diagnose-after-account.png' });

  // Get coordinates of all left-panel food items
  const leftItems = await window.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('ion-button'))
      .filter(el => {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const rect = el.getBoundingClientRect();
        return visible && rect.left < 1500 && rect.top > 50 && rect.width > 100;
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (ra.top - rb.top) || (ra.left - rb.left);
      })
      .map(el => {
        const r = el.getBoundingClientRect();
        return { text: (el.innerText || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
  });
  console.log('>> Left-panel items with coords:', JSON.stringify(leftItems));

  // Try window.mouse.click() (real mouse event) on each item until order changes
  for (const item of leftItems) {
    await window.mouse.click(item.x, item.y);
    await window.waitForTimeout(800);
    const orderText = await window.evaluate(() => {
      const page = document.querySelector<HTMLElement>('.ion-page:not(.ion-page-hidden)');
      return page?.innerText?.replace(/\s+/g, ' ').substring(0, 1000) ?? '';
    });
    const section = orderText.substring(Math.max(0, orderText.indexOf('Prog Adult'))).substring(0, 200).trim();
    console.log(`>> mouse.click "${item.text}" (${item.x},${item.y}): ${section}`);
    if (!orderText.includes('No items selected')) {
      console.log('>> ORDER CHANGED!');
      break;
    }
  }

  await window.waitForTimeout(1000);
  await window.screenshot({ path: 'diagnose-after-food.png' });
  console.log('>> Screenshot: diagnose-after-food.png');

  const pt2 = await window.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.ion-page:not(.ion-page-hidden)');
    return page?.innerText?.replace(/\s+/g, ' ').substring(0, 3000) ?? '';
  });
  console.log('\n=== PAGE TEXT AFTER MOUSE CLICKS ===\n', pt2);

  // Step 7: Click Pay using evaluate
  await window.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button'))
      .find(el =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        && /^(pay|charge)$/i.test((el.innerText || el.textContent || '').trim()),
      );
    if (btn) btn.click();
  });
  console.log('>> Clicked Pay');
  await window.waitForTimeout(3000);
  await window.screenshot({ path: 'diagnose-payment-screen.png' });
  console.log('>> Screenshot: diagnose-payment-screen.png');

  // Dump ALL visible buttons/items/segment-buttons on payment screen
  const payScreenBtns = await window.evaluate(() => {
    const results: { tag: string; text: string; top: number; left: number }[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>('ion-button, button, ion-segment-button, ion-tab-button, ion-item'));
    for (const el of els) {
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60);
      if (text) results.push({ tag: el.tagName, text, top: Math.round(rect.top), left: Math.round(rect.left) });
    }
    return results.sort((a, b) => a.top - b.top || a.left - b.left);
  });
  console.log('\n=== PAYMENT SCREEN BUTTONS ===');
  for (const b of payScreenBtns) { console.log(`  [${b.tag}] top=${b.top} left=${b.left} | "${b.text}"`); }

  const payPageText = await window.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.ion-page:not(.ion-page-hidden)');
    return page?.innerText?.replace(/\s+/g, ' ').substring(0, 3000) ?? '';
  });
  console.log('\n=== PAYMENT SCREEN TEXT ===\n', payPageText);

  // Dump all visible interactive + text elements with their position
  const info = await window.evaluate(() => {
    const results: { tag: string; text: string; top: number; left: number; width: number }[] = [];
    // Cast to string union to avoid TS narrowing issues
    const selectors = 'ion-button, button, ion-item, ion-segment-button, ion-tab-button, ion-card, ion-chip, [role=button], .menu-item, .food-item';
    const els = Array.from(document.querySelectorAll<HTMLElement>(selectors));
    for (const el of els) {
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60);
      if (text) results.push({ tag: el.tagName, text, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) });
    }
    return results.sort((a, b) => a.top - b.top || a.left - b.left);
  });

  console.log('\n=== VISIBLE BUTTONS / ITEMS (sorted by position) ===');
  for (const item of info) {
    console.log(`  [${item.tag}] top=${item.top} left=${item.left} w=${item.width} | "${item.text}"`);
  }

  // Also dump all visible text nodes to catch any plain-text selectors
  const bodyText = await window.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.ion-page:not(.ion-page-hidden)');
    return page?.innerText?.replace(/\s+/g, ' ').substring(0, 3000) ?? '';
  });
  console.log('\n=== VISIBLE PAGE TEXT ===\n', bodyText);

  // Dump left-side elements (potential food/menu items at left < 1500)
  const leftSide = await window.evaluate(() => {
    const results: { tag: string; text: string; top: number; left: number; width: number }[] = [];
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left > 1500 || rect.width < 20 || rect.height < 20) continue;
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => (n.textContent ?? '').trim())
        .join(' ').trim();
      if (ownText.length > 1) {
        results.push({ tag: el.tagName, text: ownText.substring(0, 60), top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) });
      }
    }
    return results.sort((a, b) => a.top - b.top || a.left - b.left).slice(0, 60);
  });
  console.log('\n=== LEFT-SIDE ELEMENTS (left<1500) ===');
  for (const item of leftSide) {
    console.log(`  [${item.tag}] top=${item.top} left=${item.left} w=${item.width} | "${item.text}"`);
  }

  await closeExpressPoint(handle);
})();
