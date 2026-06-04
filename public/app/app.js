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

function setSelectByText(id, text) {
    const el = $(id);
    if (!el || el.tagName !== 'SELECT') return;
    const desired = String(text || '').trim().toLowerCase();
    if (!desired) return;

    const opts = Array.from(el.options || []);
    const match = opts.find((o) => String(o.value || '').trim().toLowerCase() === desired)
        || opts.find((o) => String(o.text || '').trim().toLowerCase() === desired);
    if (match) el.value = match.value;
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

let passwordEditing = false;

function setPasswordEditing(enabled) {
    passwordEditing = !!enabled;
    const input = $('loginPassword');
    const toggleBtn = $('toggleLoginPassword');
    if (input) {
        input.disabled = !passwordEditing;
        if (!passwordEditing) input.type = 'password';
    }
    if (toggleBtn) {
        toggleBtn.style.display = passwordEditing ? '' : 'none';
        toggleBtn.textContent = 'Show';
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
        loginPassword: passwordEditing ? readValue('loginPassword') : '',
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

function updatePasswordStatus(hasPassword) {
    const statusEl = $('passwordStatus');
    const pwdInput = $('loginPassword');
    if (!statusEl) return;
    if (hasPassword) {
        statusEl.innerHTML = '<span style="color: #77DD77; font-weight: bold;">(Already Set)</span>';
        if (pwdInput) {
            pwdInput.classList.remove('password-missing');
            pwdInput.placeholder = 'Debutservice password';
        }
    } else {
        statusEl.innerHTML = '<span style="color: #CF6679; font-weight: bold;">(Not Set - Action Required)</span>';
        if (pwdInput) {
            pwdInput.classList.add('password-missing');
            pwdInput.placeholder = '⚠️ Please enter and save password!';
        }
    }
}

function showWfhModal(loading) {
    const modal = $('wfhModal');
    if (!modal) return;
    modal.style.display = 'flex';
    if (loading) {
        $('modalLoadingState').style.display = 'block';
        $('modalSuccessState').style.display = 'none';
        $('closeModalBtn').style.display = 'none';
    } else {
        $('modalLoadingState').style.display = 'none';
        $('modalSuccessState').style.display = 'block';
        $('closeModalBtn').style.display = 'block';
    }
}

function hideWfhModal() {
    const modal = $('wfhModal');
    if (modal) modal.style.display = 'none';
}

async function loadDefaults() {
    try {
        const res = await fetch('/api/wfh/defaults');
        if (!res.ok) return;
        const d = await res.json();
        setValue('thaiName', d.thaiName);
        setValue('engName', d.engName);
        setValue('email', d.email);
        // Never hydrate password from server storage.
        setValue('loginPassword', '');
        setPasswordEditing(false);
        setValue('phone', d.phone);
        setValue('department', d.department);
        setSelectByText('department', d.department);
        setValue('because', d.because);
        setValue('reason', d.reason);
        // UI uses <input type="date"> (YYYY-MM-DD)
        setValue('startDate', dmyToIso(d.startDate) || d.startDate);
        setValue('endDate', dmyToIso(d.endDate) || d.endDate);
        setValue('extra', d.extra);
        updatePasswordStatus(d.hasPassword);
    } catch {
        // ignore
    } finally {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowIso = tomorrow.getFullYear() + '-' + 
            String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + 
            String(tomorrow.getDate()).padStart(2, '0');
        if (!readValue('startDate')) setValue('startDate', tomorrowIso);
        if (!readValue('endDate')) setValue('endDate', tomorrowIso);
    }
}

async function saveDefaults() {
    setBusy(true);
    setScreenshotPreview(null);

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
        // Hide and clear password UI after save so it can't be read back.
        setValue('loginPassword', '');
        setPasswordEditing(false);
        showToast({ type: 'success', title: 'Saved', body: 'Information saved for this user.' });
        await loadDefaults();
    } catch (e) {
        showToast({ type: 'error', title: 'Save Failed', body: e && e.message ? e.message : String(e) });
    } finally {
        setBusy(false);
    }
}

function validateForm() {
    const required = [
        { id: 'thaiName', label: 'ชื่อภาษาไทย' },
        { id: 'engName', label: 'ชื่อภาษาอังกฤษ' },
        { id: 'email', label: 'อีเมล' },
        { id: 'phone', label: 'เบอร์โทรศัพท์' },
        { id: 'department', label: 'แผนก/สังกัด' },
        { id: 'because', label: 'เนื่องจาก' },
        { id: 'reason', label: 'เหตุผล' },
        { id: 'startDate', label: 'วันที่เริ่ม' },
        { id: 'endDate', label: 'วันที่สิ้นสุด' }
    ];

    for (const field of required) {
        if (!readValue(field.id)) {
            showToast({
                type: 'error',
                title: 'Validation Error',
                body: `กรุณากรอกข้อมูลช่อง "${field.label}"`
            });
            const el = $(field.id);
            if (el) el.focus();
            return false;
        }
    }
    return true;
}

async function submitWfh() {
    if (!validateForm()) return;
    setBusy(true);
    showWfhModal(true); // Open modal with spinner

    const dryRun = false;

    try {
        // Always persist defaults before submit (do not overwrite saved password if blank).
        fetch('/api/wfh/defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...currentFormData(), loginPassword: '' })
        }).catch(() => { });

        const res = await fetch('/api/automation/debutservice/work-from-home/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun, ...currentFormData() })
        });

        const data = await res.json().catch(() => null);
        const screenshotUrl = (data && data.screenshot) ? `${window.location.origin}${data.screenshot}` : null;

        if (!res.ok || (data && data.ok === false)) {
            hideWfhModal(); // Dismiss modal so user sees error
            showToast({
                type: 'error',
                title: 'WFH Failed',
                body: (data && (data.error || data.details)) ? `${data.error || 'Error'}${data.details ? `\n${data.details}` : ''}` : `HTTP ${res.status}`,
                linkHref: screenshotUrl || undefined,
                linkText: data && data.screenshot ? 'Open screenshot' : undefined,
            });
            return;
        }

        // Show successful process in modal
        const successMsg = data && data.finalUrl ? `Final URL: ${data.finalUrl}` : 'Done.';
        $('modalSuccessMsg').textContent = successMsg;
        if (screenshotUrl) {
            $('modalScreenshotImg').src = screenshotUrl;
            $('modalScreenshotImg').style.display = 'inline-block';
        } else {
            $('modalScreenshotImg').style.display = 'none';
        }
        showWfhModal(false); // Switch to success state with screenshot at 50%
    } catch (e) {
        hideWfhModal();
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

    const closeBtn = $('closeModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', hideWfhModal);

    window.addEventListener('click', (event) => {
        const modal = $('wfhModal');
        if (event.target === modal && $('modalLoadingState').style.display !== 'block') {
            hideWfhModal();
        }
    });

    const changeBtn = $('changeLoginPassword');
    if (changeBtn) {
        changeBtn.addEventListener('click', () => {
            setPasswordEditing(true);
            setValue('loginPassword', '');
            const input = $('loginPassword');
            if (input) {
                input.focus();
                input.classList.remove('password-missing');
            }
        });
    }

    const toggleBtn = $('toggleLoginPassword');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const input = $('loginPassword');
            if (!input) return;
            const nextType = input.type === 'password' ? 'text' : 'password';
            input.type = nextType;
            toggleBtn.textContent = nextType === 'password' ? 'Show' : 'Hide';
        });
    }

    await loadDefaults();
});
