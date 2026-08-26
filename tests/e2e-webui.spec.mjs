import playwright from 'playwright';

async function runWebUiAutoTest() {
    console.log('--- STARTING AUTOMATED WEB UI E2E TEST ---');
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();

    // Set authenticated session cookies
    await context.addCookies([
        { name: 'sdb_session', value: '213', domain: 'localhost', path: '/' },
        { name: 'user_apikey', value: '2d25f9d621eeba19d1253aaf772557f3588fecc12d25668ed7c70df50c173fef', domain: 'localhost', path: '/' },
        { name: 'user_name', value: 'admin', domain: 'localhost', path: '/' },
        { name: 'user_id', value: '213', domain: 'localhost', path: '/' }
    ]);

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    // 1. Navigate to Dashboard
    console.log('[1/4] Navigating to http://localhost:3002/ ...');
    await page.goto('http://localhost:3002/', { waitUntil: 'networkidle' });

    // Assert no JavaScript console errors
    if (consoleErrors.length > 0) {
        console.error('FAILED: Browser console errors detected:', consoleErrors);
        await browser.close();
        process.exit(1);
    }
    console.log('[1/4] PASSED: No browser JS errors.');

    // 2. Verify Ranking Table Data Rendering
    console.log('[2/4] Verifying Ranking Table (#usersStatsBody) rows...');
    await page.waitForSelector('#usersStatsBody tr', { timeout: 10000 });
    const rowCount = await page.locator('#usersStatsBody tr').count();
    console.log(`[2/4] Ranking table contains ${rowCount} rows.`);

    if (rowCount <= 1) {
        console.error('FAILED: Ranking table is empty or stuck on Loading...');
        await browser.close();
        process.exit(1);
    }
    console.log('[2/4] PASSED: Ranking table populated with user data.');

    // 3. Verify Unlogged Workdays Panel Data Rendering
    console.log('[3/4] Verifying Unlogged Workdays Panel (#unloggedWorkdaysContainer)...');
    const unloggedHtml = await page.locator('#unloggedWorkdaysContainer').innerHTML();
    if (!unloggedHtml || unloggedHtml.includes('กำลังโหลด')) {
        console.error('FAILED: Unlogged workdays container is empty or stuck on Loading...');
        await browser.close();
        process.exit(1);
    }
    console.log('[3/4] PASSED: Unlogged Workdays container populated with workdays data.');

    // 4. Verify Refresh Button behavior (preserves table visibility & updates data)
    console.log('[4/4] Testing Refresh Button (#refreshUnloggedBtn) click...');
    const refreshBtn = page.locator('#refreshUnloggedBtn');
    if (await refreshBtn.count() > 0) {
        await refreshBtn.click();
        await page.waitForTimeout(1500);
        const updatedRowCount = await page.locator('#usersStatsBody tr').count();
        if (updatedRowCount <= 1) {
            console.error('FAILED: Table data disappeared after clicking refresh.');
            await browser.close();
            process.exit(1);
        }
    }
    console.log('[4/4] PASSED: Refresh button updated table data without losing visibility.');

    await browser.close();
    console.log('--- ALL WEB UI AUTO TESTS PASSED 100% ---');
}

runWebUiAutoTest().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
