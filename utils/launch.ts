import { chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

const APP_DIR  = 'C:\\Users\\Public\\Documents\\ExpressPoint\\resources\\app';
const ELECTRON = path.join(__dirname, '../node_modules/electron/dist/electron.exe');
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

  const proc = spawn(ELECTRON, [
    APP_DIR,
    `--remote-debugging-port=${CDP_PORT}`,
  ], { stdio: 'pipe', env });

  proc.stderr?.on('data', (d: Buffer) => process.stdout.write(`[app] ${d}`));
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[app:out] ${d}`));

  await waitForCDP(CDP_PORT, 30_000);
  await sleep(2000);

  const browser = await connectWithRetry(CDP_PORT, 5, 1500);
  const context = browser.contexts()[0];

  const allPages = context.pages();
  let window = allPages.find((p: Page) => p.url().includes('renderer') && !p.url().includes('electron-browser-storage'))
    ?? allPages.find((p: Page) => !p.url().includes('electron-browser-storage'))
    ?? allPages[0];

  if (!window || window.url().includes('electron-browser-storage')) {
    window = await context.waitForEvent('page', {
      predicate: (p: Page) => !p.url().includes('electron-browser-storage'),
      timeout: 15_000,
    });
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
