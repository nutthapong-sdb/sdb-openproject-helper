# AGENTS.md

Definitive operational manual and behavioral guidelines for AI agents working in the **sdb-openproject-poc** codebase.

---

## 1. Core Behavioral Guidelines

### Think Before Coding
- **Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain or requirements are ambiguous, ask before implementing.
- Present multiple interpretations if they exist - do not pick silently.
- If a simpler approach exists, propose it.

### Simplicity First
- **Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No premature abstractions or helper wrappers for single-use operations.
- No unused configuration options or speculative "you might also want..." code.
- If 50 lines can do the job of 200 lines, write 50 lines.

### Surgical Changes
- **Touch only what you must. Clean up only your own mess.**
- Do not "improve", reformat, or refactor unrelated adjacent code.
- Match existing repository patterns and styles.
- When changes create orphaned imports/variables/functions, remove them. Never delete pre-existing dead code unless explicitly instructed.
- Every changed line should trace directly to the user's prompt.

### Output & Communication Rules
- Return code first, followed by concise explanation only if non-obvious.
- No inline prose or unnecessary comments.
- Plain hyphens and straight quotes only; no decorative Unicode or em dashes.
- **ADHD Communication Mode**: When the user requests ADHD format (e.g. `i-have-adhd` skill or "ตอบแบบ adhd"), prioritize:
  1. **TL;DR first**: Core takeaway in 1–2 bullet points.
  2. **Short bullet points**: Visual anchors (emojis), bold key numbers.
  3. **Zero fluff**: Eliminate introductory boilerplate and redundant narrative.

### Verification & Testing
- Always verify syntax: `node --check server.js && node --check public/js/script.js`.
- Always run the automated regression suite: `npm test`.
- All three test suites (`e2e-webui.spec.mjs`, `time-entries-regression.mjs`, `auth-regression.mjs`) must pass 100% before concluding a task.

---

## 2. System Architecture & Tech Stack

### Purpose
**sdb-openproject-poc** is an integration middleware and web dashboard connecting Softdebut employees to the corporate OpenProject instance (`https://openproject.softdebut.com`). It provides:
1. Fast task logging (Work Packages) with local caching of projects, assignees, and task history.
2. An automated employee performance ranking dashboard (Work Hours vs OT Hours).
3. Missing workday tracking ("รายการที่ยังไม่ลงข้อมูล") to alert staff of days missing $\ge 8.0$ logged hours.
4. Work From Home (WFH) automated request submission to Debutservice via Playwright.

### Tech Stack
- **Backend Runtime**: Node.js (CommonJS)
- **Web Framework**: Express.js 5
- **Database**: SQLite3 (`projects.db`)
- **Web Automation Engines**:
  - **Puppeteer + Stealth Plugin**: Headless browser automation used for OpenProject API calls to bypass Cloudflare bot protections and CORS challenges.
  - **Playwright**: Used for server-side Debutservice automation (WFH requests and automated E2E browser tests).
- **Frontend**:
  - Vanilla JavaScript (`public/js/script.js`) + HTML5 / CSS3 (`public/index.html`, `public/css/style.css`).
  - Libraries: jQuery UI, Select2, SweetAlert2.

---

## 3. Database Schema Reference (`projects.db`)

All tables are initialized in `server.js`:

| Table Name | Primary Key / Index | Description & Key Columns |
|---|---|---|
| `users` | `id INTEGER PRIMARY KEY` | Local user accounts (`username`, `password` bcrypt hash, `api_key`, `openproject_id`, `role`). Roles: `'user'`, `'admin'`, `'root'`. |
| `projects` | `project_id TEXT UNIQUE` | Cached OpenProject projects (`project_id`, `name`, `updated_at`). |
| `project_types` | `(project_id, type_id)` | Work package types mapped per project (`project_id`, `type_id`, `type_name`). |
| `local_assignees` | `id INTEGER PRIMARY KEY` | Curated assignees with mapped `openproject_id` and display `name`. |
| `task_history` | `id INTEGER PRIMARY KEY` | Tasks created through this tool (`user_id`, `openproject_id`, `subject`, `project_name`, `start_date`, `due_date`, `spent_hours`, `web_url`). |
| `openproject_time_entries` | `openproject_id TEXT UNIQUE` | Cached time entries from OpenProject API (`id`, `openproject_id`, `user_id`, `user_name`, `work_package_id`, `work_package_title`, `project_name`, `spent_on`, `hours`, `comment`, `updated_at`). |
| `ranking_cache` | `assignee_id TEXT PRIMARY KEY` | Aggregated rankings (`assignee_id`, `name`, `work_hours`, `ot_hours`, `total_hours`, `task_count`, `missing_json`, `updated_at`). |
| `user_workday_statuses` | `(user_id, workdate)` | Workday completion cache (`user_id`, `workdate`, `logged_hours`, `status` ['completed' \| 'missing' \| 'excluded'], `updated_at`). |
| `excluded_workdays` | `excluded_date TEXT UNIQUE` | Company holidays and excluded dates (`excluded_date`, `reason`, `created_by`, `created_at`). |
| `user_sync_logs` | `id INTEGER PRIMARY KEY` | Rate limiting log for ranking sync (`user_id`, `sync_date`, `synced_at`). 1 sync/day for non-admins. |
| `wfh_form_defaults` | `user_id TEXT PRIMARY KEY` | Stored JSON defaults for WFH form per user. |
| `wfh_remote_requests` | `id INTEGER PRIMARY KEY` | Log of submitted remote work requests. |
| `meta` | `key TEXT PRIMARY KEY` | Key-value settings (`ranking_start_date`, `ranking_end_date`, `ranking_date_mode`, `last_sync`). |

---

## 4. Key Business Logic & Invariants

### A. Non-Blocking Async Sync & Cloudflare 524 Timeout Prevention
- **Critical Rule**: Because OpenProject requests pass through Puppeteer and Cloudflare, long-running sync operations (fetching 40+ pages or 20,000+ records) will trigger a **Cloudflare Error 524 (A timeout occurred)** if the HTTP response is held open.
- **Pattern**:
  1. Endpoints (`POST /api/openproject/time-entries/sync`, `POST /api/openproject/time-entries/clear-and-resync`, `POST /api/sync-projects`) return immediately within $<50$ms with `{ ok: true, active: true, message: ... }`.
  2. Heavy tasks execute asynchronously in the background via `(async () => { ... })()`.
  3. Frontend polls status endpoints (`/api/openproject/time-entries/sync-status` or `/api/sync-projects/status`) every 1.5–2.0 seconds with live progress text.
  4. SweetAlert2 modals stay open (`allowOutsideClick: false, allowEscapeKey: false`) until the user clicks "ตกลง (ปิดหน้าต่าง)".

### B. Employee Ranking & Hours Invariants
- **Mathematical Invariant**: `total_hours = work_hours + ot_hours`.
  - Normal day limit is 8.0 hours on weekdays.
  - Any hours logged beyond 8.0 hours on a single workday, or any hours logged on weekends (Saturday/Sunday), are categorized as `ot_hours`.
  - Normal work hours on weekdays up to 8.0 hours are categorized as `work_hours`.
- **Grouping**: Always group time entries strictly by `user_id` (`COALESCE(NULLIF(t.user_id, ''), t.user_name)`). Never use loose name matching (`LOWER(TRIM(...))`) in SQL joins as it causes duplicate cartesian products and inaccurate counts.
- **Sorting**: Rows must be sorted strictly by `total_hours DESC`, then `work_hours DESC`, then `task_count DESC`.

### C. Missing Workdays Tracker ("รายการที่ยังไม่ลงข้อมูล")
- Evaluates Monday–Friday workdays within the active date range (past 60 days).
- **Caching Mechanism (`user_workday_statuses`)**:
  - If a workday has `status = 'completed'` (hours $\ge 8.0$) or is in `excluded_workdays`, the system skips re-querying time entries for that date.
  - Only workdays marked `'missing'` or newly added dates are evaluated against `openproject_time_entries` and `task_history`.
  - Completed days are upserted into `user_workday_statuses` with `status = 'completed'`, preventing previously logged days from erroneously reappearing as missing.
- When an admin executes `Clear & Resync All`, `user_workday_statuses` is purged alongside `openproject_time_entries` and `ranking_cache`.

### D. Sync Projects Feature
- Located directly below the Project and Task Type selectors in the Create Task panel (`#syncProjectsBtn`).
- Open to all authenticated users (executes with the calling user's `user_apikey`).
- Non-blocking async execution with background Puppeteer browser fetch and frontend status polling.

### E. Role-Based Access Control (RBAC)
- User role is read from `users.role` (`'admin'`, `'root'`, or `'user'`).
- **Admin-Only Privileges**:
  - `POST /api/openproject/time-entries/clear-and-resync` (Clear & Resync All button).
  - Reset Ranking button (`#resetRankingBtn`).
  - Editing Ranking Date Range filters and preset chips.
  - Adding/removing excluded workdays (`/api/openproject/excluded-workdays`).
  - Unlimited ranking sync operations (regular users are rate-limited to 1 sync per calendar day via `user_sync_logs`).

---

## 5. Development, Testing & Verification Commands

### Environment Configuration
- Configured in `.env`:
  - `PORT=3002` (default port used locally and in testing)
  - `DB_FILE=./projects.db`
  - `PUPPETEER_EXECUTABLE_PATH` / `PLAYWRIGHT_EXECUTABLE_PATH` (optional custom browser paths)

### Syntax & Lint Checks
```bash
node --check server.js && node --check public/js/script.js
```

### Automated Regression Test Suite
```bash
npm test
```
Runs:
1. `tests/e2e-webui.spec.mjs`: Playwright headless browser E2E test verifying Dashboard rendering, ranking table population, unlogged workdays rendering, and refresh button state.
2. `tests/time-entries-regression.mjs`: Node.js test suite for ISO duration parsing, date presets, SQLite aggregations, and Mon-Fri missing workdays logic.
3. `tests/auth-regression.mjs`: Tests password hashing, bcrypt migration, and session handling.

### Git & Deployment Workflow
- Always commit clean, focused changes with conventional commit prefixes:
  - `feat(...)`, `fix(...)`, `style(...)`, `perf(...)`, `refactor(...)`, `chore(...)`.
- Push to GitHub:
  ```bash
  git push origin main
  ```
- Server deployment:
  ```bash
  git pull origin main
  # restart node process or pm2 if applicable
  ```
