/**
 * YLS LFA Kit AI Diagnostic WebApp Controller
 * v4.2 — 실시간 핀치 줌(확대/축소) 제스처 지원, 상단 뱃지 갱신 및 구글 시트 동기화 자동 업데이트 반영
 *
 * Flow: Login (yelloi/1111) → Time Setting (countdown) → Camera →
 *       Photo Confirm → Results (15/page, memo, absorbance graph popup)
 */

document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────────────────────
    // Constants & State
    // ─────────────────────────────────────────────────────────────
    const PAGE_SIZE = 15;

    // 사용자 계정은 Google Sheets + Apps Script에서 중앙 관리한다.
    const DEFAULT_USERS = [{ username: 'yelloi', password: '1111' }];
    const USERNAME_REGEX = /^[A-Za-z_]{1,8}$/;
    const MIN_PASSWORD_LEN = 4;

    function loadUsers() { return []; }
    function saveUsers(_) { /* Google Sheets가 원본 DB이므로 no-op */ }

    const state = {
        currentUser: {
            username: 'yelloi',
            isLoggedIn: false
        },
        users: loadUsers(),
        stream: null,
        capturedCanvas: null,
        analyzer: typeof LFAAnalyzer === 'function' ? new LFAAnalyzer() : null,
        sheetsSync: typeof GoogleSheetsSync === 'function' ? new GoogleSheetsSync() : null,
        activeView: 'view-login',
        lastAnalysisResult: null,
        countdownInterval: null,
        countdownRemaining: 0,
        currentPage: 1,
        memoEditId: null,
        activeGraphRecord: null,
        // Selection & Trash states
        isSelectMode: false,
        selectedRecordIds: new Set(),
        // Zoom control states
        currentZoom: 1.0,
        minZoom: 1.0,
        maxZoom: 5.0,
        pinchStartDist: 0,
        pinchStartZoom: 1.0
    };

    // ── Initialize mock history on first run ──
    if (!localStorage.getItem('yls_lfa_history')) {
        localStorage.setItem('yls_lfa_history', JSON.stringify(buildMockHistory()));
    }

    function buildMockHistory() {
        const rows = [
            { ts: '2026-08-26 10:15', res: '실패', conc: '-', memo: '' },
            { ts: '2026-08-24 13:45', res: '양성', conc: '0.01', memo: '첫 번째 양성 결과' },
            { ts: '2026-08-22 17:15', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-20 11:02', res: '음성', conc: '-', memo: '정상 확인' },
            { ts: '2026-08-19 13:45', res: '양성', conc: '0.02', memo: '재검 필요' },
            { ts: '2026-08-18 17:15', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-17 11:02', res: '실패', conc: '-', memo: '' },
            { ts: '2026-08-15 13:45', res: '양성', conc: '0.01', memo: '' },
            { ts: '2026-08-14 17:15', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-13 11:02', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-11 11:02', res: '실패', conc: '-', memo: '' },
            { ts: '2026-08-10 13:45', res: '양성', conc: '0.01', memo: '' },
            { ts: '2026-08-08 17:15', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-06 11:02', res: '실패', conc: '-', memo: '' },
            { ts: '2026-08-05 17:15', res: '음성', conc: '-', memo: '' },
            { ts: '2026-08-03 09:30', res: '양성', conc: '0.03', memo: '추가 검사 권고' },
            { ts: '2026-08-01 14:00', res: '음성', conc: '-', memo: '' },
            { ts: '2026-07-30 10:45', res: '음성', conc: '-', memo: '' },
        ];
        return rows.map((r, i) => ({
            id: 'REC_MOCK_' + (i + 1),
            timestamp: r.ts,
            result: r.res,
            concentrationStr: r.conc,
            userNickname: 'yelloi',
            memo: r.memo,
            cropImageDataUrl: null,
            cropFilename: null,
            profileData: null,
            metrics: null,
            confidence: null
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // DOM Elements
    // ─────────────────────────────────────────────────────────────
    const el = {
        views: {
            login: document.getElementById('view-login'),
            timesetting: document.getElementById('view-timesetting'),
            camera: document.getElementById('view-camera'),
            confirm: document.getElementById('view-confirm'),
            results: document.getElementById('view-results')
        },
        // Login
        inputUsername: document.getElementById('input-username'),
        inputPassword: document.getElementById('input-password'),
        btnLogin: document.getElementById('btn-login'),
        // Time Setting
        timesetGreeting: document.getElementById('timeset-greeting'),
        inputWaitMin: document.getElementById('input-wait-min'),
        inputWaitSec: document.getElementById('input-wait-sec'),
        btnTimesetOk: document.getElementById('btn-timeset-confirm'),
        displayMin: document.getElementById('display-min'),
        displaySec: document.getElementById('display-sec'),
        btnGoCamera: document.getElementById('btn-go-camera'),
        // Camera
        cameraVideo: document.getElementById('camera-video'),
        btnCapture: document.getElementById('btn-capture-photo'),
        cameraContainer: document.querySelector('.camera-container'),
        // Confirm
        confirmCanvas: document.getElementById('confirm-preview-canvas'),
        btnConfirmNo: document.getElementById('btn-confirm-no'),
        btnConfirmYes: document.getElementById('btn-confirm-yes'),
        // Results
        resultUserId: document.getElementById('result-user-id'),
        resultsBody: document.getElementById('results-table-body'),
        btnReturnHome: document.getElementById('btn-return-home'),
        // Overlays
        analyzingOverlay: document.getElementById('analyzing-overlay'),
        toast: document.getElementById('toast'),
        statusTime: document.getElementById('status-time'),
        // Memo popup
        memoPopup: document.getElementById('memo-popup'),
        memoTextarea: document.getElementById('memo-textarea'),
        btnMemoCancel: document.getElementById('btn-memo-cancel'),
        btnMemoConfirm: document.getElementById('btn-memo-confirm'),
        // Graph popup
        graphPopup: document.getElementById('graph-popup'),
        graphPopupDatetime: document.getElementById('graph-popup-datetime'),
        graphPopupResult: document.getElementById('graph-popup-result-badge'),
        btnGraphClose: document.getElementById('btn-graph-close'),
        btnGraphClose2: document.getElementById('btn-graph-close2'),
        btnGraphDelete: document.getElementById('btn-graph-delete'),
        graphStripCanvas: document.getElementById('graph-strip-canvas'),
        graphProfile: document.getElementById('graph-profile-canvas'),
        metricT: document.getElementById('metric-t-intensity'),
        metricC: document.getElementById('metric-c-intensity'),
        metricConf: document.getElementById('metric-confidence'),
        metricSnr: document.getElementById('metric-snr'),
        // CSV Calendar Popup
        btnExportCsv: document.getElementById('btn-export-csv'),
        csvCalendarPopup: document.getElementById('csv-calendar-popup'),
        btnCsvCalClose: document.getElementById('btn-csv-cal-close'),
        btnCsvCalCancel: document.getElementById('btn-csv-cal-cancel'),
        btnCsvCalDownload: document.getElementById('btn-csv-cal-download'),
        csvRangeStartVal: document.getElementById('csv-range-start-val'),
        csvRangeEndVal: document.getElementById('csv-range-end-val'),
        btnCalPrevMonth: document.getElementById('btn-cal-prev-month'),
        btnCalNextMonth: document.getElementById('btn-cal-next-month'),
        calMonthTitle: document.getElementById('cal-month-title'),
        calDaysGrid: document.getElementById('cal-days-grid'),
        // Results Selection & Trash
        btnToggleSelect: document.getElementById('btn-toggle-select'),
        btnOpenTrash: document.getElementById('btn-open-trash'),
        trashCountBadge: document.getElementById('trash-count-badge'),
        thCheckbox: document.getElementById('th-checkbox'),
        checkAllResults: document.getElementById('check-all-results'),
        resultsSelectActions: document.getElementById('results-select-actions'),
        btnDeleteSelected: document.getElementById('btn-delete-selected'),
        btnCancelSelect: document.getElementById('btn-cancel-select'),
        // Trash Popup
        trashPopup: document.getElementById('trash-popup'),
        btnTrashClose: document.getElementById('btn-trash-close'),
        btnTrashCancel: document.getElementById('btn-trash-cancel'),
        trashTotalCount: document.getElementById('trash-total-count'),
        trashListContainer: document.getElementById('trash-list-container'),
        btnTrashRestoreAll: document.getElementById('btn-trash-restore-all'),
        btnTrashEmpty: document.getElementById('btn-trash-empty'),
        // Delete Confirm Popup
        deleteConfirmPopup: document.getElementById('delete-confirm-popup'),
        deleteConfirmMsg: document.getElementById('delete-confirm-msg'),
        btnDeleteConfirm: document.getElementById('btn-delete-confirm'),
        btnDeleteCancel: document.getElementById('btn-delete-cancel'),
        // Timesetting extras
        btnViewResults: document.getElementById('btn-view-results'),
        // Login -- 사용자 추가 / 인라인 에러
        loginError: document.getElementById('login-error'),
        btnOpenAddUser: document.getElementById('btn-open-adduser'),
        // 사용자 추가 팝업
        addUserPopup: document.getElementById('adduser-popup'),
        inputNewUsername: document.getElementById('input-new-username'),
        inputNewPassword: document.getElementById('input-new-password'),
        inputNewPasswordConfirm: document.getElementById('input-new-password-confirm'),
        btnAddUserClose: document.getElementById('btn-adduser-close'),
        btnAddUserCancel: document.getElementById('btn-adduser-cancel'),
        btnAddUserConfirm: document.getElementById('btn-adduser-confirm'),
        addUserError: document.getElementById('adduser-error'),
        // 톱니바퀴 -> 사용자 설정
        btnSettingsMenu: document.getElementById('btn-settings-menu'),
        userSettingsPopup: document.getElementById('user-settings-popup'),
        currentUserIdDisplay: document.getElementById('current-user-id-display'),
        inputCurrentPassword: document.getElementById('input-current-password'),
        inputNewPassword2: document.getElementById('input-new-password2'),
        inputNewPasswordConfirm2: document.getElementById('input-new-password-confirm2'),
        btnUserSettingsClose: document.getElementById('btn-user-settings-close'),
        btnUserSettingsCancel: document.getElementById('btn-user-settings-cancel'),
        btnUserSettingsSave: document.getElementById('btn-user-settings-save'),
        btnUserSettingsLogout: document.getElementById('btn-user-settings-logout'),
        userSettingsError: document.getElementById('user-settings-error'),
        userSettingsSuccess: document.getElementById('user-settings-success'),
        // Exit confirm popup
        exitConfirmPopup: document.getElementById('exit-confirm-popup'),
        btnExitYes: document.getElementById('btn-exit-yes'),
        btnExitNo: document.getElementById('btn-exit-no'),
        // Top Back buttons
        btnBackFromCamera: document.getElementById('btn-back-from-camera'),
        btnBackFromConfirm: document.getElementById('btn-back-from-confirm')
    };

    // ─────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────
    function showToast(msg) {
        if (!el.toast) return;
        el.toast.textContent = msg;
        el.toast.classList.add('show');
        setTimeout(() => el.toast && el.toast.classList.remove('show'), 2800);
    }

    function updateClock() {
        const now = new Date();
        if (el.statusTime) {
            el.statusTime.textContent =
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0');
        }
    }
    setInterval(updateClock, 10000);
    updateClock();

    // ─────────────────────────────────────────────────────────────
    // Navigation
    // ─────────────────────────────────────────────────────────────
    function navigateTo(viewName) {
        state.activeView = 'view-' + viewName;
        if (viewName !== 'login') {
            localStorage.setItem('yls_last_view', viewName);
        }

        Object.entries(el.views).forEach(([name, node]) => {
            if (!node) return;
            node.classList.toggle('active', name === viewName);
        });

        if (viewName === 'camera') {
            startCamera();
            setTimeout(updateCameraGuide, 200);
        } else {
            stopCamera();
        }

        if (viewName === 'timesetting') {
            if (el.timesetGreeting) {
                el.timesetGreeting.textContent =
                    `'${state.currentUser.username}' 님 환영합니다.`;
            }
            if (!state.countdownInterval) {
                if (el.displayMin) el.displayMin.textContent = '--';
                if (el.displaySec) el.displaySec.textContent = '--';
            }
        } else if (viewName === 'results') {
            state.currentPage = 1;
            renderResultsTable();
        } else if (viewName === 'confirm') {
            setTimeout(() => {
                const m = state.guideMetrics;
                if (!m) return;
                const cFrame = document.getElementById('confirm-kit-frame');
                const cWin = document.getElementById('confirm-guide-window');
                const cWell = document.getElementById('confirm-guide-well');
                applyStyle(cFrame, { width: m.fW + 'px', height: m.fH + 'px', top: m.fTop + 'px', left: m.fLeft + 'px', transform: 'none' });
                applyStyle(cWin, { width: m.sW + 'px', height: m.sH + 'px', left: m.sLeft + 'px', top: m.sTop + 'px', transform: 'none' });
                applyStyle(cWell, { width: m.wDiam + 'px', height: m.wDiam + 'px', left: m.wLeft + 'px', top: m.wTop + 'px', transform: 'none' });
            }, 50);
        }
    }

    // ────────────────────────────────────────────────────────────
    // LOGIN
    // ────────────────────────────────────────────────────────────
    function showLoginError(msg) {
        if (!el.loginError) { showToast(msg); return; }
        el.loginError.textContent = msg;
        el.loginError.classList.remove('hidden');
    }
    function clearLoginError() {
        if (!el.loginError) return;
        el.loginError.textContent = '';
        el.loginError.classList.add('hidden');
    }

    async function doLogin() {
        const username = (el.inputUsername?.value || '').trim();
        const password = (el.inputPassword?.value || '').trim();

        if (!username || !password) {
            showLoginError('User_ID와 Password를 입력해 주세요.');
            return;
        }

        try {
            const res = await GoogleUserAuth.login(username, password);
            if (res && res.success) {
                state.currentUser.username = username;
                state.currentUser.isLoggedIn = true;
                localStorage.setItem('yls_user_logged_in', 'true');
                localStorage.setItem('yls_user_name', username);
                clearLoginError();
                if (el.inputPassword) el.inputPassword.value = '';
                navigateTo('timesetting');
                loadAndRenderResultsTable();
            } else {
                showLoginError((res && res.message) || '아이디 또는 비밀번호가 올바르지 않습니다.');
                if (el.inputPassword) el.inputPassword.value = '';
            }
        } catch (err) {
            console.error('[GoogleUserAuth] login failed:', err);
            showLoginError('사용자 서버에 연결할 수 없습니다. 인터넷 연결과 서버 연동 설정을 확인해 주세요.');
        }
    }

    if (el.btnLogin) el.btnLogin.addEventListener('click', doLogin);
    [el.inputUsername, el.inputPassword].forEach(inp => {
        if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    });
    if (el.inputUsername) el.inputUsername.addEventListener('input', clearLoginError);
    if (el.inputPassword) el.inputPassword.addEventListener('input', clearLoginError);

    // ────────────────────────────────────────────────────────────
    // ADD USER
    // ────────────────────────────────────────────────────────────
    function showAddUserError(msg) {
        if (!el.addUserError) { showToast(msg); return; }
        el.addUserError.textContent = msg;
        el.addUserError.classList.remove('hidden');
    }
    function openAddUserPopup() {
        if (!el.addUserPopup) return;
        if (el.inputNewUsername) el.inputNewUsername.value = '';
        if (el.inputNewPassword) el.inputNewPassword.value = '';
        if (el.inputNewPasswordConfirm) el.inputNewPasswordConfirm.value = '';
        if (el.addUserError) el.addUserError.classList.add('hidden');
        el.addUserPopup.classList.remove('hidden');
        setTimeout(() => el.inputNewUsername?.focus(), 50);
    }
    function closeAddUserPopup() {
        if (!el.addUserPopup) return;
        el.addUserPopup.classList.add('hidden');
    }
    async function confirmAddUser() {
        const id = (el.inputNewUsername?.value || '').trim();
        const pw = el.inputNewPassword?.value || '';
        const pw2 = el.inputNewPasswordConfirm?.value || '';

        if (!USERNAME_REGEX.test(id)) {
            showAddUserError('User_ID는 영문 또는 언더스코어(_) 1~8자만 가능합니다.');
            return;
        }
        if (pw.length < MIN_PASSWORD_LEN) {
            showAddUserError('Password는 최소 ' + MIN_PASSWORD_LEN + '자 이상이어야 합니다.');
            return;
        }
        if (pw !== pw2) {
            showAddUserError('Password 확인이 일치하지 않습니다.');
            return;
        }
        try {
            const res = await GoogleUserAuth.register(id, pw);
            if (!res || !res.success) {
                showAddUserError((res && res.message) || '사용자 등록에 실패했습니다.');
                return;
            }

            closeAddUserPopup();
            showToast(`사용자 '${id}' 가 등록되었습니다.`);
            if (el.inputUsername) el.inputUsername.value = id;
            if (el.inputPassword) { el.inputPassword.value = ''; el.inputPassword.focus(); }
        } catch (err) {
            console.error('[GoogleUserAuth] register failed:', err);
            showAddUserError('사용자 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
        }
    }
    if (el.btnOpenAddUser) el.btnOpenAddUser.addEventListener('click', openAddUserPopup);
    if (el.btnAddUserClose) el.btnAddUserClose.addEventListener('click', closeAddUserPopup);
    if (el.btnAddUserCancel) el.btnAddUserCancel.addEventListener('click', closeAddUserPopup);
    if (el.btnAddUserConfirm) el.btnAddUserConfirm.addEventListener('click', confirmAddUser);
    [el.inputNewUsername, el.inputNewPassword, el.inputNewPasswordConfirm].forEach(inp => {
        if (inp) inp.addEventListener('keydown', e => {
            if (e.key === 'Enter' && el.btnAddUserConfirm) el.btnAddUserConfirm.click();
        });
    });
    if (el.addUserPopup) el.addUserPopup.addEventListener('click', e => {
        if (e.target === el.addUserPopup) closeAddUserPopup();
    });

    // ────────────────────────────────────────────────────────────
    // USER SETTINGS
    // ────────────────────────────────────────────────────────────
    function openUserSettings() {
        if (!el.userSettingsPopup) return;
        if (el.currentUserIdDisplay) {
            el.currentUserIdDisplay.textContent = state.currentUser.username;
        }
        if (el.inputCurrentPassword) el.inputCurrentPassword.value = '';
        if (el.inputNewPassword2) el.inputNewPassword2.value = '';
        if (el.inputNewPasswordConfirm2) el.inputNewPasswordConfirm2.value = '';
        if (el.userSettingsError) el.userSettingsError.classList.add('hidden');
        if (el.userSettingsSuccess) el.userSettingsSuccess.classList.add('hidden');
        el.userSettingsPopup.classList.remove('hidden');
    }
    function closeUserSettings() {
        if (!el.userSettingsPopup) return;
        el.userSettingsPopup.classList.add('hidden');
    }
    function showSettingsError(msg) {
        if (!el.userSettingsError) { showToast(msg); return; }
        el.userSettingsError.textContent = msg;
        el.userSettingsError.classList.remove('hidden');
        if (el.userSettingsSuccess) el.userSettingsSuccess.classList.add('hidden');
    }
    async function savePasswordChange() {
        const cur = el.inputCurrentPassword?.value || '';
        const newPw = el.inputNewPassword2?.value || '';
        const newPw2 = el.inputNewPasswordConfirm2?.value || '';
        if (newPw.length < MIN_PASSWORD_LEN) {
            showSettingsError('새 Password는 최소 ' + MIN_PASSWORD_LEN + '자 이상이어야 합니다.');
            return;
        }
        if (newPw !== newPw2) { showSettingsError('새 Password 확인이 일치하지 않습니다.'); return; }

        try {
            const res = await GoogleUserAuth.changePassword(state.currentUser.username, cur, newPw);
            if (!res || !res.success) {
                showSettingsError((res && res.message) || 'Password 변경에 실패했습니다.');
                return;
            }
        } catch (err) {
            console.error('[GoogleUserAuth] password change failed:', err);
            showSettingsError('사용자 서버에 연결할 수 없습니다.');
            return;
        }
        if (el.inputCurrentPassword) el.inputCurrentPassword.value = '';
        if (el.inputNewPassword2) el.inputNewPassword2.value = '';
        if (el.inputNewPasswordConfirm2) el.inputNewPasswordConfirm2.value = '';
        if (el.userSettingsError) el.userSettingsError.classList.add('hidden');
        if (el.userSettingsSuccess) {
            el.userSettingsSuccess.textContent = 'Password가 변경되었습니다.';
            el.userSettingsSuccess.classList.remove('hidden');
        }
        showToast('Password가 변경되었습니다.');
    }
    function doLogout() {
        state.currentUser.isLoggedIn = false;
        localStorage.removeItem('yls_user_logged_in');
        localStorage.removeItem('yls_user_name');
        localStorage.removeItem('yls_last_view');
        // 로그아웃 시 로컬 검사 기록 및 휴지통 초기화 (다음 사용자 로그인 시 섞이지 않도록)
        localStorage.removeItem('yls_lfa_history');
        localStorage.removeItem('yls_lfa_trash');
        clearInterval(state.countdownInterval);
        state.countdownInterval = null;
        state.countdownRemaining = 0;
        if (el.displayMin) el.displayMin.textContent = '--';
        if (el.displaySec) el.displaySec.textContent = '--';
        if (el.inputUsername) el.inputUsername.value = '';
        if (el.inputPassword) el.inputPassword.value = '';
        clearLoginError();
        if (el.userSettingsPopup) el.userSettingsPopup.classList.add('hidden');
        navigateTo('login');
    }
    if (el.btnSettingsMenu) el.btnSettingsMenu.addEventListener('click', openUserSettings);
    if (el.btnUserSettingsClose) el.btnUserSettingsClose.addEventListener('click', closeUserSettings);
    if (el.btnUserSettingsCancel) el.btnUserSettingsCancel.addEventListener('click', closeUserSettings);
    if (el.btnUserSettingsSave) el.btnUserSettingsSave.addEventListener('click', savePasswordChange);
    if (el.btnUserSettingsLogout) el.btnUserSettingsLogout.addEventListener('click', doLogout);
    if (el.userSettingsPopup) el.userSettingsPopup.addEventListener('click', e => {
        if (e.target === el.userSettingsPopup) closeUserSettings();
    });
    [el.inputCurrentPassword, el.inputNewPassword2, el.inputNewPasswordConfirm2].forEach(inp => {
        if (inp) inp.addEventListener('keydown', e => {
            if (e.key === 'Enter' && el.btnUserSettingsSave) el.btnUserSettingsSave.click();
        });
    });

    if (el.btnViewResults) {
        el.btnViewResults.addEventListener('click', () => {
            navigateTo('results');
            loadAndRenderResultsTable();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // TIME SETTING & COUNTDOWN
    // ─────────────────────────────────────────────────────────────
    function startCountdown(totalSec) {
        clearInterval(state.countdownInterval);
        state.countdownRemaining = totalSec;
        renderCountdown();

        state.countdownInterval = setInterval(() => {
            state.countdownRemaining--;
            renderCountdown();
            if (state.countdownRemaining <= 0) {
                clearInterval(state.countdownInterval);
                state.countdownInterval = null;
                if (state.activeView === 'view-timesetting') {
                    navigateTo('camera');
                }
            }
        }, 1000);
    }

    function renderCountdown() {
        const rem = Math.max(0, state.countdownRemaining);
        const m = Math.floor(rem / 60);
        const s = rem % 60;
        if (el.displayMin) el.displayMin.textContent = String(m).padStart(2, '0');
        if (el.displaySec) el.displaySec.textContent = String(s).padStart(2, '0');
    }

    if (el.btnTimesetOk) {
        el.btnTimesetOk.addEventListener('click', () => {
            const min = parseInt(el.inputWaitMin?.value) || 0;
            const sec = parseInt(el.inputWaitSec?.value) || 0;
            const total = min * 60 + sec;
            if (total <= 0) { showToast('대기 시간을 입력하세요.'); return; }
            startCountdown(total);
        });
    }

    if (el.btnGoCamera) {
        el.btnGoCamera.addEventListener('click', () => {
            clearInterval(state.countdownInterval);
            state.countdownInterval = null;
            navigateTo('camera');
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CAMERA & PINCH ZOOM CONTROL
    // ─────────────────────────────────────────────────────────────
    async function getBestMainCameraDeviceId() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            if (videoDevices.length <= 1) return null;

            const backCameras = videoDevices.filter(d => {
                const label = (d.label || '').toLowerCase();
                return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('후면');
            });

            const candidateList = backCameras.length > 0 ? backCameras : videoDevices;

            let bestDevice = null;
            let bestScore = -999;

            candidateList.forEach(dev => {
                const label = (dev.label || '').toLowerCase();
                let score = 0;

                if (label.includes('ultra') || label.includes('0.5') || label.includes('0.6') || label.includes('super wide')) {
                    score -= 50;
                }
                if (label.includes('macro') || label.includes('depth')) {
                    score -= 30;
                }
                if (label.includes('tele') || label.includes('zoom') || label.includes('3x') || label.includes('5x') || label.includes('10x')) {
                    score -= 20;
                }

                if (label.includes('main') || label.includes('primary') || label.includes('standard') || label.includes('1x') || label.includes('기본')) {
                    score += 50;
                }
                if (label.includes('wide') && !label.includes('ultra') && !label.includes('super')) {
                    score += 20;
                }
                if (label.includes('camera 0') || label.includes('camera2 0') || label.includes('0, facing back')) {
                    score += 15;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestDevice = dev;
                }
            });

            return bestDevice ? bestDevice.deviceId : null;
        } catch (e) {
            console.warn('Device enumeration error:', e);
            return null;
        }
    }

    async function applyCameraZoom(zoomLevel) {
        state.currentZoom = Math.max(state.minZoom, Math.min(state.maxZoom, zoomLevel));

        if (state.stream) {
            const track = state.stream.getVideoTracks()[0];
            if (track && typeof track.applyConstraints === 'function') {
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    if (caps.zoom) {
                        const targetZoom = Math.max(caps.zoom.min || 1, Math.min(state.currentZoom, caps.zoom.max || 1));
                        await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
                        return;
                    }
                } catch (e) {
                    console.warn('Hardware zoom apply failed:', e);
                }
            }
        }

        // Hardware Zoom 미지원 디바이스 - CSS Transform 확대 Fallback
        if (el.cameraVideo) {
            el.cameraVideo.style.transform = `scale(${state.currentZoom})`;
            el.cameraVideo.style.transformOrigin = 'center center';
        }
    }

    async function startCamera() {
        try {
            stopCamera();
            state.currentZoom = 1.0;

            let targetDeviceId = await getBestMainCameraDeviceId();

            let videoConstraints = {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920, min: 1280 },
                height: { ideal: 1080, min: 720 }
            };

            if (targetDeviceId) {
                videoConstraints.deviceId = { exact: targetDeviceId };
            }

            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
            } catch (deviceErr) {
                console.warn('Target camera failed, fallback to general environment camera:', deviceErr);
                videoConstraints = {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 }
                };
                stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
            }

            if (!targetDeviceId && navigator.mediaDevices.enumerateDevices) {
                const refreshedDeviceId = await getBestMainCameraDeviceId();
                if (refreshedDeviceId) {
                    try {
                        const newStream = await navigator.mediaDevices.getUserMedia({
                            video: { deviceId: { exact: refreshedDeviceId }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } },
                            audio: false
                        });
                        stream.getTracks().forEach(t => t.stop());
                        stream = newStream;
                    } catch (_) { }
                }
            }

            state.stream = stream;
            if (el.cameraVideo) {
                el.cameraVideo.srcObject = stream;
                el.cameraVideo.style.transform = 'scale(1.0)';
                await el.cameraVideo.play();
            }

            const track = stream.getVideoTracks()[0];
            if (track && typeof track.getCapabilities === 'function') {
                const caps = track.getCapabilities();
                if (caps.zoom) {
                    state.minZoom = caps.zoom.min || 1.0;
                    state.maxZoom = caps.zoom.max || 5.0;
                }
            }

            if (track && typeof track.applyConstraints === 'function') {
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    const adv = [{ focusMode: 'continuous' }];

                    if (caps.zoom) {
                        adv[0].zoom = state.minZoom;
                    }
                    await track.applyConstraints({ advanced: adv });
                } catch (_) { }
            }
        } catch (err) {
            console.warn('Camera access error:', err);
        }
    }

    function stopCamera() {
        if (state.stream) {
            state.stream.getTracks().forEach(t => t.stop());
            state.stream = null;
        }
    }

    // 두 손가락 터치(Pinch Gesture) 확대/축소 이벤트 핸들러
    if (el.cameraContainer) {
        const getTouchDistance = (e) => {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        };

        el.cameraContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                state.pinchStartDist = getTouchDistance(e);
                state.pinchStartZoom = state.currentZoom;
            }
        }, { passive: true });

        el.cameraContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && state.pinchStartDist > 0) {
                const dist = getTouchDistance(e);
                const factor = dist / state.pinchStartDist;
                const newZoom = state.pinchStartZoom * factor;
                applyCameraZoom(newZoom);
            }
        }, { passive: true });

        el.cameraContainer.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                state.pinchStartDist = 0;
            }
        }, { passive: true });
    }

    function updateCameraGuide() {
        const container = document.querySelector('.camera-container');
        if (!container) return;
        const W = container.offsetWidth;
        const H = container.offsetHeight;

        const fW = Math.round(W / 3);
        const fH = Math.round(fW * 3.5);
        const fTop = Math.round(fW / 2);
        const fLeft = Math.round((W - fW) / 2);

        const sW = Math.round(fW / 3);
        const sH = Math.round(fW * 2 / 3);
        const sLeft = Math.round((fW - sW) / 2);
        const sTop = Math.round(fW * 4 / 3);

        const wDiam = sW;
        const wTop = Math.round(fH - fW / 2 - wDiam / 2);
        const wLeft = Math.round((fW - wDiam) / 2);

        const frame = document.getElementById('guide-kit-frame');
        const strip = document.querySelector('.guide-window-cutout');
        const well = document.querySelector('.guide-sample-well');

        applyStyle(frame, { width: fW + 'px', height: fH + 'px', top: fTop + 'px', left: fLeft + 'px', transform: 'none' });
        applyStyle(strip, { width: sW + 'px', height: sH + 'px', left: sLeft + 'px', top: sTop + 'px', transform: 'none' });
        applyStyle(well, { width: wDiam + 'px', height: wDiam + 'px', left: wLeft + 'px', top: wTop + 'px', transform: 'none' });

        const cFrame = document.getElementById('confirm-kit-frame');
        const cWin = document.getElementById('confirm-guide-window');
        const cWell = document.getElementById('confirm-guide-well');
        applyStyle(cFrame, { width: fW + 'px', height: fH + 'px', top: fTop + 'px', left: fLeft + 'px', transform: 'none' });
        applyStyle(cWin, { width: sW + 'px', height: sH + 'px', left: sLeft + 'px', top: sTop + 'px', transform: 'none' });
        applyStyle(cWell, { width: wDiam + 'px', height: wDiam + 'px', left: wLeft + 'px', top: wTop + 'px', transform: 'none' });

        state.guideMetrics = { fW, fH, fTop, fLeft, sW, sH, sLeft, sTop, wDiam, wTop, wLeft };
    }

    function applyStyle(el, styles) {
        if (!el) return;
        Object.assign(el.style, styles);
    }

    // ─────────────────────────────────────────────────────────────
    // Burst-average capture: grabs several frames in rapid succession and
    // pixel-averages them BEFORE any analysis. Random camera sensor/read noise
    // averages down by roughly sqrt(N) across N frames, while the real strip
    // image (line included) stays the same — so a faint T-line that sits just
    // below the noise floor in any single frame becomes reliably visible in
    // the averaged image. This is a hardware-level SNR improvement that no
    // amount of post-processing on one photo alone can recover, and it works
    // silently in the background during the normal capture button press.
    // ─────────────────────────────────────────────────────────────
    const BURST_FRAME_COUNT = 6;
    const BURST_INTERVAL_MS = 30; // total burst window ~150-180ms — short enough that normal hand tremor is sub-pixel

    function grabZoomAdjustedFrame(ctx, vw, vh) {
        if (state.currentZoom > 1.0) {
            const cropW = vw / state.currentZoom;
            const cropH = vh / state.currentZoom;
            const cropX = (vw - cropW) / 2;
            const cropY = (vh - cropH) / 2;
            ctx.drawImage(el.cameraVideo, cropX, cropY, cropW, cropH, 0, 0, vw, vh);
        } else {
            ctx.drawImage(el.cameraVideo, 0, 0, vw, vh);
        }
    }

    async function captureBurstAveragedCanvas() {
        const vw = el.cameraVideo.videoWidth;
        const vh = el.cameraVideo.videoHeight;

        const grabCanvas = document.createElement('canvas');
        grabCanvas.width = vw;
        grabCanvas.height = vh;
        const grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true });

        const accum = new Float64Array(vw * vh * 3); // R,G,B sums (skip alpha)
        let framesGrabbed = 0;

        for (let f = 0; f < BURST_FRAME_COUNT; f++) {
            grabZoomAdjustedFrame(grabCtx, vw, vh);
            const frame = grabCtx.getImageData(0, 0, vw, vh).data;
            for (let i = 0, p = 0; i < frame.length; i += 4, p += 3) {
                accum[p] += frame[i];
                accum[p + 1] += frame[i + 1];
                accum[p + 2] += frame[i + 2];
            }
            framesGrabbed++;
            if (f < BURST_FRAME_COUNT - 1) {
                await new Promise(resolve => setTimeout(resolve, BURST_INTERVAL_MS));
            }
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = vw;
        outCanvas.height = vh;
        const outCtx = outCanvas.getContext('2d');
        const outImgData = outCtx.createImageData(vw, vh);
        for (let i = 0, p = 0; i < outImgData.data.length; i += 4, p += 3) {
            outImgData.data[i] = accum[p] / framesGrabbed;
            outImgData.data[i + 1] = accum[p + 1] / framesGrabbed;
            outImgData.data[i + 2] = accum[p + 2] / framesGrabbed;
            outImgData.data[i + 3] = 255;
        }
        outCtx.putImageData(outImgData, 0, 0);
        return outCanvas;
    }

    if (el.btnCapture) {
        el.btnCapture.addEventListener('click', async () => {
            let canvas;

            if (state.stream && el.cameraVideo && el.cameraVideo.videoWidth > 0) {
                const originalLabel = el.btnCapture.textContent;
                el.btnCapture.disabled = true;
                el.btnCapture.textContent = '촬영 중...';
                const instructionEl = document.querySelector('.guide-instruction-text');
                const originalInstruction = instructionEl ? instructionEl.textContent : null;
                if (instructionEl) instructionEl.textContent = '움직이지 마세요 (노이즈 제거 중)';

                try {
                    canvas = await captureBurstAveragedCanvas();
                } finally {
                    el.btnCapture.disabled = false;
                    el.btnCapture.textContent = originalLabel;
                    if (instructionEl && originalInstruction !== null) instructionEl.textContent = originalInstruction;
                }
            } else if (typeof LFATestSamples !== 'undefined' && LFATestSamples.createSyntheticKit) {
                canvas = LFATestSamples.createSyntheticKit({ cLine: 0.88, tLine: 0.45, noise: 0.02 });
            } else {
                canvas = document.createElement('canvas');
                canvas.width = 480; canvas.height = 1440;
            }

            state.capturedCanvas = canvas;

            if (el.confirmCanvas) {
                el.confirmCanvas.width = canvas.width;
                el.confirmCanvas.height = canvas.height;
                el.confirmCanvas.getContext('2d').drawImage(canvas, 0, 0);
            }
            navigateTo('confirm');
        });
    }

    function cropStripFromCapturedCanvas() {
        if (!state.capturedCanvas) return null;
        const srcCanvas = state.capturedCanvas;
        const imgW = srcCanvas.width;
        const imgH = srcCanvas.height;

        const contEl = document.querySelector('.confirm-photo-area') ||
            document.querySelector('.camera-container') ||
            document.body;
        const winEl = document.getElementById('confirm-guide-window') ||
            document.querySelector('.guide-window-cutout');

        const rectCont = contEl ? contEl.getBoundingClientRect() : { left: 0, top: 0, width: 360, height: 640 };
        const rectWin = winEl ? winEl.getBoundingClientRect() : null;

        const dispW = rectCont.width || 360;
        const dispH = rectCont.height || 640;

        let winX, winY, winW, winH;

        if (rectWin && rectWin.width > 0 && rectWin.height > 0) {
            winX = rectWin.left - rectCont.left;
            winY = rectWin.top - rectCont.top;
            winW = rectWin.width;
            winH = rectWin.height;
        } else {
            const fW = Math.round(dispW / 3);
            const fTop = Math.round(fW / 2);
            const fLeft = Math.round((dispW - fW) / 2);
            winW = Math.round(fW / 3);
            winH = Math.round(fW * 2 / 3);
            winX = fLeft + Math.round((fW - winW) / 2);
            winY = fTop + Math.round(fW * 4 / 3);
        }

        const scale = Math.max(dispW / imgW, dispH / imgH);
        const renderW = imgW * scale;
        const renderH = imgH * scale;
        const offsetX = (dispW - renderW) / 2;
        const offsetY = (dispH - renderH) / 2;

        let realX = Math.round((winX - offsetX) / scale);
        let realY = Math.round((winY - offsetY) / scale);
        let realW = Math.round(winW / scale);
        let realH = Math.round(winH / scale);

        realX = Math.max(0, Math.min(imgW - 10, realX));
        realY = Math.max(0, Math.min(imgH - 10, realY));
        realW = Math.max(10, Math.min(imgW - realX, realW));
        realH = Math.max(10, Math.min(imgH - realY, realH));

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = realW;
        cropCanvas.height = realH;
        const cCtx = cropCanvas.getContext('2d');
        cCtx.drawImage(srcCanvas, realX, realY, realW, realH, 0, 0, realW, realH);

        return cropCanvas;
    }

    if (el.btnBackFromCamera) {
        el.btnBackFromCamera.addEventListener('click', () => {
            stopCamera();
            navigateTo('timesetting');
        });
    }

    if (el.btnBackFromConfirm) {
        el.btnBackFromConfirm.addEventListener('click', () => {
            state.capturedCanvas = null;
            navigateTo('camera');
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CONFIRM SCREEN
    // ─────────────────────────────────────────────────────────────
    if (el.btnConfirmNo) {
        el.btnConfirmNo.addEventListener('click', () => {
            state.capturedCanvas = null;
            navigateTo('camera');
        });
    }

    if (el.btnConfirmYes) {
        el.btnConfirmYes.addEventListener('click', async () => {
            if (!state.capturedCanvas) { navigateTo('camera'); return; }

            if (el.analyzingOverlay) el.analyzingOverlay.classList.add('active');

            try {
                if (!state.analyzer) state.analyzer = new LFAAnalyzer();

                const croppedStrip = cropStripFromCapturedCanvas() || state.capturedCanvas;

                const result = await state.analyzer.analyze(croppedStrip, { isPreCropped: true });
                if (result.visualData) {
                    result.visualData.stripCanvas = croppedStrip;
                    result.visualData.previewCanvas = croppedStrip;
                }
                state.lastAnalysisResult = result;

                const savedRecord = saveResultRecord(result, croppedStrip);

                try {
                    const cropUrl = savedRecord?.cropImageDataUrl || croppedStrip.toDataURL('image/jpeg', 0.85);
                    if (state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                        state.sheetsSync.syncResult(
                            result,
                            state.currentUser,
                            savedRecord?.memo || '',
                            savedRecord?.cropFilename || '',
                            cropUrl,
                            savedRecord?.timestamp || null
                        ).catch(e => console.warn('Sheets sync:', e));
                    }
                } catch (e) {
                    console.warn('Sheets sync error:', e);
                }

                navigateTo('results');
                if (savedRecord) {
                    showGraphPopup(savedRecord);
                }
            } catch (err) {
                console.error('Analysis error:', err);
                showToast('분석 중 오류가 발생했습니다.');
                navigateTo('results');
            } finally {
                if (el.analyzingOverlay) el.analyzingOverlay.classList.remove('active');
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // RESULTS & HISTORY
    // ─────────────────────────────────────────────────────────────
    function parseRecordDate(ts) {
        if (!ts) return 0;
        const str = String(ts).trim();
        const m = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
        if (m) {
            return new Date(
                parseInt(m[1], 10),
                parseInt(m[2], 10) - 1,
                parseInt(m[3], 10),
                parseInt(m[4], 10),
                parseInt(m[5], 10),
                m[6] ? parseInt(m[6], 10) : 0
            ).getTime();
        }
        const d = new Date(str.replace(/\./g, '-'));
        return !isNaN(d.getTime()) ? d.getTime() : 0;
    }

    function sortHistoryByDateDesc(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.slice().sort((a, b) => {
            const timeA = parseRecordDate(a.timestamp || a.ts);
            const timeB = parseRecordDate(b.timestamp || b.ts);
            return timeB - timeA;
        });
    }

    function saveResultRecord(analysis, croppedCanvas = null) {
        if (!analysis || !analysis.diagnosis) return null;
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const diag = analysis.diagnosis;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const fileTimestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const fname = `${state.currentUser.username}_${fileTimestamp}.jpg`;

        let cropDataUrl = null;
        try {
            const sc = croppedCanvas || analysis.visualData?.stripCanvas || analysis.visualData?.previewCanvas;
            if (sc) cropDataUrl = sc.toDataURL('image/jpeg', 0.85);
        } catch (_) { }

        let profileData = null;
        try {
            const vd = analysis.visualData;
            if (vd?.correctedProfile) {
                profileData = {
                    corrected: Array.from(vd.correctedProfile),
                    cLineIndex: vd.cLineIndex,
                    tLineIndex: vd.tLineIndex,
                    cLineDetected: vd.cLineDetected,
                    tLineDetected: vd.tLineDetected,
                    cLineRange: vd.cLineRange,
                    tLineRange: vd.tLineRange
                };
            }
        } catch (_) { }

        const record = {
            id: 'REC_' + Date.now(),
            timestamp: ts,
            result: diag.result || '실패',
            concentrationStr: diag.result === '양성' ? (diag.concentrationStr || '0.01') : '-',
            userNickname: state.currentUser.username,
            memo: '',
            cropImageDataUrl: cropDataUrl,
            cropFilename: fname,
            profileData,
            metrics: analysis.metrics || null,
            confidence: diag.confidence || null
        };

        history.push(record);
        const sorted = sortHistoryByDateDesc(history);
        if (sorted.length > 100) sorted.pop();
        localStorage.setItem('yls_lfa_history', JSON.stringify(sorted));
        return record;
    }

    function resolveImageUrl(url) {
        if (!url) return null;
        if (url.startsWith('data:image/')) return url;

        let fileId = null;
        const match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match1) fileId = match1[1];
        const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (match2) fileId = match2[1];

        if (fileId) {
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
        }
        return url;
    }

    async function loadAndRenderResultsTable() {
        renderResultsTable();
        updateTrashBadge();

        if (state.sheetsSync && typeof state.sheetsSync.fetchResults === 'function') {
            try {
                // 현재 로그인 사용자의 결과만 서버에서 가져옴
                const currentUser = state.currentUser.username;
                const res = await state.sheetsSync.fetchResults(currentUser);
                if (res && res.success) {
                    if (Array.isArray(res.data) && res.data.length > 0) {
                        // 서버 응답에서 혹시 다른 사용자 데이터가 섞이지 않도록 클라이언트에서도 재확인
                        const filtered = res.data.filter(r =>
                            !r.userNickname || r.userNickname === currentUser
                        );
                        const sorted = sortHistoryByDateDesc(filtered);
                        localStorage.setItem('yls_lfa_history', JSON.stringify(sorted));
                    } else if (Array.isArray(res.data) && res.data.length === 0) {
                        // 서버에 이 사용자의 결과가 없으면 로컬도 초기화
                        localStorage.setItem('yls_lfa_history', JSON.stringify([]));
                    }
                    if (Array.isArray(res.trash)) {
                        // 휴지통도 현재 사용자 것만 필터링
                        const filteredTrash = res.trash.filter(r =>
                            !r.userNickname || r.userNickname === currentUser
                        );
                        localStorage.setItem('yls_lfa_trash', JSON.stringify(filteredTrash));
                        updateTrashBadge();
                    }
                    renderResultsTable();
                }
            } catch (err) {
                console.warn('Failed to fetch latest records from server:', err);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TRASH & SELECTION MANAGEMENT (휴지통 및 7일 자동 삭제 & 복원)
    // ─────────────────────────────────────────────────────────────
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    /**
     * 7일이 경과한 휴지통 항목을 자동 영구 삭제합니다.
     */
    function cleanupExpiredTrash() {
        try {
            const currentUser = state.currentUser.username;
            const raw = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
            const now = Date.now();
            // 7일 경과 제거 + 현재 사용자 것만 반환
            const valid = raw.filter(item => {
                const delTime = item.deletedAt ? new Date(item.deletedAt).getTime() : 0;
                return (now - delTime) < SEVEN_DAYS_MS;
            });
            if (valid.length !== raw.length) {
                localStorage.setItem('yls_lfa_trash', JSON.stringify(valid));
            }
            // 현재 로그인 사용자의 휴지통 항목만 반환
            return valid.filter(item =>
                !item.userNickname || item.userNickname === currentUser
            );
        } catch (e) {
            console.warn('Trash cleanup error:', e);
            return [];
        }
    }

    /**
     * 휴지통 상단 뱃지 숫자 갱신
     */
    function updateTrashBadge() {
        const trash = cleanupExpiredTrash();
        const count = trash.length;
        if (el.trashCountBadge) {
            el.trashCountBadge.textContent = count;
            if (count > 0) {
                el.trashCountBadge.classList.remove('hidden');
            } else {
                el.trashCountBadge.classList.add('hidden');
            }
        }
    }

    function toggleSelectMode() {
        state.isSelectMode = !state.isSelectMode;
        state.selectedRecordIds.clear();
        updateSelectModeUI();
        renderResultsTable();
    }

    function exitSelectMode() {
        state.isSelectMode = false;
        state.selectedRecordIds.clear();
        updateSelectModeUI();
        renderResultsTable();
    }

    function updateSelectModeUI() {
        if (state.isSelectMode) {
            if (el.btnToggleSelect) {
                el.btnToggleSelect.classList.add('active');
                el.btnToggleSelect.textContent = '선택 취소';
            }
            if (el.thCheckbox) el.thCheckbox.classList.remove('hidden');
            if (el.resultsSelectActions) el.resultsSelectActions.classList.remove('hidden');
            if (el.btnExportCsv) el.btnExportCsv.classList.add('hidden');
            if (el.checkAllResults) el.checkAllResults.checked = false;
            updateDeleteButtonState();
        } else {
            if (el.btnToggleSelect) {
                el.btnToggleSelect.classList.remove('active');
                el.btnToggleSelect.textContent = '선택';
            }
            if (el.thCheckbox) el.thCheckbox.classList.add('hidden');
            if (el.resultsSelectActions) el.resultsSelectActions.classList.add('hidden');
            if (el.btnExportCsv) el.btnExportCsv.classList.remove('hidden');
        }
    }

    function updateDeleteButtonState() {
        const count = state.selectedRecordIds.size;
        if (el.btnDeleteSelected) {
            el.btnDeleteSelected.disabled = (count === 0);
            el.btnDeleteSelected.textContent = `🗑️ 삭제 (${count})`;
        }
    }

    function renderResultsTable() {
        const tbody = el.resultsBody;
        if (!tbody) return;

        const currentUser = state.currentUser.username;
        if (el.resultUserId) el.resultUserId.textContent = currentUser;
        updateTrashBadge();

        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        // 현재 로그인 사용자의 기록만 표시 (로컬에 혼재된 경우 방어적 필터)
        const userHistory = rawHistory.filter(r =>
            !r.userNickname || r.userNickname === currentUser
        );
        const history = sortHistoryByDateDesc(userHistory);
        const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
        if (state.currentPage > totalPages) state.currentPage = totalPages;

        const start = (state.currentPage - 1) * PAGE_SIZE;
        const items = history.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = '';

        if (history.length === 0) {
            const colspan = state.isSelectMode ? 5 : 4;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-msg">검사 기록이 없습니다.</td></tr>`;
            renderPagination(totalPages);
            return;
        }

        // 전체 선택 체크박스 상태 동기화
        if (state.isSelectMode && el.checkAllResults) {
            const allChecked = items.length > 0 && items.every(r => state.selectedRecordIds.has(r.id));
            el.checkAllResults.checked = allChecked;
        }

        items.forEach(rec => {
            const tr = document.createElement('tr');
            const isChecked = state.selectedRecordIds.has(rec.id);

            let cls = 'col-negative', label = '음성', val = '-';
            if (rec.result === '양성' || rec.result === 'positive') {
                cls = 'col-positive'; label = '양성';
                val = (rec.concentrationStr && rec.concentrationStr !== '-') ? rec.concentrationStr : '0.01';
            } else if (rec.result === '실패' || rec.result === 'fail') {
                cls = 'col-fail'; label = '실패';
            }

            const hasMemo = !!(rec.memo && String(rec.memo).trim());
            const memoLabel = hasMemo ? '보기' : '';

            let checkHtml = '';
            if (state.isSelectMode) {
                checkHtml = `<td class="col-checkbox-td"><input type="checkbox" class="result-row-check" data-id="${rec.id}" ${isChecked ? 'checked' : ''}></td>`;
            }

            tr.innerHTML = `
                ${checkHtml}
                <td class="col-date">${rec.timestamp || '-'}</td>
                <td class="${cls}">${label}</td>
                <td>${val}</td>
                <td><span class="memo-cell${hasMemo ? ' has-memo' : ''}" data-id="${rec.id}">${memoLabel}</span></td>
            `;

            tr.addEventListener('click', e => {
                if (e.target.classList.contains('memo-cell')) return;

                if (state.isSelectMode) {
                    // 선택 모드: 행 클릭 시 체크박스 토글
                    const chk = tr.querySelector('.result-row-check');
                    const willCheck = !state.selectedRecordIds.has(rec.id);
                    if (willCheck) {
                        state.selectedRecordIds.add(rec.id);
                    } else {
                        state.selectedRecordIds.delete(rec.id);
                    }
                    if (chk) chk.checked = willCheck;
                    updateDeleteButtonState();

                    if (el.checkAllResults) {
                        el.checkAllResults.checked = items.every(r => state.selectedRecordIds.has(r.id));
                    }
                } else {
                    // 일반 모드: 상세 분석 그래프 팝업 오픈
                    showGraphPopup(rec);
                }
            });

            // 체크박스 직접 클릭 시 이벤트 전파 방지 및 상태 처리
            const rowCheckbox = tr.querySelector('.result-row-check');
            if (rowCheckbox) {
                rowCheckbox.addEventListener('click', e => {
                    e.stopPropagation();
                    if (rowCheckbox.checked) {
                        state.selectedRecordIds.add(rec.id);
                    } else {
                        state.selectedRecordIds.delete(rec.id);
                    }
                    updateDeleteButtonState();
                    if (el.checkAllResults) {
                        el.checkAllResults.checked = items.every(r => state.selectedRecordIds.has(r.id));
                    }
                });
            }

            const memoSpan = tr.querySelector('.memo-cell');
            if (memoSpan) {
                memoSpan.addEventListener('click', e => {
                    e.stopPropagation();
                    openMemoPopup(rec.id);
                });
            }

            tbody.appendChild(tr);
        });

        renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
        const container = document.getElementById('results-pagination');
        if (!container) return;
        container.innerHTML = '';
        if (totalPages <= 1) return;

        const maxBtn = 5;
        const half = Math.floor(maxBtn / 2);
        let pStart = Math.max(1, state.currentPage - half);
        let pEnd = Math.min(totalPages, pStart + maxBtn - 1);
        if (pEnd - pStart < maxBtn - 1) pStart = Math.max(1, pEnd - maxBtn + 1);

        for (let p = pStart; p <= pEnd; p++) {
            const btn = document.createElement('button');
            btn.className = 'page-btn' + (p === state.currentPage ? ' active' : '');
            btn.textContent = p;
            btn.addEventListener('click', () => { state.currentPage = p; renderResultsTable(); });
            container.appendChild(btn);
        }
        if (state.currentPage < totalPages) {
            const nxt = document.createElement('button');
            nxt.className = 'page-btn';
            nxt.textContent = '>';
            nxt.addEventListener('click', () => {
                state.currentPage = Math.min(totalPages, state.currentPage + 1);
                renderResultsTable();
            });
            container.appendChild(nxt);
        }
    }

    if (el.btnReturnHome) {
        el.btnReturnHome.addEventListener('click', () => {
            exitSelectMode();
            navigateTo('timesetting');
        });
    }

    // ─────────────────────────────────────────────────────────────
    // TRASH & SELECTION EVENT HANDLERS
    // ─────────────────────────────────────────────────────────────
    if (el.btnToggleSelect) {
        el.btnToggleSelect.addEventListener('click', toggleSelectMode);
    }

    if (el.btnCancelSelect) {
        el.btnCancelSelect.addEventListener('click', exitSelectMode);
    }

    if (el.checkAllResults) {
        el.checkAllResults.addEventListener('change', () => {
            const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
            const history = sortHistoryByDateDesc(rawHistory);
            const start = (state.currentPage - 1) * PAGE_SIZE;
            const items = history.slice(start, start + PAGE_SIZE);

            if (el.checkAllResults.checked) {
                items.forEach(r => state.selectedRecordIds.add(r.id));
            } else {
                items.forEach(r => state.selectedRecordIds.delete(r.id));
            }
            updateDeleteButtonState();
            renderResultsTable();
        });
    }

    function openDeleteConfirmPopup() {
        const count = state.selectedRecordIds.size;
        if (count === 0) return;
        if (el.deleteConfirmMsg) {
            el.deleteConfirmMsg.textContent = `선택한 ${count}개의 검사 결과를 휴지통으로 이동하시겠습니까?`;
        }
        if (el.deleteConfirmPopup) el.deleteConfirmPopup.classList.remove('hidden');
    }

    function closeDeleteConfirmPopup() {
        if (el.deleteConfirmPopup) el.deleteConfirmPopup.classList.add('hidden');
    }

    function confirmDeleteRecords() {
        const selectedIds = new Set(state.selectedRecordIds);
        const count = selectedIds.size;
        if (count === 0) return;

        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const trash = cleanupExpiredTrash();

        const remainingHistory = [];
        const movedToTrash = [];
        const nowIso = new Date().toISOString();

        rawHistory.forEach(rec => {
            if (selectedIds.has(rec.id)) {
                movedToTrash.push({
                    ...rec,
                    deletedAt: nowIso
                });
            } else {
                remainingHistory.push(rec);
            }
        });

        // 1. 로컬 저장소 갱신
        localStorage.setItem('yls_lfa_history', JSON.stringify(remainingHistory));
        localStorage.setItem('yls_lfa_trash', JSON.stringify([...movedToTrash, ...trash]));

        // 2. 서버 동기화 (휴지통 이동)
        if (state.sheetsSync && typeof state.sheetsSync.moveToTrash === 'function') {
            state.sheetsSync.moveToTrash(movedToTrash).catch(err => {
                console.warn('Server trash sync error:', err);
            });
        }

        closeDeleteConfirmPopup();
        exitSelectMode();
        updateTrashBadge();
        renderResultsTable();

        showToast(`선택한 ${count}개의 검사 결과가 휴지통으로 이동되었습니다.`);
    }

    if (el.btnDeleteSelected) {
        el.btnDeleteSelected.addEventListener('click', openDeleteConfirmPopup);
    }
    if (el.btnDeleteCancel) {
        el.btnDeleteCancel.addEventListener('click', closeDeleteConfirmPopup);
    }
    if (el.btnDeleteConfirm) {
        el.btnDeleteConfirm.addEventListener('click', confirmDeleteRecords);
    }
    if (el.deleteConfirmPopup) {
        el.deleteConfirmPopup.addEventListener('click', e => {
            if (e.target === el.deleteConfirmPopup) closeDeleteConfirmPopup();
        });
    }

    // ── Trash Popup Logic ──
    async function openTrashPopup() {
        // 1. 기존 로컬 데이터를 즉시 표시 (지연 없는 쾌속 UX)
        renderTrashList();
        if (el.trashPopup) el.trashPopup.classList.remove('hidden');

        // 2. 서버 휴지통과 실시간 동기화하여 최신 삭제 목록 반영
        if (state.sheetsSync && typeof state.sheetsSync.fetchTrash === 'function') {
            try {
                const currentUser = state.currentUser.username;
                const res = await state.sheetsSync.fetchTrash(currentUser);
                if (res && res.success && Array.isArray(res.data)) {
                    // 현재 사용자의 휴지통 항목만 필터링
                    const filteredTrash = res.data.filter(r =>
                        !r.userNickname || r.userNickname === currentUser
                    );
                    // 다른 사용자의 기존 로컬 휴지통 데이터 보존
                    const existingTrash = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
                    const otherUsersTrash = existingTrash.filter(r =>
                        currentUser && r.userNickname && r.userNickname !== currentUser
                    );
                    localStorage.setItem('yls_lfa_trash', JSON.stringify([...filteredTrash, ...otherUsersTrash]));
                    renderTrashList();
                }
            } catch (err) {
                console.warn('Failed to sync trash from server:', err);
            }
        }
    }

    function closeTrashPopup() {
        if (el.trashPopup) el.trashPopup.classList.add('hidden');
    }

    function renderTrashList() {
        if (!el.trashListContainer) return;
        const trash = cleanupExpiredTrash();
        const total = trash.length;

        if (el.trashTotalCount) {
            el.trashTotalCount.textContent = `${total}건`;
        }
        updateTrashBadge();

        if (total === 0) {
            el.trashListContainer.innerHTML = '<div class="trash-empty-state">휴지통이 비어 있습니다.</div>';
            if (el.btnTrashRestoreAll) el.btnTrashRestoreAll.disabled = true;
            if (el.btnTrashEmpty) el.btnTrashEmpty.disabled = true;
            return;
        }

        if (el.btnTrashRestoreAll) el.btnTrashRestoreAll.disabled = false;
        if (el.btnTrashEmpty) el.btnTrashEmpty.disabled = false;

        const now = Date.now();
        el.trashListContainer.innerHTML = '';

        trash.forEach(rec => {
            const delTime = rec.deletedAt ? new Date(rec.deletedAt).getTime() : now;
            const elapsedDays = Math.floor((now - delTime) / (24 * 60 * 60 * 1000));
            const daysLeft = Math.max(1, 7 - elapsedDays);

            let badgeCls = 'fail', badgeLabel = '실패';
            if (rec.result === '양성' || rec.result === 'positive') {
                badgeCls = 'positive'; badgeLabel = '양성';
            } else if (rec.result === '음성' || rec.result === 'negative') {
                badgeCls = 'negative'; badgeLabel = '음성';
            }

            const conc = (rec.concentrationStr && rec.concentrationStr !== '-') ? `${rec.concentrationStr} ng/dL` : '-';

            const card = document.createElement('div');
            card.className = 'trash-item-card';
            card.innerHTML = `
                <div class="trash-item-info">
                    <div class="trash-item-header">
                        <span class="trash-item-date">${rec.timestamp || '-'}</span>
                        <span class="trash-badge ${badgeCls}">${badgeLabel}</span>
                    </div>
                    <div class="trash-item-meta">
                        <span>농도: ${conc}</span>
                        <span class="trash-expire-tag">${daysLeft}일 후 영구삭제</span>
                    </div>
                </div>
                <button type="button" class="btn-trash-restore-item" data-id="${rec.id}">복원</button>
            `;

            const btnRestore = card.querySelector('.btn-trash-restore-item');
            if (btnRestore) {
                btnRestore.addEventListener('click', () => {
                    restoreRecordFromTrash(rec.id);
                });
            }

            el.trashListContainer.appendChild(card);
        });
    }

    async function restoreRecordFromTrash(recordId) {
        const trash = cleanupExpiredTrash();
        const targetIdx = trash.findIndex(r => r.id === recordId);
        if (targetIdx < 0) return;

        const restored = { ...trash[targetIdx] };
        delete restored.deletedAt;

        // 휴지통에서 해당 ID만 안전하게 제거 (다른 사용자 항목 보존)
        const rawTrash = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
        const updatedTrash = rawTrash.filter(r => r.id !== recordId);
        localStorage.setItem('yls_lfa_trash', JSON.stringify(updatedTrash));

        // 기존 검사 결과로 복원 (원래 일시분초 그대로 복귀)
        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        rawHistory.push(restored);
        const sorted = sortHistoryByDateDesc(rawHistory);
        localStorage.setItem('yls_lfa_history', JSON.stringify(sorted));

        showToast(`'${restored.timestamp}' 검사 결과가 원래대로 복원되었습니다.`);
        renderTrashList();
        renderResultsTable();

        // 서버 동기화 (복원)
        if (state.sheetsSync && typeof state.sheetsSync.restoreFromTrash === 'function') {
            try {
                await state.sheetsSync.restoreFromTrash(restored);
            } catch (err) {
                console.warn('Server restore sync error:', err);
            }
        }
    }

    async function restoreAllTrash() {
        const trash = cleanupExpiredTrash();
        if (trash.length === 0) return;

        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const restoredItems = trash.map(item => {
            const r = { ...item };
            delete r.deletedAt;
            return r;
        });

        const combined = sortHistoryByDateDesc([...rawHistory, ...restoredItems]);
        localStorage.setItem('yls_lfa_history', JSON.stringify(combined));

        // 현재 사용자의 항목만 로컬 휴지통에서 제거하고, 다른 사용자의 휴지통 항목은 유지
        const currentUser = state.currentUser ? state.currentUser.username : null;
        const rawTrash = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
        const remainingTrash = rawTrash.filter(item =>
            currentUser && item.userNickname && item.userNickname !== currentUser
        );
        localStorage.setItem('yls_lfa_trash', JSON.stringify(remainingTrash));

        showToast(`${restoredItems.length}개의 검사 결과가 모두 복원되었습니다.`);
        renderTrashList();
        renderResultsTable();

        // 서버 동기화
        if (state.sheetsSync && typeof state.sheetsSync.restoreFromTrash === 'function') {
            try {
                await state.sheetsSync.restoreFromTrash(restoredItems);
            } catch (err) {
                console.warn('Server restoreAll sync error:', err);
            }
        }
    }

    async function emptyTrash() {
        const trash = cleanupExpiredTrash();
        if (trash.length === 0) return;

        if (!confirm('휴지통을 비우시겠습니까? 비워진 항목은 영구 삭제되어 다시 복원할 수 없습니다.')) {
            return;
        }

        const currentUser = state.currentUser ? state.currentUser.username : null;
        // 로컬 휴지통에서도 현재 로그인 사용자의 항목만 삭제하고, 다른 사용자의 휴지통 항목은 안전하게 유지
        const rawTrash = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
        const remainingTrash = rawTrash.filter(item =>
            currentUser && item.userNickname && item.userNickname !== currentUser
        );
        localStorage.setItem('yls_lfa_trash', JSON.stringify(remainingTrash));

        showToast('휴지통이 비워졌습니다.');
        renderTrashList();
        renderResultsTable();

        // 서버 휴지통 비우기 동기화 (현재 로그인 사용자만 전달)
        if (state.sheetsSync && typeof state.sheetsSync.emptyTrash === 'function') {
            try {
                await state.sheetsSync.emptyTrash(currentUser);
            } catch (err) {
                console.warn('Server emptyTrash sync error:', err);
            }
        }
    }

    if (el.btnOpenTrash) {
        el.btnOpenTrash.addEventListener('click', openTrashPopup);
    }
    if (el.btnTrashClose) {
        el.btnTrashClose.addEventListener('click', closeTrashPopup);
    }
    if (el.btnTrashCancel) {
        el.btnTrashCancel.addEventListener('click', closeTrashPopup);
    }
    if (el.trashPopup) {
        el.trashPopup.addEventListener('click', e => {
            if (e.target === el.trashPopup) closeTrashPopup();
        });
    }
    if (el.btnTrashRestoreAll) {
        el.btnTrashRestoreAll.addEventListener('click', restoreAllTrash);
    }
    if (el.btnTrashEmpty) {
        el.btnTrashEmpty.addEventListener('click', emptyTrash);
    }

    // ─────────────────────────────────────────────────────────────
    // CSV CALENDAR DATE-RANGE PICKER POPUP (월 달력 다운로드 기간 선택)
    // ─────────────────────────────────────────────────────────────
    const calState = {
        currentYear: new Date().getFullYear(),
        currentMonth: new Date().getMonth(), // 0-11
        startDate: null, // 'YYYY-MM-DD'
        endDate: null,   // 'YYYY-MM-DD'
        step: 0          // 0: ready to pick start, 1: picked start
    };

    function formatLocalDate(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatDisplayDate(dateStr) {
        if (!dateStr) return '-';
        return dateStr.replace(/-/g, '.');
    }

    function openCsvCalendarPopup() {
        const now = new Date();
        calState.currentYear = now.getFullYear();
        calState.currentMonth = now.getMonth();

        // Default to current month range
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        calState.startDate = formatLocalDate(firstDayOfMonth);
        calState.endDate = formatLocalDate(now);
        calState.step = 0;

        renderCalendar();
        if (el.csvCalendarPopup) el.csvCalendarPopup.classList.remove('hidden');
    }

    function closeCsvCalendarPopup() {
        if (el.csvCalendarPopup) el.csvCalendarPopup.classList.add('hidden');
    }

    function renderCalendar() {
        const year = calState.currentYear;
        const month = calState.currentMonth;

        if (el.calMonthTitle) {
            el.calMonthTitle.textContent = `${year}년 ${month + 1}월`;
        }

        if (el.csvRangeStartVal) {
            el.csvRangeStartVal.textContent = formatDisplayDate(calState.startDate);
        }
        if (el.csvRangeEndVal) {
            el.csvRangeEndVal.textContent = formatDisplayDate(calState.endDate);
        }

        const grid = el.calDaysGrid;
        if (!grid) return;
        grid.innerHTML = '';

        const todayStr = formatLocalDate(new Date());

        // First day of month and number of days
        const firstDayIndex = new Date(year, month, 1).getDay(); // 0(Sun) - 6(Sat)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // 1. Previous month trailing days
        for (let i = firstDayIndex - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cal-day-cell other-month';
            btn.textContent = dayNum;
            btn.disabled = true;
            grid.appendChild(btn);
        }

        // 2. Current month days
        const pad = n => String(n).padStart(2, '0');
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cal-day-cell';
            btn.textContent = day;

            if (dateStr === todayStr) {
                btn.classList.add('today');
            }

            const isStart = (dateStr === calState.startDate);
            const isEnd = (dateStr === calState.endDate);
            const isSingle = isStart && isEnd;
            const inRange = (calState.startDate && calState.endDate && 
                             dateStr > calState.startDate && dateStr < calState.endDate);

            if (isSingle) {
                btn.classList.add('selected-start', 'selected-end', 'selected-single');
            } else if (isStart) {
                btn.classList.add('selected-start');
            } else if (isEnd) {
                btn.classList.add('selected-end');
            } else if (inRange) {
                btn.classList.add('in-range');
            }

            btn.addEventListener('click', () => onDayClick(dateStr));
            grid.appendChild(btn);
        }

        // 3. Next month leading days to complete grid rows
        const totalCells = firstDayIndex + daysInMonth;
        const remainingCells = (7 - (totalCells % 7)) % 7;
        for (let day = 1; day <= remainingCells; day++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cal-day-cell other-month';
            btn.textContent = day;
            btn.disabled = true;
            grid.appendChild(btn);
        }
    }

    function onDayClick(dateStr) {
        if (calState.step === 0) {
            // First click: sets start date
            calState.startDate = dateStr;
            calState.endDate = dateStr;
            calState.step = 1;
        } else {
            // Second click: sets end date
            if (dateStr >= calState.startDate) {
                calState.endDate = dateStr;
                calState.step = 0;
            } else {
                // Clicked earlier than start date, so make this the new start date
                calState.startDate = dateStr;
                calState.endDate = dateStr;
                calState.step = 1;
            }
        }
        renderCalendar();
    }

    function applyPreset(preset) {
        const now = new Date();
        const todayStr = formatLocalDate(now);

        if (preset === 'today') {
            calState.startDate = todayStr;
            calState.endDate = todayStr;
            calState.currentYear = now.getFullYear();
            calState.currentMonth = now.getMonth();
        } else if (preset === 'week') {
            const weekAgo = new Date();
            weekAgo.setDate(now.getDate() - 6);
            calState.startDate = formatLocalDate(weekAgo);
            calState.endDate = todayStr;
            calState.currentYear = now.getFullYear();
            calState.currentMonth = now.getMonth();
        } else if (preset === 'month') {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            calState.startDate = formatLocalDate(firstDay);
            calState.endDate = formatLocalDate(lastDay);
            calState.currentYear = now.getFullYear();
            calState.currentMonth = now.getMonth();
        } else if (preset === 'all') {
            const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
            let earliest = '2025-01-01';
            rawHistory.forEach(r => {
                const m = String(r.timestamp || '').match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
                if (m) {
                    const pad = n => String(n).padStart(2, '0');
                    const d = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
                    if (d < earliest || earliest === '2025-01-01') earliest = d;
                }
            });
            calState.startDate = earliest;
            calState.endDate = todayStr;
            calState.currentYear = now.getFullYear();
            calState.currentMonth = now.getMonth();
        }

        calState.step = 0;
        renderCalendar();
    }

    function exportCsvForDateRange() {
        if (!calState.startDate || !calState.endDate) {
            showToast('다운로드할 기간을 선택해주세요.');
            return;
        }

        let start = calState.startDate;
        let end = calState.endDate;
        if (start > end) {
            const temp = start; start = end; end = temp;
        }

        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const pad = n => String(n).padStart(2, '0');

        const filtered = rawHistory.filter(rec => {
            const ts = rec.timestamp || rec.ts || '';
            const m = String(ts).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
            if (!m) return false;
            const recDateStr = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
            return recDateStr >= start && recDateStr <= end;
        });

        if (filtered.length === 0) {
            showToast(`선택한 기간(${start} ~ ${end})의 검사 기록이 없습니다.`);
            return;
        }

        const headers = ['timestamp', 'User_ID', 'C_line', 'T_line', 'result', 'value', 'error', 'Memo', 'Crop_image'];
        const rows = filtered.map(r => [
            `"${r.timestamp || ''}"`,
            `"${r.userNickname || r.User_ID || state.currentUser.username || ''}"`,
            `"${r.cLine || (r.result === '실패' ? 'none' : 'ok')}"`,
            `"${r.tLine || (r.result === '양성' ? 'ok' : 'none')}"`,
            `"${r.resultEnglish || (r.result === '양성' ? 'positive' : r.result === '음성' ? 'negative' : 'fail')}"`,
            `"${r.concentrationStr && r.concentrationStr !== '-' ? r.concentrationStr : (r.result === '양성' ? '0.01' : '')}"`,
            `"${r.error || ''}"`,
            `"${r.memo || ''}"`,
            `"${r.cropUrl || r.cropFilename || ''}"`
        ]);

        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filenameStart = start.replace(/-/g, '');
        const filenameEnd = end.replace(/-/g, '');
        a.download = `LFA_AFP_Test_Results_${filenameStart}_${filenameEnd}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        closeCsvCalendarPopup();
        showToast(`${filtered.length}건의 검사 기록이 다운로드되었습니다.`);
    }

    if (el.btnExportCsv) {
        el.btnExportCsv.addEventListener('click', openCsvCalendarPopup);
    }
    if (el.btnCsvCalClose) el.btnCsvCalClose.addEventListener('click', closeCsvCalendarPopup);
    if (el.btnCsvCalCancel) el.btnCsvCalCancel.addEventListener('click', closeCsvCalendarPopup);
    if (el.btnCsvCalDownload) el.btnCsvCalDownload.addEventListener('click', exportCsvForDateRange);
    if (el.csvCalendarPopup) {
        el.csvCalendarPopup.addEventListener('click', e => {
            if (e.target === el.csvCalendarPopup) closeCsvCalendarPopup();
        });
    }

    if (el.btnCalPrevMonth) {
        el.btnCalPrevMonth.addEventListener('click', () => {
            calState.currentMonth--;
            if (calState.currentMonth < 0) {
                calState.currentMonth = 11;
                calState.currentYear--;
            }
            renderCalendar();
        });
    }

    if (el.btnCalNextMonth) {
        el.btnCalNextMonth.addEventListener('click', () => {
            calState.currentMonth++;
            if (calState.currentMonth > 11) {
                calState.currentMonth = 0;
                calState.currentYear++;
            }
            renderCalendar();
        });
    }

    document.querySelectorAll('.cal-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            if (preset) applyPreset(preset);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // MEMO POPUP
    // ─────────────────────────────────────────────────────────────
    function openMemoPopup(recordId) {
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const rec = history.find(r => r.id === recordId);
        if (!rec) return;
        state.memoEditId = recordId;
        if (el.memoTextarea) el.memoTextarea.value = rec.memo || '';
        if (el.memoPopup) el.memoPopup.classList.remove('hidden');
    }

    function closeMemoPopup() {
        state.memoEditId = null;
        if (el.memoPopup) el.memoPopup.classList.add('hidden');
    }

    function saveMemo() {
        if (!state.memoEditId) return;
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const idx = history.findIndex(r => r.id === state.memoEditId);
        if (idx >= 0) {
            history[idx].memo = (el.memoTextarea?.value || '').trim();
            const sorted = sortHistoryByDateDesc(history);
            localStorage.setItem('yls_lfa_history', JSON.stringify(sorted));

            // 구글 시트에 메모 변경 동기화 (원래의 검사일시 유지)
            if (state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                state.sheetsSync.syncResult(
                    { diagnosis: { result: history[idx].result, concentrationStr: history[idx].concentrationStr } },
                    state.currentUser,
                    history[idx].memo,
                    history[idx].cropFilename || '',
                    history[idx].cropImageDataUrl || '',
                    history[idx].timestamp,
                    {
                        rowIndex: history[idx].rowIndex || null,
                        driveFileId: history[idx].driveFileId || null
                    }
                ).catch(e => console.warn('Memo sheet sync error:', e));
            }
        }
        closeMemoPopup();
        renderResultsTable();
    }

    if (el.btnMemoCancel) el.btnMemoCancel.addEventListener('click', closeMemoPopup);
    if (el.btnMemoConfirm) el.btnMemoConfirm.addEventListener('click', saveMemo);
    if (el.memoPopup) {
        el.memoPopup.addEventListener('click', e => {
            if (e.target === el.memoPopup) closeMemoPopup();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // GRAPH ANALYSIS POPUP
    // ─────────────────────────────────────────────────────────────
    function formatPopupDateTime(ts) {
        if (!ts) return '검사일시 : -';
        const str = String(ts).trim();
        // 초 포함 형식: YYYY-MM-DD HH:MM:SS, YYYY.MM.DD.HH:MM 등 모든 구분자 지원
        const m = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT.]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
        if (m) {
            const pad = n => String(n).padStart(2, '0');
            const y = m[1];
            const mon = pad(m[2]);
            const d = pad(m[3]);
            const h = pad(m[4]);
            const min = pad(m[5]);
            const s = m[6] ? pad(m[6]) : '00';
            return `검사일시 : ${y}-${mon}-${d} ${h}:${min}:${s}`;
        }
        return `검사일시 : ${str}`;
    }

    function updateResultBadge(resText) {
        if (!el.graphPopupResult) return;
        const res = resText || '실패';
        el.graphPopupResult.textContent = `‘검사결과 : ${res}’`;
        el.graphPopupResult.className = 'graph-popup-result-badge';
        if (res === '양성' || res === 'positive') {
            el.graphPopupResult.classList.add('badge-positive');
        } else if (res === '음성' || res === 'negative') {
            el.graphPopupResult.classList.add('badge-negative');
        } else {
            el.graphPopupResult.classList.add('badge-fail');
        }
    }

    function showGraphPopup(record) {
        state.activeGraphRecord = record;
        if (el.graphPopup) el.graphPopup.classList.remove('hidden');

        if (el.graphPopupDatetime) {
            el.graphPopupDatetime.textContent = formatPopupDateTime(record.timestamp);
        }

        updateResultBadge(record.result);

        const sc = el.graphStripCanvas;
        if (sc) {
            sc.width = 72;
            sc.height = 190;
            const ctx = sc.getContext('2d');
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(0, 0, 72, 190);
            ctx.fillStyle = '#64748b';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('로딩 중...', 36, 95);

            let targetFileId = '';
            const rawIdOrUrl = record.driveFileId || record.cropUrl || '';
            const idM = String(rawIdOrUrl).match(/[-\w]{25,}/);
            if (idM) {
                targetFileId = idM[0];
            } else {
                targetFileId = record.driveFileId || '';
            }

            if (record.cropImageDataUrl && record.cropImageDataUrl.startsWith('data:image/')) {
                renderStripAndAnalyze(record.cropImageDataUrl);
            }
            else if (targetFileId) {
                if (state.sheetsSync) {
                    state.sheetsSync.fetchDriveImageBase64(targetFileId).then(b64 => {
                        if (b64) {
                            record.cropImageDataUrl = b64;
                            renderStripAndAnalyze(b64);
                        } else {
                            tryDirectThumbnail(targetFileId);
                        }
                    }).catch(() => tryDirectThumbnail(targetFileId));
                } else {
                    tryDirectThumbnail(targetFileId);
                }
            }
            else if (record.cropUrl) {
                renderStripAndAnalyze(record.cropUrl);
            } else {
                showImagePlaceholder('이미지 없음');
            }

            function tryDirectThumbnail(fId) {
                const thumbUrl = `https://drive.google.com/thumbnail?id=${fId}&sz=w1000`;
                renderStripAndAnalyze(thumbUrl);
            }

            function renderStripAndAnalyze(imgSrc) {
                const img = new Image();
                img.onload = () => {
                    sc.width = img.width || 72;
                    sc.height = img.height || 190;
                    const sCtx = sc.getContext('2d');
                    sCtx.clearRect(0, 0, sc.width, sc.height);
                    sCtx.drawImage(img, 0, 0);

                    if (state.analyzer) {
                        state.analyzer.analyze(sc, { isPreCropped: true }).then(analysisRes => {
                            if (analysisRes && analysisRes.visualData) {
                                const vd = analysisRes.visualData;
                                const diag = analysisRes.diagnosis || {};
                                const newResult = diag.result || '실패';
                                const oldResult = record.result;

                                updateResultBadge(newResult);

                                record.profileData = {
                                    corrected: Array.from(vd.correctedProfile || []),
                                    cLineIndex: vd.cLineIndex,
                                    tLineIndex: vd.tLineIndex,
                                    cLineDetected: vd.cLineDetected,
                                    tLineDetected: vd.tLineDetected,
                                    cLineRange: vd.cLineRange,
                                    tLineRange: vd.tLineRange
                                };
                                record.metrics = analysisRes.metrics;
                                record.confidence = diag.confidence;

                                record.result = newResult;
                                if (diag.concentrationStr) {
                                    record.concentrationStr = diag.concentrationStr;
                                }

                                drawAbsorbanceGraph(record);
                                const m = record.metrics || {};
                                setText(el.metricT, m.tPeakHeight != null ? m.tPeakHeight.toFixed(3) : '-');
                                setText(el.metricC, m.cPeakHeight != null ? m.cPeakHeight.toFixed(3) : '-');
                                setText(el.metricConf, record.confidence != null ? record.confidence.toFixed(1) + '%' : '-');
                                setText(el.metricSnr, m.signalToNoise != null ? m.signalToNoise.toFixed(1) + ' dB' : '-');

                                const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
                                const hIdx = history.findIndex(r => r.id === record.id);
                                if (hIdx >= 0) {
                                    const originalTimestamp = history[hIdx].timestamp || record.timestamp;
                                    history[hIdx] = {
                                        ...history[hIdx],
                                        ...record,
                                        timestamp: originalTimestamp
                                    };
                                    const sorted = sortHistoryByDateDesc(history);
                                    localStorage.setItem('yls_lfa_history', JSON.stringify(sorted));
                                    renderResultsTable();
                                }

                                if (oldResult !== newResult && state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                                    showToast(`판정 변경 (${oldResult} ➔ ${newResult}): 서버 동기화 중...`);
                                    const base64Data = (record.cropImageDataUrl && record.cropImageDataUrl.startsWith('data:image/'))
                                        ? record.cropImageDataUrl : '';
                                    state.sheetsSync.syncResult(
                                        analysisRes,
                                        state.currentUser,
                                        record.memo || '',
                                        record.cropFilename || '',
                                        base64Data,
                                        record.timestamp,
                                        {
                                            rowIndex: record.rowIndex || null,
                                            driveFileId: record.driveFileId || null
                                        }
                                    ).then(() => {
                                        console.log(`[ServerSync] 레코드(${record.id}) 업데이트 성공: ${oldResult} -> ${newResult}`);
                                        showToast(`서버에 '${newResult}' 판정으로 업데이트 완료되었습니다.`);
                                    }).catch(err => {
                                        console.warn('Server update sync error:', err);
                                        showToast('서버 업데이트 전송 실패');
                                    });
                                }
                            }
                        }).catch(e => console.warn('Realtime profile analysis failed:', e));
                    }
                };
                img.onerror = () => showImagePlaceholder('이미지 오류');
                img.src = imgSrc;
            }

            function showImagePlaceholder(text) {
                sc.width = 72;
                sc.height = 190;
                const c = sc.getContext('2d');
                c.fillStyle = '#f8fafc';
                c.fillRect(0, 0, 72, 190);
                c.fillStyle = '#94a3b8';
                c.font = '10px sans-serif';
                c.textAlign = 'center';
                c.fillText(text, 36, 95);
            }
        }

        drawAbsorbanceGraph(record);

        const m = record.metrics || {};
        const conf = record.confidence;

        setText(el.metricT, m.tPeakHeight != null ? m.tPeakHeight.toFixed(3) : '-');
        setText(el.metricC, m.cPeakHeight != null ? m.cPeakHeight.toFixed(3) : '-');
        setText(el.metricConf, conf != null ? conf.toFixed(1) + '%' : '-');
        setText(el.metricSnr, m.signalToNoise != null ? m.signalToNoise.toFixed(1) + ' dB' : '-');
    }

    function closeGraphPopup() {
        if (el.graphPopup) el.graphPopup.classList.add('hidden');
        state.activeGraphRecord = null;
    }

    /**
     * 그래프 팝업에서 현재 표시 중인 기록을 휴지통으로 이동합니다.
     */
    async function deleteFromGraphPopup() {
        const record = state.activeGraphRecord;
        if (!record || !record.id) return;

        // 삭제 확인
        if (!confirm('이 검사 결과를 휴지통으로 이동하시겠습니까?')) return;

        const rawHistory = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const existingTrash = cleanupExpiredTrash();
        const fullTrash = JSON.parse(localStorage.getItem('yls_lfa_trash') || '[]');
        const nowIso = new Date().toISOString();

        const remaining = rawHistory.filter(r => r.id !== record.id);
        const trashItem = { ...record, deletedAt: nowIso };

        localStorage.setItem('yls_lfa_history', JSON.stringify(remaining));
        localStorage.setItem('yls_lfa_trash', JSON.stringify([trashItem, ...fullTrash]));

        // 서버 동기화
        if (state.sheetsSync && typeof state.sheetsSync.moveToTrash === 'function') {
            state.sheetsSync.moveToTrash([trashItem]).catch(err => {
                console.warn('Server trash sync error:', err);
            });
        }

        closeGraphPopup();
        updateTrashBadge();
        renderResultsTable();
        showToast('검사 결과가 휴지통으로 이동되었습니다.');
    }

    if (el.btnGraphClose) el.btnGraphClose.addEventListener('click', closeGraphPopup);
    if (el.btnGraphClose2) el.btnGraphClose2.addEventListener('click', closeGraphPopup);
    if (el.btnGraphDelete) el.btnGraphDelete.addEventListener('click', deleteFromGraphPopup);
    if (el.graphPopup) {
        el.graphPopup.addEventListener('click', e => {
            if (e.target === el.graphPopup) closeGraphPopup();
        });
    }

    function setText(node, text) { if (node) node.textContent = text; }

    function drawAbsorbanceGraph(record) {
        const canvas = el.graphProfile;
        if (!canvas) return;

        const W = 220, H = 170;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        const pd = record.profileData;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, W, H);

        if (!pd || !pd.corrected || pd.corrected.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('분석 데이터 없음', W / 2, H / 2);
            return;
        }

        const pL = 28, pR = 10, pT = 22, pB = 24;
        const pW = W - pL - pR;
        const pH = H - pT - pB;
        const profile = pd.corrected;
        const N = profile.length;

        let maxVal = 0.0001;
        for (const v of profile) if (v > maxVal) maxVal = v;

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 0.5;
        for (let g = 0; g <= 4; g++) {
            const y = pT + pH - (g / 4) * pH;
            ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + pW, y); ctx.stroke();
        }

        if (pd.tLineRange) {
            const [l, r] = pd.tLineRange;
            ctx.fillStyle = 'rgba(239,68,68,0.10)';
            ctx.fillRect(pL + (l / N) * pW, pT, Math.max(2, ((r - l) / N) * pW), pH);
        }
        if (pd.cLineRange) {
            const [l, r] = pd.cLineRange;
            ctx.fillStyle = 'rgba(16,185,129,0.10)';
            ctx.fillRect(pL + (l / N) * pW, pT, Math.max(2, ((r - l) / N) * pW), pH);
        }

        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.8;
        for (let i = 0; i < N; i++) {
            const x = pL + (i / (N - 1)) * pW;
            const y = pT + pH - (profile[i] / maxVal) * pH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (pd.tLineDetected && pd.tLineIndex != null) {
            const x = pL + (pd.tLineIndex / (N - 1)) * pW;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + pH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('T', x, pT - 5);
        }

        if (pd.cLineDetected && pd.cLineIndex != null) {
            const x = pL + (pd.cLineIndex / (N - 1)) * pW;
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + pH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('C', x, pT - 5);
        }

        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pL, pT);
        ctx.lineTo(pL, pT + pH);
        ctx.lineTo(pL + pW, pT + pH);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('← 샘플웰       흡수패드 →', pL + pW / 2, H - 5);

        ctx.save();
        ctx.translate(9, pT + pH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('흡광도', 0, 0);
        ctx.restore();

        ctx.textAlign = 'left';
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(pL, pT - 18, 8, 6);
        ctx.fillStyle = '#64748b';
        ctx.font = '8px sans-serif';
        ctx.fillText('T-Line', pL + 10, pT - 13);

        ctx.fillStyle = '#10b981';
        ctx.fillRect(pL + 60, pT - 18, 8, 6);
        ctx.fillStyle = '#64748b';
        ctx.fillText('C-Line', pL + 70, pT - 13);
    }

    window.addEventListener('resize', () => {
        if (state.activeView === 'view-camera') {
            updateCameraGuide();
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ANDROID 뒤로가기 처리
    // ─────────────────────────────────────────────────────────────
    let exitPopupVisible = false;

    function showExitPopup() {
        if (!el.exitConfirmPopup) return;
        exitPopupVisible = true;
        el.exitConfirmPopup.classList.remove('hidden');
        history.pushState({ ylsApp: true }, '');
    }

    function hideExitPopup() {
        if (!el.exitConfirmPopup) return;
        exitPopupVisible = false;
        el.exitConfirmPopup.classList.add('hidden');
    }

    history.pushState({ ylsApp: true }, '');

    window.addEventListener('popstate', (e) => {
        if (exitPopupVisible) {
            hideExitPopup();
            history.pushState({ ylsApp: true }, '');
            return;
        }

        if (state.activeView === 'view-camera' || state.activeView === 'view-confirm') {
            history.pushState({ ylsApp: true }, '');
            return;
        }

        if (state.activeView === 'view-login') {
            showExitPopup();
            return;
        }

        if (state.activeView === 'view-timesetting') {
            showExitPopup();
            return;
        }

        if (state.activeView === 'view-results') {
            navigateTo('timesetting');
            history.pushState({ ylsApp: true }, '');
            return;
        }

        history.pushState({ ylsApp: true }, '');
    });

    if (el.btnExitNo) {
        el.btnExitNo.addEventListener('click', () => {
            hideExitPopup();
            history.pushState({ ylsApp: true }, '');
        });
    }

    if (el.btnExitYes) {
        el.btnExitYes.addEventListener('click', () => {
            try {
                window.close();
            } catch (_) { }
            try {
                window.location.replace('about:blank');
            } catch (_) { }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // App Startup
    // ─────────────────────────────────────────────────────────────
    if (el.inputPassword) el.inputPassword.value = '';

    const isLoggedIn = localStorage.getItem('yls_user_logged_in') === 'true';
    const savedUsername = localStorage.getItem('yls_user_name') || 'yelloi';
    let lastView = localStorage.getItem('yls_last_view') || 'timesetting';

    if (lastView === 'camera' || lastView === 'confirm') {
        lastView = 'timesetting';
    }

    updateTrashBadge();

    if (isLoggedIn) {
        state.currentUser.username = savedUsername;
        state.currentUser.isLoggedIn = true;
        navigateTo(lastView);
        loadAndRenderResultsTable();
    } else {
        navigateTo('login');
    }
});