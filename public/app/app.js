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
    const changeBtn = $('changeLoginPassword');
    if (input) {
        input.disabled = !passwordEditing;
        if (!passwordEditing) input.type = 'password';
    }
    if (toggleBtn) {
        toggleBtn.style.display = passwordEditing ? '' : 'none';
        toggleBtn.textContent = 'Show';
    }
    if (changeBtn) {
        if (passwordEditing) {
            changeBtn.textContent = 'Confirm';
            changeBtn.style.backgroundColor = '#2e7d32';
            changeBtn.style.color = '#ffffff';
            changeBtn.style.borderColor = '#2e7d32';
        } else {
            changeBtn.textContent = 'Change Password';
            changeBtn.style.backgroundColor = '';
            changeBtn.style.color = '';
            changeBtn.style.borderColor = '';
        }
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
        showWfhModal(false); // Switch to success state with screenshot at 100%
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
        changeBtn.addEventListener('click', async () => {
            if (!passwordEditing) {
                setPasswordEditing(true);
                setValue('loginPassword', '');
                const input = $('loginPassword');
                if (input) {
                    input.focus();
                    input.classList.remove('password-missing');
                }
            } else {
                const pwd = readValue('loginPassword');
                if (pwd) {
                    try {
                        const res = await fetch('/api/wfh/defaults', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...currentFormData(), loginPassword: pwd })
                        });
                        if (res.ok) {
                            showToast({ type: 'success', title: 'Password Saved', body: 'Debutservice password updated.' });
                            updatePasswordStatus(true);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }
                setValue('loginPassword', '');
                setPasswordEditing(false);
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

    // WFH State & Filter Engine
    let rawWfhItems = [];
    let lastWfhUpdated = null;
    let calendarYear = new Date().getFullYear();
    let calendarMonth = new Date().getMonth(); // 0-indexed (0=Jan)
    let activeViewMode = 'table';

    const getFilteredWfhItems = () => {
        const statusVal = ($('wfhFilterStatus')?.value || 'all').trim().toLowerCase();
        const startVal = $('wfhFilterStartDate')?.value;
        const endVal = $('wfhFilterEndDate')?.value;
        const searchVal = ($('wfhFilterSearch')?.value || '').trim().toLowerCase();

        return rawWfhItems.filter(item => {
            // Status Filter
            if (statusVal !== 'all') {
                const itemSt = (item.status || '').trim().toLowerCase();
                if (itemSt !== statusVal) return false;
            }

            // Date Range Filter
            const itemStart = (item.start_date || '').slice(0, 10);
            const itemEnd = (item.end_date || '').slice(0, 10);
            if (startVal && itemEnd < startVal) return false;
            if (endVal && itemStart > endVal) return false;

            // Search Keyword
            if (searchVal) {
                const ref = (item.ref_no || '').toLowerCase();
                const name = (item.creator_name || '').toLowerCase();
                const because = (item.because_of || '').toLowerCase();
                const reason = (item.reason || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                if (!ref.includes(searchVal) && !name.includes(searchVal) && !because.includes(searchVal) && !reason.includes(searchVal) && !desc.includes(searchVal)) {
                    return false;
                }
            }

            return true;
        });
    };

    // WFH Remote Table rendering
    const renderWfhTable = (items, lastUpdated) => {
        const tbody = $('wfhRemoteTbody');
        const updatedLabel = $('wfhListLastUpdated');
        if (!tbody) return;

        if (updatedLabel && lastUpdated) {
            const d = new Date(lastUpdated);
            updatedLabel.textContent = `อัปเดตล่าสุด: ${d.toLocaleString('th-TH')}`;
        }

        if (!items || items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">
                        ไม่พบรายการ WFH (กดปุ่ม "ดึงข้อมูลใหม่ (Re-pull)" ด้านบนเพื่อดึงรายการจาก Debutservice)
                    </td>
                </tr>
            `;
            return;
        }

        const getStatusBadge = (st) => {
            const s = (st || '').trim().toLowerCase();
            let bg = '#777';
            let color = '#fff';
            if (s === 'approve') { bg = '#2e7d32'; color = '#fff'; }
            else if (s === 'approval') { bg = '#f57c00'; color = '#fff'; }
            else if (s === 'create') { bg = '#0288d1'; color = '#fff'; }
            else if (s === 'reject') { bg = '#c62828'; color = '#fff'; }
            else if (s === 'cancel') { bg = '#616161'; color = '#fff'; }

            return `<span style="background: ${bg}; color: ${color}; padding: 3px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 600; display: inline-block;">${st || 'N/A'}</span>`;
        };

        const formatShortDate = (dtStr) => {
            if (!dtStr) return '-';
            return dtStr.replace(/\s+00:00:00$/, '');
        };

        tbody.innerHTML = items.map(item => {
            const startShort = formatShortDate(item.start_date);
            const endShort = formatShortDate(item.end_date);
            const dateDisplay = startShort === endShort ? startShort : `${startShort} - ${endShort}`;
            const detailBtn = item.detail_url 
                ? `<a href="${item.detail_url}" target="_blank" class="btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; text-decoration: none; display: inline-block;">ดูรายละเอียด ↗</a>`
                : '-';

            return `
                <tr style="border-bottom: 1px solid var(--border-color, #333);">
                    <td style="padding: 10px; font-weight: 600; color: var(--primary-color, #4CAF50);">${item.ref_no || '-'}</td>
                    <td style="padding: 10px; white-space: nowrap;">${dateDisplay}</td>
                    <td style="padding: 10px;">
                        <div style="font-weight: 500;">${item.because_of || '-'} / ${item.reason || '-'}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">${item.description || ''}</div>
                    </td>
                    <td style="padding: 10px; white-space: nowrap;">${item.creator_name || '-'}</td>
                    <td style="padding: 10px; text-align: center;">${getStatusBadge(item.status)}</td>
                    <td style="padding: 10px; text-align: center;">${detailBtn}</td>
                </tr>
            `;
        }).join('');
    };

    // Calendar Rendering Engine
    const renderWfhCalendar = () => {
        const gridBody = $('wfhCalendarGridBody');
        const monthTitle = $('calMonthTitle');
        const showAllTeam = $('wfhToggleShowAllTeam')?.checked ?? true;
        if (!gridBody) return;

        const dateObj = new Date(calendarYear, calendarMonth, 1);
        const thaiMonthNames = [
            'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
        ];
        if (monthTitle) {
            monthTitle.textContent = `${thaiMonthNames[calendarMonth]} ${calendarYear + 543}`;
        }

        const firstDayOfWeek = dateObj.getDay(); // 0 = Sun
        const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
        const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

        const currentUserName = (readValue('thaiName') || '').trim();

        let itemsForCalendar = getFilteredWfhItems();
        if (!showAllTeam && currentUserName) {
            itemsForCalendar = itemsForCalendar.filter(i => (i.creator_name || '').includes(currentUserName));
        }

        const todayObj = new Date();
        const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
        let cellsHtml = '';

        // Padding cells for previous month
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const dayNum = prevMonthDays - i;
            cellsHtml += `
                <div class="calendar-day-cell other-month">
                    <div class="calendar-day-num">${dayNum}</div>
                </div>
            `;
        }

        // Current month cells
        for (let day = 1; day <= daysInMonth; day++) {
            const dayStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dayStr === todayStr;

            const dayEvents = itemsForCalendar.filter(item => {
                const s = (item.start_date || '').slice(0, 10);
                const e = (item.end_date || '').slice(0, 10);
                return dayStr >= s && dayStr <= e;
            });

            let eventPillsHtml = '';
            dayEvents.forEach(item => {
                const stClass = `status-${(item.status || 'default').toLowerCase()}`;
                const nameShort = (item.creator_name || 'User').split(' ')[0];
                const titleAttr = `${item.ref_no || ''} | ${item.creator_name || ''} | ${item.because_of || ''} (${item.status || ''})`;
                const hrefAttr = item.detail_url ? `onclick="window.open('${item.detail_url}', '_blank')"` : '';

                eventPillsHtml += `
                    <div class="cal-wfh-pill ${stClass}" title="${titleAttr}" ${hrefAttr}>
                        <span>${nameShort}</span>
                        <span style="opacity: 0.8; font-size: 0.7rem;">${item.status || ''}</span>
                    </div>
                `;
            });

            cellsHtml += `
                <div class="calendar-day-cell ${isToday ? 'is-today' : ''}">
                    <div class="calendar-day-num" style="${isToday ? 'color: var(--primary-color, #FF8F00);' : ''}">${day} ${isToday ? '• วันนี้' : ''}</div>
                    ${eventPillsHtml}
                </div>
            `;
        }

        // Next month padding cells
        const totalCellsSoFar = firstDayOfWeek + daysInMonth;
        const remainder = totalCellsSoFar % 7;
        if (remainder > 0) {
            const nextPadding = 7 - remainder;
            for (let day = 1; day <= nextPadding; day++) {
                cellsHtml += `
                    <div class="calendar-day-cell other-month">
                        <div class="calendar-day-num">${day}</div>
                    </div>
                `;
            }
        }

        gridBody.innerHTML = cellsHtml;
    };

    const refreshWfhViews = () => {
        const filteredItems = getFilteredWfhItems();
        renderWfhTable(filteredItems, lastWfhUpdated);
        renderWfhCalendar();
    };

    const loadCachedWfhList = async () => {
        try {
            const res = await fetch('/api/automation/debutservice/work-from-home/list');
            if (res.ok) {
                const data = await res.json();
                if (data.ok) {
                    rawWfhItems = data.items || [];
                    lastWfhUpdated = rawWfhItems.length > 0 ? rawWfhItems[0].updated_at : null;
                    refreshWfhViews();
                }
            }
        } catch (e) {
            console.error('Failed to load cached WFH list:', e);
        }
    };

    const triggerWfhRepull = async () => {
        const btn = $('wfhRepullBtn');
        const icon = $('wfhRepullIcon');
        const text = $('wfhRepullText');
        if (btn) btn.disabled = true;
        if (icon) icon.textContent = '⏳';
        if (text) text.textContent = 'กำลังดึงข้อมูล...';

        try {
            const res = await fetch('/api/automation/debutservice/work-from-home/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentFormData())
            });
            const data = await res.json();

            if (res.ok && data.ok) {
                showToast({ type: 'success', title: 'Re-pull Success', body: `ดึงข้อมูลสำเร็จ ${data.count} รายการ` });
                rawWfhItems = data.items || [];
                lastWfhUpdated = data.lastUpdated;
                refreshWfhViews();
            } else {
                showToast({ type: 'error', title: 'Re-pull Failed', body: data.error || 'Failed to fetch WFH records' });
            }
        } catch (e) {
            console.error('Error re-pulling WFH data:', e);
            showToast({ type: 'error', title: 'Error', body: e.message || 'Network error' });
        } finally {
            if (btn) btn.disabled = false;
            if (icon) icon.textContent = '🔄';
            if (text) text.textContent = 'ดึงข้อมูลใหม่ (Re-pull)';
        }
    };

    // Event Listeners for Filters & Calendar Controls
    const repullBtn = $('wfhRepullBtn');
    if (repullBtn) repullBtn.addEventListener('click', triggerWfhRepull);

    // View Switcher Handlers
    const tableBtn = $('wfhViewTableBtn');
    const calendarBtn = $('wfhViewCalendarBtn');
    const tableView = $('wfhTableView');
    const calendarView = $('wfhCalendarView');

    if (tableBtn && calendarBtn) {
        tableBtn.addEventListener('click', () => {
            activeViewMode = 'table';
            tableBtn.classList.add('active');
            calendarBtn.classList.remove('active');
            if (tableView) tableView.style.display = 'block';
            if (calendarView) calendarView.style.display = 'none';
        });

        calendarBtn.addEventListener('click', () => {
            activeViewMode = 'calendar';
            calendarBtn.classList.add('active');
            tableBtn.classList.remove('active');
            if (calendarView) calendarView.style.display = 'block';
            if (tableView) tableView.style.display = 'none';
            renderWfhCalendar();
        });
    }

    // Filter Controls Handlers
    ['wfhFilterStatus', 'wfhFilterStartDate', 'wfhFilterEndDate'].forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener('input', refreshWfhViews);
            el.addEventListener('change', refreshWfhViews);
        }
    });

    const resetFilterBtn = $('wfhFilterResetBtn');
    if (resetFilterBtn) {
        resetFilterBtn.addEventListener('click', () => {
            if ($('wfhFilterStatus')) $('wfhFilterStatus').value = 'all';
            if ($('wfhFilterStartDate')) $('wfhFilterStartDate').value = '';
            if ($('wfhFilterEndDate')) $('wfhFilterEndDate').value = '';
            refreshWfhViews();
        });
    }

    // Calendar Month Navigation Handlers
    const prevMonthBtn = $('calPrevMonthBtn');
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            calendarMonth--;
            if (calendarMonth < 0) {
                calendarMonth = 11;
                calendarYear--;
            }
            renderWfhCalendar();
        });
    }

    const nextMonthBtn = $('calNextMonthBtn');
    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            calendarMonth++;
            if (calendarMonth > 11) {
                calendarMonth = 0;
                calendarYear++;
            }
            renderWfhCalendar();
        });
    }

    const todayBtn = $('calTodayBtn');
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            const now = new Date();
            calendarYear = now.getFullYear();
            calendarMonth = now.getMonth();
            renderWfhCalendar();
        });
    }

    const teamToggle = $('wfhToggleShowAllTeam');
    if (teamToggle) {
        teamToggle.addEventListener('change', renderWfhCalendar);
    }

    await loadDefaults();
    await loadCachedWfhList();
});
