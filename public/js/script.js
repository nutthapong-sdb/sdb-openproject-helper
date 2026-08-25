document.addEventListener('DOMContentLoaded', async () => {
    // Global variable for current user ID and role
    let currentUserId = null;
    let currentUserRole = null;

    // Fetch User Info
    try {
        const userRes = await fetch('/api/user');
        if (userRes.ok) {
            const userData = await userRes.json();
            currentUserId = userData.id; // Store user ID
            currentUserRole = userData.role || 'user'; // Store user role
            const displayName = userData.firstName ? `${userData.firstName} ${userData.lastName}` : (userData.name || 'User');
            // Show OpenProject ID and Role in header
            const roleDisplay = userData.role ? `[${userData.role}]` : '';
            document.getElementById('userNameDisplay').textContent = `${displayName} ${roleDisplay}`;

            // Show Settings (with Admin Panel inside) for admin or root role
            if (userData.role === 'admin' || userData.role === 'root') {
                $('#settingsWrapper').show();
            }
        }
    } catch (e) {
        console.error('Failed to load user info', e);
    }

    // Set Default Dates to Today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('startDate').value = today;
    document.getElementById('dueDate').value = today;

    // Initialize Select2 with AJAX (Projects)
    const projectSelect = $('#projectId').select2({
        width: '100%',
        placeholder: 'Search for a project...',
        minimumInputLength: 0,
        ajax: {
            url: '/api/projects',
            dataType: 'json',
            delay: 250,
            data: function (params) {
                return {
                    q: params.term
                };
            },
            processResults: function (data) {
                // Ensure array
                let projects = [];
                if (Array.isArray(data)) {
                    projects = data;
                } else if (data._embedded && data._embedded.elements) {
                    projects = data._embedded.elements;
                }

                return {
                    results: projects.map(project => ({
                        id: project.id,
                        text: project.name
                    }))
                };
            },
            cache: true
        }
    });



    // Initialize Select2 for Assignee (Standard Select, populated dynamically)
    const assigneeSelect = $('#assigneeId').select2({
        width: '100%',
        placeholder: 'Select an Assignee'
    });

    // Function to Load Local Assignees
    const loadAssignees = async () => {
        try {
            const response = await fetch('/api/assignees');
            const users = await response.json();

            // Keep current selection if possible
            const currentVal = assigneeSelect.val();

            assigneeSelect.empty().append('<option value="" disabled selected>Select an Assignee</option>');

            users.forEach(user => {
                // Format: "ID - Name"
                const text = `${user.id} - ${user.name}`;
                const option = new Option(text, user.id, false, false);
                assigneeSelect.append(option);
            });

            if (currentVal) {
                assigneeSelect.val(currentVal).trigger('change');
            } else {
                // Auto-select Current User
                try {
                    const meRes = await fetch('/api/user');
                    if (meRes.ok) {
                        const me = await meRes.json();
                        const myName = me.name || (me.firstName + ' ' + me.lastName);

                        // Fix: Match by ID directly (since local_assignees uses OpenProject ID as Primary Key)
                        const match = users.find(u => u.id == me.id);

                        if (match) {
                            assigneeSelect.val(match.id).trigger('change');
                        }
                    }
                } catch (e) { console.warn('Auto-select user failed', e); }
            }

        } catch (error) {
            console.error('Error loading local assignees:', error);
        }
    };


    // --- Task Type Logic ---
    const loadProjectTypes = async (projectId) => {
        const typeSelect = $('#taskType');
        typeSelect.empty().append('<option value="" disabled selected>Loading...</option>');
        typeSelect.prop('disabled', true);

        try {
            const response = await fetch(`/api/projects/${projectId}/types`);
            if (!response.ok) throw new Error('Failed to fetch types');
            const types = await response.json();

            typeSelect.empty();
            if (types.length === 0) {
                typeSelect.append('<option value="" disabled selected>No types found</option>');
            } else {
                types.forEach(t => {
                    const isTask = t.type_name === 'Task'; // Pre-select 'Task'
                    typeSelect.append(new Option(t.type_name, t.type_id, isTask, isTask));
                });
                typeSelect.prop('disabled', false); // Enable
            }
        } catch (error) {
            console.error(error);
            typeSelect.empty().append('<option value="" disabled selected>Error loading types</option>');
        }
    };

    // Project Select Change Listener using jQuery
    $('#projectId').on('change', function () {
        const projectId = $(this).val();
        if (projectId) {
            loadProjectTypes(projectId);
        } else {
            $('#taskType').empty().append('<option value="" disabled selected>Select a Project first</option>').prop('disabled', true);
        }
    });

    // Load Last Used Project from LocalStorage (Trigger AFTER listener is attached)
    const lastProject = JSON.parse(localStorage.getItem('lastProject') || 'null');
    if (lastProject && lastProject.id) {
        // We append manually because Select2 might not have loaded options yet if they are remote
        const option = new Option(lastProject.name, lastProject.id, true, true);
        $('#projectId').append(option).trigger('change');
    }

    // --- History Logic (SQLite via API) ---
    let currentHistoryPage = 1;
    const historyLimit = 5;

    // Helper: Format Date YYYY-MM-DD -> DD/MM
    const formatDateShort = (dateString) => {
        if (!dateString) return '-';
        // Try to handle ISO string or YYYY-MM-DD
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '-';

        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${d}/${m}`;
    };

    const loadHistory = async (page = 1) => {
        const historyBody = document.getElementById('historyBody');
        const pageInfo = document.getElementById('pageInfo');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');

        try {
            const response = await fetch(`/api/history?page=${page}&limit=${historyLimit}`);
            if (!response.ok) {
                historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #777;">Failed.</td></tr>';
                return;
            }

            const result = await response.json();
            const history = result.data || [];
            const pagination = result.pagination || { current: 1, totalItems: 0, totalPages: 1 };

            if (history.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #777;">No data.</td></tr>';
                pageInfo.innerText = '0-0/0';
                prevPageBtn.disabled = true;
                nextPageBtn.disabled = true;
                return;
            }

            historyBody.innerHTML = '';
            history.forEach(item => {
                const dateStr = formatDateShort(item.created_at || item.start_date);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 8px 5px; border-bottom: 1px solid #333; color: #aaa; font-size: 0.8rem;">${dateStr}</td>
                    <td style="padding: 8px 5px; border-bottom: 1px solid #333; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px;" title="${item.subject || ''}">${item.subject || '-'}</td>
                    <td style="padding: 8px 5px; border-bottom: 1px solid #333; text-align: center; font-size: 0.8rem;">${item.spent_hours || '-'}</td>
                    <td style="padding: 8px 5px; border-bottom: 1px solid #333; vertical-align: middle;">
                        <div style="display: flex; justify-content: center; align-items: center; gap: 6px;">
                             <a href="${item.web_url}" target="_blank" style="margin: 0; padding: 0; text-decoration: none; display: flex; align-items: center; justify-content: center; color: #aaa; transition: color 0.2s; width: 16px; height: 16px;" onmouseover="this.style.color='#FF8F00'" onmouseout="this.style.color='#aaa'" title="Open in OpenProject">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                             </a>
                            <button class="delete-history-btn" data-id="${item.id}" data-op-id="${item.openproject_id}" data-subject="${item.subject}" style="margin: 0; padding: 0; background: transparent; color: #555; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; width: 16px; height: 16px; min-width: auto;" onmouseover="this.style.color='#ef5350'" onmouseout="this.style.color='#555'" title="Delete">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                        </div>
                    </td>
                `;
                historyBody.appendChild(row);
            });

            // Update Pagination UI
            currentHistoryPage = pagination.current;
            const startItem = (pagination.current - 1) * pagination.limit + 1;
            const endItem = Math.min(pagination.current * pagination.limit, pagination.totalItems);
            pageInfo.innerText = `${startItem}-${endItem}/${pagination.totalItems}`;

            prevPageBtn.disabled = pagination.current <= 1;
            nextPageBtn.disabled = pagination.current >= pagination.totalPages;

            // Attach delete handlers
            document.querySelectorAll('.delete-history-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const btnElement = e.currentTarget;
                    const historyId = btnElement.dataset.id;
                    const opId = btnElement.dataset.opId;
                    const subject = btnElement.dataset.subject;
                    deleteFromHistory(historyId, opId, subject);
                });
            });

            // Pagination Listeners (ensure only one binding)
            prevPageBtn.onclick = () => loadHistory(currentHistoryPage - 1);
            nextPageBtn.onclick = () => loadHistory(currentHistoryPage + 1);

        } catch (error) {
            console.error('Error loading history:', error);
            historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #c62828;">Error.</td></tr>';
        }
    };

    // Helper to format date display
    const formatDateDisplay = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return dateStr;
    };

    // Helper: Safely fetch JSON response with Content-Type validation
    const safeFetchJson = async (url, options = {}) => {
        const res = await fetch(url, options);
        const contentType = res.headers.get('content-type') || '';
        let data = null;
        if (contentType.includes('application/json')) {
            data = await res.json().catch(() => null);
        } else {
            const text = await res.text().catch(() => '');
            data = { error: `Server response is non-JSON (${res.status}): ${text.slice(0, 150)}` };
        }
        if (!res.ok) {
            const errMsg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
            throw new Error(errMsg);
        }
        return data || {};
    };

    // Load User Stats
    const loadUserStats = async () => {
        const tbody = document.getElementById('usersStatsBody');
        const badge = document.getElementById('rankingDateRangeBadge');
        if (!tbody) return;

        try {
            const data = await safeFetchJson('/api/users-stats');

            let users = [];
            let settings = null;

            if (Array.isArray(data)) {
                users = data;
            } else {
                users = data.users || [];
                settings = data.settings || null;
            }

            if (badge) {
                if (settings && settings.mode === 'all') {
                    badge.textContent = 'ทุกช่วงเวลา (All-time)';
                    badge.style.display = 'inline-block';
                } else if (settings && (settings.activeStartDate || settings.activeEndDate)) {
                    const startFmt = formatDateDisplay(settings.activeStartDate);
                    const endFmt = settings.mode === 'to_present' ? 'ปัจจุบัน' : formatDateDisplay(settings.activeEndDate);
                    if (startFmt && endFmt) {
                        badge.textContent = `${startFmt} - ${endFmt}`;
                    } else if (startFmt) {
                        badge.textContent = `ตั้งแต่ ${startFmt}`;
                    } else {
                        badge.textContent = `ถึง ${endFmt}`;
                    }
                    badge.style.display = 'inline-block';
                } else {
                    badge.textContent = 'ทุกช่วงเวลา (All-time)';
                    badge.style.display = 'inline-block';
                }
            }

            const syncLabel = document.getElementById('rankingLastSyncLabel');
            if (syncLabel) {
                if (data && data.lastSync) {
                    const d = new Date(data.lastSync);
                    syncLabel.textContent = `Sync ล่าสุด: ${d.toLocaleString('th-TH')}`;
                } else {
                    syncLabel.textContent = `ยังไม่มีการ Sync ข้อมูล`;
                }
            }

            tbody.innerHTML = '';

            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #777;">No users found.</td></tr>';
                return;
            }

            const topUsers = users.slice(0, 10);

            topUsers.forEach((u, index) => {
                const rank = index + 1;
                const tr = document.createElement('tr');
                tr.className = `rank-row rank-${rank}`;

                let iconHtml = '';
                if (rank === 1) iconHtml = '<div class="rank-crown crown-gold"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></div>';
                else if (rank === 2) iconHtml = '<div class="rank-crown crown-silver"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></div>';
                else if (rank === 3) iconHtml = '<div class="rank-crown crown-bronze"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></div>';

                let nameStyle = 'font-weight: 500; font-size: 0.95rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 150px; display: inline-block; vertical-align: middle;';
                if (rank === 1) nameStyle += ' color: #ffe082; font-weight: bold;';
                else if (rank === 2) nameStyle += ' color: #e0e0e0; font-weight: bold;';
                else if (rank === 3) nameStyle += ' color: #ffcc80; font-weight: bold;';

                const rawHours = typeof u.total_hours === 'number' ? u.total_hours : parseFloat(u.total_hours || 0);
                const displayHours = rawHours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

                tr.innerHTML = `
                    <td style="padding: 10px; border-bottom: 1px solid #333; text-align: center; font-weight: bold; font-size: 1rem; color: ${rank <= 3 ? 'var(--primary-color)' : '#aaa'};">${rank}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #333; display: flex; align-items: center;">
                        <div class="rank-avatar-container">
                             ${iconHtml}
                             <div class="rank-frame">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${rank <= 5 ? '#fff' : '#aaa'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                             </div>
                        </div>
                        <span style="${nameStyle}" title="${u.name}">${u.name || 'Unknown'}</span>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #333; text-align: center; font-weight: bold; color: var(--primary-color); font-size: ${rank <= 3 ? '1.1rem' : '0.9rem'};">${displayHours} ชม.</td>
                `;
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('[loadUserStats]', error);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: #c62828;">Error loading stats: ${error.message}</td></tr>`;
        }
    };

    const syncTimeBtn = document.getElementById('syncTimeEntriesBtn');
    if (syncTimeBtn) {
        syncTimeBtn.addEventListener('click', async () => {
            const icon = document.getElementById('syncTimeEntriesIcon');
            if (icon) icon.textContent = '⏳';
            syncTimeBtn.disabled = true;

            try {
                const data = await safeFetchJson('/api/openproject/time-entries/sync', { method: 'POST' });
                if (data && data.ok) {
                    if (typeof showToast === 'function') {
                        showToast(`ดึงข้อมูลเวลาจริงจาก OpenProject สำเร็จ (${data.count} รายการ)`, 'success');
                    } else if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Sync Success', text: `ดึงข้อมูลเวลาจริงสำเร็จ (${data.count} รายการ)` });
                    }
                    await loadUserStats();
                } else {
                    const msg = (data && data.error) || 'Failed to sync time entries';
                    if (typeof showToast === 'function') showToast(msg, 'error');
                    else if (typeof Swal !== 'undefined') Swal.fire('Sync Failed', msg, 'error');
                }
            } catch (e) {
                const msg = e.message || 'Error syncing time entries';
                if (typeof showToast === 'function') showToast(msg, 'error');
                else if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            } finally {
                if (icon) icon.textContent = '🔄';
                syncTimeBtn.disabled = false;
            }
        });
    }

    const deleteFromHistory = async (historyId, openprojectId, subject) => {
        // Confirmation Dialog
        const result = await Swal.fire({
            title: 'Delete Task?',
            html: `<p>Are you sure you want to delete:</p><p><strong>${subject}</strong></p><p style="color: #c62828;">This will also delete it from OpenProject!</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#c62828',
            cancelButtonColor: '#555',
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) return;

        // Show loading
        Swal.fire({
            title: 'Deleting...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            // Delete from OpenProject
            const opResponse = await fetch(`/api/work_packages/${openprojectId}`, {
                method: 'DELETE'
            });

            // Delete from local history DB (regardless of OpenProject result)
            await fetch(`/api/history/${historyId}`, {
                method: 'DELETE'
            });

            loadHistory(currentHistoryPage);
            loadUserStats(); // Reload Stats

            if (opResponse.ok || opResponse.status === 404) {
                Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'Task deleted successfully.',
                    timer: 2000,
                    showConfirmButton: false
                }).then(() => {
                    // Reload page to refresh dashboard
                    window.location.reload();
                });
            } else {
                Swal.fire({
                    icon: 'warning',
                    title: 'Partially Deleted',
                    text: 'Removed from history, but could not delete from OpenProject (it might have been deleted already).'
                }).then(() => {
                    // Reload page to refresh dashboard
                    window.location.reload();
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Network error. Please try again.'
            });
        }
    };



    // --- Chart.js Logic ---
    let weeklyChartInstance = null;

    const loadWeeklyStats = async () => {
        const ctx = document.getElementById('weeklyChart');
        if (!ctx) return;

        try {
            const response = await fetch('/api/weekly-stats');
            if (!response.ok) return;
            const stats = await response.json();

            const labels = stats.map(s => s.label);

            // We need to create datasets based on Tasks.
            // 1. Identify all unique task IDs involved in this week.
            const uniqueTaskIds = new Set();
            stats.forEach(day => {
                day.tasks.forEach(t => uniqueTaskIds.add(t.taskId));
            });

            // 2. Map Task IDs to Names (for legend/tooltip) - straightforward mapping
            const taskInfoMap = {}; // { taskId: { name, color } }
            // Rainbow Palette (Pastel)
            const rainbowColors = [
                '#FF6961', // Pastel Red
                '#FFB347', // Pastel Orange
                '#FDFD96', // Pastel Yellow (Caution: Light)
                '#77DD77', // Pastel Green
                '#AEC6CF', // Pastel Blue
                '#7AC5CD', // Pastel Cyan
                '#B39EB5'  // Pastel Purple
            ];

            const datasets = [];
            let colorIndex = 0;

            uniqueTaskIds.forEach(taskId => {
                // Find task info from first occurrence
                let taskName = `Task #${taskId}`;
                for (const day of stats) {
                    const t = day.tasks.find(x => x.taskId === taskId);
                    if (t) { taskName = t.taskName; break; }
                }

                // Build data array for this task across all dates
                const data = stats.map(day => {
                    const t = day.tasks.find(x => x.taskId === taskId);
                    return t ? t.hours : 0;
                });

                datasets.push({
                    label: taskName,
                    taskId: taskId,
                    data: data,
                    backgroundColor: rainbowColors[colorIndex % rainbowColors.length],
                    stack: 'Stack 0',
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                    // 1px Rounding and Margin
                    borderRadius: 5,
                    borderWidth: 1, // 1px margin (gap)
                    borderColor: '#1E1E1E', // Matches card background to create 'gap'
                    borderSkipped: false // Gap on all sides
                });

                colorIndex++;
            });

            if (weeklyChartInstance) {
                weeklyChartInstance.destroy();
            }

            weeklyChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                plugins: [ChartDataLabels],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: 0 },
                    plugins: {
                        datalabels: {
                            color: '#000000ff',
                            // Default Centered Position
                            anchor: 'center',
                            align: 'center',
                            clip: true,
                            font: function (context) {
                                var value = context.dataset.data[context.dataIndex];
                                var size = Math.min(11, Math.max(9, 8 + value));
                                return { size: size, weight: 'normal' }; // Lighter weight
                            },
                            formatter: (value, ctx) => {
                                if (!value || value < 0.2) return '';

                                const ds = ctx.dataset;
                                const taskId = ds.taskId;
                                const taskLabel = ds.label;

                                // Combine all into one string and wrap
                                const fullText = `${value}h #${taskId} ${taskLabel}`;

                                // Helper to wrap text by character (force break)
                                const wrapText = (str, limit) => {
                                    if (!str) return '';
                                    const regex = new RegExp(`.{1,${limit}}`, 'g');
                                    return str.match(regex).join('\n');
                                };

                                return wrapText(fullText, 25);
                            },
                            display: true
                        },
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: '#333',
                            titleColor: '#fff',
                            bodyColor: '#fff',
                            borderColor: '#555',
                            borderWidth: 1,
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.parsed.y} hrs`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            grid: { color: '#333' },
                            ticks: { color: '#aaa', font: { size: 11 } }
                        },
                        y: {
                            stacked: true,
                            beginAtZero: true,
                            grid: { color: '#333' },
                            ticks: { color: '#aaa' }
                        }
                    }
                }
            });

        } catch (error) {
            console.error('Error loading weekly stats:', error);
        }
    };

    const addToHistory = async (task) => {
        try {
            await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    openprojectId: task.id,
                    subject: task.subject,
                    projectName: task.projectName,
                    startDate: task.startDate,
                    dueDate: task.dueDate,
                    spentHours: task.spentHours,
                    webUrl: task.webUrl
                })
            });
            loadHistory();
            loadWeeklyStats(); // Reload chart
        } catch (error) {
            console.error('Error adding to history:', error);
        }
    };



    // Load on start
    loadAssignees();

    // Settings Dropdown Logic
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsDropdown = document.getElementById('settingsDropdown');

    if (settingsBtn && settingsDropdown) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsDropdown.style.display = settingsDropdown.style.display === 'block' ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
                settingsDropdown.style.display = 'none';
            }
        });
    }

    // Sync Users Logic
    const syncUsersBtn = document.getElementById('syncUsersBtn');
    if (syncUsersBtn) {
        syncUsersBtn.addEventListener('click', async (e) => {
            console.log('Sync Users Clicked'); // Debug
            // Don't close immediately if needed, but usually clicking button implies action done
            // e.stopPropagation(); 

            const originalText = syncUsersBtn.innerText;
            syncUsersBtn.innerText = 'Syncing...';
            syncUsersBtn.disabled = true;
            syncUsersBtn.style.cursor = 'wait';

            try {
                const response = await fetch('/api/sync-users', { method: 'POST' });
                const result = await response.json();

                if (response.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Sync Complete',
                        text: result.message || 'User list synchronized successfully.',
                        // timer: 2000,
                        showConfirmButton: true,
                        confirmButtonText: 'OK'
                    });
                    loadAssignees(); // Reload dropdown
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Sync failed:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Sync Failed',
                    text: error.message || 'Could not sync users.'
                });
            } finally {
                syncUsersBtn.innerText = originalText;
                syncUsersBtn.disabled = false;
                syncUsersBtn.style.cursor = 'pointer';
            }
        });
    }

    // Sync Projects Logic
    const syncProjectsBtn = document.getElementById('syncProjectsBtn');
    if (syncProjectsBtn) {
        syncProjectsBtn.addEventListener('click', async (e) => {
            console.log('Sync Projects Clicked'); // Debug
            const originalText = syncProjectsBtn.innerText;
            syncProjectsBtn.innerText = 'Syncing...';
            syncProjectsBtn.disabled = true;
            syncProjectsBtn.style.cursor = 'wait';

            try {
                const response = await fetch('/api/sync-projects', { method: 'POST' });
                const result = await response.json();

                if (response.ok) {
                    await Swal.fire({
                        icon: 'success',
                        title: 'Sync Complete',
                        text: `Synchronized ${result.count} projects successfully.`,
                        showConfirmButton: true,
                        confirmButtonText: 'Great, thanks!'
                    });

                    // Reload after user closes the popup
                    location.reload();
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Sync failed:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Sync Failed',
                    text: error.message || 'Could not sync projects.'
                });
            } finally {
                syncProjectsBtn.innerText = originalText;
                syncProjectsBtn.disabled = false;
                syncProjectsBtn.style.cursor = 'pointer';
            }
        });
    }

    // Reset Ranking Logic
    const resetRankingBtn = document.getElementById('resetRankingBtn');
    if (resetRankingBtn) {
        resetRankingBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            const result = await Swal.fire({
                title: 'Reset Ranking?',
                html: '<p>Are you sure you want to reset the ranking?</p><p style="color: #ff6b6b; font-size: 0.9em;">This will clear all local task history numbers to 0.</p>',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ff6b6b',
                cancelButtonColor: '#555',
                confirmButtonText: 'Yes, Reset',
                cancelButtonText: 'Cancel'
            });

            if (!result.isConfirmed) return;

            const originalText = resetRankingBtn.innerText;
            resetRankingBtn.innerText = 'Resetting...';
            resetRankingBtn.disabled = true;
            resetRankingBtn.style.cursor = 'wait';

            try {
                const response = await fetch('/api/admin/reset-ranking', { method: 'POST' });

                // Safe JSON Parsing to prevent "Unexpected token < in JSON"
                const resText = await response.text();
                let resData;
                try {
                    resData = resText ? JSON.parse(resText) : {};
                } catch (parseErr) {
                    console.error('Failed to parse response:', resText);
                    throw new Error('Server returned invalid data. Please restart your Node.js server (npm start) to apply the latest backend changes.');
                }

                if (response.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Ranking Reset',
                        text: 'Ranking counts have been successfully reset to 0.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    loadUserStats();
                    loadHistory(1);
                    loadWeeklyStats();
                } else {
                    throw new Error(resData.error || 'Failed to reset ranking');
                }
            } catch (error) {
                console.error('Reset failed:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Reset Failed',
                    text: error.message || 'Could not reset ranking.'
                });
            } finally {
                resetRankingBtn.innerText = originalText;
                resetRankingBtn.disabled = false;
                resetRankingBtn.style.cursor = 'pointer';
                if (settingsDropdown) {
                    settingsDropdown.style.display = 'none';
                }
            }
        });
    }

    // Logout Logic
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/login.html';
            } catch (e) {
                console.error('Logout failed', e);
                window.location.href = '/login.html';
            }
        });
    }


    // Enforce focus on search box when opened
    $(document).on('select2:open', () => {
        const searchField = document.querySelector('.select2-search__field');
        if (searchField) searchField.focus();
    });

    const form = document.getElementById('createTaskForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnLoader = document.getElementById('btnLoader');
    const btnText = submitBtn.querySelector('span');

    // Percentage Buttons
    const percentBtns = document.querySelectorAll('.percent-btn');
    const percentInput = document.getElementById('percentageDone');

    percentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            percentBtns.forEach(b => b.classList.remove('active'));
            // Add to clicked
            btn.classList.add('active');
            // Set value
            percentInput.value = btn.dataset.value;
        });
    });

    // Time (Hr) + and - Buttons
    const decreaseTimeBtn = document.getElementById('decreaseTimeBtn');
    const increaseTimeBtn = document.getElementById('increaseTimeBtn');
    const spentHoursInput = document.getElementById('spentHours');

    if (decreaseTimeBtn && increaseTimeBtn && spentHoursInput) {
        decreaseTimeBtn.addEventListener('click', () => {
            let val = parseFloat(spentHoursInput.value) || 0;
            if (val > 0) {
                spentHoursInput.value = Math.max(0, val - 1);
            }
        });
        increaseTimeBtn.addEventListener('click', () => {
            let val = parseFloat(spentHoursInput.value) || 0;
            spentHoursInput.value = val + 1;
        });
    }

    // Today Button
    document.getElementById('todayBtn').addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('startDate').value = today;
        // Auto-sync to finish date
        document.getElementById('dueDate').value = today;
    });

    // Auto-sync Finish Date when Start Date changes
    document.getElementById('startDate').addEventListener('change', (e) => {
        const startDate = e.target.value;
        if (startDate) {
            document.getElementById('dueDate').value = startDate;
        }
    });

    // Detect Project Change to fetch Assignees - REMOVED for Local Management
    // $('#projectId').on('select2:select', ...);

    // --- Auto-Assign Self Helper ---
    const getSelfAssigneeId = async () => {
        try {
            // 1. Get Current User Info
            const userRes = await fetch('/api/user');
            if (!userRes.ok) return null;
            const userData = await userRes.json();
            const myOpId = userData.id;
            const myName = userData.name || (userData.firstName + ' ' + userData.lastName);

            if (!myOpId) return null;

            // 2. Check if exists in dropdown
            let existingVal = null;
            $('#assigneeId option').each(function () {
                if ($(this).text().trim() === myName.trim()) {
                    existingVal = $(this).val();
                    return false;
                }
            });

            if (existingVal) return existingVal;

            // 3. Create New via API
            const createRes = await fetch('/api/assignees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: myName,
                    projectId: $('#projectId').val(),
                    openProjectId: myOpId
                })
            });

            if (!createRes.ok) {
                console.error('Auto-assign failed status:', createRes.status);
                return null;
            }

            const resText = await createRes.text();
            if (!resText) {
                console.error('Auto-assign server returned empty response');
                return null;
            }

            let newAssignee;
            try {
                newAssignee = JSON.parse(resText);
            } catch (jsonErr) {
                console.error('Failed to parse auto-assign response:', resText);
                return null;
            }

            console.log('Auto-Assigned User:', newAssignee);

            // Add to dropdown
            const newOption = new Option(newAssignee.name, newAssignee.id, true, true);
            $('#assigneeId').append(newOption).trigger('change');

            // Notify User
            Swal.fire({
                icon: 'info',
                title: 'Auto-Assigned',
                text: `You have been assigned as: ${newAssignee.name}`,
                timer: 2000,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });

            return newAssignee.id;

        } catch (e) {
            console.error('Auto-assign self error:', e);
            return null;
        }
    };

    // 2. Handle Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get values
        const projectId = $('#projectId').val();
        let assigneeId = $('#assigneeId').val();
        const typeId = $('#taskType').val(); // Get Type ID
        // Helper to ensure Plain Text (Strip HTML)
        const toPlainText = (str) => {
            if (!str) return '';
            const parser = new DOMParser();
            const doc = parser.parseFromString(str, 'text/html');
            return doc.body.textContent || '';
        };

        const subject = toPlainText(document.getElementById('taskName').value);
        const description = toPlainText(document.getElementById('taskDescription').value); // Get Description

        // Auto-Assign Self if empty
        if (!assigneeId) {
            assigneeId = await getSelfAssigneeId();
        }
        let startDate = document.getElementById('startDate').value;
        let dueDate = document.getElementById('dueDate').value;
        const percentageDone = document.getElementById('percentageDone').value;
        let spentHours = document.getElementById('spentHours').value;

        // Default to 1 hour if empty
        if (!spentHours) spentHours = '1';

        // Auto-fill Dates Logic
        const today = new Date().toISOString().split('T')[0];

        if (!startDate) {
            startDate = today;
        }

        if (!dueDate) {
            dueDate = startDate;
        }

        if (!projectId || !subject) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Info',
                text: 'Please select a project and enter a task name.',
                confirmButtonColor: '#FF8F00'
            });
            return;
        }

        // Loading State
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';

        try {
            const response = await fetch('/api/work_packages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    projectId,
                    projectName: $('#projectId').find(':selected').text(),
                    subject,
                    description,
                    typeId,
                    assigneeId,
                    startDate,
                    dueDate,
                    percentageDone,
                    spentHours
                })
            });

            // Safe JSON Parsing
            const resText = await response.text();
            let result;
            try {
                result = resText ? JSON.parse(resText) : {};
            } catch (parseErr) {
                console.error('Failed to parse response:', resText);
                throw new Error('Server returned invalid response. Check logs.');
            }

            if (response.ok) {
                let title = 'Task Created Successfully!';
                if (result.timeLogged) {
                    title = 'Task & Time Logged!';
                } else if (result.timeError) {
                    // Show warning toast for time error
                    Swal.fire({
                        icon: 'warning',
                        title: 'Task Created, but...',
                        text: result.timeError,
                        footer: `<a href="${result.webUrl}" target="_blank">Open Task</a>`
                    }).then(() => {
                        location.reload();
                    });
                    return;
                }

                // Show Success Modal and Reload
                Swal.fire({
                    icon: 'success',
                    title: title,
                    html: `Task <b>#${result.id}</b> created.<br><a href="${result.webUrl}" target="_blank" style="color: var(--primary-color);">Click to view in OpenProject</a>`,
                    confirmButtonText: 'OK, New Task',
                    allowOutsideClick: false
                }).then(() => {
                    // Refresh the page to reset form
                    location.reload();
                });

                // History Updated by Backend
                console.log('History logged by server.');

                // Save Last Used Project
                localStorage.setItem('lastProject', JSON.stringify({
                    id: projectId,
                    name: $('#projectId').find(':selected').text() || 'Unknown Project'
                }));

                // Reset Form
                document.getElementById('taskName').value = '';
                document.getElementById('startDate').value = '';
                document.getElementById('dueDate').value = '';
                document.getElementById('spentHours').value = '1';
                document.getElementById('percentageDone').value = '100';

                percentBtns.forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.value === '100') b.classList.add('active');
                });

                $('#projectId').val(null).trigger('change'); // Reset Select2
                $('#assigneeId').val(null).trigger('change').prop('disabled', true); // Reset Assignee

            } else {
                throw new Error(result.errorIdentifier || result.message || 'Unknown error');
            }

        } catch (error) {
            console.error('Error creating task:', error);
            Swal.fire({
                icon: 'error',
                title: 'Failed',
                text: error.message || 'Something went wrong.',
                confirmButtonColor: '#CF6679'
            });
        } finally {
            // Reset Loading State
            submitBtn.disabled = false;
            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
        }
    });
    loadHistory(); // Initial Load History
    loadUserStats(); // Initial Load Stats
    loadWeeklyStats(); // Initial Chart Load

    // --- Admin Panel Logic ---
    $('#adminPanelBtn').click(openAdminPanel);
    $('.close-modal, #closeAdminModal').click(() => $('#adminModal').fadeOut());

    // Close modal when clicking outside
    $(window).click((event) => {
        if (event.target.id === 'adminModal') {
            $('#adminModal').fadeOut();
        }
    });

    let currentRankingMode = 'custom';

    async function loadAdminRankingSettings() {
        try {
            const res = await fetch('/api/ranking/settings');
            if (!res.ok) return;
            const settings = await res.json();
            $('#rankingStartDateInput').val(settings.startDate || '');
            $('#rankingEndDateInput').val(settings.endDate || '');
            currentRankingMode = settings.mode || 'custom';

            updateRankingModeUI();
        } catch (e) {
            console.error('Failed to load ranking settings:', e);
        }
    }

    function updateRankingModeUI() {
        const isAdmin = currentUserRole === 'admin' || currentUserRole === 'root';
        $('.preset-chip-btn').removeClass('active');
        
        if (currentRankingMode === 'all') {
            $('#rankingAllTimeBtn').addClass('active').html('✓ ทุกช่วงเวลา');
            $('#rankingToPresentBtn').html('จนถึงปัจจุบัน');
            $('#rankingStartDateInput').val('').prop('disabled', true);
            $('#rankingEndDateInput').val('').prop('disabled', true);
            const noticeText = isAdmin 
                ? 'โหมด: แสดงทุกช่วงเวลา (All-Time) ทั้งหมดที่มีในระบบ'
                : 'โหมด: แสดงทุกช่วงเวลา (เฉพาะ Role Admin ขึ้นไปเท่านั้นที่สามารถเปลี่ยนได้)';
            $('#rankingDateNotice').text(noticeText);
        } else if (currentRankingMode === 'to_present') {
            $('#rankingAllTimeBtn').html('ทุกช่วงเวลา');
            $('#rankingToPresentBtn').addClass('active').html('✓ จนถึงปัจจุบัน');
            const today = new Date().toISOString().split('T')[0];
            $('#rankingStartDateInput').prop('disabled', !isAdmin);
            $('#rankingEndDateInput').val(today).prop('disabled', true);
            const noticeText = isAdmin 
                ? 'โหมด: คำนวณตั้งแต่วันที่เริ่มต้น จนถึงวันปัจจุบัน (อัปเดตอัตโนมัติทุกวัน)'
                : 'โหมด: คำนวณตั้งแต่วันที่เริ่มต้น จนถึงวันปัจจุบัน (เฉพาะ Role Admin ขึ้นไปเท่านั้นที่สามารถเปลี่ยนได้)';
            $('#rankingDateNotice').text(noticeText);
        } else {
            $('#rankingAllTimeBtn').html('ทุกช่วงเวลา');
            $('#rankingToPresentBtn').html('จนถึงปัจจุบัน');
            $('#rankingStartDateInput').prop('disabled', !isAdmin);
            $('#rankingEndDateInput').prop('disabled', !isAdmin);
            const noticeText = isAdmin 
                ? 'โหมด: กำหนดช่วงวันที่เริ่มต้นและสิ้นสุดแบบกำหนดเอง'
                : 'โหมด: กำหนดช่วงวันที่แบบกำหนดเอง (เฉพาะ Role Admin ขึ้นไปเท่านั้นที่สามารถเปลี่ยนได้)';
            $('#rankingDateNotice').text(noticeText);
        }

        $('.preset-chip-btn').prop('disabled', !isAdmin);
        $('#saveRankingDateBtn').prop('disabled', !isAdmin).css('opacity', isAdmin ? '1' : '0.5');
    }

    const applyPresetDateRange = (months, years = 0, btnId = null) => {
        const today = new Date();
        const endStr = today.toISOString().split('T')[0];
        const startObj = new Date(today);
        if (months > 0) startObj.setMonth(startObj.getMonth() - months);
        if (years > 0) startObj.setFullYear(startObj.getFullYear() - years);
        const startStr = startObj.toISOString().split('T')[0];

        $('#rankingStartDateInput').val(startStr);
        $('#rankingEndDateInput').val(endStr);
        currentRankingMode = 'custom';
        updateRankingModeUI();
        if (btnId) $(btnId).addClass('active');
    };

    $('#ranking1MonthBtn').on('click', function() { applyPresetDateRange(1, 0, '#ranking1MonthBtn'); });
    $('#ranking3MonthsBtn').on('click', function() { applyPresetDateRange(3, 0, '#ranking3MonthsBtn'); });
    $('#ranking6MonthsBtn').on('click', function() { applyPresetDateRange(6, 0, '#ranking6MonthsBtn'); });
    $('#ranking1YearBtn').on('click', function() { applyPresetDateRange(0, 1, '#ranking1YearBtn'); });

    $('#rankingAllTimeBtn').on('click', function() {
        currentRankingMode = currentRankingMode === 'all' ? 'custom' : 'all';
        updateRankingModeUI();
    });

    $('#rankingToPresentBtn').on('click', function() {
        currentRankingMode = currentRankingMode === 'to_present' ? 'custom' : 'to_present';
        updateRankingModeUI();
    });

    $('#saveRankingDateBtn').on('click', async function() {
        const startDate = $('#rankingStartDateInput').val();
        const endDate = $('#rankingEndDateInput').val();
        const mode = currentRankingMode;

        try {
            const res = await fetch('/api/admin/ranking/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate, mode })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save settings');

            Swal.fire({
                icon: 'success',
                title: 'บันทึกช่วงวันที่สำเร็จ',
                text: 'ระบบได้อัปเดตช่วงวันที่ Ranking สำหรับทุกคนแล้ว',
                timer: 2000,
                showConfirmButton: false
            });

            loadUserStats();
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        }
    });

    async function openAdminPanel() {
        $('#adminModal').fadeIn();
        loadAdminRankingSettings();
        const tbody = $('#userListBody');
        tbody.html('<tr><td colspan="6" style="text-align:center; padding: 20px;">Loading users...</td></tr>');

        try {
            const res = await fetch('/api/admin/users');
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to load users');
            const users = await res.json();

            tbody.empty();
            users.forEach(u => {
                const displayId = u.openproject_id || u.id;
                const tr = `
                    <tr style="border-bottom: 1px solid #444;">
                        <td style="padding: 10px;">${displayId}</td>
                        <td style="padding: 10px;">${u.username}</td>
                        <td style="padding: 10px;">${u.name}</td>
                        <td style="padding: 10px;">
                            <span style="background: ${u.role === 'admin' ? '#9c27b0' : '#444'}; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: white;">${u.role}</span>
                        </td>
                        <td style="padding: 10px; text-align: center;">
                            <button onclick="window.editUser(${u.id}, '${u.username}', '${u.name}', '${u.role}')" style="background: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                            <button onclick="window.resetUserPassword(${u.id}, '${u.username}')" style="background: #e57373; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Reset Pwd</button>
                        </td>
                    </tr>
                `;
                tbody.append(tr);
            });
        } catch (e) {
            tbody.html(`<tr><td colspan="6" style="color: #ff5252; text-align:center; padding: 20px;">Error: ${e.message}</td></tr>`);
        }
    }

    // Expose edit function to global scope
    window.editUser = async (id, username, name, role) => {
        const result = await Swal.fire({
            title: 'Edit User',
            html:
                `<div style="display: flex; flex-direction: column; gap: 10px;">
                    <input id="swal-username" class="swal2-input" placeholder="Username" value="${username}" style="margin: 0;">
                    <input id="swal-name" class="swal2-input" placeholder="Full Name" value="${name}" style="margin: 0;">
                    <select id="swal-role" class="swal2-input" style="margin: 0; padding: 0 10px;">
                        <option value="user" ${role === 'user' ? 'selected' : ''}>User</option>
                        <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save',
            confirmButtonColor: '#4CAF50',
            preConfirm: () => {
                const newUsername = document.getElementById('swal-username').value;
                const newName = document.getElementById('swal-name').value;
                const newRole = document.getElementById('swal-role').value;

                if (!newUsername || !newName) {
                    Swal.showValidationMessage('Fields are required');
                    return false;
                }
                return { username: newUsername, name: newName, role: newRole };
            }
        });

        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/admin/users/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                if (res.ok) {
                    Swal.fire('Success', 'User updated successfully!', 'success');
                    openAdminPanel(); // Refresh the list
                } else {
                    const error = await res.json();
                    Swal.fire('Error', error.error || 'Failed to update user', 'error');
                }
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    };

    // Expose reset function to global scope so onclick can see it
    window.resetUserPassword = async (id, username) => {
        const result = await Swal.fire({
            title: 'Reset Password',
            html: `<div style="display: flex; flex-direction: column; gap: 10px;">
                    <p style="margin: 0 0 10px 0; color: #ccc;">Enter new password for <strong>${username}</strong>:</p>
                    <input id="swal-password" type="password" class="swal2-input" placeholder="New Password" style="margin: 0;">
                </div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Reset Password',
            confirmButtonColor: '#e57373',
            preConfirm: () => {
                const newPwd = document.getElementById('swal-password').value;
                if (!newPwd) {
                    Swal.showValidationMessage('Password is required');
                    return false;
                }
                if (newPwd.length < 6) {
                    Swal.showValidationMessage('Password must be at least 6 characters');
                    return false;
                }
                return newPwd;
            }
        });

        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/admin/users/${id}/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newPassword: result.value })
                });
                if (res.ok) {
                    Swal.fire('Success', 'Password updated successfully!', 'success');
                } else {
                    const error = await res.json();
                    Swal.fire('Error', error.error || 'Failed to reset password', 'error');
                }
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    };

});
