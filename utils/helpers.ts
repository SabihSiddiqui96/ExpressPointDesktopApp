import { expect, Page, Locator } from '@playwright/test';
import { launchExpressPoint, closeExpressPoint, ExpressPointHandle } from './launch';
import { LoginPage } from '../pages/LoginPage';
import { EP_USERNAME, EP_PASSWORD } from './env';
import { WarningDialog } from './dialogs';

export async function loginToExpressPoint(): Promise<ExpressPointHandle> {
  const handle = await launchExpressPoint();
  const { window } = handle;
  const login = new LoginPage(window);

  await seedOpenSessionForToday(window);
  await login.loginWithPrimeroEdge(EP_USERNAME, EP_PASSWORD);

  // Serving Options heading confirms login succeeded and the menu has loaded
  await expect(
    window.getByText('Serving Options for', { exact: false }).first()
  ).toBeVisible({ timeout: 20_000 });

  // Dismiss the Square Authorization token warning if it appears on the dashboard.
  await WarningDialog.dismiss(window);

  return handle;
}

export { closeExpressPoint };

async function seedOpenSessionForToday(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const now = new Date();
    const openDate = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

    await new Promise<void>((resolve) => {
      const request = indexedDB.open('_pouch_EXP_TRANSACTIONS');
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('by-sequence', 'readwrite');
        const store = tx.objectStore('by-sequence');
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const doc = cursor.value;
          if (/^OpenSession--/.test(doc._doc_id_rev ?? '') && doc.isStillOpen === true) {
            doc.OpenDate = openDate;
            doc.OpenDateWithTime = now.getTime();
            doc.OpenSessionDate = now.getTime();
            cursor.update(doc);
          }

          cursor.continue();
        };

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
    });
  }).catch(() => {});
}

/** Fill an Ionic ion-input by clicking it and typing. */
export async function fillIonInput(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.fill(value);
}

/** Take a named screenshot into the project root. */
export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${name}.png` });
}
