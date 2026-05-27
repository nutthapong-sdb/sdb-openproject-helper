import 'dotenv/config';
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

async function waitForHttp(url, timeoutMs = 20_000) {
  const start = Date.now();
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
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write(s);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    err += s;
    process.stderr.write(s);
  });

  return {
    child,
    getLogs() {
      return { out, err };
    },
  };
}

async function main() {
  const user = process.env.DEBUTSERVICE_USER;
  const pass = process.env.DEBUTSERVICE_PASS;
  if (!user || !pass) {
    console.log('WFH dry-run e2e skipped (missing DEBUTSERVICE_USER/DEBUTSERVICE_PASS).');
    return;
  }

  const PORT = process.env.TEST_PORT || '3011';
  const BASE_URL = `http://localhost:${PORT}`;

  const server = startServer({ PORT });
  try {
    await waitForHttp(`${BASE_URL}/login.html`);

    const browser = await chromium.launch(launchOptions());
    const context = await browser.newContext();

    console.log('[WFH-TEST] Browser launched');

    // Bypass OpenProject login for speed: set auth cookies.
    const TEST_USER_ID = process.env.TEST_USER_ID || '213';
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

    const page = await context.newPage();
    let addApiResult = null;
    page.on('console', (m) => console.log('[WFH-UI]', m.text()));

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/automation/debutservice/work-from-home/add')) {
        console.log('[WFH-UI] request', req.method(), url);
      }
    });
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/automation/debutservice/work-from-home/add')) {
        console.log('[WFH-UI] response', res.status(), url);
        const body = await res.text().catch(() => null);
        if (body) {
          console.log('[WFH-UI] response body', body.length > 4000 ? body.slice(0, 4000) + '...<truncated>' : body);
          try {
            addApiResult = JSON.parse(body);
          } catch {
            // ignore
          }
        }
      }
    });

    await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
    console.log('[WFH-TEST] Opened /app');

    // Fill required fields (first-time user defaults are empty).
    await page.locator('#thaiName').fill('Test Thai');
    await page.locator('#engName').fill('Test Eng');
    await page.locator('#email').fill(user);
    await page.locator('#changeLoginPassword').click();
    await page.locator('#loginPassword').fill(pass);
    await page.locator('#phone').fill('0800000000');
    await page.locator('#department').selectOption({ label: 'Technology division' });
    await page.locator('#because').fill('ขอใช้สิทธิ์');
    await page.locator('#reason').fill('ขอใช้สิทธิ์');
    await page.locator('#extra').fill('ขอใช้สิทธิ์');
    await page.locator('#startDate').fill('2026-06-02');
    await page.locator('#endDate').fill('2026-06-02');

    // Trigger submit (real save).
    console.log('[WFH-TEST] Click Submit');
    await page.locator('#wfhSubmitBtn').click();

    // Wait for the server-side automation (may be slowed/paused in headed mode).
    await page.waitForTimeout(2_000);
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const lastToast = await page.locator('.toast-item').first().textContent().catch(() => null);
      if (lastToast) {
        // Helpful when the automation fails before a screenshot is attached.
        // eslint-disable-next-line no-console
        console.log('WFH UI toast:', lastToast.replace(/\s+/g, ' ').trim());
      }

      if (addApiResult && addApiResult.ok) {
        if (addApiResult.screenshot) {
          const shotUrl = `${BASE_URL}${addApiResult.screenshot}`;
          const res = await fetch(shotUrl, { redirect: 'manual' });
          if (!res.ok) throw new Error(`Screenshot URL not accessible: ${shotUrl} (${res.status})`);
          console.log('WFH e2e passed. Screenshot:', shotUrl);
        } else {
          console.log('WFH e2e passed.');
        }
        break;
      }

      if (Date.now() - start > 120_000) {
        throw new Error('Timed out waiting for automation response.');
      }
      await sleep(500);
    }

    await browser.close();
  } catch (e) {
    const { out, err } = server.getLogs();
    console.error('WFH dry-run e2e failed:', e && e.message ? e.message : e);
    if (out.trim()) console.error('--- server stdout ---\n' + out.trim());
    if (err.trim()) console.error('--- server stderr ---\n' + err.trim());
    process.exitCode = 1;
  } finally {
    server.child.kill('SIGTERM');
  }
}

await main();
