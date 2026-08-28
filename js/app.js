/**
 * YLS LFA Kit AI Diagnostic WebApp Controller
 * Handles user authentication, camera lifecycle (multi-lens switching & autofocus), state machine, and UI interactions
 */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // State Initialization
    // -------------------------------------------------------------
    const state = {
        currentUser: {
            id: 'yelloi',
            nickname: localStorage.getItem('yls_user_nickname') || '',
            isLoggedIn: localStorage.getItem('yls_user_logged_in') === 'true'
        },
        stream: null,
        videoDevices: [],
        currentCameraIndex: 0,
        capturedCanvas: null,
        analyzer: new LFAAnalyzer(),
        sheetsSync: new GoogleSheetsSync(),
        activeView: 'view-login',
        lastAnalysisResult: null
    };

    // DOM Elements
    const elements = {
        // Views
        views: {
            login: document.getElementById('view-login'),
            home: document.getElementById('view-home'),
            camera: document.getElementById('view-camera'),
            results: document.getElementById('view-results')
        },
        // Login
        btnLoginGoogle: document.getElementById('btn-login-google'),
        btnLoginKakao: document.getElementById('btn-login-kakao'),
        btnLoginNaver: document.getElementById('btn-login-naver'),
        btnLoginEmail: document.getElementById('btn-login-email'),
        // Home
        nicknameSetupBox: document.getElementById('nickname-setup-box'),
        greetingBanner: document.getElementById('greeting-banner'),
        inputNickname: document.getElementById('input-nickname'),
        btnSaveNickname: document.getElementById('btn-save-nickname'),
        userDisplayName: document.getElementById('user-display-name'),
        btnChangeNickname: document.getElementById('btn-change-nickname'),
        btnStartTest: document.getElementById('btn-start-test'),
        btnViewHistory: document.getElementById('btn-view-history'),
        // Camera
        cameraVideo: document.getElementById('camera-video'),
        btnCameraBack: document.getElementById('btn-camera-back'),
        btnSwitchCamera: document.getElementById('btn-switch-camera'),
        btnCapturePhoto: document.getElementById('btn-capture-photo'),
        btnOpenSamples: document.getElementById('btn-open-samples'),
        btnToggleFlash: document.getElementById('btn-toggle-flash'),
        // Modals
        modalConfirm: document.getElementById('modal-confirm'),
        confirmPreviewCanvas: document.getElementById('confirm-preview-canvas'),
        btnConfirmNo: document.getElementById('btn-confirm-no'),
        btnConfirmYes: document.getElementById('btn-confirm-yes'),
        modalSamples: document.getElementById('modal-samples'),
        btnCloseSamples: document.getElementById('btn-close-samples'),
        sampleListContainer: document.getElementById('sample-list-container'),
        modalSheets: document.getElementById('modal-sheets'),
        btnCloseSheets: document.getElementById('btn-close-sheets'),
        btnOpenSheetsSettings: document.getElementById('btn-open-sheets-settings'),
        btnSaveSheetsConfig: document.getElementById('btn-save-sheets-config'),
        inputSheetId: document.getElementById('input-sheet-id'),
        inputWebhookUrl: document.getElementById('input-webhook-url'),
        // Results
        resultUserId: document.getElementById('result-user-id'),
        latestResultBadge: document.getElementById('latest-result-badge'),
        resultTagBadge: document.getElementById('result-tag-badge'),
        resultValDisplay: document.getElementById('result-val-display'),
        resultsTableBody: document.getElementById('results-table-body'),
        btnReturnHome: document.getElementById('btn-return-home'),
        btnToggleDetails: document.getElementById('btn-toggle-details'),
        analysisDetailsPanel: document.getElementById('analysis-details-panel'),
        croppedStripCanvas: document.getElementById('cropped-strip-canvas'),
        profileGraphCanvas: document.getElementById('profile-graph-canvas'),
        btnExportCsv: document.getElementById('btn-export-csv'),
        // Metrics
        metricCHeight: document.getElementById('metric-c-height'),
        metricTHeight: document.getElementById('metric-t-height'),
        metricTcRatio: document.getElementById('metric-tc-ratio'),
        metricSnr: document.getElementById('metric-snr'),
        // Overlays & Toast
        analyzingOverlay: document.getElementById('analyzing-overlay'),
        toast: document.getElementById('toast'),
        statusTime: document.getElementById('status-time')
    };

    // -------------------------------------------------------------
    // Helper Functions
    // -------------------------------------------------------------
    function showToast(msg) {
        if (!elements.toast) return;
        elements.toast.textContent = msg;
        elements.toast.classList.add('show');
        setTimeout(() => elements.toast.classList.remove('show'), 2500);
    }

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        if (elements.statusTime) elements.statusTime.textContent = `${hours}:${minutes}`;
    }
    setInterval(updateClock, 10000);
    updateClock();

    function navigateTo(viewName) {
        state.activeView = viewName;
        Object.entries(elements.views).forEach(([name, el]) => {
            if (name === viewName) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // View specific activations
        if (viewName === 'camera') {
            startCamera();
        } else {
            stopCamera();
        }

        if (viewName === 'home') {
            refreshHomeUI();
        } else if (viewName === 'results') {
            renderResultsTable();
        }
    }

    // -------------------------------------------------------------
    // Authentication & Nickname
    // -------------------------------------------------------------
    function handleLogin(providerName) {
        state.currentUser.isLoggedIn = true;
        localStorage.setItem('yls_user_logged_in', 'true');
        showToast(`${providerName} 계정으로 로그인되었습니다.`);
        navigateTo('home');
    }

    if (elements.btnLoginGoogle) elements.btnLoginGoogle.addEventListener('click', () => handleLogin('Google'));
    if (elements.btnLoginKakao) elements.btnLoginKakao.addEventListener('click', () => handleLogin('카카오'));
    if (elements.btnLoginNaver) elements.btnLoginNaver.addEventListener('click', () => handleLogin('네이버'));
    if (elements.btnLoginEmail) elements.btnLoginEmail.addEventListener('click', () => handleLogin('이메일'));

    function refreshHomeUI() {
        const nick = state.currentUser.nickname;
        if (nick) {
            elements.nicknameSetupBox.style.display = 'none';
            elements.greetingBanner.style.display = 'flex';
            elements.userDisplayName.textContent = nick;
        } else {
            elements.nicknameSetupBox.style.display = 'block';
            elements.greetingBanner.style.display = 'none';
            elements.inputNickname.value = '';
        }
    }

    if (elements.btnSaveNickname) {
        elements.btnSaveNickname.addEventListener('click', () => {
            const val = elements.inputNickname.value.trim();
            if (!val) {
                showToast('닉네임을 입력해 주세요.');
                return;
            }
            state.currentUser.nickname = val;
            state.currentUser.id = val;
            localStorage.setItem('yls_user_nickname', val);
            showToast('닉네임이 설정되었습니다.');
            refreshHomeUI();
        });
    }

    if (elements.btnChangeNickname) {
        elements.btnChangeNickname.addEventListener('click', () => {
            elements.nicknameSetupBox.style.display = 'block';
            elements.greetingBanner.style.display = 'none';
            elements.inputNickname.value = state.currentUser.nickname;
            elements.inputNickname.focus();
        });
    }

    if (elements.btnStartTest) {
        elements.btnStartTest.addEventListener('click', () => {
            if (!state.currentUser.nickname) {
                showToast('검사를 시작하기 전에 닉네임을 먼저 설정해 주세요.');
                elements.inputNickname.focus();
                return;
            }
            navigateTo('camera');
        });
    }

    if (elements.btnViewHistory) {
        elements.btnViewHistory.addEventListener('click', () => {
            navigateTo('results');
        });
    }

    // -------------------------------------------------------------
    // Camera Handling: Multi-lens Auto Detection, Switching & Autofocus
    // -------------------------------------------------------------
    async function updateAvailableCameras() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter(d => d.kind === 'videoinput');

            // Sort cameras: prioritize back/rear standard/main cameras over ultra-wide
            videoInputs.sort((a, b) => {
                const labelA = (a.label || '').toLowerCase();
                const labelB = (b.label || '').toLowerCase();
                
                // Penalize front cameras
                const isFrontA = labelA.includes('front') || labelA.includes('user') || labelA.includes('전면');
                const isFrontB = labelB.includes('front') || labelB.includes('user') || labelB.includes('전면');
                if (isFrontA !== isFrontB) return isFrontA ? 1 : -1;

                // Penalize ultra-wide (0.5x)
                const isUltraA = labelA.includes('ultra') || labelA.includes('wide 0') || labelA.includes('0.5');
                const isUltraB = labelB.includes('ultra') || labelB.includes('wide 0') || labelB.includes('0.5');
                if (isUltraA !== isUltraB) return isUltraA ? 1 : -1;

                // Prioritize main / 1x standard
                const isMainA = labelA.includes('main') || labelA.includes('back 0') || labelA.includes('standard') || labelA.includes('1x');
                const isMainB = labelB.includes('main') || labelB.includes('back 0') || labelB.includes('standard') || labelB.includes('1x');
                if (isMainA !== isMainB) return isMainA ? -1 : 1;

                return 0;
            });

            state.videoDevices = videoInputs;
            return videoInputs;
        } catch (e) {
            console.warn('Failed to enumerate video devices:', e);
            return [];
        }
    }

    async function startCamera(switchNext = false) {
        try {
            stopCamera();

            // Refresh device list
            const devices = await updateAvailableCameras();

            if (switchNext && devices.length > 1) {
                state.currentCameraIndex = (state.currentCameraIndex + 1) % devices.length;
            } else if (!switchNext && state.currentCameraIndex >= devices.length) {
                state.currentCameraIndex = 0;
            }

            const selectedDevice = devices[state.currentCameraIndex];
            const deviceId = selectedDevice ? selectedDevice.deviceId : undefined;

            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    facingMode: deviceId ? undefined : { ideal: 'environment' },
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    focusMode: { ideal: 'continuous' },
                    advanced: [
                        { focusMode: 'continuous' }
                    ]
                },
                audio: false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.stream = stream;
            elements.cameraVideo.srcObject = stream;
            await elements.cameraVideo.play();

            // Apply hardware focus constraints if supported
            const track = stream.getVideoTracks()[0];
            if (track && typeof track.applyConstraints === 'function') {
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    if (caps.focusMode && caps.focusMode.includes('continuous')) {
                        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
                    }
                } catch (focusErr) {
                    console.log('Focus constraint note:', focusErr);
                }
            }

            if (devices.length === 0 || !devices[0].label) {
                await updateAvailableCameras();
            }

            const currentDev = state.videoDevices[state.currentCameraIndex];
            const camName = currentDev && currentDev.label ? currentDev.label : `카메라 ${state.currentCameraIndex + 1}`;
            if (switchNext) {
                showToast(`카메라 전환: ${camName}`);
            }
        } catch (err) {
            console.warn('Camera access error:', err);
            showToast('카메라 접근 권한이 없거나 지원되지 않아 시뮬레이션 모드를 사용합니다.');
        }
    }

    function stopCamera() {
        if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
            state.stream = null;
        }
    }

    if (elements.btnCameraBack) {
        elements.btnCameraBack.addEventListener('click', () => {
            navigateTo('home');
        });
    }

    if (elements.btnSwitchCamera) {
        elements.btnSwitchCamera.addEventListener('click', async () => {
            await startCamera(true);
        });
    }

    if (elements.btnToggleFlash) {
        elements.btnToggleFlash.addEventListener('click', async () => {
            if (!state.stream) return;
            const track = state.stream.getVideoTracks()[0];
            if (track && typeof track.applyConstraints === 'function') {
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    if (caps.torch) {
                        const currentTorch = track.getSettings().torch || false;
                        await track.applyConstraints({ advanced: [{ torch: !currentTorch }] });
                        showToast(!currentTorch ? '플래시 켜짐' : '플래시 꺼짐');
                    } else {
                        showToast('이 기기는 플래시 제어를 지원하지 않습니다.');
                    }
                } catch (e) {
                    showToast('플래시 제어 불가');
                }
            }
        });
    }

    if (elements.btnCapturePhoto) {
        elements.btnCapturePhoto.addEventListener('click', () => {
            let captureCanvas;
            if (state.stream && elements.cameraVideo.videoWidth > 0) {
                const vw = elements.cameraVideo.videoWidth;
                const vh = elements.cameraVideo.videoHeight;
                captureCanvas = document.createElement('canvas');
                captureCanvas.width = vw;
                captureCanvas.height = vh;
                const ctx = captureCanvas.getContext('2d');
                ctx.drawImage(elements.cameraVideo, 0, 0, vw, vh);
            } else {
                // Use default synthetic sample if camera not streaming
                captureCanvas = LFATestSamples.createSyntheticKit({
                    cLine: 0.88,
                    tLine: 0.45,
                    noise: 0.02
                });
            }

            openConfirmationModal(captureCanvas);
        });
    }

    function openConfirmationModal(canvas) {
        state.capturedCanvas = canvas;
        const pCanvas = elements.confirmPreviewCanvas;
        pCanvas.width = canvas.width;
        pCanvas.height = canvas.height;
        const ctx = pCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);

        elements.modalConfirm.classList.add('active');
    }

    if (elements.btnConfirmNo) {
        elements.btnConfirmNo.addEventListener('click', () => {
            elements.modalConfirm.classList.remove('active');
            state.capturedCanvas = null;
        });
    }

    if (elements.btnConfirmYes) {
        elements.btnConfirmYes.addEventListener('click', async () => {
            elements.modalConfirm.classList.remove('active');
            if (!state.capturedCanvas) return;

            // Show Analysis Loading Animation
            elements.analyzingOverlay.classList.add('active');

            try {
                // Execute Robust AI Optical Analysis
                const result = await state.analyzer.analyze(state.capturedCanvas);
                state.lastAnalysisResult = result;

                // Save result to History
                saveResultRecord(result);

                // Auto-sync to Google Sheets if configured (safe try-catch to never block UI)
                try {
                    if (state.sheetsSync && typeof state.sheetsSync.isConfigured === 'function' && state.sheetsSync.isConfigured()) {
                        state.sheetsSync.syncResult(result, state.currentUser).catch(err => {
                            console.warn('Auto Google Sheets sync skipped/failed:', err);
                        });
                    }
                } catch (syncErr) {
                    console.warn('Google sheets sync warning:', syncErr);
                }

                // Render Results View
                displayDiagnosticResult(result);
                navigateTo('results');
            } catch (err) {
                console.error('Diagnosis failure:', err);
                showToast('분석 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
            } finally {
                elements.analyzingOverlay.classList.remove('active');
            }
        });
    }

    // -------------------------------------------------------------
    // Results & Visualization
    // -------------------------------------------------------------
    function saveResultRecord(analysis) {
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const record = {
            id: 'REC_' + Date.now(),
            timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            dateStr: new Date().toISOString().split('T')[0],
            result: analysis.diagnosis.result,
            concentration: analysis.diagnosis.concentration,
            concentrationStr: analysis.diagnosis.concentrationStr,
            tcRatio: analysis.metrics.tcRatio,
            userNickname: state.currentUser.nickname
        };
        history.unshift(record);
        if (history.length > 50) history.pop();
        localStorage.setItem('yls_lfa_history', JSON.stringify(history));
    }

    function displayDiagnosticResult(analysis) {
        const diag = analysis.diagnosis;
        const res = diag.result; // '양성', '음성', '실패'

        elements.resultUserId.textContent = state.currentUser.nickname || 'yelloi';

        // Update Big Badge
        elements.latestResultBadge.className = 'status-badge-lg';
        elements.resultTagBadge.className = 'status-tag-badge';

        if (res === '양성') {
            elements.latestResultBadge.classList.add('badge-positive');
            elements.latestResultBadge.textContent = '양성 (검출)';
            elements.resultTagBadge.classList.add('badge-positive');
            elements.resultTagBadge.textContent = '양성';
            elements.resultValDisplay.textContent = `${diag.concentrationStr} mg/dL`;
        } else if (res === '음성') {
            elements.latestResultBadge.classList.add('badge-negative');
            elements.latestResultBadge.textContent = '음성 (정상)';
            elements.resultTagBadge.classList.add('badge-negative');
            elements.resultTagBadge.textContent = '음성';
            elements.resultValDisplay.textContent = '-';
        } else {
            elements.latestResultBadge.classList.add('badge-invalid');
            elements.latestResultBadge.textContent = '검사 실패';
            elements.resultTagBadge.classList.add('badge-invalid');
            elements.resultTagBadge.textContent = '실패';
            elements.resultValDisplay.textContent = '-';
        }

        renderDetailedAnalysis(analysis);
    }

    function renderResultsTable() {
        const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
        const tbody = elements.resultsTableBody;
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #94a3b8; padding: 16px;">기록된 검사 결과가 없습니다.</td></tr>';
            return;
        }

        history.slice(0, 10).forEach(rec => {
            const tr = document.createElement('tr');
            let resultClass = 'col-negative';
            let resKorean = '음성';
            let valStr = rec.concentrationStr ? `${rec.concentrationStr} mg/dL` : '-';

            if (rec.result === '양성') {
                resultClass = 'col-positive';
                resKorean = '양성';
            } else if (rec.result === '실패' || rec.result === 'fail') {
                resultClass = 'col-fail';
                resKorean = '실패';
                valStr = '-';
            }

            tr.innerHTML = `
                <td class="col-date">${rec.timestamp || '-'}</td>
                <td class="${resultClass}">${resKorean}</td>
                <td>${valStr}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderDetailedAnalysis(analysis) {
        if (!analysis || !analysis.visualData) return;
        const vd = analysis.visualData;

        // Render Cropped Strip ROI Canvas (Upright: C-line at top, T-line/Sample Inlet at bottom)
        const stripC = elements.croppedStripCanvas;
        if (vd.stripCanvas) {
            stripC.width = vd.stripCanvas.width;
            stripC.height = vd.stripCanvas.height;
            const sCtx = stripC.getContext('2d');
            sCtx.clearRect(0, 0, stripC.width, stripC.height);
            sCtx.drawImage(vd.stripCanvas, 0, 0);
        }

        // Render 1D Optical Profile Graph
        const gCanvas = elements.profileGraphCanvas;
        const gCtx = gCanvas.getContext('2d');
        const gw = (gCanvas.width = gCanvas.parentElement.clientWidth || 240);
        const gh = (gCanvas.height = 140);

        gCtx.clearRect(0, 0, gw, gh);

        const profile = vd.greenProfile;
        const baseline = vd.baseline;
        const len = profile.length;

        if (len > 0) {
            // Find min and max for scaling
            let minP = 999, maxP = -999;
            for (let i = 0; i < len; i++) {
                if (profile[i] < minP) minP = profile[i];
                if (profile[i] > maxP) maxP = profile[i];
            }
            const range = Math.max(10, maxP - minP);

            // Draw Grid Lines
            gCtx.strokeStyle = '#f1f5f9';
            gCtx.lineWidth = 1;
            gCtx.beginPath();
            gCtx.moveTo(0, gh / 2); gCtx.lineTo(gw, gh / 2);
            gCtx.moveTo(0, gh * 0.25); gCtx.lineTo(gw, gh * 0.25);
            gCtx.moveTo(0, gh * 0.75); gCtx.lineTo(gw, gh * 0.75);
            gCtx.stroke();

            // Draw Baseline (Dashed Blue Line)
            gCtx.strokeStyle = '#3b82f6';
            gCtx.lineWidth = 1.5;
            gCtx.setLineDash([4, 4]);
            gCtx.beginPath();
            for (let i = 0; i < len; i++) {
                const x = (i / (len - 1)) * gw;
                const y = gh - ((baseline[i] - minP) / range) * (gh * 0.75) - gh * 0.12;
                if (i === 0) gCtx.moveTo(x, y); else gCtx.lineTo(x, y);
            }
            gCtx.stroke();
            gCtx.setLineDash([]);

            // Draw Green Profile (Solid Green Line)
            gCtx.strokeStyle = '#059669';
            gCtx.lineWidth = 2;
            gCtx.beginPath();
            for (let i = 0; i < len; i++) {
                const x = (i / (len - 1)) * gw;
                const y = gh - ((profile[i] - minP) / range) * (gh * 0.75) - gh * 0.12;
                if (i === 0) gCtx.moveTo(x, y); else gCtx.lineTo(x, y);
            }
            gCtx.stroke();

            // Highlight T-Line Peak (Left ~32% along flow)
            if (vd.tLineIndex > 0) {
                const tx = (vd.tLineIndex / (len - 1)) * gw;
                gCtx.fillStyle = 'rgba(239, 68, 68, 0.18)';
                gCtx.fillRect(tx - 10, 0, 20, gh);
                gCtx.fillStyle = '#dc2626';
                gCtx.font = 'bold 10px sans-serif';
                gCtx.fillText('T-Line', tx - 14, 14);
            }

            // Highlight C-Line Peak (Right ~76% along flow)
            if (vd.cLineIndex > 0) {
                const cx = (vd.cLineIndex / (len - 1)) * gw;
                gCtx.fillStyle = 'rgba(59, 130, 246, 0.18)';
                gCtx.fillRect(cx - 10, 0, 20, gh);
                gCtx.fillStyle = '#2563eb';
                gCtx.font = 'bold 10px sans-serif';
                gCtx.fillText('C-Line', cx - 14, 14);
            }
        }

        // Metrics
        const m = analysis.metrics;
        elements.metricTHeight.textContent = m.tPeakHeight ? m.tPeakHeight.toFixed(3) : '0.000';
        elements.metricCHeight.textContent = m.cPeakHeight ? m.cPeakHeight.toFixed(3) : '0.000';
        elements.metricTcRatio.textContent = m.tcRatio ? m.tcRatio.toFixed(3) : '-';
        elements.metricSnr.textContent = m.signalToNoise ? m.signalToNoise.toFixed(1) + ' dB' : '-';
    }

    if (elements.btnToggleDetails) {
        elements.btnToggleDetails.addEventListener('click', () => {
            const isShown = elements.analysisDetailsPanel.classList.toggle('show');
            elements.btnToggleDetails.querySelector('span').textContent = isShown ? 
                '정밀 AI 광학 프로파일 분석 접기' : '정밀 AI 광학 프로파일 분석 보기';
            if (isShown && state.lastAnalysisResult) {
                renderDetailedAnalysis(state.lastAnalysisResult);
            }
        });
    }

    if (elements.btnReturnHome) {
        elements.btnReturnHome.addEventListener('click', () => {
            navigateTo('home');
        });
    }

    // -------------------------------------------------------------
    // Sample Kits Modal
    // -------------------------------------------------------------
    if (elements.btnOpenSamples) {
        elements.btnOpenSamples.addEventListener('click', () => {
            populateSamplesList();
            elements.modalSamples.classList.add('active');
        });
    }

    if (elements.btnCloseSamples) {
        elements.btnCloseSamples.addEventListener('click', () => {
            elements.modalSamples.classList.remove('active');
        });
    }

    function populateSamplesList() {
        const container = elements.sampleListContainer;
        container.innerHTML = '';

        LFATestSamples.samples.forEach(sample => {
            const card = document.createElement('div');
            card.className = 'sample-card';
            card.innerHTML = `
                <div class="sample-title">${sample.name}</div>
                <div class="sample-desc">${sample.description}</div>
            `;
            card.addEventListener('click', () => {
                elements.modalSamples.classList.remove('active');
                const syntheticCanvas = LFATestSamples.createSyntheticKit(sample.params);
                openConfirmationModal(syntheticCanvas);
            });
            container.appendChild(card);
        });
    }

    // -------------------------------------------------------------
    // Google Sheets Modal & Sync
    // -------------------------------------------------------------
    if (elements.btnOpenSheetsSettings) {
        elements.btnOpenSheetsSettings.addEventListener('click', () => {
            const cfg = state.sheetsSync.getConfig ? state.sheetsSync.getConfig() : {};
            elements.inputSheetId.value = cfg.sheetId || '';
            elements.inputWebhookUrl.value = cfg.webhookUrl || '';
            elements.modalSheets.classList.add('active');
        });
    }

    if (elements.btnCloseSheets) {
        elements.btnCloseSheets.addEventListener('click', () => {
            elements.modalSheets.classList.remove('active');
        });
    }

    if (elements.btnSaveSheetsConfig) {
        elements.btnSaveSheetsConfig.addEventListener('click', () => {
            const sheetId = elements.inputSheetId.value.trim();
            const webhookUrl = elements.inputWebhookUrl.value.trim();
            state.sheetsSync.saveConfig({ sheetId, webhookUrl });
            elements.modalSheets.classList.remove('active');
            showToast('구글시트 연동 정보가 저장되었습니다.');
        });
    }

    // -------------------------------------------------------------
    // CSV Export
    // -------------------------------------------------------------
    if (elements.btnExportCsv) {
        elements.btnExportCsv.addEventListener('click', () => {
            const history = JSON.parse(localStorage.getItem('yls_lfa_history') || '[]');
            if (history.length === 0) {
                showToast('내보낼 검사 데이터가 없습니다.');
                return;
            }

            let csvContent = 'ID,Date,Time,User,Result,Concentration (mg/dL),T/C Ratio\n';
            history.forEach(r => {
                csvContent += `"${r.id}","${r.dateStr || ''}","${r.timestamp || ''}","${r.userNickname || ''}","${r.result}","${r.concentrationStr || ''}","${r.tcRatio || ''}"\n`;
            });

            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LFA_Test_Results_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('CSV 파일이 다운로드되었습니다.');
        });
    }

    // Initial View Startup
    if (state.currentUser.isLoggedIn) {
        navigateTo('home');
    } else {
        navigateTo('login');
    }
});
