import { spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

function launchOptions() {
  const headless = String(process.env.PW_HEADLESS || 'false').toLowerCase() === 'true' ? true : false;
  const slowMoRaw = process.env.PW_SLOWMO;
  const slowMo = slowMoRaw ? Number(slowMoRaw) : 0;
  return {
    headless,
    ...(Number.isFinite(slowMo) && slowMo > 0 ? { slowMo } : {}),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpOk(url, timeoutMs = 15_000) {
  const start = Date.now();
  // Use node's fetch (Node 18+) to avoid extra deps.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      // ignore
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Server not responding at ${url} within ${timeoutMs}ms`);
    }
    await sleep(250);
  }
}

function startServer(env) {
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (err += d.toString()));

  return {
    child,
    getLogs() {
      return { out, err };
    },
  };
}

async function main() {
  const PORT = process.env.TEST_PORT || '3011';
  const BASE_URL = `http://localhost:${PORT}`;

  // For this regression test we bypass the OpenProject login flow (which launches Puppeteer
  // and slows tests) by setting the same cookies the app uses for auth.
  const TEST_USER_ID = process.env.TEST_USER_ID || '213';

  const server = startServer({ PORT });
  try {
    await waitForHttpOk(`${BASE_URL}/login.html`);

    const browser = await chromium.launch(launchOptions());
    const context = await browser.newContext();

    const consoleErrors = [];
    context.on('page', (p) => {
      p.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      p.on('pageerror', (e) => consoleErrors.push(String(e)));
    });

    const page = await context.newPage();

    await context.addCookies([
      {
        name: 'user_apikey',
        value: 'test',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
      },
      {
        name: 'user_id',
        value: TEST_USER_ID,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
      },
      {
        name: 'sdb_session',
        value: TEST_USER_ID,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
      },
    ]);

    // Go to WFH app
    await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });

    // Ensure buttons are clickable (JS wired)
    const saveBtn = page.locator('#wfhSaveBtn');
    const submitBtn = page.locator('#wfhSubmitBtn');
    await saveBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await submitBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Change a field then save
    await page.locator('#phone').fill('0812345678');
    await saveBtn.click();

    // Give the request time to complete.
    await page.waitForTimeout(750);

    // Fetch defaults and ensure the value persisted
    const res = await context.request.get(`${BASE_URL}/api/wfh/defaults`);
    if (!res.ok()) throw new Error(`GET /api/wfh/defaults failed: ${res.status()}`);
    const defaults = await res.json();
    if (defaults.phone !== '0812345678') {
      throw new Error(`Expected saved phone to be 0812345678, got: ${defaults.phone}`);
    }

    // Only fail on console errors if they originate from the /app page.
    const appConsoleErrors = consoleErrors.filter((t) => t.includes('/app/'));
    if (appConsoleErrors.length) {
      throw new Error(`Console errors detected:\n${appConsoleErrors.join('\n')}`);
    }

    await browser.close();
    console.log('WFH regression test passed.');
  } catch (e) {
    const { out, err } = server.getLogs();
    // Keep failure output actionable.
    console.error('WFH regression test failed:', e && e.message ? e.message : e);
    if (out.trim()) console.error('--- server stdout ---\n' + out.trim());
    if (err.trim()) console.error('--- server stderr ---\n' + err.trim());
    process.exitCode = 1;
  } finally {
    server.child.kill('SIGTERM');
  }
}

await main();
