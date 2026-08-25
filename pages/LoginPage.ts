import { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  // Landing screen — login method buttons
  primeroEdgeLoginBtn = () => this.page.locator('ion-button', { hasText: 'Use PrimeroEdge Login' });
  windowsLoginBtn     = () => this.page.locator('ion-button', { hasText: 'Use Windows Login' });

  // PrimeroEdge credential form — native <input> inside shadow root
  usernameInput = () => this.page.locator('ion-input[placeholder="Username"] input');
  passwordInput = () => this.page.locator('ion-input[placeholder="Password"] input');
  loginBtn      = () => this.page.locator('ion-button', { hasText: 'Login' });
  backBtn       = () => this.page.locator('ion-button', { hasText: 'Back' });

  // Post-login: Serving Options heading
  servingOptionsHeading = () => this.page.getByText('Serving Options for', { exact: false });

  // Serving Options menu items
  menuOpenService    = () => this.page.locator('ion-item[detail]', { hasText: 'Open Service' });
  menuTransactions   = () => this.page.locator('ion-item[detail]', { hasText: 'Transactions' });
  menuBulkSales      = () => this.page.locator('ion-item[detail]', { hasText: 'Bulk Sales' });
  menuSummarySale    = () => this.page.locator('ion-item[detail]', { hasText: 'Summary Sale' });
  menuOrders         = () => this.page.locator('ion-item[detail]', { hasText: 'Orders' });
  menuPayments       = () => this.page.locator('ion-item[detail]', { hasText: 'Payments' });
  menuDeviceInfo     = () => this.page.locator('ion-item[detail]', { hasText: 'Device Information' });

  /**
   * Click the landing-screen "Use PrimeroEdge Login" button IF it is present.
   *
   * As of ExpressPoint 6.4.0 (Angular 22) the login-method landing screen was
   * removed — the app boots straight to the credential form. Older builds still
   * show it, so this is a best-effort step rather than a hard requirement.
   * Returns true if the landing screen was there and was clicked.
   */
  async clickPrimeroEdgeLogin(): Promise<boolean> {
    try {
      await this.primeroEdgeLoginBtn().click({ timeout: 5_000 });
      return true;
    } catch {
      return false;   // 6.4.0+ — credential form is already on screen
    }
  }

  async loginWithPrimeroEdge(username: string, password: string) {
    await this.clickPrimeroEdgeLogin();
    await this.usernameInput().waitFor({ state: 'visible', timeout: 10_000 });
    await this.usernameInput().click();
    await this.usernameInput().fill(username);
    await this.passwordInput().click();
    await this.passwordInput().fill(password);
    await this.loginBtn().click();
  }
}
