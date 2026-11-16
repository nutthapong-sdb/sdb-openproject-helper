import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dateInTimezone, msUntilNextMidnight, scheduleNightlySync } = require('../lib/nightly-sync.js');

console.log('--- Testing nightly sync scheduling ---');
const TZ = 'Asia/Bangkok';

assert.strictEqual(dateInTimezone(new Date('2026-11-16T16:30:00Z'), TZ), '2026-11-16');
assert.strictEqual(dateInTimezone(new Date('2026-11-16T17:00:00Z'), TZ), '2026-11-17');
// 26 hours before 00:00 Bangkok on 17 Nov is 22:00 on 15 Nov, so the window starts on the 15th.
assert.strictEqual(dateInTimezone(new Date(new Date('2026-11-16T17:00:00Z').getTime() - 26 * 3600 * 1000), TZ), '2026-11-15');

assert.strictEqual(msUntilNextMidnight(new Date('2026-11-16T16:30:00Z'), TZ), 30 * 60 * 1000);
assert.strictEqual(msUntilNextMidnight(new Date('2026-11-16T16:59:59.500Z'), TZ), 500);
assert.strictEqual(msUntilNextMidnight(new Date('2026-11-16T17:00:00Z'), TZ), 24 * 3600 * 1000);
assert.strictEqual(msUntilNextMidnight(new Date('2026-11-16T05:00:00Z'), TZ), 12 * 3600 * 1000);
assert.strictEqual(msUntilNextMidnight(new Date('2026-11-16T12:00:00Z'), 'UTC'), 12 * 3600 * 1000);

let clock = new Date('2026-11-16T16:30:00Z');
const delays = [];
let fire = null;
let runs = 0;
scheduleNightlySync({
    timeZone: TZ,
    now: () => clock,
    setTimer: (fn, ms) => { delays.push(ms); fire = fn; return {}; },
    run: async () => {
        runs++;
        if (runs === 1) throw new Error('boom');
        clock = new Date('2026-11-17T17:00:10Z');
    }
});
assert.deepStrictEqual(delays, [30 * 60 * 1000]);

clock = new Date('2026-11-16T17:00:00Z');
await fire();
assert.strictEqual(runs, 1, 'run fires at midnight');
assert.strictEqual(delays.length, 2, 'a failed run still re-arms the timer');

await fire();
assert.strictEqual(runs, 2);
assert.strictEqual(delays[2], 24 * 3600 * 1000 - 10 * 1000, 'next run is the following midnight');
console.log('Nightly sync scheduling tests PASSED!');
