/* eslint-disable no-console */

function $(id) {
    return document.getElementById(id);
}

function readValue(id) {
    const el = $(id);
    return el ? String(el.value || '').trim() : '';
}

function setValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value == null ? '' : String(value);
}

function setResult(text) {
    // Result box removed; use toast notifications instead.
    if (text) showToast({ type: 'info', title: 'Info', body: text, ttlMs: 4000 });
}

function showToast({ type, title, body, linkHref, linkText, ttlMs }) {
    const host = $('toastHost');
    if (!host) return;

    const el = document.createElement('div');
    el.className = `toast ${type || ''}`.trim();

    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    const titleText = document.createElement('span');
    titleText.textContent = title || '';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => el.remove());
    titleEl.appendChild(titleText);
    titleEl.appendChild(closeBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    if (body) bodyEl.textContent = body;

    el.appendChild(titleEl);
    el.appendChild(bodyEl);

    if (linkHref) {
        const link = document.createElement('a');
        link.href = linkHref;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = linkText || linkHref;
        const wrap = document.createElement('div');
        wrap.style.marginTop = '8px';
        wrap.appendChild(link);
        el.appendChild(wrap);
    }

    host.prepend(el);

    const ttl = typeof ttlMs === 'number' ? ttlMs : (type === 'error' ? 10_000 : 6_000);
    window.setTimeout(() => {
        el.remove();
    }, ttl);
}

function setScreenshotPreview(url) {
    const wrap = $('screenshotWrap');
    const img = $('screenshotImg');
    if (!wrap || !img) return;

    if (!url) {
        img.removeAttribute('src');
        wrap.style.display = 'none';
        return;
    }

    img.src = url;
    wrap.style.display = 'block';
}

function setBusy(busy) {
    const submitBtn = $('wfhSubmitBtn');
    const saveBtn = $('wfhSaveBtn');

    if (submitBtn) {
        submitBtn.disabled = !!busy;
        submitBtn.textContent = busy ? 'Working...' : 'Submit';
    }
    if (saveBtn) {
        saveBtn.disabled = !!busy;
        saveBtn.textContent = busy ? 'Working...' : 'Save Information';
    }
}

function dmyToIso(dmy) {
    const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(dmy || ''));
    if (!m) return '';
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
}

function isoToDmy(iso) {
    const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(String(iso || ''));
    if (!m) return '';
    const [, yyyy, mm, dd] = m;
    return `${dd}/${mm}/${yyyy}`;
}

function currentFormData() {
    return {
        thaiName: readValue('thaiName'),
        engName: readValue('engName'),
        email: readValue('email'),
        phone: readValue('phone'),
        department: readValue('department'),
        because: readValue('because'),
        reason: readValue('reason'),
        // Keep server-side expectations stable (DD/MM/YYYY)
        startDate: isoToDmy(readValue('startDate')) || readValue('startDate'),
        endDate: isoToDmy(readValue('endDate')) || readValue('endDate'),
        extra: readValue('extra')
    };
}

async function loadDefaults() {
    try {
        const res = await fetch('/api/wfh/defaults');
        if (!res.ok) return;
        const d = await res.json();
        setValue('thaiName', d.thaiName);
        setValue('engName', d.engName);
        setValue('email', d.email);
        setValue('phone', d.phone);
        setValue('department', d.department);
        setValue('because', d.because);
        setValue('reason', d.reason);
        // UI uses <input type="date"> (YYYY-MM-DD)
        setValue('startDate', dmyToIso(d.startDate) || d.startDate);
        setValue('endDate', dmyToIso(d.endDate) || d.endDate);
        setValue('extra', d.extra);
    } catch {
        // ignore
    }
}

async function saveDefaults() {
    setBusy(true);
    setScreenshotPreview(null);
    showToast({ type: 'info', title: 'Saving', body: 'Saving information...', ttlMs: 2500 });

    try {
        const res = await fetch('/api/wfh/defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentFormData())
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
            showToast({
                type: 'error',
                title: 'Save Failed',
                body: (data && (data.error || data.details)) ? `${data.error || 'Error'}${data.details ? `\n${data.details}` : ''}` : `HTTP ${res.status}`
            });
            return;
        }
        showToast({ type: 'success', title: 'Saved', body: 'Information saved for this user.' });
    } catch (e) {
        showToast({ type: 'error', title: 'Save Failed', body: e && e.message ? e.message : String(e) });
    } finally {
        setBusy(false);
    }
}

async function submitWfh() {
    setBusy(true);
    setScreenshotPreview(null);
    showToast({ type: 'info', title: 'Submitting', body: 'Running WFH automation...', ttlMs: 3500 });

    const dryRun = false;

    try {
        // Always persist defaults before submit.
        fetch('/api/wfh/defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentFormData())
        }).catch(() => { });

        const res = await fetch('/api/automation/debutservice/work-from-home/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun, ...currentFormData() })
        });

        const data = await res.json().catch(() => null);
        const screenshotUrl = (data && data.screenshot) ? `${window.location.origin}${data.screenshot}` : null;
        // Keep screenshot visible when the server returns one.
        if (screenshotUrl) setScreenshotPreview(screenshotUrl);

        if (!res.ok || (data && data.ok === false)) {
            showToast({
                type: 'error',
                title: 'WFH Failed',
                body: (data && (data.error || data.details)) ? `${data.error || 'Error'}${data.details ? `\n${data.details}` : ''}` : `HTTP ${res.status}`,
                linkHref: screenshotUrl || undefined,
                linkText: data && data.screenshot ? 'Open screenshot' : undefined,
            });
            return;
        }

        showToast({
            type: 'success',
            title: 'WFH Submitted',
            body: data && data.finalUrl ? `Final URL: ${data.finalUrl}` : 'Done.',
            linkHref: screenshotUrl || undefined,
            linkText: data && data.screenshot ? 'Open screenshot' : undefined,
        });
    } catch (e) {
        showToast({ type: 'error', title: 'WFH Failed', body: e && e.message ? e.message : String(e) });
    } finally {
        setBusy(false);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    setBusy(false);
    // no-op

    const saveBtn = $('wfhSaveBtn');
    const submitBtn = $('wfhSubmitBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveDefaults);
    if (submitBtn) submitBtn.addEventListener('click', submitWfh);

    await loadDefaults();
});
