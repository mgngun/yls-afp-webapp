/**
 * YLS LFA Kit AI Diagnostic WebApp Controller
 * v4.0 — 1차 개편 시나리오 전면 반영
 *
 * Flow: Login (yelloi/1234) → Time Setting (countdown) → Camera →
 *       Photo Confirm → Results (15/page, memo, absorbance graph popup)
 */

document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────────────────────
    // Constants & State
    // ─────────────────────────────────────────────────────────────
    const VALID_CREDENTIALS = { username: 'yelloi', password: '1234' };
    const PAGE_SIZE = 15;

    const state = {
        currentUser: {
            username: 'yelloi',
            isLoggedIn: false
        },
        stream:              null,
        capturedCanvas:      null,
        analyzer:            typeof LFAAnalyzer      === 'function' ? new LFAAnalyzer()      : null,
        sheetsSync:          typeof GoogleSheetsSync === 'function' ? new GoogleSheetsSync() : null,
        activeView:          'view-login',
        lastAnalysisResult:  null,
        countdownInterval:   null,
        countdownRemaining:  0,
        currentPage:         1,
        memoEditId:          null
    };

    // ── Initialize mock history on first run ──
    if (!localStorage.getItem('yls_lfa_history')) {
        localStorage.setItem('yls_lfa_history', JSON.stringify(buildMockHistory()));
    }

    function buildMockHistory() {
        const rows = [
            { ts: '2026-08-26 10:15', res: '실패',  conc: '-',    memo: '' },
            { ts: '2026-08-24 13:45', res: '양성',  conc: '0.01', memo: '첫 번째 양성 결과' },
            { ts: '2026-08-22 17:15', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-20 11:02', res: '음성',  conc: '-',    memo: '정상 확인' },
            { ts: '2026-08-19 13:45', res: '양성',  conc: '0.02', memo: '재검 필요' },
            { ts: '2026-08-18 17:15', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-17 11:02', res: '실패',  conc: '-',    memo: '' },
            { ts: '2026-08-15 13:45', res: '양성',  conc: '0.01', memo: '' },
            { ts: '2026-08-14 17:15', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-13 11:02', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-11 11:02', res: '실패',  conc: '-',    memo: '' },
            { ts: '2026-08-10 13:45', res: '양성',  conc: '0.01', memo: '' },
            { ts: '2026-08-08 17:15', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-06 11:02', res: '실패',  conc: '-',    memo: '' },
            { ts: '2026-08-05 17:15', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-08-03 09:30', res: '양성',  conc: '0.03', memo: '추가 검사 권고' },
            { ts: '2026-08-01 14:00', res: '음성',  conc: '-',    memo: '' },
            { ts: '2026-07-30 10:45', res: '음성',  conc: '-',    memo: '' },
        ];
        return rows.map((r, i) => ({
            id:               'REC_MOCK_' + (i + 1),
            timestamp:        r.ts,
            result:           r.res,
            concentrationStr: r.conc,
            userNickname:     'yelloi',
            memo:             r.memo,
            cropImageDataUrl: null,
            cropFilename:     null,
            profileData:      null,
            metrics:          null,
            confidence:       null
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // DOM Elements
    // ─────────────────────────────────────────────────────────────
    const el = {
        views: {
            login:       document.getElementById('view-login'),
            timesetting: document.getElementById('view-timesetting'),
            camera:      document.getElementById('view-camera'),
            confirm:     document.getElementById('view-confirm'),
            results:     document.getElementById('view-results')
        },
        // Login
        inputUsername:    document.getElementById('input-username'),
        inputPassword:    document.getElementById('input-password'),
        btnLogin:         document.getElementById('btn-login'),
        // Time Setting
        timesetGreeting:  document.getElementById('timeset-greeting'),
        inputWaitMin:     document.getElementById('input-wait-min'),
        inputWaitSec:     document.getElementById('input-wait-sec'),
        btnTimesetOk:     document.getElementById('btn-timeset-confirm'),
        displayMin:       document.getElementById('display-min'),
        displaySec:       document.getElementById('display-sec'),
        btnGoCamera:      document.getElementById('btn-go-camera'),
        // Camera
        cameraVideo:      document.getElementById('camera-video'),
        btnCapture:       document.getElementById('btn-capture-photo'),
        // Confirm
        confirmCanvas:    document.getElementById('confirm-preview-canvas'),
        btnConfirmNo:     document.getElementById('btn-confirm-no'),
        btnConfirmYes:    document.getElementById('btn-confirm-yes'),
        // Results
        resultUserId:     document.getElementById('result-user-id'),
        resultsBody:      document.getElementById('results-table-body'),
        btnReturnHome:    document.getElementById('btn-return-home'),
        // Overlays
        analyzingOverlay: document.getElementById('analyzing-overlay'),
        toast:            document.getElementById('toast'),
        statusTime:       document.getElementById('status-time'),
        // Memo popup
        memoPopup:        document.getElementById('memo-popup'),
        memoTextarea:     document.getElementById('memo-textarea'),
        btnMemoCancel:    document.getElementById('btn-memo-cancel'),
        btnMemoConfirm:   document.getElementById('btn-memo-confirm'),
        // Graph popup
        graphPopup:       document.getElementById('graph-popup'),
        btnGraphClose:    document.getElementById('btn-graph-close'),
        btnGraphClose2:   document.getElementById('btn-graph-close2'),
        graphStripCanvas: document.getElementById('graph-strip-canvas'),
        graphProfile:     document.getElementById('graph-profile-canvas'),
        metricT:          document.getElementById('metric-t-intensity'),
        metricC:          document.getElementById('metric-c-intensity'),
        metricConf:       document.getElementById('metric-confidence'),
        metricSnr:        document.getElementById('metric-snr'),
        // Settings popup & CSV
        btnExportCsv:     document.getElementById('btn-export-csv'),
        btnOpenSettings:  document.getElementById('btn-open-settings'),
        settingsPopup:    document.getElementById('settings-popup'),
        inputWebhookUrl:  document.getElementById('input-webhook-url'),
        btnSettingsClose: document.getElementById('btn-settings-close'),
        btnSettingsCancel:document.getElementById('btn-settings-cancel'),
        btnSettingsSave:  document.getElementById('btn-settings-save')
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
            // Keep countdown display if still running
            if (!state.countdownInterval) {
                if (el.displayMin) el.displayMin.textContent = '--';
                if (el.displaySec) el.displaySec.textContent = '--';
            }
        } else if (viewName === 'results') {
            state.currentPage = 1;
            renderResultsTable();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // LOGIN
    // ─────────────────────────────────────────────────────────────
    function doLogin() {
        const username = (el.inputUsername?.value || '').trim();
        const password = (el.inputPassword?.value || '').trim();

        if (username === VALID_CREDENTIALS.username &&
            password === VALID_CREDENTIALS.password) {
            state.currentUser.username  = username;
            state.currentUser.isLoggedIn = true;
            localStorage.setItem('yls_user_logged_in', 'true');
            localStorage.setItem('yls_user_name', username);
            navigateTo('timesetting');
        } else {
            showToast('아이디 또는 비밀번호가 올바르지 않습니다.');
            if (el.inputPassword) el.inputPassword.value = '';
        }
    }

    if (el.btnLogin) el.btnLogin.addEventListener('click', doLogin);
    [el.inputUsername, el.inputPassword].forEach(inp => {
        if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    });

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
                // Auto-navigate only if still on timesetting
                if (state.activeView === 'view-timesetting') {
                    navigateTo('camera');
                }
            }
        }, 1000);
    }

    function renderCountdown() {
        const rem = Math.max(0, state.countdownRemaining);
        const m   = Math.floor(rem / 60);
        const s   = rem % 60;
        if (el.displayMin) el.displayMin.textContent = String(m).padStart(2, '0');
        if (el.displaySec) el.displaySec.textContent = String(s).padStart(2, '0');
    }

    if (el.btnTimesetOk) {
        el.btnTimesetOk.addEventListener('click', () => {
            const min   = parseInt(el.inputWaitMin?.value) || 0;
            const sec   = parseInt(el.inputWaitSec?.value) || 0;
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
    // CAMERA
    // ─────────────────────────────────────────────────────────────
    async function startCamera() {
        try {
            stopCamera();
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720  }
                },
                audio: false
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.stream = stream;
            if (el.cameraVideo) {
                el.cameraVideo.srcObject = stream;
                await el.cameraVideo.play();
            }
            // Request 1.0x zoom + continuous focus
            const track = stream.getVideoTracks()[0];
            if (track && typeof track.applyConstraints === 'function') {
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    const adv  = [{ focusMode: 'continuous' }];
                    if (caps.zoom) adv[0].zoom = 1.0;
                    await track.applyConstraints({ advanced: adv });
                } catch (_) {}
            }
        } catch (err) {
            console.warn('Camera access:', err);
        }
    }

    function stopCamera() {
        if (state.stream) {
            state.stream.getTracks().forEach(t => t.stop());
            state.stream = null;
        }
    }

    /**
     * Dynamically compute and apply guide frame dimensions based on spec:
     *  - frame_width  = container_width / 3
     *  - frame_height = frame_width × 3.5
     *  - frame_top    = frame_width / 2  (from top of camera view)
     *  - strip inside frame: width=frame/3, height=frame*(2/3), top offset=frame*(4/3)
     *  - well circle:  diameter=strip_width, center_y = frame_bottom + frame_width/2
     */
    function updateCameraGuide() {
        const container = document.querySelector('.camera-container');
        if (!container) return;
        const W = container.offsetWidth;

        const fW   = Math.round(W / 3);
        const fH   = Math.round(fW * 3.5);
        const fTop = Math.round(fW / 2);
        const fLeft = Math.round((W - fW) / 2);

        const sW    = Math.round(fW / 3);
        const sH    = Math.round(fW * 2 / 3);
        const sLeft = Math.round((fW - sW) / 2);
        const sTop  = Math.round(fW * 4 / 3);

        const wDiam  = sW;
        const wTop   = Math.round(fH - fW / 2 - wDiam / 2);
        const wLeft  = Math.round((fW - wDiam) / 2);

        const frame  = document.getElementById('guide-kit-frame');
        const strip  = document.querySelector('.guide-window-cutout');
        const well   = document.querySelector('.guide-sample-well');

        applyStyle(frame, { width: fW+'px', height: fH+'px', top: fTop+'px', left: fLeft+'px', transform: 'none' });
        applyStyle(strip, { width: sW+'px', height: sH+'px', left: sLeft+'px', top: sTop+'px',  transform: 'none' });
        applyStyle(well,  { width: wDiam+'px', height: wDiam+'px', left: wLeft+'px', top: wTop+'px', transform: 'none' });

        // Mirror to confirm screen
        const cFrame = document.getElementById('confirm-kit-frame');
        const cWin   = document.getElementById('confirm-guide-window');
        const cWell  = document.getElementById('confirm-guide-well');
        applyStyle(cFrame, { width: fW+'px', height: fH+'px' });
        applyStyle(cWin,   { width: sW+'px', height: sH+'px', left: sLeft+'px', top: sTop+'px', transform: 'none' });
        applyStyle(cWell,  { width: wDiam+'px', height: wDiam+'px', left: wLeft+'px', top: wTop+'px', transform: 'none' });
    }

    function applyStyle(el, styles) {
        if (!el) return;
        Object.assign(el.style, styles);
    }

    // ── Capture Photo ──
    if (el.btnCapture) {
        el.btnCapture.addEventListener('click', () => {
            let canvas;
            if (state.stream && el.cameraVideo && el.cameraVideo.videoWidth > 0) {
                const vw = el.cameraVideo.videoWidth;
                const vh = el.cameraVideo.videoHeight;
                canvas = document.createElement('canvas');
                canvas.width  = vw;
                canvas.height = vh;
                canvas.getContext('2d').drawImage(el.cameraVideo, 0, 0, vw, vh);
            } else if (typeof LFATestSamples !== 'undefined' && LFATestSamples.createSyntheticKit) {
                canvas = LFATestSamples.createSyntheticKit({ cLine: 0.88, tLine: 0.45, noise: 0.02 });
            } else {
                canvas = document.createElement('canvas');
                canvas.width = 480; canvas.height = 1440;
            }

            state.capturedCanvas = canvas;

            if (el.confirmCanvas) {
                el.confirmCanvas.width  = canvas.width;
                el.confirmCanvas.height = canvas.height;
                el.confirmCanvas.getContext('2d').drawImage(canvas, 0, 0);
            }
            navigateTo('confirm');
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
                const result = await state.analyzer.analyze(state.capturedCanvas);
                state.lastAnalysisResult = result;

                const savedRecord = saveResultRecord(result);

                // Auto-sync to Google Sheets
                try {
                    if (state.sheetsSync && typeof state.sheetsSync.syncResult === 'function') {
                        state.sheetsSync.syncResult(result, state.currentUser,
                            savedRecord?.memo || '',
                            savedRecord?.cropFilename || '')
                            .catch(e => console.warn('Sheets sync:', e));
                    }
                } catch (_) {}

                navigateTo('results');
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
    /**
     * Save analysis result with crop image (base64) and profile data for graph popup.
     */
    function saveResultRecord(analysis) {
        if (!analysis || !analysis.diagnosis) return null;
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const diag    = analysis.diagnosis;

        const now   = new Date();
        const pad   = n => String(n).padStart(2, '0');
        const ts    = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const fname = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;

        // Crop image as base64 JPEG (stored locally)
        let cropDataUrl = null;
        try {
            const sc = analysis.visualData?.previewCanvas || analysis.visualData?.stripCanvas;
            if (sc) cropDataUrl = sc.toDataURL('image/jpeg', 0.60);
        } catch (_) {}

        // Absorbance profile for graph drawing
        let profileData = null;
        try {
            const vd = analysis.visualData;
            if (vd?.correctedProfile) {
                profileData = {
                    corrected:      Array.from(vd.correctedProfile),
                    cLineIndex:     vd.cLineIndex,
                    tLineIndex:     vd.tLineIndex,
                    cLineDetected:  vd.cLineDetected,
                    tLineDetected:  vd.tLineDetected,
                    cLineRange:     vd.cLineRange,
                    tLineRange:     vd.tLineRange
                };
            }
        } catch (_) {}

        const record = {
            id:               'REC_' + Date.now(),
            timestamp:        ts,
            result:           diag.result || '실패',
            concentrationStr: diag.result === '양성' ? (diag.concentrationStr || '0.01') : '-',
            userNickname:     state.currentUser.username,
            memo:             '',
            cropImageDataUrl: cropDataUrl,
            cropFilename:     fname,
            profileData,
            metrics:          analysis.metrics   || null,
            confidence:       diag.confidence    || null
        };

        history.unshift(record);
        if (history.length > 50) history.pop();
        localStorage.setItem('yls_lfa_history', JSON.stringify(history));
        return record;
    }

    // ── Render paginated results table ──
    function renderResultsTable() {
        const tbody = el.resultsBody;
        if (!tbody) return;

        if (el.resultUserId) el.resultUserId.textContent = state.currentUser.username;

        const history    = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
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

            let cls  = 'col-negative', label = '음성', val = '-';
            if (rec.result === '양성' || rec.result === 'positive') {
                cls = 'col-positive'; label = '양성';
                val = (rec.concentrationStr && rec.concentrationStr !== '-') ? rec.concentrationStr : '0.01';
            } else if (rec.result === '실패' || rec.result === 'fail') {
                cls = 'col-fail'; label = '실패';
            }

            const hasMemo   = !!(rec.memo && rec.memo.trim());
            const memoLabel = hasMemo ? '보기' : '';

            tr.innerHTML = `
                <td class="col-date">${rec.timestamp || '-'}</td>
                <td class="${cls}">${label}</td>
                <td>${val}</td>
                <td><span class="memo-cell${hasMemo ? ' has-memo' : ''}" data-id="${rec.id}">${memoLabel}</span></td>
            `;

            // Row click → graph popup
            tr.addEventListener('click', e => {
                if (e.target.classList.contains('memo-cell')) return;
                showGraphPopup(rec);
            });

            // Memo cell click → memo popup
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

        const maxBtn  = 5;
        const half    = Math.floor(maxBtn / 2);
        let   pStart  = Math.max(1, state.currentPage - half);
        let   pEnd    = Math.min(totalPages, pStart + maxBtn - 1);
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

    // ── CSV Export & Settings Modal ──
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

    if (el.btnSettingsClose)  el.btnSettingsClose.addEventListener('click', closeSettingsPopup);
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
        const rec     = history.find(r => r.id === recordId);
        if (!rec) return;
        state.memoEditId = recordId;
        if (el.memoTextarea) el.memoTextarea.value = rec.memo || '';
        if (el.memoPopup)    el.memoPopup.classList.remove('hidden');
    }

    function closeMemoPopup() {
        state.memoEditId = null;
        if (el.memoPopup)    el.memoPopup.classList.add('hidden');
    }

    function saveMemo() {
        if (!state.memoEditId) return;
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const idx     = history.findIndex(r => r.id === state.memoEditId);
        if (idx >= 0) {
            history[idx].memo = (el.memoTextarea?.value || '').trim();
            localStorage.setItem('yls_lfa_history', JSON.stringify(history));
        }
        closeMemoPopup();
        renderResultsTable();
    }

    if (el.btnMemoCancel)  el.btnMemoCancel.addEventListener('click',  closeMemoPopup);
    if (el.btnMemoConfirm) el.btnMemoConfirm.addEventListener('click', saveMemo);
    if (el.memoPopup) {
        el.memoPopup.addEventListener('click', e => {
            if (e.target === el.memoPopup) closeMemoPopup();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // GRAPH ANALYSIS POPUP
    // ─────────────────────────────────────────────────────────────
    function showGraphPopup(record) {
        if (el.graphPopup) el.graphPopup.classList.remove('hidden');

        // ── Strip image ──
        const sc = el.graphStripCanvas;
        if (sc) {
            if (record.cropImageDataUrl) {
                const img = new Image();
                img.onload = () => {
                    sc.width  = img.width;
                    sc.height = img.height;
                    sc.getContext('2d').drawImage(img, 0, 0);
                };
                img.src = record.cropImageDataUrl;
            } else {
                sc.width  = 72;
                sc.height = 190;
                const ctx = sc.getContext('2d');
                ctx.fillStyle = '#e2e8f0';
                ctx.fillRect(0, 0, 72, 190);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('이미지', 36, 90);
                ctx.fillText('없음',   36, 104);
            }
        }

        // ── Absorbance graph ──
        drawAbsorbanceGraph(record);

        // ── Metrics ──
        const m    = record.metrics || {};
        const conf = record.confidence;

        setText(el.metricT,    m.tPeakHeight   != null ? m.tPeakHeight.toFixed(3)   : '-');
        setText(el.metricC,    m.cPeakHeight   != null ? m.cPeakHeight.toFixed(3)   : '-');
        setText(el.metricConf, conf            != null ? conf.toFixed(1) + '%'       : '-');
        setText(el.metricSnr,  m.signalToNoise != null ? m.signalToNoise.toFixed(1) + ' dB' : '-');
    }

    function closeGraphPopup() {
        if (el.graphPopup) el.graphPopup.classList.add('hidden');
    }

    if (el.btnGraphClose)  el.btnGraphClose.addEventListener('click',  closeGraphPopup);
    if (el.btnGraphClose2) el.btnGraphClose2.addEventListener('click', closeGraphPopup);
    if (el.graphPopup) {
        el.graphPopup.addEventListener('click', e => {
            if (e.target === el.graphPopup) closeGraphPopup();
        });
    }

    function setText(node, text) { if (node) node.textContent = text; }

    // ── Draw absorbance profile graph on canvas ──
    function drawAbsorbanceGraph(record) {
        const canvas = el.graphProfile;
        if (!canvas) return;

        const W = 220, H = 170;
        canvas.width  = W;
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
        const N       = profile.length;

        let maxVal = 0.0001;
        for (const v of profile) if (v > maxVal) maxVal = v;

        // Grid lines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth   = 0.5;
        for (let g = 0; g <= 4; g++) {
            const y = pT + pH - (g / 4) * pH;
            ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + pW, y); ctx.stroke();
        }

        // Shaded zones
        if (pd.tLineRange) {
            const [l, r] = pd.tLineRange;
            ctx.fillStyle = 'rgba(239,68,68,0.10)';
            ctx.fillRect(pL + (l/N)*pW, pT, Math.max(2, ((r-l)/N)*pW), pH);
        }
        if (pd.cLineRange) {
            const [l, r] = pd.cLineRange;
            ctx.fillStyle = 'rgba(16,185,129,0.10)';
            ctx.fillRect(pL + (l/N)*pW, pT, Math.max(2, ((r-l)/N)*pW), pH);
        }

        // Profile line (green channel curve)
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth   = 1.8;
        for (let i = 0; i < N; i++) {
            const x = pL + (i / (N - 1)) * pW;
            const y = pT + pH - (profile[i] / maxVal) * pH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // T-Line marker
        if (pd.tLineDetected && pd.tLineIndex != null) {
            const x = pL + (pd.tLineIndex / (N - 1)) * pW;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth   = 1.2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + pH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('T', x, pT - 5);
        }

        // C-Line marker
        if (pd.cLineDetected && pd.cLineIndex != null) {
            const x = pL + (pd.cLineIndex / (N - 1)) * pW;
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth   = 1.2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + pH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('C', x, pT - 5);
        }

        // Axes
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(pL, pT);
        ctx.lineTo(pL, pT + pH);
        ctx.lineTo(pL + pW, pT + pH);
        ctx.stroke();

        // X-axis label
        ctx.fillStyle = '#64748b';
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('← 샘플웰       흡수패드 →', pL + pW / 2, H - 5);

        // Y-axis label
        ctx.save();
        ctx.translate(9, pT + pH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('흡광도', 0, 0);
        ctx.restore();

        // Legend
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
    // App Startup
    // ─────────────────────────────────────────────────────────────
    if (el.inputPassword) el.inputPassword.value = '';
    navigateTo('login');
});
