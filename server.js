require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const bcrypt = require('bcrypt');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.json());
app.use(cookieParser());

// Helper to check session
function getSession(req) {
    const apiKey = req.cookies.user_apikey;
    if (apiKey) return { isValid: true, apiKey };
    return { isValid: false };
}

app.get(['/login.html', '/login'], (req, res, next) => {
    const session = getSession(req);
    if (session && session.isValid) return res.redirect('/');
    next();
});

app.get(['/', '/index.html'], (req, res, next) => {
    const session = getSession(req);
    if (!session || !session.isValid) return res.redirect('/login.html');
    next();
});

// React SPA mount (served from /public/app/index.html)
// Keep static assets under /app/* working (don't hijack requests with extensions).
app.get(/^\/app(\/.*)?$/, (req, res, next) => {
    // Allow common static assets to be served directly, but don't allow HTML bypass.
    if (/\.(js|css|map|png|jpg|jpeg|svg|ico|webp)$/i.test(req.path)) return next();
    const session = getSession(req);
    if (!session || !session.isValid) return res.redirect('/login.html');
    res.sendFile(require('path').resolve(__dirname, 'public', 'app', 'index.html'));
});

app.use(express.static('public'));

const HOST = 'https://openproject.softdebut.com';

// --- Playwright automation (server-side) ---
// Note: Playwright requires its browsers installed (usually via: npx playwright install)
let _playwright;
async function getPlaywrightChromium() {
    if (!_playwright) {
        _playwright = require('playwright');
    }
    return _playwright.chromium;
}

function getPlaywrightLaunchOptions() {
    const headless = String(process.env.PLAYWRIGHT_HEADLESS || 'true').toLowerCase() !== 'false';
    const slowMoRaw = process.env.PLAYWRIGHT_SLOWMO;
    const slowMo = slowMoRaw ? Number(slowMoRaw) : 0;
    return {
        headless,
        ...(Number.isFinite(slowMo) && slowMo > 0 ? { slowMo } : {})
    };
}

function getPlaywrightPostRunPauseMs() {
    const pauseRaw = process.env.PLAYWRIGHT_POSTRUN_PAUSE_MS;
    const pause = pauseRaw ? Number(pauseRaw) : 0;
    return Number.isFinite(pause) && pause > 0 ? pause : 0;
}

function isDebutserviceAdminLoginUrl(url) {
    return typeof url === 'string' && url.includes('/admin/login.php');
}

async function maybeClickOkDialog(page) {
    const okBtn = page.getByRole('button', { name: /^ok$/i }).first();
    if ((await okBtn.count().catch(() => 0)) > 0) {
        await okBtn.click().catch(() => { });
        await page.waitForTimeout(250);
    }
}

async function debutserviceLoginIfNeeded(page, { username, password, postLoginUrl }) {
    // If we already see the list URL content, don't do anything.
    if (!isDebutserviceAdminLoginUrl(page.url())) return { ok: true, didLogin: false };

    await maybeClickOkDialog(page);

    const userCtl = page.locator('input[name="username"], input[name="user"], input[id*="user" i]').first();
    // Legacy page sometimes has inputs without useful attributes.
    const userCtlFallback = page.locator('xpath=//*[contains(normalize-space(),"Username")]/following::input[1]').first();

    const passCtl = page.locator('input[type="password"], input[name="password"], input[id*="pass" i]').first();
    const passCtlFallback = page.locator('xpath=//*[contains(normalize-space(),"Password")]/following::input[1]').first();

    const resolvedUserCtl = (await userCtl.count().catch(() => 0)) > 0 ? userCtl : userCtlFallback;
    const resolvedPassCtl = (await passCtl.count().catch(() => 0)) > 0 ? passCtl : passCtlFallback;

    if ((await resolvedUserCtl.count().catch(() => 0)) === 0 || (await resolvedPassCtl.count().catch(() => 0)) === 0) {
        return { ok: false, error: 'Could not find login fields' };
    }

    await resolvedUserCtl.fill(username);
    await resolvedPassCtl.fill(password);

    const submit = page.getByRole('button', { name: /login|log in|sign in|\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a/i })
        .or(page.locator('input[type="submit"], button[type="submit"]'))
        // Debutservice legacy login uses an image input button.
        .or(page.locator('input[type="image"][src*="bt_login" i], input[type="image"][src$="/admin/images/bt_login.gif" i]'))
        .or(page.getByText(/sign in/i))
        .first();

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { }),
        submit.click().catch(() => { })
    ]);

    await page.waitForTimeout(800);
    if (postLoginUrl) {
        await page.goto(postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    if (isDebutserviceAdminLoginUrl(page.url())) {
        await maybeClickOkDialog(page);
        return { ok: false, error: 'Login failed (still on login page)' };
    }

    return { ok: true, didLogin: true };
}

app.post('/api/automation/check', async (req, res) => {
    const session = getSession(req);
    if (!session || !session.isValid) return res.status(401).json({ error: 'Not logged in' });

    const url = (req.body && req.body.url ? String(req.body.url) : '').trim();
    if (!url) return res.status(400).json({ error: 'url is required' });

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return res.status(400).json({ error: 'url must be a valid URL' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'url must start with http:// or https://' });
    }

    let browser;
    try {
        const chromium = await getPlaywrightChromium();
        browser = await chromium.launch(getPlaywrightLaunchOptions());

        const context = await browser.newContext();
        const page = await context.newPage();

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
        });

        const title = await page.title();
        const finalUrl = page.url();
        const status = response ? response.status() : null;

        res.json({
            ok: status !== null ? status >= 200 && status < 400 : true,
            inputUrl: url,
            finalUrl,
            status,
            title
        });
    } catch (e) {
        res.status(500).json({
            ok: false,
            inputUrl: url,
            error: e && e.message ? e.message : String(e)
        });
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
});

app.post('/api/automation/debutservice/login', async (req, res) => {
    const session = getSession(req);
    if (!session || !session.isValid) return res.status(401).json({ error: 'Not logged in' });

    const targetUrl = 'https://debutservice.softdebut.com/v2/form/work_from_home';
    const username = (process.env.DEBUTSERVICE_USER || '').trim();
    const password = process.env.DEBUTSERVICE_PASS || '';
    if (!username || !password) {
        return res.status(400).json({
            error: 'Missing credentials',
            details: 'Set DEBUTSERVICE_USER and DEBUTSERVICE_PASS in environment variables.'
        });
    }

    let browser;
    let page;
    let popup;
    try {
        const chromium = await getPlaywrightChromium();
        browser = await chromium.launch(getPlaywrightLaunchOptions());
        const context = await browser.newContext();
        page = await context.newPage();

        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // Debutservice sometimes redirects to /admin/login.php with a legacy form.
        const currentUrl = page.url();
        let userField;
        let passField;
        let submitBtn;

        if (currentUrl.includes('/admin/login.php')) {
            userField = page.locator('input[name="username"], input[name="user"], input[id*="user" i], input[type="text"]').first();
            passField = page.locator('input[type="password"], input[name="password"], input[id*="pass" i]').first();
            submitBtn = page.locator('input[type="image"][src*="bt_login" i], input[type="image"][src$="/admin/images/bt_login.gif" i], button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign")').first();
        } else {
            userField = page.getByLabel(/email|username|user name/i)
                .or(page.getByPlaceholder(/email|username|user name/i))
                .or(page.locator('input[type="email"]'))
                .or(page.locator('input[name="username"], input[name="email"], input[id*="user" i], input[id*="email" i]'))
                .first();
            passField = page.getByLabel(/password/i)
                .or(page.getByPlaceholder(/password/i))
                .or(page.locator('input[type="password"]'))
                .or(page.locator('input[name="password"], input[id*="pass" i]'))
                .first();
            submitBtn = page.getByRole('button', { name: /log in|login|sign in|submit/i })
                .or(page.locator('button[type="submit"]'))
                .or(page.locator('form button'))
                .first();
        }

        if ((await userField.count().catch(() => 0)) === 0 || (await passField.count().catch(() => 0)) === 0) {
            return res.status(500).json({
                ok: false,
                error: 'Could not find login fields on page',
                finalUrl: page.url(),
                title: await page.title().catch(() => null)
            });
        }
        if ((await submitBtn.count().catch(() => 0)) === 0) {
            return res.status(500).json({
                ok: false,
                error: 'Could not find submit button',
                finalUrl: page.url(),
                title: await page.title().catch(() => null)
            });
        }

        await userField.fill(username);
        await passField.fill(password);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { }),
            submitBtn.click().catch(() => { })
        ]);

        // Give the app a moment to finish any redirects.
        await page.waitForTimeout(1500);

        const finalUrl = page.url();
        const title = await page.title().catch(() => null);
        const status = response ? response.status() : null;

        // Save a screenshot for debugging without exposing credentials.
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const debugDir = './public/debug';
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
        const screenshotRelPath = `/debug/debutservice_login_${timestamp}.png`;
        await page.screenshot({ path: publicFilePath(screenshotRelPath), fullPage: true }).catch(() => { });

        const pauseMs = getPlaywrightPostRunPauseMs();
        if (!getPlaywrightLaunchOptions().headless && pauseMs) {
            await page.waitForTimeout(pauseMs).catch(() => { });
        }

        res.json({
            ok: true,
            inputUrl: targetUrl,
            finalUrl,
            status,
            title,
            screenshot: screenshotRelPath
        });
    } catch (e) {
        res.status(500).json({
            ok: false,
            inputUrl: 'https://debutservice.softdebut.com/v2/form/work_from_home',
            error: e && e.message ? e.message : String(e)
        });
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
});

app.post('/api/automation/debutservice/work-from-home/add', async (req, res) => {
    const session = getSession(req);
    if (!session || !session.isValid) return res.status(401).json({ error: 'Not logged in' });

    const listUrl = 'https://debutservice.softdebut.com/v2/form/work_from_home';
    const addUrl = 'https://debutservice.softdebut.com/v2/form/work_from_home/add';
    const username = (process.env.DEBUTSERVICE_USER || '').trim();
    const password = process.env.DEBUTSERVICE_PASS || '';
    if (!username || !password) {
        return res.status(400).json({
            error: 'Missing credentials',
            details: 'Set DEBUTSERVICE_USER and DEBUTSERVICE_PASS in environment variables.'
        });
    }

    const body = req.body || {};
    const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : true;

    const userId = req.cookies.user_id || req.cookies.sdb_session;

    const storedDefaults = await new Promise((resolve) => {
        if (!userId) return resolve(null);
        db.get('SELECT data FROM wfh_form_defaults WHERE user_id = ?', [userId], (err, row) => {
            if (err || !row) return resolve(null);
            try { resolve(JSON.parse(row.data)); }
            catch { resolve(null); }
        });
    });

    const fallbackDefaults = {
        thaiName: 'นัทธพงศ์ วิวิธสุรการ',
        engName: 'Nutthapong Vivithsurakarn',
        email: 'nutthapong.v@softdebut.com',
        phone: '0853166969',
        department: 'Technology division',
        because: 'ขอใช้สิทธิ์',
        reason: 'ขอใช้สิทธิ์',
        startDate: '27/05/2026',
        endDate: '27/05/2026',
        extra: 'ขอใช้สิทธิ์'
    };

    const mergedDefaults = { ...fallbackDefaults, ...(storedDefaults || {}) };
    const payload = {
        thaiName: (body.thaiName ? String(body.thaiName) : mergedDefaults.thaiName).trim(),
        engName: (body.engName ? String(body.engName) : mergedDefaults.engName).trim(),
        email: (body.email ? String(body.email) : mergedDefaults.email).trim(),
        phone: (body.phone ? String(body.phone) : mergedDefaults.phone).trim(),
        department: (body.department ? String(body.department) : mergedDefaults.department).trim(),
        because: (body.because ? String(body.because) : mergedDefaults.because).trim(),
        reason: (body.reason ? String(body.reason) : mergedDefaults.reason).trim(),
        startDate: (body.startDate ? String(body.startDate) : mergedDefaults.startDate).trim(),
        endDate: (body.endDate ? String(body.endDate) : mergedDefaults.endDate).trim(),
        extra: (body.extra ? String(body.extra) : mergedDefaults.extra).trim()
    };

    const traceEnabled = String(process.env.PLAYWRIGHT_TRACE_LOG || 'false').toLowerCase() === 'true';
    const trace = [];
    const tlog = (msg) => {
        const line = `[WFH-AUTO] ${msg}`;
        trace.push(line);
        if (traceEnabled) console.log(line);
    };

    function toDateInputValue(ddmmyyyy) {
        const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(ddmmyyyy);
        if (!m) return ddmmyyyy;
        const [, dd, mm, yyyy] = m;
        return `${yyyy}-${mm}-${dd}`;
    }

    function ddmmyyyyToIso(ddmmyyyy) {
        const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(ddmmyyyy || ''));
        if (!m) return String(ddmmyyyy || '').trim();
        const [, dd, mm, yyyy] = m;
        return `${yyyy}-${mm}-${dd}`;
    }

    async function findControlByLabelText(page, labelText) {
        const label = page.locator('label', { hasText: labelText }).first();
        if ((await label.count().catch(() => 0)) === 0) return null;

        const forId = await label.getAttribute('for').catch(() => null);
        if (forId) {
            const byFor = page.locator(`#${CSS.escape(forId)}`).first();
            if ((await byFor.count().catch(() => 0)) > 0) return byFor;
        }

        // Common pattern: <label>..</label><input ...>
        const sibling = label.locator('xpath=following-sibling::*[1]//*[self::input or self::textarea or self::select] | xpath=following-sibling::*[1][self::input or self::textarea or self::select]').first();
        if ((await sibling.count().catch(() => 0)) > 0) return sibling;

        // Fallback: nearest container
        const container = label.locator('xpath=ancestor-or-self::*[self::div or self::td or self::th][1]').first();
        const inside = container.locator('input, textarea, select').first();
        if ((await inside.count().catch(() => 0)) > 0) return inside;

        return null;
    }

    async function dumpFormControls(page) {
        const controls = await page.locator('input, textarea, select').evaluateAll((els) => {
            function text(s) {
                return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
            }

            return els.map((el) => {
                const tag = el.tagName.toLowerCase();
                const type = tag === 'input' ? (el.getAttribute('type') || 'text') : null;
                const id = el.getAttribute('id') || null;
                const name = el.getAttribute('name') || null;
                const placeholder = el.getAttribute('placeholder') || null;
                const ariaLabel = el.getAttribute('aria-label') || null;

                let labelText = null;
                if (id) {
                    const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
                    if (lab) labelText = text(lab.textContent);
                }
                if (!labelText) {
                    // Try nearest preceding label in same container.
                    const container = el.closest('div, td, th, tr, form') || el.parentElement;
                    if (container) {
                        const lab = container.querySelector('label');
                        if (lab) labelText = text(lab.textContent);
                    }
                }

                const outerHTML = el.outerHTML ? String(el.outerHTML).slice(0, 300) : null;

                return {
                    tag,
                    type,
                    id,
                    name,
                    placeholder,
                    ariaLabel,
                    labelText,
                    outerHTML,
                };
            });
        }).catch(() => []);

        return controls;
    }

    async function selectOptionLoose(selectLocator, desiredLabel) {
        const desired = String(desiredLabel || '').replace(/\s+/g, ' ').trim();
        if (!desired) return false;

        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const desiredN = norm(desired);

        const options = await selectLocator.locator('option').evaluateAll((opts) =>
            opts.map((o) => ({
                value: o.getAttribute('value') || '',
                label: (o.textContent || '').replace(/\s+/g, ' ').trim(),
            }))
        ).catch(() => []);

        const candidates = options
            .map((o) => ({ ...o, labelN: norm(o.label) }))
            .filter((o) => o.value && o.labelN);

        const exact = candidates.find((o) => o.labelN === desiredN);
        const includes = candidates.find((o) => o.labelN.includes(desiredN) || desiredN.includes(o.labelN));
        const picked = exact || includes;
        if (!picked) return false;

        await selectLocator.selectOption(picked.value);
        return true;
    }

    async function setInputValueForce(inputLocator, value) {
        const v = String(value ?? '');
        await inputLocator.evaluate((el, nextValue) => {
            try {
                el.removeAttribute('readonly');
            } catch {
                // ignore
            }

            // flatpickr wires itself on the input element.
            // Prefer using its API so internal state stays consistent.
            const fp = el._flatpickr;
            if (fp && typeof fp.setDate === 'function') {
                const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(nextValue));
                if (m) {
                    const dd = Number(m[1]);
                    const mm = Number(m[2]);
                    const yyyy = Number(m[3]);
                    const d = new Date(yyyy, mm - 1, dd);
                    fp.setDate(d, true);
                } else {
                    fp.setDate(nextValue, true);
                }

                // Some flatpickr configs use a hidden input + altInput. Ensure visible value is set.
                try {
                    if (fp.altInput) fp.altInput.value = String(nextValue);
                } catch {
                    // ignore
                }
                try {
                    el.value = String(nextValue);
                } catch {
                    // ignore
                }
                try {
                    el.setAttribute('value', String(nextValue));
                } catch {
                    // ignore
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
                el.value = nextValue;
                try {
                    el.setAttribute('value', String(nextValue));
                } catch {
                    // ignore
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
        }, v);
    }

    async function pickFlatpickrDate(page, inputLocator, ddmmyyyy) {
        const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(ddmmyyyy || ''));
        if (!m) return false;
        const dd = String(Number(m[1]));
        const mm = Number(m[2]);
        const yyyy = String(Number(m[3]));

        await inputLocator.click().catch(() => { });
        const cal = page.locator('.flatpickr-calendar.open').last();
        if ((await cal.count().catch(() => 0)) === 0) return false;

        const monthSelect = cal.locator('select.flatpickr-monthDropdown-months').first();
        const yearInput = cal.locator('input.cur-year').first();
        if ((await monthSelect.count().catch(() => 0)) > 0) {
            await monthSelect.selectOption(String(mm - 1)).catch(() => { });
        }
        if ((await yearInput.count().catch(() => 0)) > 0) {
            await yearInput.fill(yyyy).catch(() => { });
            await yearInput.press('Enter').catch(() => { });
        }

        const day = cal
            .locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)')
            .filter({ hasText: new RegExp(`^${dd}$`) })
            .first();
        if ((await day.count().catch(() => 0)) === 0) return false;
        await day.click();
        return true;
    }

    async function setFlatpickrHiddenSibling(visibleInputLocator, value) {
        const hidden = visibleInputLocator
            .locator('xpath=preceding-sibling::input[@type="hidden" and contains(@class,"flatpickr-input")]')
            .first();

        if ((await hidden.count().catch(() => 0)) === 0) return false;

        // Hidden input is typically the one submitted. Update it explicitly.
        await hidden.evaluate((el, nextValue) => {
            el.value = String(nextValue);
            try {
                el.setAttribute('value', String(nextValue));
            } catch {
                // ignore
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, String(value ?? ''));
        return true;
    }

    async function setFlatpickrHiddenBySelector(page, selector, value) {
        const hidden = page.locator(selector).first();
        if ((await hidden.count().catch(() => 0)) === 0) return false;
        await hidden.evaluate((el, nextValue) => {
            el.value = String(nextValue);
            try {
                el.setAttribute('value', String(nextValue));
            } catch {
                // ignore
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, String(value ?? ''));
        return true;
    }

    async function resolveVisibleDateInput(dateControl) {
        const type = await dateControl.getAttribute('type').catch(() => null);
        if (type && type.toLowerCase() === 'hidden') {
            const nextVisible = dateControl
                .locator('xpath=following-sibling::input[not(@type="hidden")][1]')
                .first();
            if ((await nextVisible.count().catch(() => 0)) > 0) return nextVisible;
        }
        return dateControl;
    }

    async function tryClickFirst(page, locators) {
        for (const loc of locators) {
            try {
                if (!loc) continue;
                const count = await loc.count().catch(() => 0);
                if (!count) continue;
                const target = loc.first();
                await target.scrollIntoViewIfNeeded().catch(() => { });
                // Some overlays intercept normal clicks; try force.
                await target.click({ timeout: 5000 }).catch(async () => {
                    await target.click({ timeout: 5000, force: true });
                });
                return true;
            } catch {
                // try next
            }
        }
        return false;
    }

    let browser;
    let page;
    try {
        const chromium = await getPlaywrightChromium();
        tlog('launch browser');
        browser = await chromium.launch(getPlaywrightLaunchOptions());
        const context = await browser.newContext();
        page = await context.newPage();

        // Go straight to the add form page (no need to click "เพิ่มรายการ").
        tlog(`goto ${addUrl}`);
        await page.goto(addUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        tlog(`landed ${page.url()}`);

        // If redirected to the legacy admin login, log in then reopen the add form.
        if (isDebutserviceAdminLoginUrl(page.url())) {
            tlog('redirected to admin login, attempting login');
            const loginResult = await debutserviceLoginIfNeeded(page, { username, password, postLoginUrl: addUrl });
            if (!loginResult.ok) {
                tlog(`login failed: ${loginResult.error || 'unknown'}`);
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                const shot = `/debug/debutservice_login_failed_${ts}.png`;
                await page.screenshot({ path: publicFilePath(shot), fullPage: true }).catch(() => { });
                return res.status(401).json({ ok: false, error: loginResult.error || 'Login failed', finalUrl: page.url(), screenshot: shot, trace });
            }
            // debutserviceLoginIfNeeded already navigates to postLoginUrl.
            tlog(`post-login landed ${page.url()}`);
        }

        // Allow dynamic content to render before locating labels.
        tlog('wait 1500ms for dynamic content');
        await page.waitForTimeout(1500);

        if (isDebutserviceAdminLoginUrl(page.url())) {
            tlog('still on admin login after login attempt');
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const shot = `/debug/debutservice_login_still_${ts}.png`;
            await page.screenshot({ path: publicFilePath(shot), fullPage: true }).catch(() => { });
            return res.status(401).json({ ok: false, error: 'Login failed (still on login page)', finalUrl: page.url(), screenshot: shot, trace });
        }

        const thaiNameCtl = await findControlByLabelText(page, 'ชื่อ-นามสกุล (ภาษาไทย)');
        const engNameCtl = await findControlByLabelText(page, 'ชื่อ-นามสกุล (ภาษาอังกฤษ)');
        const emailCtl = await findControlByLabelText(page, 'อีเมล');
        const phoneCtl = await findControlByLabelText(page, 'เบอร์โทรศัพท์');
        const deptCtl = await findControlByLabelText(page, 'แผนก/สังกัด');
        const becauseCtl = await findControlByLabelText(page, 'เนื่องจาก');
        const reasonCtl = await findControlByLabelText(page, 'เหตุผล');
        const startCtl = await findControlByLabelText(page, 'วันที่เริ่ม');
        const endCtl = await findControlByLabelText(page, 'วันที่สิ้นสุด');
        const descriptionCtl = page.locator('#description, textarea[name="description"]').first();

        const missing = [];
        if (!thaiNameCtl) missing.push('ชื่อ-นามสกุล (ภาษาไทย)');
        if (!engNameCtl) missing.push('ชื่อ-นามสกุล (ภาษาอังกฤษ)');
        if (!emailCtl) missing.push('อีเมล');
        if (!phoneCtl) missing.push('เบอร์โทรศัพท์');
        if (!deptCtl) missing.push('แผนก/สังกัด');
        if (!becauseCtl) missing.push('เนื่องจาก');
        if (!reasonCtl) missing.push('เหตุผล');
        if (!startCtl) missing.push('วันที่เริ่ม');
        if (!endCtl) missing.push('วันที่สิ้นสุด');
        if ((await descriptionCtl.count().catch(() => 0)) === 0) missing.push('description');
        if (missing.length) {
            tlog(`missing controls: ${missing.join(', ')}`);
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const shot = `/debug/debutservice_fields_missing_${ts}.png`;
            await page.screenshot({ path: publicFilePath(shot), fullPage: true }).catch(() => { });
            const elements = await dumpFormControls(page);
            return res.status(500).json({ ok: false, error: 'Some fields were not found', missing, finalUrl: page.url(), screenshot: shot, elements, trace });
        }

        tlog('fill text fields');
        await thaiNameCtl.fill(payload.thaiName);
        await engNameCtl.fill(payload.engName);
        await emailCtl.fill(payload.email);
        await phoneCtl.fill(payload.phone);

        const deptTag = await deptCtl.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (deptTag === 'select') {
            tlog(`select department: ${payload.department}`);
            await selectOptionLoose(deptCtl, payload.department).catch(() => { });
        } else {
            await deptCtl.fill(payload.department);
        }

        const becauseTag = await becauseCtl.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (becauseTag === 'select') {
            tlog(`select because: ${payload.because}`);
            await selectOptionLoose(becauseCtl, payload.because).catch(() => { });
        } else {
            await becauseCtl.fill(payload.because);
        }

        tlog('fill reason');
        await reasonCtl.fill(payload.reason);

        const startType = await startCtl.getAttribute('type').catch(() => null);
        const endType = await endCtl.getAttribute('type').catch(() => null);

        const startValue = startType === 'date' ? toDateInputValue(payload.startDate) : payload.startDate;
        const endValue = endType === 'date' ? toDateInputValue(payload.endDate) : payload.endDate;

        // Debutservice WFH form uses a hidden input that stores ISO (yyyy-mm-dd).
        const startIso = ddmmyyyyToIso(payload.startDate);
        const endIso = ddmmyyyyToIso(payload.endDate);

        // Always try to set the hidden inputs directly by id/name.
        // These are the values that will be submitted.
        tlog(`set hidden dates start=${startIso} end=${endIso}`);
        await setFlatpickrHiddenBySelector(page, 'input[type="hidden"]#wfh_startdate, input[type="hidden"][name="wfh_startdate"]', startIso).catch(() => { });
        await setFlatpickrHiddenBySelector(page, 'input[type="hidden"]#wfh_enddate, input[type="hidden"][name="wfh_enddate"]', endIso).catch(() => { });

        // Dates: we only need the hidden ISO inputs filled.
        // Do not interact with the visible flatpickr text inputs.
        tlog('skip visible date inputs (hidden ISO already set)');

        // Capture what the DOM currently holds for dates.
        const dateDebug = {
            startIso,
            endIso,
            hiddenStartValue: await page.locator('input[type="hidden"]#wfh_startdate, input[type="hidden"][name="wfh_startdate"]').first().getAttribute('value').catch(() => null),
            hiddenEndValue: await page.locator('input[type="hidden"]#wfh_enddate, input[type="hidden"][name="wfh_enddate"]').first().getAttribute('value').catch(() => null),
            visibleStartValue: null,
            visibleEndValue: null,
        };

        tlog(`dateDebug hiddenStart=${dateDebug.hiddenStartValue} hiddenEnd=${dateDebug.hiddenEndValue}`);

        tlog('fill description');
        await descriptionCtl.scrollIntoViewIfNeeded().catch(() => { });
        await descriptionCtl.fill(payload.extra);
        tlog('description filled');

        // The form's required "ข้อมูลเพิ่มเติม" is textarea#description.
        await descriptionCtl.fill(payload.extra);

        // Safety net: if the page has any other required text inputs/textareas left blank,
        // fill them with the extra note so the form is complete.
        // (Skip hidden/readonly/date flatpickr inputs and selects.)
        const requiredTextControls = page.locator(
            'input[required]:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]), textarea[required]'
        );
        const reqCount = await requiredTextControls.count().catch(() => 0);
        for (let i = 0; i < reqCount; i++) {
            const ctl = requiredTextControls.nth(i);
            const tag = await ctl.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
            if (tag === 'input') {
                const type = await ctl.getAttribute('type').catch(() => null);
                if (type && type.toLowerCase() === 'file') continue;
            }

            const isReadonly = await ctl.getAttribute('readonly').catch(() => null);
            const hasFlatpickr = await ctl.getAttribute('class').then((c) => (c || '').includes('flatpickr')).catch(() => false);
            if (isReadonly !== null && hasFlatpickr) continue;

            const current = await ctl.inputValue().catch(() => '');
            if (String(current || '').trim()) continue;

            await ctl.fill(payload.extra).catch(() => { });
        }

        if (!dryRun) {
            tlog('click Save');
            const submitBtn = page.getByRole('button', { name: /^save$/i })
                .or(page.getByRole('button', { name: /submit|save|ส่ง|บันทึก/i }))
                .or(page.locator('button[type="submit"], input[type="submit"]'))
                .first();
            if ((await submitBtn.count().catch(() => 0)) > 0) {
                await Promise.all([
                    page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => { }),
                    submitBtn.click().catch(() => { })
                ]);
                await page.waitForTimeout(800);
            }

            // After save, refresh and submit for approval.
            tlog('refresh page');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
            await page.waitForTimeout(800);

            tlog('click Submit Approval');
            const approvalBtn = page.locator('#btnSubmitApproval').first();
            if ((await approvalBtn.count().catch(() => 0)) > 0) {
                await approvalBtn.scrollIntoViewIfNeeded().catch(() => { });
                await approvalBtn.click().catch(async () => {
                    await approvalBtn.click({ force: true }).catch(() => { });
                });
                await page.waitForTimeout(800);
            } else {
                tlog('Submit Approval button not found');
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotRelPath = `/debug/debutservice_wfh_add_${timestamp}.png`;
        await page.screenshot({ path: publicFilePath(screenshotRelPath), fullPage: true });

        const pauseMs = getPlaywrightPostRunPauseMs();
        if (!getPlaywrightLaunchOptions().headless && pauseMs) {
            await page.waitForTimeout(pauseMs).catch(() => { });
        }

        res.json({
            ok: true,
            inputUrl: addUrl,
            finalUrl: page.url(),
            title: await page.title().catch(() => null),
            dryRun,
            screenshot: screenshotRelPath,
            dateDebug,
            trace
        });
    } catch (e) {
        tlog(`error: ${e && e.message ? e.message : String(e)}`);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        let shot = null;
        const targetForShot = page;
        if (targetForShot) {
            shot = `/debug/debutservice_wfh_error_${ts}.png`;
            await targetForShot.screenshot({ path: publicFilePath(shot), fullPage: true }).catch(() => { });

            const pauseMs = getPlaywrightPostRunPauseMs();
            if (!getPlaywrightLaunchOptions().headless && pauseMs) {
                await targetForShot.waitForTimeout(pauseMs).catch(() => { });
            }
        }
        res.status(500).json({
            ok: false,
            inputUrl: addUrl,
            error: e && e.message ? e.message : String(e),
            screenshot: shot,
            finalUrl: page ? page.url() : null,
            trace
        });
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
});

// Improved Puppeteer Fetch for Cloudflare Bypass
async function puppeteerFetch(url, options = {}, specificApiKey = null, timeoutMs = 60000) {
    let browser = null;
    try {
        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-notifications',
            '--disable-extensions',
            '--mute-audio'
        ];

        // Specific config for Docker/Linux if Chromium is at system path
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();

        console.log(`[Puppeteer] Launching... Path: ${executablePath}`);

        browser = await puppeteer.launch({
            headless: 'shell',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: launchArgs,
            dumpio: true
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Authenticate (Basic Auth)
        const keyToUse = specificApiKey;
        if (keyToUse) {
            await page.authenticate({ username: 'apikey', password: keyToUse });
        }

        // --- Navigate with Error Handling ---
        try {
            console.log(`[Puppeteer] Navigating to ${url}...`);

            // Set Headers
            if (options.headers) await page.setExtraHTTPHeaders(options.headers);

            const method = options.method || 'GET';

            if (method === 'GET') {
                const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
                const content = await page.evaluate(() => document.body.innerText);

                try {
                    return { status: response.status(), data: JSON.parse(content) };
                } catch {
                    // --- DEBUG: TAKE SCREENSHOT ON ERROR ---
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const debugDir = './public/debug';
                    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
                    const shotPath = `${debugDir}/error_${timestamp}.png`;
                    await page.screenshot({ path: shotPath, fullPage: true });
                    console.error(`[Puppeteer] JSON Parse Failed. content preview: ${content.substring(0, 200)}...`);
                    console.error(`[Puppeteer] Screenshot saved to: ${shotPath}`);

                    return { status: response.status(), data: content, error: 'Invalid JSON response (Check Debug Screenshot)' };
                }

            } else {
                // For POST/PUT/DELETE, we rely on page.evaluate fetch to bypass cloudflare fully
                // BUT we must navigate to the domain first to avoid CORS (Origin: null)
                const targetUrl = new URL(url);
                try {
                    // Navigate to a harmless page on the same domain (e.g., login or root)
                    await page.goto(`${targetUrl.origin}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
                } catch (navErr) {
                    console.warn(`[Puppeteer] Pre-navigation warning: ${navErr.message}`);
                    // Continue anyway, maybe it loaded partial
                }

                const result = await page.evaluate(async (endpoint, opts, authKey) => {
                    const headers = {
                        'Content-Type': 'application/json',
                        ...opts.headers
                    };
                    if (authKey) headers['Authorization'] = 'Basic ' + btoa('apikey:' + authKey);

                    try {
                        const res = await fetch(endpoint, {
                            method: opts.method,
                            headers: headers,
                            body: opts.body
                        });
                        const txt = await res.text();
                        try { return { status: res.status, data: JSON.parse(txt) }; }
                        catch { return { status: res.status, data: txt, isError: true }; }
                    } catch (e) {
                        return { status: 500, error: e.toString() };
                    }
                }, url, options, keyToUse);

                if (result.isError) {
                    // Screenshot for POST fail
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const debugDir = './public/debug';
                    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
                    await page.screenshot({ path: `${debugDir}/post_error_${timestamp}.png` });
                    console.error(`[Puppeteer] POST Failed. Response: ${result.data}`);
                }

                return result;
            }

        } catch (e) {
            console.error('[Puppeteer] Navigation/Eval Error:', e.message);
            // Screenshot on Crash
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const debugDir = './public/debug';
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
            await page.screenshot({ path: `${debugDir}/crash_${timestamp}.png` }).catch(() => { });

            return { status: 500, error: e.message };
        }

    } catch (error) {
        console.error('[Puppeteer] Critical Error:', error);
        return { status: 500, error: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

// Session Helpers (Mapped to PuppeteerFetch)
async function createBrowserSession(apiKey) { return { apiKey }; }
async function fetchWithSession(session, url, options = {}) { return await puppeteerFetch(url, options, session.apiKey); }

// (Legacy helpers removed to avoid duplication)

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

function publicFilePath(relPath) {
    const cleaned = String(relPath || '').replace(/^\/+/, '');
    return path.resolve(__dirname, 'public', cleaned);
}

// Initialize SQLite Database
const dbFile = process.env.DB_FILE || './projects.db';
console.log(`Database file should be at: ${require('path').resolve(dbFile)}`);
const db = new sqlite3.Database(dbFile);

// Create table if not exists
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, project_id TEXT UNIQUE, name TEXT, updated_at DATETIME)");
    db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS local_assignees (id INTEGER PRIMARY KEY, name TEXT)");
    db.run(`CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        openproject_id TEXT,
        subject TEXT,
        project_name TEXT,
        start_date TEXT,
        due_date TEXT,
        spent_hours TEXT,
        web_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // New isolated Ranking Table
    db.run(`CREATE TABLE IF NOT EXISTS ranking_scores (
        user_id TEXT PRIMARY KEY,
        score INTEGER DEFAULT 0
    )`, (err) => {
        if (!err) {
            // Migrate existing count on startup if the table was just created
            // We use INSERT OR IGNORE so it only seeds once
            db.run(`
                INSERT OR IGNORE INTO ranking_scores (user_id, score)
                SELECT h.user_id, COUNT(h.id) 
                FROM task_history h
                GROUP BY h.user_id
            `);
        }
    });

    db.run("CREATE TABLE IF NOT EXISTS user_project_mapping (user_id TEXT, project_id TEXT, PRIMARY KEY(user_id, project_id))");
    db.run("CREATE TABLE IF NOT EXISTS project_types (project_id TEXT, type_id TEXT, type_name TEXT, PRIMARY KEY(project_id, type_id))");

    // Per-user defaults for the WFH automation form (stored as JSON).
    db.run(`CREATE TABLE IF NOT EXISTS wfh_form_defaults (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.get('/api/wfh/defaults', (req, res) => {
    const userId = req.cookies.user_id || req.cookies.sdb_session;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    db.get('SELECT data FROM wfh_form_defaults WHERE user_id = ?', [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            // Seed defaults on first use so UI always loads from DB.
            const defaults = {
                thaiName: 'นัทธพงศ์ วิวิธสุรการ',
                engName: 'Nutthapong Vivithsurakarn',
                email: 'nutthapong.v@softdebut.com',
                phone: '0853166969',
                department: 'Technology division',
                because: 'ขอใช้สิทธิ์',
                reason: 'ขอใช้สิทธิ์',
                startDate: '27/05/2026',
                endDate: '27/05/2026',
                extra: 'ขอใช้สิทธิ์'
            };

            db.run(
                `INSERT INTO wfh_form_defaults (user_id, data, updated_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)`,
                [userId, JSON.stringify(defaults)],
                () => res.json(defaults)
            );
            return;
        }
        try {
            res.json(JSON.parse(row.data));
        } catch {
            res.json({});
        }
    });
});

app.post('/api/wfh/defaults', (req, res) => {
    const userId = req.cookies.user_id || req.cookies.sdb_session;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const json = JSON.stringify(data);
    db.run(
        `INSERT INTO wfh_form_defaults (user_id, data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
        [userId, json],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ok: true });
        }
    );
});

// Helper to save projects to DB (Upsert Logic)
function saveProjectsToDB(projects) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare(`
            INSERT INTO projects (project_id, name, updated_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at
        `);

        const now = new Date().toISOString();
        projects.forEach(p => {
            stmt.run(p.id, p.name, now);
        });

        stmt.finalize();
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)", now);
        db.run("COMMIT");
    });
    console.log(`Synced ${projects.length} projects with database at ${new Date().toISOString()}`);
}

// Helper to Sync All Projects (Global) with Types using Session
// Helper to Sync All Projects (Global) with Types using PuppeteerFetch
// Helper to Sync All Projects (Global) with Types using Persistent Browser Session
async function syncAllProjects(apiKey) {
    if (!apiKey) return;

    console.log(`Syncing ALL projects and types (Single Browser Session)...`);

    // Launch Browser Manually
    const browser = await puppeteer.launch({
        headless: 'shell',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-notifications',
            '--disable-extensions',
            '--mute-audio'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    let typeCount = 0;

    try {
        const page = await browser.newPage();

        // 1. Set Authorization Header Globally for this page
        // OpenProject API accepts Basic Auth (apikey:<key>)
        const authString = 'Basic ' + Buffer.from('apikey:' + apiKey).toString('base64');
        await page.setExtraHTTPHeaders({
            'Authorization': authString,
            'Accept': 'application/json'
        });

        // 2. Fetch Projects
        // Note: For API endpoints that return JSON, we read document.body.innerText
        const projectsUrl = `${HOST}/api/v3/projects?pageSize=500`;
        console.log(`[Sync] Fetching Projects List...`);

        await page.goto(projectsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const projectsContent = await page.evaluate(() => document.body.innerText);

        let projectsData;
        try {
            projectsData = JSON.parse(projectsContent);
        } catch (e) {
            console.error(`[Sync] Failed to parse Projects JSON. Content: ${projectsContent.substring(0, 200)}...`);
            throw new Error('Invalid JSON from Projects API');
        }

        if (projectsData && projectsData._embedded && projectsData._embedded.elements) {
            const projects = projectsData._embedded.elements;
            console.log(`[Sync] Found ${projects.length} projects. Fetching types...`);

            // DB Upsert Projects
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const now = new Date().toISOString();
                const upsertStmt = db.prepare(`
                    INSERT INTO projects (project_id, name, updated_at) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(project_id) DO UPDATE SET
                    name = excluded.name,
                    updated_at = excluded.updated_at
                `);
                projects.forEach(p => upsertStmt.run(p.id.toString(), p.name, now));
                upsertStmt.finalize();
                db.run("COMMIT");
            });

            // 3. Loop Fetch Types (Using SAME Page)
            for (const p of projects) {
                try {
                    const typeUrl = `${HOST}/api/v3/projects/${p.id}/types`;
                    // console.log(`[Sync] Fetching types for Project ${p.id}...`); // Too verbose

                    await page.goto(typeUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    const typeContent = await page.evaluate(() => document.body.innerText);
                    const typeData = JSON.parse(typeContent);

                    if (typeData && typeData._embedded && typeData._embedded.elements) {
                        const types = typeData._embedded.elements;

                        await new Promise((resolve) => {
                            db.serialize(() => {
                                db.run("BEGIN TRANSACTION");
                                const typeStmt = db.prepare("INSERT OR REPLACE INTO project_types (project_id, type_id, type_name) VALUES (?, ?, ?)");
                                types.forEach(t => {
                                    typeStmt.run(p.id.toString(), t.id.toString(), t.name);
                                    typeCount++;
                                });
                                typeStmt.finalize();
                                db.run("COMMIT", resolve);
                            });
                        });
                    }
                } catch (err) {
                    console.log(`[Sync] Failed types for Project ${p.id}: ${err.message}`);
                }
            }

            console.log(`[Sync] Completed. Total Types Synced: ${typeCount}`);
            return projects.length;
        }

    } catch (error) {
        console.error("Failed to sync projects:", error);
    } finally {
        if (browser) {
            console.log('[Sync] Closing Browser...');
            await browser.close();
        }
    }
}

// GET Project Types
app.get('/api/projects/:id/types', (req, res) => {
    const projectId = req.params.id;
    db.all("SELECT type_id, type_name FROM project_types WHERE project_id = ? ORDER BY type_name", [projectId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});


// GET Projects: Read from DB (Filtered by User)
// GET Projects: Read ALL from DB
app.get('/api/projects', (req, res) => {
    const search = req.query.q || '';

    let query = `SELECT project_id as id, name FROM projects`;
    let params = [];

    if (search) {
        query += " WHERE name LIKE ?";
        params.push(`%${search}%`);
    }

    query += " ORDER BY name ASC";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// --- Auth Endpoints ---
app.post('/api/login', async (req, res) => {
    let { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and Password are required' });
    }

    // 1. Check Local DB
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, dbUser) => {
        if (err) {
            console.error('Login DB Error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!dbUser) {
            // Use dummy comparison to prevent timing attacks? (Not critical for POC)
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Check Password (Bcrypt or Legacy Plaintext)
        let passwordMatch = false;
        let migrationNeeded = false;

        if (dbUser.password.startsWith('$2b$') || dbUser.password.startsWith('$2a$')) {
            // It's a hash
            passwordMatch = await bcrypt.compare(password, dbUser.password);
        } else {
            // It's likely plaintext (Legacy)
            if (dbUser.password === password) {
                passwordMatch = true;
                migrationNeeded = true;
            }
        }

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Lazy Migration: Update to Hash
        if (migrationNeeded) {
            console.log(`Migrating password for user ${username} to hash...`);
            const newHash = await bcrypt.hash(password, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [newHash, dbUser.id]);
        }

        const apikey = dbUser.api_key;
        console.log(`User '${username}' authenticated. Verifying Key...`);

        try {
            // 2. Refresh/Verify Session with OpenProject
            const result = await puppeteerFetch(`${HOST}/api/v3/users/me`, {
                method: 'GET'
            }, apikey);

            if (result.status >= 200 && result.status < 300) {
                let user = result.data;
                if (typeof user === 'string') {
                    try { user = JSON.parse(user); } catch (e) { }
                }

                console.log(`Login successful for: ${user.name} (ID: ${user.id})`);

                // Backfill openproject_id if missing or mismatch
                if (user.id) {
                    db.run("UPDATE users SET openproject_id = ? WHERE id = ?", [user.id.toString(), dbUser.id]);
                }

                // Set Cookies
                res.cookie('sdb_session', dbUser.id.toString(), {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_apikey', apikey, {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_id', user.id || '0', {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_name', encodeURIComponent(dbUser.name), { // Use Local Name
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });

                // await syncAllProjects(apikey); // Disabled

                res.json({
                    message: 'Login successful',
                    user: { id: user.id || 0, name: dbUser.name }
                });
            } else {
                console.warn(`Login failed. OpenProject rejected key. Status: ${result.status}`);
                res.status(401).json({
                    error: 'Your OpenProject API Key may have expired or is invalid. Please contact admin or re-register.',
                    details: JSON.stringify(result.data).substring(0, 150)
                });
            }

        } catch (error) {
            console.error('Login System Error:', error);
            res.status(500).json({ error: 'Internal Server Error during login.' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('sdb_session');
    res.clearCookie('user_apikey');
    res.clearCookie('user_name');
    res.json({ message: 'Logged out' });
});

app.get('/api/user', async (req, res) => {
    const session = getSession(req);
    if (session && session.isValid) {
        // Query Role from DB
        const localId = req.cookies.sdb_session;

        // Default response
        const userResp = session.user || { name: 'User' };

        if (localId) {
            db.get("SELECT role FROM users WHERE id = ?", [localId], (err, row) => {
                userResp.role = (row && row.role) ? row.role : 'user';
                res.json(userResp);
            });
        } else {
            userResp.role = 'user';
            res.json(userResp);
        }
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

function getSession(req) {
    if (req.cookies.user_apikey) {
        const userName = req.cookies.user_name ? decodeURIComponent(req.cookies.user_name) : 'API User';
        const userId = req.cookies.user_id || null;
        return {
            isValid: true,
            type: 'apikey',
            cookies: { apikey: req.cookies.user_apikey },
            user: { id: userId, name: userName }
        };
    }
    return null;
}

// --- Local Assignees API ---

// GET All Local Assignees
app.get('/api/assignees', (req, res) => {
    db.all("SELECT * FROM local_assignees ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Helper to search user in a specific project
async function findUserInProject(name, projectId) {
    try {
        console.log(`Searching for '${name}' in Project ${projectId}...`);
        const url = `${HOST} /api/v3 / projects / ${projectId}/available_assignees`;
        const result = await puppeteerFetch(url, { method: 'GET' }, null, 3000); // 3s Timeout

        if (result.status >= 200 && result.status < 300 && result.data._embedded && result.data._embedded.elements) {
            const user = result.data._embedded.elements.find(el => el._type === 'User' && el.name.toLowerCase().includes(name.toLowerCase()));
            if (user) {
                return user.id.toString();
            }
        }
    } catch (e) {
        console.error(`Search failed for project ${projectId}:`, e.message);
    }
    return null;
}

// ADD Local Assignee
app.post('/api/assignees', async (req, res) => {
    const { name, projectId, openProjectId } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = openProjectId || null;

    // Search Strategy:
    // 1. If project context provided, search there first.
    // 2. If not found or no context, search in default projects (Production: 614, MA: 615)
    // 3. This covers the "Global" search requirement without global permissions.

    const searchQueue = [];
    if (projectId) searchQueue.push(projectId);
    searchQueue.push('614'); // Default Production
    searchQueue.push('615'); // Default MA

    // Remove duplicates
    const uniqueQueue = [...new Set(searchQueue)];

    if (!finalOpId) {
        for (const pid of uniqueQueue) {
            finalOpId = await findUserInProject(name, pid);
            if (finalOpId) {
                console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
                break;
            }
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    db.get("SELECT * FROM local_assignees WHERE id = ?", [finalOpId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            // Found existing, return it (Find or Create logic)
            return res.json(row);
        }

        db.run("INSERT INTO local_assignees (id, name) VALUES (?, ?)", [finalOpId, name], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: finalOpId, name: name });
        });
    });
});

// UPDATE Local Assignee
app.put('/api/assignees/:id', async (req, res) => {
    const { name, projectId } = req.body;
    const { id } = req.params;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = null;

    const searchQueue = [];
    if (projectId) searchQueue.push(projectId);
    searchQueue.push('614');
    searchQueue.push('615');

    const uniqueQueue = [...new Set(searchQueue)];

    for (const pid of uniqueQueue) {
        finalOpId = await findUserInProject(name, pid);
        if (finalOpId) {
            console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
            break;
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    // Check for duplicate OpenProject ID (excluding current record)
    db.get("SELECT * FROM local_assignees WHERE openproject_id = ? AND id != ?", [finalOpId, id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(409).json({ error: `Duplicate: '${row.name}' already uses ID ${finalOpId}.` });
        }

        db.run("UPDATE local_assignees SET name = ?, openproject_id = ? WHERE id = ?", [name, finalOpId, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Updated successfully' });
        });
    });
});

// DELETE Local Assignee
app.delete('/api/assignees/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM local_assignees WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted successfully' });
    });
});

// Return empty list for old dynamic endpoint (Frontend will be updated to use /api/assignees)
app.get('/api/projects/:id/assignees', (req, res) => {
    res.json([]);
});

// --- Task History API ---
// GET History for current user
// GET History for current user (with Pagination)
app.get('/api/history', (req, res) => {
    const userId = req.cookies.sdb_session;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    // 1. Get Total Count
    db.get("SELECT COUNT(*) as count FROM task_history WHERE user_id = ?", [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const totalItems = row.count;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Get Data for current page
        db.all(
            "SELECT * FROM task_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [userId, limit, offset],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                    data: rows || [],
                    pagination: {
                        current: page,
                        limit: limit,
                        totalItems: totalItems,
                        totalPages: totalPages
                    }
                });
            }
        );
    });
});

// POST Add to History
app.post('/api/history', (req, res) => {
    const userId = req.cookies.sdb_session;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { openprojectId, subject, projectName, startDate, dueDate, spentHours, webUrl } = req.body;

    db.run(
        `INSERT INTO task_history (user_id, openproject_id, subject, project_name, start_date, due_date, spent_hours, web_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, openprojectId, subject, projectName, startDate, dueDate, spentHours, webUrl],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            db.run(`
                INSERT INTO ranking_scores (user_id, score) 
                VALUES (?, 1) 
                ON CONFLICT(user_id) DO UPDATE SET score = score + 1
            `, [userId]);
            res.json({ id: this.lastID, message: 'Added to history' });
        }
    );
});

// DELETE from History (local DB only)
app.delete('/api/history/:id', (req, res) => {
    const userId = req.cookies.sdb_session;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    console.log(`Deleting from local history: ID=${id}, UserID=${userId}`);

    db.run(
        "DELETE FROM task_history WHERE id = ? AND user_id = ?",
        [id, userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'History item not found' });
            }

            // Decrease ranking by 1, floor at 0
            db.run(`
                UPDATE ranking_scores 
                SET score = MAX(0, score - 1) 
                WHERE user_id = ?
            `, [userId]);

            res.json({ message: 'Deleted from history' });
        }
    );
});

// API to create Work Package
app.post('/api/work_packages', async (req, res) => {
    const { projectId, projectName, subject, description, assigneeId, typeId, startDate, dueDate, percentageDone, spentHours } = req.body;
    const userApiKey = req.cookies.user_apikey;

    if (!userApiKey) {
        return res.status(401).json({ error: 'Not authenticated. Please login.' });
    }

    if (!projectId || !subject) {
        return res.status(400).json({ error: 'Missing projectId or subject' });
    }

    try {
        let openProjectAssigneeId = assigneeId; // Default to assuming it's already an OP ID

        // Optional: Lookup in local DB if we suspect it's a local mapping ID 
        // But since we aligned IDs, direct usage is safer. We'll keep DB check just in case.
        if (assigneeId) {
            const assignee = await new Promise((resolve) => {
                db.get("SELECT openproject_id FROM local_assignees WHERE id = ?", [assigneeId], (err, row) => resolve(row));
            });
            if (assignee && assignee.openproject_id) {
                openProjectAssigneeId = assignee.openproject_id;
            }
        }

        console.log(`Creating Task '${subject.substring(0, 20)}...' in Project ${projectId} (Assignee: ${openProjectAssigneeId})...`);
        const url = `${HOST}/api/v3/projects/${projectId}/work_packages`;

        const payload = {
            subject: subject.trim(),
            description: { raw: description ? description.trim() : "" },
            percentageDone: parseInt(percentageDone) || 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            "_links": {
                "type": {
                    "href": `/api/v3/types/${typeId || 1}`
                }
            }
        };

        if (openProjectAssigneeId) {
            payload._links.assignee = { href: `/api/v3/users/${openProjectAssigneeId}` };
        }

        if (!payload.startDate) delete payload.startDate;
        if (!payload.dueDate) delete payload.dueDate;

        const result = await puppeteerFetch(url, {
            method: 'POST',
            body: JSON.stringify(payload)
        }, userApiKey);

        if (result.status >= 200 && result.status < 300) {
            // Check if actual JSON
            if (typeof result.data !== 'object') {
                console.error('[CreateTask] Unexpected non-object response:', result.data);
                return res.status(500).json({ error: 'OpenProject returned invalid data (likely Cloudflare block)' });
            }

            const newWorkPackageId = result.data.id;
            const webUrl = `${HOST}/work_packages/${newWorkPackageId}`;

            // --- History Log ---
            const sdbSession = req.cookies.sdb_session;
            const nowIso = new Date().toISOString();
            // Schema: user_id, openproject_id, subject, project_name, start_date, due_date, spent_hours, web_url, created_at
            db.run(
                `INSERT INTO task_history (user_id, openproject_id, subject, project_name, start_date, due_date, spent_hours, web_url, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sdbSession, newWorkPackageId, subject, projectName || 'Unknown', startDate || null, dueDate || null, spentHours || 0, webUrl, nowIso],
                (err) => {
                    if (err) {
                        console.error("Failed to log history", err);
                    } else {
                        // Increase ranking by 1 when history is logged
                        db.run(`
                            INSERT INTO ranking_scores (user_id, score) 
                            VALUES (?, 1) 
                            ON CONFLICT(user_id) DO UPDATE SET score = score + 1
                        `, [sdbSession]);
                    }
                }
            );
            // -------------------

            // --- Log Time Logic ---
            let timeError = null;
            if (spentHours && parseFloat(spentHours) > 0) {
                console.log(`Logging ${spentHours} hours for WP #${newWorkPackageId}...`);
                const timeUrl = `${HOST}/api/v3/time_entries`;
                const isoDuration = `PT${spentHours}H`;
                const dateToLog = startDate || new Date().toISOString().split('T')[0];

                const timePayload = {
                    "_links": {
                        "workPackage": { "href": `/api/v3/work_packages/${newWorkPackageId}` },
                        "activity": { "href": "/api/v3/time_entries/activities/1" }
                    },
                    "hours": isoDuration,
                    "spentOn": dateToLog,
                    "comment": { "raw": "Logged via Task Creator" }
                };

                const timeResult = await puppeteerFetch(timeUrl, {
                    method: 'POST',
                    body: JSON.stringify(timePayload)
                }, userApiKey);

                if (timeResult.status < 200 || timeResult.status >= 300) {
                    timeError = (typeof timeResult.data === 'object' ? timeResult.data.message : 'Failed to log time') || 'Unknown Time Error';
                    console.error('Failed to log time:', timeResult.status, timeError);
                }
            }
            // ---------------------

            res.json({
                ...result.data,
                webUrl,
                timeError: timeError ? `Note: Task created, but failed to log time (${timeError})` : null
            });
        } else {
            // Error Handling: Ensure JSON
            console.error('[CreateTask] API Error:', result.status, result.data);
            const errMsg = (typeof result.data === 'object' && result.data.message)
                ? result.data.message
                : (typeof result.data === 'string' && result.data.includes('<!DOCTYPE'))
                    ? 'Blocked by Cloudflare (HTML Response)'
                    : 'Unknown Error from OpenProject';

            res.status(result.status).json({ error: errMsg, details: result.data });
        }
    } catch (error) {
        console.error('[CreateTask] Exception:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE Work Package from OpenProject
app.delete('/api/work_packages/:id', async (req, res) => {
    const { id } = req.params;
    const userApiKey = req.cookies.user_apikey;

    if (!userApiKey) {
        return res.status(401).json({ error: 'Not authenticated. Please login.' });
    }

    if (!id) {
        return res.status(400).json({ error: 'Missing work package ID' });
    }

    try {
        console.log(`Deleting Work Package #${id}...`);
        const url = `${HOST}/api/v3/work_packages/${id}`;

        const result = await puppeteerFetch(url, {
            method: 'DELETE'
        }, userApiKey);

        if (result.status >= 200 && result.status < 300) {
            console.log(`Work Package #${id} deleted successfully.`);
            res.json({ success: true, message: `Work Package #${id} deleted.` });
        } else if (result.status === 404) {
            console.log(`Work Package #${id} not found in OpenProject. Treating as success.`);
            res.json({ success: true, message: `Work Package #${id} was already deleted or not found.` });
        } else {
            console.error('Failed to delete:', result.status, result.data);
            res.status(result.status).json({ error: result.data?.message || 'Failed to delete work package' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API to sync users (POST) - Persistent Session
app.post('/api/sync-users', async (req, res) => {
    const apiKey = req.cookies.user_apikey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    console.log('Syncing users (Persistent Session)...');
    let session = null;

    try {
        session = await createBrowserSession(apiKey);
        const projectIds = [614, 615];
        let allUsers = [];

        for (const pid of projectIds) {
            console.log(`Fetching available assignees for project ${pid}...`);
            const response = await fetchWithSession(session, `${HOST}/api/v3/projects/${pid}/available_assignees`, { method: 'GET' });
            if (response.status === 200 && response.data && response.data._embedded && response.data._embedded.elements) {
                allUsers = allUsers.concat(response.data._embedded.elements);
            }
        }

        if (allUsers.length === 0) return res.status(404).json({ error: 'No assignees found.' });

        const uniqueUsers = Array.from(new Map(allUsers.map(u => [u.id, u])).values());
        console.log(`Total unique assignees found: ${uniqueUsers.length}`);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            // Use UPSERT
            // id column is now the OpenProject ID (Primary Key)
            const stmt = db.prepare("INSERT INTO local_assignees (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name");
            uniqueUsers.forEach(u => stmt.run(u.id, u.name));
            stmt.finalize();
            db.run("COMMIT");
        });

        res.json({ message: 'Users synced successfully', count: uniqueUsers.length });

    } catch (error) {
        console.error('Sync users error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (session && session.browser) await session.browser.close();
    }
});

// Sync Projects Endpoint (Manual Trigger)
app.post('/api/sync-projects', async (req, res) => {
    const userApiKey = req.cookies.user_apikey;
    if (!userApiKey) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const count = await syncAllProjects(userApiKey);
        res.json({ message: 'Project synchronization started.', count: count || 0 });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// GET User Stats for Dashboard
app.get('/api/users-stats', (req, res) => {
    const query = `
        SELECT 
            COALESCE(u.name, a.name) as name, 
            COALESCE(r.score, 0) as task_count
        FROM local_assignees a 
        LEFT JOIN ranking_scores r ON a.id = r.user_id 
        LEFT JOIN users u ON u.openproject_id = a.id
        ORDER BY task_count DESC, name ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET Weekly Stats for Chart
// GET Weekly Stats for Chart (From OpenProject)
app.get('/api/weekly-stats', async (req, res) => {
    const userId = req.cookies.sdb_session; // OpenProject User ID
    const apiKey = req.cookies.user_apikey;

    if (!userId || !apiKey) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // Generate last 5 days dates (including today)
    const dates = [];
    for (let i = 4; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }

    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    try {
        // Construct OpenProject API Filter
        // Filter by user ID and Date Range (spentOn)
        // Note: OpenProject filter syntax is complex JSON stringified
        const filters = JSON.stringify([
            { "spent_on": { "operator": "<>d", "values": [startDate, endDate] } },
            { "user": { "operator": "=", "values": [userId] } }
        ]);

        const url = `${HOST}/api/v3/time_entries?filters=${encodeURIComponent(filters)}&pageSize=500`;
        console.log(`Fetching time entries from: ${url}`);

        const result = await puppeteerFetch(url, { method: 'GET' }, apiKey);

        if (result.status !== 200) {
            console.error('Failed to fetch stats from OP:', result.status);
            return res.status(result.status).json({ error: 'Failed to fetch external stats' });
        }

        const entries = result.data._embedded ? result.data._embedded.elements : [];

        // Aggregate
        const stats = dates.map(date => {
            // entries.hours is usually an ISO duration (e.g., PT5H) or simple value depending on API version
            // OpenProject V3 usually returns "PT1H", but let's check. 
            // Actually, usually it returns string like "PT1H", but we need to parse.
            // Wait, standard OpenProject V3 might return hours property?
            // Let's assume it returns ISO 8601 duration string in 'hours' field.

            // Filter entries for this date
            const dailyEntries = entries.filter(e => e.spentOn === date);

            // detailed tasks: { taskId, taskName, hours } 

            const detailedTasks = dailyEntries.map(e => {
                const duration = e.hours;
                let h = 0;
                let m = 0;
                const hMatch = duration.match(/(\d+(?:\.\d+)?)H/);
                const mMatch = duration.match(/(\d+)M/);
                if (hMatch) h = parseFloat(hMatch[1]);
                if (mMatch) m = parseInt(mMatch[1]);
                const total = h + (m / 60);

                // Try to get work package ID/Name
                // e._links.workPackage.href -> "/api/v3/work_packages/3038"
                // e._links.workPackage.title -> "Task Name" (Only if lightweight representation includes it, otherwise we might just have ID)

                const wpLink = e._links.workPackage;
                const wpId = wpLink.href.split('/').pop();
                const wpTitle = wpLink.title || `Task #${wpId}`;

                return {
                    taskId: wpId,
                    taskName: wpTitle,
                    hours: parseFloat(total.toFixed(2))
                };
            });

            // Format Label
            const parts = date.split('-');
            let label = `${parts[2]}/${parts[1]}`;
            const today = new Date().toISOString().split('T')[0];
            if (date === today) label += ' (Today)';

            return {
                date: date,
                label: label,
                tasks: detailedTasks,
                totalHours: detailedTasks.reduce((s, t) => s + t.hours, 0)
            };
        });

        console.log("Weekly Stats Response:", JSON.stringify(stats, null, 2));
        res.json(stats);

    } catch (e) {
        console.error('Weekly Stats Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- User Management & Registration ---

// Init Users Table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            openproject_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

    db.all("PRAGMA table_info(users)", (err, columns) => {
        if (!err && columns) {
            const hasRole = columns.some(c => c.name === 'role');
            if (!hasRole) {
                console.log("Migrating: Adding 'role' column...");
                db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
            }
            const hasOpId = columns.some(c => c.name === 'openproject_id');
            if (!hasOpId) {
                console.log("Migrating: Adding 'openproject_id' column...");
                db.run("ALTER TABLE users ADD COLUMN openproject_id TEXT");
            }
        }
    });
});

app.post('/api/register', async (req, res) => {
    const { name, username, password, apikey } = req.body;
    if (!name || !username || !password || !apikey) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    db.get('SELECT id, username, api_key FROM users WHERE username = ? OR api_key = ?', [username, apikey], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            if (row.username === username) return res.status(400).json({ error: 'Username already taken.' });
            if (row.api_key === apikey) return res.status(400).json({ error: 'This API Key is already registered.', errorIdentifier: 'DUPLICATE_API_KEY' });
        }

        try {
            // Check if DB is empty to assign ROOT role
            db.get("SELECT COUNT(*) as count FROM users", [], async (err, rowCount) => {
                if (err) return res.status(500).json({ error: 'Database check error' });

                const isFirstUser = rowCount.count === 0;
                const role = isFirstUser ? 'root' : 'user';

                console.log(`[Register] Checking API Key for ${username}...`);
                const result = await puppeteerFetch(`${HOST}/api/v3/users/me`, { method: 'GET' }, apikey);

                if (result.status >= 200 && result.status < 300) {
                    const opUser = result.data;
                    const hashedPassword = await bcrypt.hash(password, 10);
                    const opId = opUser.id.toString();

                    console.log(`[Register] Creating user ${username} (Role: ${role}, OP-ID: ${opId})`);

                    // Force ID = OpenProject ID for consistency
                    db.run(
                        'INSERT INTO users (id, username, password, name, api_key, role, openproject_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [opUser.id, username, hashedPassword, name, apikey, role, opId],
                        async function (err) {
                            if (err) {
                                // If insert fails (maybe duplicate ID), try fallback without explicit ID? 
                                // But we want explicit ID. So report error.
                                return res.status(500).json({ error: 'Database insert error: ' + err.message });
                            }

                            const newUserId = opUser.id; // Correct ID usage
                            res.cookie('sdb_session', newUserId.toString(), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                            res.cookie('user_apikey', apikey, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                            res.cookie('user_id', opId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                            res.cookie('user_name', encodeURIComponent(name), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

                            res.json({
                                message: 'Registration successful',
                                user: { id: newUserId, name: name, role: role }
                            });
                        }
                    );
                } else {
                    res.status(401).json({ error: 'Invalid API Key or Cloudflare blocked.' });
                }
            });
        } catch (e) {
            console.error('Registration Error:', e);
            res.status(500).json({ error: 'Server error during verification.' });
        }
    });
});

// --- Admin Endpoints ---

// Reset Ranking (Clear Task History)
app.post('/api/admin/reset-ranking', (req, res) => {
    const localUserId = req.cookies.sdb_session;
    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });

    // Simply set all scores to 0 in the separate ranking table
    db.run("UPDATE ranking_scores SET score = 0", [], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ranking counts reset successfully." });
    });
});

// Get All Users (All logged-in users can access)
app.get('/api/admin/users', (req, res) => {
    const localUserId = req.cookies.sdb_session;
    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });

    // Allow all logged-in users to view user list
    db.all("SELECT id, username, name, role, openproject_id, created_at FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Reset User Password (All logged-in users can access)
app.post('/api/admin/users/:id/reset-password', async (req, res) => {
    const targetId = req.params.id;
    const { newPassword } = req.body;
    const localUserId = req.cookies.sdb_session;

    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!newPassword) return res.status(400).json({ error: "New password is required" });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, targetId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Password updated successfully" });
        });
    } catch (e) {
        res.status(500).json({ error: "Error hashing password" });
    }
});

// Update User Info (All logged-in users can access)
// Update User Info (All logged-in users can access but check permissions in real app)
app.put('/api/admin/users/:id', (req, res) => {
    const targetId = req.params.id;
    const { username, name, role } = req.body;
    const localUserId = req.cookies.sdb_session;

    console.log(`DEBUG: Updating User ${targetId} -> Role: ${role}, Username: ${username}, Name: ${name}`);

    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!username && !name && !role) return res.status(400).json({ error: "At least one field is required" });

    // Build dynamic update query
    let updates = [];
    let params = [];

    if (username) {
        updates.push("username = ?");
        params.push(username);
    }
    if (name) {
        updates.push("name = ?");
        params.push(name);
    }
    if (role) {
        updates.push("role = ?");
        params.push(role);
    }

    params.push(targetId);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;

    db.run(query, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User updated successfully" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    const dbPath = require('path').resolve(dbFile || 'projects.db'); // Safe reference
    console.log(`Database file should be at: ${dbPath}`);
});
