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
        graphPopupResult: document.getElementById('graph-popup-result-badge'),
        btnGraphClose: document.getElementById('btn-graph-close'),
        btnGraphClose2: document.getElementById('btn-graph-close2'),
        graphStripCanvas: document.getElementById('graph-strip-canvas'),
        graphProfile: document.getElementById('graph-profile-canvas'),
        metricT: document.getElementById('metric-t-intensity'),
        metricC: document.getElementById('metric-c-intensity'),
        metricConf: document.getElementById('metric-confidence'),
        metricSnr: document.getElementById('metric-snr'),
        // Settings popup & CSV
        btnExportCsv: document.getElementById('btn-export-csv'),
        btnOpenSettings: document.getElementById('btn-open-settings'),
        settingsPopup: document.getElementById('settings-popup'),
        inputWebhookUrl: document.getElementById('input-webhook-url'),
        btnSettingsClose: document.getElementById('btn-settings-close'),
        btnSettingsCancel: document.getElementById('btn-settings-cancel'),
        btnSettingsSave: document.getElementById('btn-settings-save'),
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
            showLoginError('사용자 서버에 연결할 수 없습니다. 인터넷 연결과 Google Sheets 연동 설정을 확인해 주세요.');
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

    if (el.btnCapture) {
        el.btnCapture.addEventListener('click', () => {
            let canvas;
            if (state.stream && el.cameraVideo && el.cameraVideo.videoWidth > 0) {
                const vw = el.cameraVideo.videoWidth;
                const vh = el.cameraVideo.videoHeight;
                canvas = document.createElement('canvas');
                canvas.width = vw;
                canvas.height = vh;
                const ctx = canvas.getContext('2d');

                // Software Fallback Zoom이 사용되었을 경우 Canvas 크롭 영역 매핑
                if (state.currentZoom > 1.0) {
                    const cropW = vw / state.currentZoom;
                    const cropH = vh / state.currentZoom;
                    const cropX = (vw - cropW) / 2;
                    const cropY = (vh - cropH) / 2;
                    ctx.drawImage(el.cameraVideo, cropX, cropY, cropW, cropH, 0, 0, vw, vh);
                } else {
                    ctx.drawImage(el.cameraVideo, 0, 0, vw, vh);
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
                            cropUrl
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
    function saveResultRecord(analysis, croppedCanvas = null) {
        if (!analysis || !analysis.diagnosis) return null;
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const diag = analysis.diagnosis;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

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

        history.unshift(record);
        if (history.length > 100) history.pop();
        localStorage.setItem('yls_lfa_history', JSON.stringify(history));
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

        if (state.sheetsSync && typeof state.sheetsSync.fetchResults === 'function') {
            try {
                const res = await state.sheetsSync.fetchResults(state.currentUser.username);
                if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                    localStorage.setItem('yls_lfa_history', JSON.stringify(res.data));
                    renderResultsTable();
                }
            } catch (err) {
                console.warn('Failed to fetch latest records from Google Sheets:', err);
            }
        }
    }

    function renderResultsTable() {
        const tbody = el.resultsBody;
        if (!tbody) return;

        if (el.resultUserId) el.resultUserId.textContent = state.currentUser.username;

        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
        if (state.currentPage > totalPages) state.currentPage = totalPages;

        const start = (state.currentPage - 1) * PAGE_SIZE;
        const items = history.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">검사 기록이 없습니다.</td></tr>';
            renderPagination(totalPages);
            return;
        }

        items.forEach(rec => {
            const tr = document.createElement('tr');

            let cls = 'col-negative', label = '음성', val = '-';
            if (rec.result === '양성' || rec.result === 'positive') {
                cls = 'col-positive'; label = '양성';
                val = (rec.concentrationStr && rec.concentrationStr !== '-') ? rec.concentrationStr : '0.01';
            } else if (rec.result === '실패' || rec.result === 'fail') {
                cls = 'col-fail'; label = '실패';
            }

            const hasMemo = !!(rec.memo && String(rec.memo).trim());
            const memoLabel = hasMemo ? '보기' : '';

            tr.innerHTML = `
                <td class="col-date">${rec.timestamp || '-'}</td>
                <td class="${cls}">${label}</td>
                <td>${val}</td>
                <td><span class="memo-cell${hasMemo ? ' has-memo' : ''}" data-id="${rec.id}">${memoLabel}</span></td>
            `;

            tr.addEventListener('click', e => {
                if (e.target.classList.contains('memo-cell')) return;
                showGraphPopup(rec);
            });

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
        el.btnReturnHome.addEventListener('click', () => navigateTo('timesetting'));
    }

    if (el.btnExportCsv) {
        el.btnExportCsv.addEventListener('click', () => {
            if (state.sheetsSync && typeof state.sheetsSync.exportCSV === 'function') {
                state.sheetsSync.exportCSV();
            } else {
                showToast('내보낼 수 있는 모듈을 찾을 수 없습니다.');
            }
        });
    }

    if (el.btnOpenSettings) {
        el.btnOpenSettings.addEventListener('click', () => {
            const cfg = state.sheetsSync ? state.sheetsSync.getConfig() : {};
            if (el.inputWebhookUrl) el.inputWebhookUrl.value = cfg.webhookUrl || '';
            if (el.settingsPopup) el.settingsPopup.classList.remove('hidden');
        });
    }

    function closeSettingsPopup() {
        if (el.settingsPopup) el.settingsPopup.classList.add('hidden');
    }

    if (el.btnSettingsClose) el.btnSettingsClose.addEventListener('click', closeSettingsPopup);
    if (el.btnSettingsCancel) el.btnSettingsCancel.addEventListener('click', closeSettingsPopup);
    if (el.btnSettingsSave) {
        el.btnSettingsSave.addEventListener('click', () => {
            const url = (el.inputWebhookUrl?.value || '').trim();
            if (state.sheetsSync) {
                state.sheetsSync.saveConfig({ webhookUrl: url, enabled: !!url });
                showToast(url ? '구글 시트 연동 URL이 저장되었습니다.' : '연동 설정이 해제되었습니다.');
            }
            closeSettingsPopup();
        });
    }
    if (el.settingsPopup) {
        el.settingsPopup.addEventListener('click', e => {
            if (e.target === el.settingsPopup) closeSettingsPopup();
        });
    }

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
            localStorage.setItem('yls_lfa_history', JSON.stringify(history));

            // 구글 시트에 메모 변경 동기화
            if (state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                state.sheetsSync.syncResult(
                    { diagnosis: { result: history[idx].result, concentrationStr: history[idx].concentrationStr } },
                    state.currentUser,
                    history[idx].memo,
                    history[idx].cropFilename || '',
                    history[idx].cropImageDataUrl || ''
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
        if (el.graphPopup) el.graphPopup.classList.remove('hidden');

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

            let targetFileId = record.driveFileId;
            if (!targetFileId && record.cropUrl) {
                const idM = record.cropUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                    record.cropUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                    record.cropUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                if (idM) targetFileId = idM[1];
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
                                    history[hIdx] = { ...history[hIdx], ...record };
                                    localStorage.setItem('yls_lfa_history', JSON.stringify(history));
                                    renderResultsTable();
                                }

                                if (oldResult !== newResult && state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                                    state.sheetsSync.syncResult(
                                        analysisRes,
                                        state.currentUser,
                                        record.memo || '',
                                        record.cropFilename || '',
                                        record.cropImageDataUrl || imgSrc
                                    ).then(() => {
                                        console.log(`[GoogleSheets] 레코드(${record.id}) 업데이트 성공: ${oldResult} -> ${newResult}`);
                                    }).catch(err => console.warn('Google Sheets update sync error:', err));
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
    }

    if (el.btnGraphClose) el.btnGraphClose.addEventListener('click', closeGraphPopup);
    if (el.btnGraphClose2) el.btnGraphClose2.addEventListener('click', closeGraphPopup);
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

    if (isLoggedIn) {
        state.currentUser.username = savedUsername;
        state.currentUser.isLoggedIn = true;
        navigateTo(lastView);
        loadAndRenderResultsTable();
    } else {
        navigateTo('login');
    }
});