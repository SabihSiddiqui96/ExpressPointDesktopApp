import { launchExpressPoint, closeExpressPoint } from '../utils/launch';
import { LoginPage } from '../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from '../utils/env';

(async () => {
  const handle = await launchExpressPoint();
  try {
    const page = handle.window;
    const login = new LoginPage(page);
    await login.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);
    await page.getByText('Serving Options for', { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 20_000 });

    const continueService = page.locator('ion-item[detail]').filter({ hasText: /Continue Service/i }).first();
    if (await continueService.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await continueService.click();
    } else {
      await page.locator('ion-item[detail]').filter({ hasText: /Open Service/i }).first().click();
      await page.getByText(/Opening Balance/i).first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('input.input-label-opencloseBalance').first().fill('1');
      await page.locator('ion-button').filter({ hasText: /Open Service/i }).last()
        .evaluate((el: HTMLElement) => el.click());
    }

    await page.waitForTimeout(8_000);
    await page.locator('#pinInput input, input[placeholder="Enter an ID"]').first().fill('1337');
    await page.locator('ion-button').filter({ has: page.locator('ion-icon[name="caret-forward-circle"]') }).last()
      .evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(5_000);

    console.log(JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 3000),
      modals: Array.from(document.querySelectorAll<HTMLElement>('ion-modal')).map(modal => ({
        text: modal.innerText?.slice(0, 2000),
        visible: !!(modal.offsetWidth || modal.offsetHeight || modal.getClientRects().length),
        html: modal.outerHTML.slice(0, 500),
      })),
      buttons: Array.from(document.querySelectorAll<HTMLElement>('ion-button')).map(button => ({
        text: (button.innerText || button.textContent || '').trim(),
        visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
        html: button.outerHTML.slice(0, 260),
      })).filter(button => button.visible).slice(0, 120),
    })), null, 2));
  } finally {
    await closeExpressPoint(handle);
  }
})();
