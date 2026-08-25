import { chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

// Launch the PACKAGED app, not the repo's electron binary. The app depends on
// @electron/remote v2 (needs Electron >= 14); the repo ships Electron 11, under
// which the renderer never paints and the only window left is the hidden
// electron-browser-storage helper — the "white screen".
const APP_EXE  = 'C:\\Users\\Public\\Documents\\ExpressPoint\\ExpressPoint.exe';
const CDP_PORT = 9222;

export interface ExpressPointHandle {
  proc: ChildProcess;
  browser: Browser;
  window: Page;
}

export async function launchExpressPoint(): Promise<ExpressPointHandle> {
  try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM ExpressPoint.exe /T', { stdio: 'ignore' }); } catch {}
  await sleep(1500);

  // ELECTRON_RUN_AS_NODE=1 is set by npm/ts-node and makes the binary run as
  // plain Node.js (no GUI, no Electron APIs). Must be stripped before spawning.
  const { ELECTRON_RUN_AS_NODE: _drop, ...restEnv } = process.env;
  const cashDrawerStubDir = path.resolve(process.cwd(), '.cashdrawer-stub');
  fs.mkdirSync(cashDrawerStubDir, { recursive: true });
  const cashDrawerStub = path.join(cashDrawerStubDir, 'CashDrawer.exe');
  if (!fs.existsSync(cashDrawerStub)) {
    fs.copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), cashDrawerStub);
  }

  const env = {
    ...restEnv,
    NODE_ENV: 'production',
    CashDrawer: cashDrawerStubDir,
  };

  const proc = spawn(APP_EXE, [
    `--remote-debugging-port=${CDP_PORT}`,
  ], { stdio: 'pipe', env });

  proc.stderr?.on('data', (d: Buffer) => process.stdout.write(`[app] ${d}`));
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[app:out] ${d}`));

  await waitForCDP(CDP_PORT, 30_000);
  await sleep(2000);

  const browser = await connectWithRetry(CDP_PORT, 5, 1500);
  const context = browser.contexts()[0];

  // Poll for the real renderer window. The hidden electron-browser-storage
  // helper window opens first, so a fixed sleep can race and hand back the
  // wrong page. Never fall back to allPages[0] — that IS the white screen.
  const isAppWindow = (p: Page) =>
    p.url().includes('/src/renderer/') && !p.url().includes('electron-browser-storage');

  const deadline = Date.now() + 30_000;
  let window: Page | undefined;
  while (Date.now() < deadline) {
    window = context.pages().find(isAppWindow);
    if (window) break;
    await sleep(500);
  }

  if (!window) {
    const seen = context.pages().map((p: Page) => p.url()).join('\n  ');
    throw new Error(
      `ExpressPoint renderer window never appeared within 30s. Pages seen:\n  ${seen}\n` +
      `(If the only page is electron-browser-storage/index.js, the app's main window failed to load.)`,
    );
  }

  await window.waitForLoadState('domcontentloaded');
  return { proc, browser, window };
}

export async function closeExpressPoint({ proc, browser }: ExpressPointHandle): Promise<void> {
  await browser.close().catch(() => {});
  proc.kill('SIGKILL');
  try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM ExpressPoint.exe /T', { stdio: 'ignore' }); } catch {}
}

function waitForCDP(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        schedule();
      }).on('error', schedule);
    }
    function schedule() {
      if (Date.now() >= deadline)
        return reject(new Error(`CDP not available on port ${port} after ${timeoutMs}ms`));
      setTimeout(attempt, 500);
    }
    attempt();
  });
}

async function connectWithRetry(port: number, retries: number, delayMs: number): Promise<Browser> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
