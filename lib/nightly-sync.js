function dateInTimezone(date, timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function msUntilNextMidnight(now, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
    const get = (type) => Number(parts.find(p => p.type === type).value);
    const hour = get('hour') % 24;
    const elapsedMs = (hour * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds();
    return 24 * 3600 * 1000 - elapsedMs;
}

function scheduleNightlySync({ run, timeZone, now = () => new Date(), setTimer = setTimeout }) {
    const arm = () => {
        const timer = setTimer(async () => {
            try {
                await run();
            } catch (e) {
                console.error('[NightlySync] Failed:', e && e.message ? e.message : e);
            }
            arm();
        }, msUntilNextMidnight(now(), timeZone));
        if (timer && typeof timer.unref === 'function') timer.unref();
    };
    arm();
}

module.exports = { dateInTimezone, msUntilNextMidnight, scheduleNightlySync };
