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

async function waitForHttp(url, timeoutMs = 15_000) {
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

  const server = startServer({ PORT });
  try {
    await waitForHttp(`${BASE_URL}/login.html`);

    // No cookies, should redirect to /login.html
    const browser = await chromium.launch(launchOptions());
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
    if (!page.url().endsWith('/login.html')) {
      throw new Error(`Expected /app to redirect to /login.html, got: ${page.url()}`);
    }

    await page.goto(`${BASE_URL}/app/index.html`, { waitUntil: 'domcontentloaded' });
    if (!page.url().endsWith('/login.html')) {
      throw new Error(`Expected /app/index.html to redirect to /login.html, got: ${page.url()}`);
    }

    // Static JS should still be accessible without auth.
    const jsRes = await fetch(`${BASE_URL}/app/app.js`, { redirect: 'manual' });
    if (!jsRes.ok) throw new Error(`Expected /app/app.js 200, got: ${jsRes.status}`);
    const ctype = jsRes.headers.get('content-type') || '';
    if (!ctype.includes('javascript')) {
      throw new Error(`Expected /app/app.js content-type to include javascript, got: ${ctype}`);
    }

    await browser.close();
    console.log('Auth regression test passed.');
  } catch (e) {
    const { out, err } = server.getLogs();
    console.error('Auth regression test failed:', e && e.message ? e.message : e);
    if (out.trim()) console.error('--- server stdout ---\n' + out.trim());
    if (err.trim()) console.error('--- server stderr ---\n' + err.trim());
    process.exitCode = 1;
  } finally {
    server.child.kill('SIGTERM');
  }
}

await main();
