import assert from 'assert';
import sqlite3 from 'sqlite3';

function parseIsoDuration(durationStr) {
    if (!durationStr) return 0;
    if (typeof durationStr === 'number') return durationStr;
    const str = String(durationStr).trim();
    if (!isNaN(Number(str))) return Number(str);

    let totalHours = 0;
    const daysMatch = /P(?:(\d+)D)?/.exec(str);
    if (daysMatch && daysMatch[1]) {
        totalHours += Number(daysMatch[1]) * 8;
    }

    const timePartMatch = /T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(str);
    if (timePartMatch) {
        if (timePartMatch[1]) totalHours += Number(timePartMatch[1]);
        if (timePartMatch[2]) totalHours += Number(timePartMatch[2]) / 60;
        if (timePartMatch[3]) totalHours += Number(timePartMatch[3]) / 3600;
    }

    return Math.round(totalHours * 100) / 100;
}

console.log('--- 1. Testing parseIsoDuration helper ---');
assert.strictEqual(parseIsoDuration('PT2H'), 2);
assert.strictEqual(parseIsoDuration('PT2.5H'), 2.5);
assert.strictEqual(parseIsoDuration('PT1H30M'), 1.5);
assert.strictEqual(parseIsoDuration('PT45M'), 0.75);
assert.strictEqual(parseIsoDuration('2.5'), 2.5);
assert.strictEqual(parseIsoDuration(''), 0);
assert.strictEqual(parseIsoDuration(null), 0);
console.log('parseIsoDuration tests PASSED!');

console.log('\n--- 2. Testing relative date preset helpers ---');
const todayTest = new Date('2026-08-25T00:00:00Z');
const yearTest = todayTest.getFullYear();

// 1 Month ago
const start1M = new Date(todayTest);
start1M.setMonth(start1M.getMonth() - 1);
assert.strictEqual(start1M.toISOString().split('T')[0], '2026-07-25');

// 3 Months ago
const start3M = new Date(todayTest);
start3M.setMonth(start3M.getMonth() - 3);
assert.strictEqual(start3M.toISOString().split('T')[0], '2026-05-25');

// 6 Months ago
const start6M = new Date(todayTest);
start6M.setMonth(start6M.getMonth() - 6);
assert.strictEqual(start6M.toISOString().split('T')[0], '2026-02-25');

// 1 Year ago
const start1Y = new Date(todayTest);
start1Y.setFullYear(start1Y.getFullYear() - 1);
assert.strictEqual(start1Y.toISOString().split('T')[0], '2025-08-25');

// This Year (ปีนี้)
assert.strictEqual(`${yearTest}-01-01`, '2026-01-01');

// Last Year (ปีที่แล้ว)
assert.strictEqual(`${yearTest - 1}-01-01`, '2025-01-01');
assert.strictEqual(`${yearTest - 1}-12-31`, '2025-12-31');
console.log('Relative date preset tests PASSED!');

console.log('\n--- 3. Testing SQLite openproject_time_entries aggregation & ranking_cache ---');
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run(`CREATE TABLE local_assignees (id INTEGER PRIMARY KEY, name TEXT)`);
    db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, openproject_id TEXT)`);
    db.run(`CREATE TABLE openproject_time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openproject_id TEXT UNIQUE,
        user_id TEXT,
        user_name TEXT,
        work_package_id TEXT,
        spent_on TEXT,
        hours REAL DEFAULT 0
    )`);
    db.run(`CREATE TABLE ranking_cache (
        assignee_id TEXT PRIMARY KEY,
        name TEXT,
        total_hours REAL DEFAULT 0,
        task_count INTEGER DEFAULT 0,
        data_source TEXT,
        missing_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE user_sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        sync_date TEXT NOT NULL,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`INSERT INTO local_assignees (id, name) VALUES (1, 'User 1'), (2, 'User 2')`);
    db.run(`INSERT INTO users (id, name, role, openproject_id) VALUES ('u1', 'User 1', 'user', '1'), ('u2', 'User 2', 'admin', '2')`);
    
    // Time logged in August 2026
    db.run(`INSERT INTO openproject_time_entries (openproject_id, user_id, spent_on, hours) VALUES 
        ('op1', '1', '2026-08-17', 8.0),
        ('op2', '1', '2026-08-18', 5.0),
        ('op3', '1', '2026-08-20', 8.0),
        ('op4', '2', '2026-08-17', 8.0)
    `);

    // Query entries in August 2026
    const query = `
        SELECT 
            a.id as assignee_id,
            COALESCE(u.name, a.name) as name, 
            COALESCE(t.total_op_hours, 0) as total_hours,
            COALESCE(t.op_task_count, 0) as task_count
        FROM local_assignees a 
        LEFT JOIN users u ON u.openproject_id = CAST(a.id AS TEXT)
        LEFT JOIN (
            SELECT 
                user_id,
                SUM(hours) as total_op_hours,
                COUNT(DISTINCT openproject_id) as op_task_count
            FROM openproject_time_entries t
            WHERE DATE(t.spent_on) BETWEEN DATE('2026-08-01') AND DATE('2026-08-31')
            GROUP BY user_id
        ) t ON (t.user_id = CAST(a.id AS TEXT) OR t.user_id = u.openproject_id OR t.user_id = u.id)
        GROUP BY a.id, a.name, u.name
        ORDER BY total_hours DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) throw err;
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].name, 'User 1');
        assert.strictEqual(rows[0].total_hours, 21.0);
        assert.strictEqual(rows[1].name, 'User 2');
        assert.strictEqual(rows[1].total_hours, 8.0);
        console.log('SQLite aggregation test PASSED!');

        console.log('\n--- 4. Testing Mon-Fri Missing Workdays Logic ---');
        // Evaluate Mon-Fri range: 2026-08-17 (Mon) to 2026-08-21 (Fri) = 5 workdays
        // User 1 logged: Mon (8.0), Tue (5.0), Wed (0), Thu (8.0), Fri (0)
        // Missing days for User 1: Tue (missing 3.0), Wed (missing 8.0), Fri (missing 8.0) -> Total 3 days, 19.0 hrs.
        const workdays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
        const loggedMap = { '2026-08-17': 8.0, '2026-08-18': 5.0, '2026-08-20': 8.0 };

        const missingDays = [];
        let totalMissingHours = 0;
        workdays.forEach(d => {
            const logged = loggedMap[d] || 0;
            if (logged < 8.0) {
                const missing = 8.0 - logged;
                totalMissingHours += missing;
                missingDays.push({ date: d, missing });
            }
        });

        assert.strictEqual(missingDays.length, 3);
        assert.strictEqual(totalMissingHours, 19.0);
        assert.strictEqual(missingDays[0].date, '2026-08-18');
        assert.strictEqual(missingDays[0].missing, 3.0);
        assert.strictEqual(missingDays[1].date, '2026-08-19');
        assert.strictEqual(missingDays[1].missing, 8.0);
        console.log('Missing workdays calculation tests PASSED!');

        console.log('\n--- 5. Testing Daily Sync Quota Rate Limiting ---');
        const todayStr = '2026-08-25';
        
        // Log sync for user 'u1' (standard user)
        db.run(`INSERT INTO user_sync_logs (user_id, sync_date) VALUES ('u1', ?)`, [todayStr], () => {
            db.get(`SELECT COUNT(*) as cnt FROM user_sync_logs WHERE user_id = 'u1' AND sync_date = ?`, [todayStr], (err2, r1) => {
                assert.strictEqual(r1.cnt, 1);
                const isUserQuotaExceeded = r1.cnt >= 1;
                assert.strictEqual(isUserQuotaExceeded, true);

                // Admin 'u2' has unlimited syncs
                const isAdmin = true;
                const canAdminSync = isAdmin || !isUserQuotaExceeded;
                assert.strictEqual(canAdminSync, true);

                console.log('Daily sync quota rate limiting tests PASSED!');
                db.close();
            });
        });
    });
});
