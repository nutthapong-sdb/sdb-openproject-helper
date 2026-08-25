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

console.log('Testing parseIsoDuration helper...');
assert.strictEqual(parseIsoDuration('PT2H'), 2);
assert.strictEqual(parseIsoDuration('PT2.5H'), 2.5);
assert.strictEqual(parseIsoDuration('PT1H30M'), 1.5);
assert.strictEqual(parseIsoDuration('PT45M'), 0.75);
assert.strictEqual(parseIsoDuration('2.5'), 2.5);
assert.strictEqual(parseIsoDuration(''), 0);
assert.strictEqual(parseIsoDuration(null), 0);
console.log('parseIsoDuration tests PASSED!');

console.log('Testing SQLite openproject_time_entries aggregation...');
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run(`CREATE TABLE local_assignees (id INTEGER PRIMARY KEY, name TEXT)`);
    db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, openproject_id TEXT)`);
    db.run(`CREATE TABLE openproject_time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openproject_id TEXT UNIQUE,
        user_id TEXT,
        user_name TEXT,
        work_package_id TEXT,
        spent_on TEXT,
        hours REAL DEFAULT 0
    )`);

    db.run(`INSERT INTO local_assignees (id, name) VALUES (1, 'User 1'), (2, 'User 2')`);
    db.run(`INSERT INTO users (id, name, openproject_id) VALUES ('u1', 'User 1', '1'), ('u2', 'User 2', '2')`);
    
    // Time logged in past 1 month vs older
    db.run(`INSERT INTO openproject_time_entries (openproject_id, user_id, spent_on, hours) VALUES 
        ('op1', '1', '2026-08-20', 4.5),
        ('op2', '1', '2026-08-22', 2.0),
        ('op3', '2', '2026-06-10', 8.0)
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
        console.log('Query result for August 2026:', rows);
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].name, 'User 1');
        assert.strictEqual(rows[0].total_hours, 6.5);
        assert.strictEqual(rows[1].name, 'User 2');
        assert.strictEqual(rows[1].total_hours, 0);
        console.log('SQLite aggregation test PASSED!');
        db.close();
    });
});
