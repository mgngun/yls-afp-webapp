/**
 * YLS LFA Kit AI Diagnostic WebApp Controller
 * Handles user authentication, camera lifecycle, state machine, and UI interactions
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

    elements.btnLoginGoogle.addEventListener('click', () => handleLogin('Google'));
    elements.btnLoginKakao.addEventListener('click', () => handleLogin('카카오'));
    elements.btnLoginNaver.addEventListener('click', () => handleLogin('네이버'));
    elements.btnLoginEmail.addEventListener('click', () => handleLogin('이메일'));

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

    elements.btnChangeNickname.addEventListener('click', () => {
        elements.nicknameSetupBox.style.display = 'block';
        elements.greetingBanner.style.display = 'none';
        elements.inputNickname.value = state.currentUser.nickname;
        elements.inputNickname.focus();
    });

    elements.btnStartTest.addEventListener('click', () => {
        if (!state.currentUser.nickname) {
            showToast('검사를 시작하기 전에 닉네임을 먼저 설정해 주세요.');
            elements.inputNickname.focus();
            return;
        }
        navigateTo('camera');
    });

    elements.btnViewHistory.addEventListener('click', () => {
        navigateTo('results');
    });

    // -------------------------------------------------------------
    // Camera Handling & Frame Capture
    // -------------------------------------------------------------
    async function startCamera() {
        try {
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.stream = stream;
            elements.cameraVideo.srcObject = stream;
            await elements.cameraVideo.play();
        } catch (err) {
            console.warn('Camera access denied or unavailable:', err);
            showToast('카메라 접근 권한이 없거나 지원되지 않아 시뮬레이션 모드를 사용합니다.');
        }
    }

    function stopCamera() {
        if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
            state.stream = null;
        }
    }

    elements.btnCameraBack.addEventListener('click', () => {
        navigateTo('home');
    });

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

    function openConfirmationModal(canvas) {
        state.capturedCanvas = canvas;
        const pCanvas = elements.confirmPreviewCanvas;
        pCanvas.width = canvas.width;
        pCanvas.height = canvas.height;
        const ctx = pCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);

        elements.modalConfirm.classList.add('active');
    }

    elements.btnConfirmNo.addEventListener('click', () => {
        elements.modalConfirm.classList.remove('active');
        state.capturedCanvas = null;
        showToast('재촬영을 진행합니다.');
    });

    elements.btnConfirmYes.addEventListener('click', async () => {
        elements.modalConfirm.classList.remove('active');
        if (!state.capturedCanvas) return;

        // Show analyzing overlay
        elements.analyzingOverlay.classList.add('active');

        // Execute LFA AI analysis
        setTimeout(async () => {
            const result = await state.analyzer.analyze(state.capturedCanvas);
            state.lastAnalysisResult = result;

            // Sync to Google Sheets and save to local history
            const record = {
                timestamp: formatTimestamp(new Date()),
                userId: state.currentUser.nickname || state.currentUser.id || 'yelloi',
                cLineStatus: result.diagnosis.cLineStatus,
                tLineStatus: result.diagnosis.tLineStatus,
                result: result.diagnosis.result,
                resultEnglish: result.diagnosis.resultEnglish,
                concentration: result.diagnosis.concentration,
                errorReason: result.diagnosis.errorReason
            };

            await state.sheetsSync.recordResult(record);

            elements.analyzingOverlay.classList.remove('active');
            navigateTo('results');
            renderDetailedAnalysis(result);
            showToast('검사 분석이 완료되었습니다.');
        }, 500);
    });

    // -------------------------------------------------------------
    // Test Sample Selector Modal (Simulation Mode)
    // -------------------------------------------------------------
    function setupSamplesModal() {
        const samples = LFATestSamples.getSamples();
        elements.sampleListContainer.innerHTML = '';

        samples.forEach(sample => {
            const card = document.createElement('div');
            card.className = 'sample-card';
            card.innerHTML = `
                <div class="sample-card-title">${sample.title}</div>
                <div class="sample-card-desc">${sample.description}</div>
            `;
            card.addEventListener('click', () => {
                elements.modalSamples.classList.remove('active');
                const canvas = sample.generate();
                openConfirmationModal(canvas);
            });
            elements.sampleListContainer.appendChild(card);
        });
    }

    elements.btnOpenSamples.addEventListener('click', () => {
        setupSamplesModal();
        elements.modalSamples.classList.add('active');
    });

    elements.btnCloseSamples.addEventListener('click', () => {
        elements.modalSamples.classList.remove('active');
    });

    // -------------------------------------------------------------
    // Results Rendering & Graph Plotting
    // -------------------------------------------------------------
    function formatTimestamp(d) {
        const pad = (n) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const minutes = pad(d.getMinutes());
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function renderResultsTable() {
        const queue = state.sheetsSync.getQueue();
        const tbody = elements.resultsTableBody;
        tbody.innerHTML = '';

        const currentNick = state.currentUser.nickname || 'yelloi';
        elements.resultUserId.textContent = currentNick;

        // Default mockup data if queue is empty
        const records = queue.length > 0 ? [...queue].reverse() : [
            { timestamp: '2026-08-28 10:11', result: 'positive', value: 0.01 },
            { timestamp: '2026-08-27 12:11', result: 'negative', value: '' },
            { timestamp: '2026-08-26 10:15', result: 'fail', value: '' }
        ];

        // Update latest result highlight card
        const latest = records[0];
        if (latest) {
            let resKorean = latest.result === 'positive' || latest.result === '양성' ? '양성' :
                            latest.result === 'negative' || latest.result === '음성' ? '음성' : '실패';
            
            elements.resultTagBadge.textContent = resKorean;
            elements.resultTagBadge.className = `result-tag ${resKorean === '양성' ? 'positive' : resKorean === '음성' ? 'negative' : 'fail'}`;
            elements.resultValDisplay.textContent = (resKorean === '양성' && latest.value !== undefined && latest.value !== '') ? Number(latest.value).toFixed(2) : '-';
        }

        // Render table rows matching format
        records.forEach(rec => {
            const tr = document.createElement('tr');
            const resKorean = rec.result === 'positive' || rec.result === '양성' ? '양성' :
                              rec.result === 'negative' || rec.result === '음성' ? '음성' : '실패';
            
            const resultClass = resKorean === '양성' ? 'col-result-positive' :
                                resKorean === '음성' ? 'col-result-negative' : 'col-result-fail';

            const valStr = (resKorean === '양성' && rec.value !== undefined && rec.value !== '') ? Number(rec.value).toFixed(2) : '-';

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
        const corrected = vd.correctedProfile;
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

            // Highlight T-Line Peak (Left ~28% along flow)
            if (vd.tLineIndex > 0) {
                const tx = (vd.tLineIndex / (len - 1)) * gw;
                gCtx.fillStyle = 'rgba(239, 68, 68, 0.18)';
                gCtx.fillRect(tx - 10, 0, 20, gh);
                gCtx.fillStyle = '#dc2626';
                gCtx.font = 'bold 10px sans-serif';
                gCtx.fillText('T-Line', tx - 14, 14);
            }

            // Highlight C-Line Peak (Right ~72% along flow)
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

    elements.btnToggleDetails.addEventListener('click', () => {
        const isShown = elements.analysisDetailsPanel.classList.toggle('show');
        elements.btnToggleDetails.querySelector('span').textContent = isShown ? 
            '정밀 AI 광학 프로파일 분석 접기' : '정밀 AI 광학 프로파일 분석 보기';
        if (isShown && state.lastAnalysisResult) {
            renderDetailedAnalysis(state.lastAnalysisResult);
        }
    });

    elements.btnReturnHome.addEventListener('click', () => {
        navigateTo('home');
    });

    // -------------------------------------------------------------
    // Google Sheets Config & CSV Export
    // -------------------------------------------------------------
    elements.btnOpenSheetsSettings.addEventListener('click', () => {
        const conf = state.sheetsSync.config;
        elements.inputSheetId.value = conf.sheetId || '';
        elements.inputWebhookUrl.value = conf.webhookUrl || '';
        elements.modalSheets.classList.add('active');
    });

    elements.btnCloseSheets.addEventListener('click', () => {
        elements.modalSheets.classList.remove('active');
    });

    elements.btnSaveSheetsConfig.addEventListener('click', () => {
        state.sheetsSync.saveConfig({
            sheetId: elements.inputSheetId.value.trim(),
            webhookUrl: elements.inputWebhookUrl.value.trim()
        });
        elements.modalSheets.classList.remove('active');
        showToast('구글 시트 연동 설정이 저장되었습니다.');
    });

    elements.btnExportCsv.addEventListener('click', () => {
        state.sheetsSync.exportCSV();
    });

    // -------------------------------------------------------------
    // Initial Route
    // -------------------------------------------------------------
    if (state.currentUser.isLoggedIn) {
        navigateTo('home');
    } else {
        navigateTo('login');
    }
});
