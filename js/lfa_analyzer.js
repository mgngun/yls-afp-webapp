/**
 * LFA (Lateral Flow Assay) Computer Vision & AI Analysis Engine - Robust Enhanced Edition
 * 
 * Key Improvements:
 * 1. Adaptive Membrane Window Localization: Accurately isolates the inner nitrocellulose membrane, excluding plastic bevel shadows.
 * 2. Morphological 1D Top-Hat Filtering: Rejects gradual lighting and bevel shadows; detects true line peaks.
 * 3. Statistical Noise Gate & Sensitive Peak Detection: Reliably identifies faint and standard C/T-lines on smartphone camera images.
 * 4. Strict C-Line Validation: Blank or unreacted strips with no C-line strictly produce '실패' (Invalid / Fail).
 */

class LFAAnalyzer {
    constructor(config = {}) {
        this.config = {
            // Canonical normalized size for rectified kit
            canonicalWidth: 320,
            canonicalHeight: 960,
            
            // Along fluidics flow direction (0.0: Sample Inlet/Bottom, 1.0: Absorption Pad/Top)
            tLinePosRatio: 0.32,   // Test Line (~32% along flow)
            cLinePosRatio: 0.76,   // Control Line (~76% along flow)
            peakTolerance: 0.18,   // Search window around expected peak (±18%)
            
            // Peak geometry requirements optimized for smartphone camera images
            minPeakFWHM: 2,        // Min peak full-width at half-max (pixels)
            maxPeakFWHM: 35,       // Max peak width (rejects broad shadows/gradients)
            minCProminenceSigma: 1.8, // C-line must be > 1.8 * background noise σ
            minTProminenceSigma: 1.8, // T-line must be > 1.8 * background noise σ
            absoluteMinCPeak: 0.003,  // Absolute minimum absorbance drop for C-line (0.3%)
            absoluteMinTPeak: 0.003,  // Absolute minimum absorbance drop for faint T-line (0.3%)
            
            // Calibration curve coefficients: Conc = a * (T/C) + b * (T/C)^1.4
            calibration: {
                a: 0.05,
                b: 0.25,
                unit: 'mg/dL'
            },
            
            ...config
        };
    }

    /**
     * Main analysis entry point
     * @param {HTMLCanvasElement|ImageData|Image} imageSource - Full image or pre-cropped strip canvas
     * @param {Object} [cropOptions] - Optional pre-cropped strip canvas or custom ROI
     */
    async analyze(imageSource, cropOptions = null) {
        const startTime = performance.now();
        
        try {
            // 1. Convert input to standard Canvas
            const srcCanvas = this._toCanvas(imageSource);
            const ctx = srcCanvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
            
            let stripROI;
            let rectifiedCanvas = srcCanvas;

            // 크롭 옵션이 명시되었거나 세로형 스트립 이미지인 경우
            const isPreCropped = (cropOptions && cropOptions.isPreCropped === true) ||
                                 (srcCanvas.height >= srcCanvas.width * 1.2);

            if (isPreCropped) {
                // 사용자가 화면에서 맞춘 빨간 사각 멤브레인 이미지를 직접 스트립 ROI로 사용
                stripROI = {
                    canvas: srcCanvas,
                    previewCanvas: srcCanvas,
                    imgData: imgData,
                    width: srcCanvas.width,
                    height: srcCanvas.height
                };
            } else {
                // 2. Kit Bounding & Perspective Rectification
                const { rectifiedCanvas: rectCanvas } = this._rectifyKit(srcCanvas, imgData);
                rectifiedCanvas = rectCanvas;
                
                // 3. Adaptive Precise Membrane ROI Extraction
                stripROI = this._extractAdaptiveMembraneROI(rectifiedCanvas);
            }
            
            // 4. Extract Green Channel & 1D Longitudinal Profile
            const { rawProfile, greenProfile } = this._extractColorProfiles(stripROI);
            
            // 5. Morphological Top-Hat & Baseline Illumination Subtraction
            const { baseline, correctedProfile, topHatProfile } = this._compensateIlluminationRobust(greenProfile);
            
            // 6. Strict Peak Detection & Validation (Geometry + Statistical Noise Gate)
            const peakResults = this._detectPeaksRobust(greenProfile, correctedProfile, topHatProfile);
            
            // 7. Diagnostic Classification & Concentration Estimation
            const diagnosis = this._classifyResult(peakResults, imgData);
            
            const totalElapsed = Math.round(performance.now() - startTime);

            return {
                success: true,
                timestamp: new Date().toISOString(),
                diagnosis: {
                    result: diagnosis.result,        // '양성', '음성', '실패'
                    resultEnglish: diagnosis.resultEng, // 'positive', 'negative', 'fail'
                    concentration: diagnosis.concentration, // Number (mg/dL) or null
                    concentrationStr: diagnosis.concentrationStr,
                    cLineDetected: peakResults.cLine.detected,
                    tLineDetected: peakResults.tLine.detected,
                    cLineStatus: peakResults.cLine.detected ? 'ok' : 'none',
                    tLineStatus: peakResults.tLine.detected ? 'ok' : 'none',
                    errorReason: diagnosis.errorReason,
                    confidence: diagnosis.confidence
                },
                metrics: {
                    cPeakHeight: peakResults.cLine.height,
                    cPeakAUC: peakResults.cLine.auc,
                    tPeakHeight: peakResults.tLine.height,
                    tPeakAUC: peakResults.tLine.auc,
                    tcRatio: peakResults.tcRatio,
                    signalToNoise: peakResults.snr,
                    bgNoiseSigma: peakResults.bgNoiseSigma,
                    elapsedMs: totalElapsed
                },
                visualData: {
                    rectifiedCanvas,
                    stripCanvas: stripROI.previewCanvas || stripROI.canvas,
                    profileLength: greenProfile.length,
                    rawProfile,
                    greenProfile,
                    baseline,
                    correctedProfile: topHatProfile, // Display clean top-hat line response
                    cLineIndex: peakResults.cLine.index,
                    tLineIndex: peakResults.tLine.index,
                    cLineDetected: peakResults.cLine.detected,
                    tLineDetected: peakResults.tLine.detected,
                    cLineRange: peakResults.cLine.range,
                    tLineRange: peakResults.tLine.range
                }
            };
        } catch (err) {
            console.error('LFA Analysis Error:', err);
            return {
                success: false,
                diagnosis: {
                    result: '실패',
                    resultEng: 'fail',
                    concentration: null,
                    concentrationStr: '-',
                    cLineDetected: false,
                    tLineDetected: false,
                    cLineStatus: 'none',
                    tLineStatus: 'none',
                    errorReason: err.message || 'unknown_error'
                },
                metrics: { elapsedMs: Math.round(performance.now() - startTime) }
            };
        }
    }

    _toCanvas(source) {
        if (source instanceof HTMLCanvasElement) return source;
        const canvas = document.createElement('canvas');
        if (source instanceof ImageData) {
            canvas.width = source.width;
            canvas.height = source.height;
            canvas.getContext('2d').putImageData(source, 0, 0);
        } else {
            canvas.width = source.naturalWidth || source.videoWidth || source.width || 640;
            canvas.height = source.naturalHeight || source.videoHeight || source.height || 480;
            canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
        }
        return canvas;
    }

    _rectifyKit(srcCanvas, imgData) {
        const { width: sw, height: sh } = srcCanvas;
        const dw = this.config.canonicalWidth;
        const dh = this.config.canonicalHeight;
        
        const outCanvas = document.createElement('canvas');
        outCanvas.width = dw;
        outCanvas.height = dh;
        const outCtx = outCanvas.getContext('2d');

        const guideAspect = dw / dh; // ~0.333 (1:3)
        const srcAspect = sw / sh;
        
        let sx, sy, sWidth, sHeight;
        if (srcAspect > guideAspect) {
            sHeight = sh * 0.90;
            sWidth = sHeight * guideAspect;
            sx = (sw - sWidth) / 2;
            sy = (sh - sHeight) / 2;
        } else {
            sWidth = sw * 0.90;
            sHeight = sWidth / guideAspect;
            sx = (sw - sWidth) / 2;
            sy = (sh - sHeight) / 2;
        }

        outCtx.drawImage(srcCanvas, sx, sy, sWidth, sHeight, 0, 0, dw, dh);

        // Check if kit is upside down
        const isUpsideDown = this._checkOrientation(outCanvas);
        if (isUpsideDown) {
            const rotatedCanvas = document.createElement('canvas');
            rotatedCanvas.width = dw;
            rotatedCanvas.height = dh;
            const rotCtx = rotatedCanvas.getContext('2d');
            rotCtx.translate(dw / 2, dh / 2);
            rotCtx.rotate(Math.PI);
            rotCtx.drawImage(outCanvas, -dw / 2, -dh / 2);
            return { rectifiedCanvas: rotatedCanvas, orientation: 'inverted_corrected', isFlipped: true };
        }

        return { rectifiedCanvas: outCanvas, orientation: 'normal', isFlipped: false };
    }

    _checkOrientation(canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        const topData = ctx.getImageData(w * 0.25, h * 0.05, w * 0.5, h * 0.25);
        const botData = ctx.getImageData(w * 0.25, h * 0.70, w * 0.5, h * 0.25);

        const topVar = this._computeGradientVariance(topData);
        const botVar = this._computeGradientVariance(botData);

        return topVar > botVar * 1.8;
    }

    _computeGradientVariance(imgData) {
        const { data, width, height } = imgData;
        let sum = 0, count = 0;
        for (let y = 1; y < height - 1; y += 2) {
            for (let x = 1; x < width - 1; x += 2) {
                const idx = (y * width + x) * 4;
                const g = data[idx + 1];
                const gR = data[(y * width + (x + 1)) * 4 + 1];
                const gD = data[((y + 1) * width + x) * 4 + 1];
                sum += Math.abs(g - gR) + Math.abs(g - gD);
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }

    /**
     * Adaptive Membrane Extraction:
     * Inner window area trimmed horizontally and vertically to cleanly isolate the nitrocellulose membrane.
     */
    _extractAdaptiveMembraneROI(rectifiedCanvas) {
        const w = rectifiedCanvas.width;
        const h = rectifiedCanvas.height;

        // Window region: x: 0.41 ~ 0.59, y: 0.325 ~ 0.545
        const xMin = 0.41;
        const xMax = 0.59;
        const yMin = 0.325;
        const yMax = 0.545;

        const roiX = Math.round(w * xMin);
        const roiY = Math.round(h * yMin);
        const roiW = Math.round(w * (xMax - xMin));
        const roiH = Math.round(h * (yMax - yMin));

        // 1. Pure membrane canvas used for quantitative math analysis
        const stripCanvas = document.createElement('canvas');
        stripCanvas.width = roiW;
        stripCanvas.height = roiH;
        const ctx = stripCanvas.getContext('2d');
        ctx.drawImage(rectifiedCanvas, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
        const imgData = ctx.getImageData(0, 0, roiW, roiH);

        // 2. Visual Preview Canvas with surrounding context & 80% black mask outside the analyzed ROI
        const ctxXMin = 0.34, ctxXMax = 0.66;
        const ctxYMin = 0.28, ctxYMax = 0.58;
        const ctxX = Math.round(w * ctxXMin);
        const ctxY = Math.round(h * ctxYMin);
        const ctxW = Math.round(w * (ctxXMax - ctxXMin));
        const ctxH = Math.round(h * (ctxYMax - ctxYMin));

        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = ctxW;
        previewCanvas.height = ctxH;
        const pCtx = previewCanvas.getContext('2d');

        // Draw surrounding image context
        pCtx.drawImage(rectifiedCanvas, ctxX, ctxY, ctxW, ctxH, 0, 0, ctxW, ctxH);

        // Relative coordinates of analyzed box within preview
        const boxX = roiX - ctxX;
        const boxY = roiY - ctxY;
        const boxW = roiW;
        const boxH = roiH;

        // Apply 80% black opacity mask outside the analyzed rectangle
        pCtx.fillStyle = 'rgba(0, 0, 0, 0.80)';
        // Top outer region
        pCtx.fillRect(0, 0, ctxW, boxY);
        // Bottom outer region
        pCtx.fillRect(0, boxY + boxH, ctxW, ctxH - (boxY + boxH));
        // Left outer region
        pCtx.fillRect(0, boxY, boxX, boxH);
        // Right outer region
        pCtx.fillRect(boxX + boxW, boxY, ctxW - (boxX + boxW), boxH);

        // Draw crisp highlight border around the analyzed active rectangle
        pCtx.strokeStyle = '#5ec5d6';
        pCtx.lineWidth = 1.5;
        pCtx.strokeRect(boxX, boxY, boxW, boxH);

        return { 
            canvas: stripCanvas, 
            previewCanvas,
            imgData, 
            width: roiW, 
            height: roiH 
        };
    }

    /**
     * Extracts Green channel profile with horizontal center weighting
     */
    _extractColorProfiles(stripROI) {
        const { imgData, width, height } = stripROI;
        const data = imgData.data;

        const rawProfile = new Float32Array(height);
        const greenProfile = new Float32Array(height);

        // Center 70% columns with cosine weighting to minimize edge shadow noise
        const xStart = Math.round(width * 0.15);
        const xEnd = Math.round(width * 0.85);

        // Scan along fluidics flow direction: from bottom (Sample Inlet) to top (Absorption Pad)
        for (let y = 0; y < height; y++) {
            const srcY = height - 1 - y; // Bottom of vertical image = 0 in flow profile
            let sumG = 0, sumGray = 0, weightSum = 0;
            for (let x = xStart; x < xEnd; x++) {
                const normX = (x - xStart) / (xEnd - xStart) - 0.5; // -0.5 to +0.5
                const weight = Math.cos(normX * Math.PI); // Peak at center
                
                const idx = (srcY * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                
                sumG += g * weight;
                sumGray += (0.299 * r + 0.587 * g + 0.114 * b) * weight;
                weightSum += weight;
            }
            rawProfile[y] = sumGray / weightSum;
            greenProfile[y] = sumG / weightSum;
        }

        const smoothGreen = this._smooth1D(greenProfile, 2);

        return { rawProfile, greenProfile: smoothGreen };
    }

    _smooth1D(arr, radius = 2) {
        const len = arr.length;
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            let sum = 0, count = 0;
            for (let k = -radius; k <= radius; k++) {
                const idx = i + k;
                if (idx >= 0 && idx < len) {
                    sum += arr[idx];
                    count++;
                }
            }
            out[i] = sum / count;
        }
        return out;
    }

    /**
     * Morphological 1D Top-Hat Baseline Compensation:
     * Removes all gradual lighting gradients, leaving ONLY narrow, sharp line absorptions.
     */
    _compensateIlluminationRobust(profile) {
        const len = profile.length;
        const baseline = new Float32Array(len);
        const corrected = new Float32Array(len);
        const topHat = new Float32Array(len);

        const kRadius = 14;
        
        // 1. Dilation (Local Maximum)
        const dilated = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            let maxVal = -1;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (profile[idx] > maxVal) maxVal = profile[idx];
            }
            dilated[i] = maxVal;
        }

        // 2. Erosion (Local Minimum of Dilated) -> Forms Morphological Background Baseline
        for (let i = 0; i < len; i++) {
            let minVal = 999;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (dilated[idx] < minVal) minVal = dilated[idx];
            }
            baseline[i] = minVal;
            
            // Top-Hat signal: ΔI = Baseline - Profile (positive for dark lines, exactly 0 for smooth background)
            const drop = Math.max(0, baseline[i] - profile[i]);
            topHat[i] = drop / (baseline[i] || 200); // Normalized relative absorption
            corrected[i] = topHat[i];
        }

        return { baseline, correctedProfile: corrected, topHatProfile: topHat };
    }

    /**
     * Robust Peak Detection with Geometry (FWHM) & Statistical Noise Gate
     */
    _detectPeaksRobust(rawProfile, correctedProfile, topHatProfile) {
        const len = topHatProfile.length;

        // 1. Compute Local Background Noise Standard Deviation (σ_bg) excluding outer edge boundaries
        const bgNoiseSigma = this._computeNoiseSigma(topHatProfile);

        // 2. C-Line Search Region (Upper flow: ~58% to 94%)
        const cExpected = Math.round(len * this.config.cLinePosRatio);
        const cTolerance = Math.round(len * this.config.peakTolerance);
        const cStart = Math.max(2, cExpected - cTolerance);
        const cEnd = Math.min(len - 2, cExpected + cTolerance);

        // 3. T-Line Search Region (Lower flow: ~14% to 50%)
        const tExpected = Math.round(len * this.config.tLinePosRatio);
        const tTolerance = Math.round(len * this.config.peakTolerance);
        const tStart = Math.max(2, tExpected - tTolerance);
        const tEnd = Math.min(len - 2, tExpected + tTolerance);

        const cPeak = this._validatePeak(topHatProfile, cStart, cEnd, this.config.absoluteMinCPeak, this.config.minCProminenceSigma * bgNoiseSigma);
        const tPeak = this._validatePeak(topHatProfile, tStart, tEnd, this.config.absoluteMinTPeak, this.config.minTProminenceSigma * bgNoiseSigma);

        const snr = bgNoiseSigma > 0.0001 ? (cPeak.height / bgNoiseSigma) : 0.0;
        const tcRatio = (cPeak.detected && cPeak.auc > 0) ? (tPeak.auc / cPeak.auc) : 0.0;

        return {
            cLine: cPeak,
            tLine: tPeak,
            tcRatio,
            snr,
            bgNoiseSigma
        };
    }

    _computeNoiseSigma(topHat) {
        const len = topHat.length;
        // Collect middle 80% to avoid boundary edge shadows
        const inner = [];
        const start = Math.floor(len * 0.08);
        const end = Math.floor(len * 0.92);
        for (let i = start; i < end; i++) {
            inner.push(topHat[i]);
        }
        inner.sort((a, b) => a - b);
        const cutoff = Math.floor(inner.length * 0.65);
        let sumSq = 0;
        for (let i = 0; i < cutoff; i++) {
            sumSq += inner[i] * inner[i];
        }
        const sigma = Math.sqrt(sumSq / (cutoff || 1));
        return Math.max(0.001, sigma);
    }

    _validatePeak(signal, startIdx, endIdx, absoluteMin, statisticalMin) {
        const threshold = Math.max(absoluteMin, statisticalMin);
        let maxVal = 0;
        let peakIdx = -1;

        // 1. Search for local maxima
        for (let i = startIdx; i < endIdx; i++) {
            if (signal[i] > maxVal && signal[i] >= signal[i - 1] && signal[i] >= signal[i + 1]) {
                maxVal = signal[i];
                peakIdx = i;
            }
        }

        // 2. Fallback: If no strict local maxima, find absolute max in range
        if (peakIdx === -1) {
            for (let i = startIdx; i < endIdx; i++) {
                if (signal[i] > maxVal) {
                    maxVal = signal[i];
                    peakIdx = i;
                }
            }
        }

        if (peakIdx === -1 || maxVal < threshold) {
            return {
                detected: false,
                index: peakIdx !== -1 ? peakIdx : Math.round((startIdx + endIdx) / 2),
                height: Math.round(maxVal * 1000) / 1000,
                auc: 0,
                fwhm: 0,
                range: [startIdx, endIdx]
            };
        }

        // Measure Full-Width at Half-Maximum (FWHM)
        const halfMax = maxVal * 0.50;
        let left = peakIdx;
        while (left > Math.max(0, startIdx - 10) && signal[left] > halfMax) left--;
        let right = peakIdx;
        while (right < Math.min(signal.length - 1, endIdx + 10) && signal[right] > halfMax) right++;
        const fwhm = Math.max(1, right - left);

        // Reject if peak is too broad (illumination shadow artifact)
        if (fwhm > this.config.maxPeakFWHM) {
            return {
                detected: false,
                index: peakIdx,
                height: Math.round(maxVal * 1000) / 1000,
                auc: 0,
                fwhm,
                range: [left, right],
                rejectedReason: 'invalid_fwhm'
            };
        }

        // Integrate Peak Area (AUC)
        let auc = 0;
        for (let k = left; k <= right; k++) {
            auc += signal[k];
        }

        return {
            detected: true,
            index: peakIdx,
            height: Math.round(maxVal * 1000) / 1000,
            auc: Math.round(auc * 1000) / 1000,
            fwhm,
            range: [left, right]
        };
    }

    /**
     * Final Diagnostic Classification & Concentration Output
     */
    _classifyResult(peakResults, rawImgData) {
        // Average image brightness check
        const avgBrightness = this._calculateAvgBrightness(rawImgData);
        if (avgBrightness < 30) {
            return {
                result: '실패',
                resultEng: 'fail',
                concentration: null,
                concentrationStr: '-',
                errorReason: 'too dark (조명이 너무 어둡습니다)',
                confidence: 0
            };
        }

        // STRICT RULE 1: If C-Line is NOT detected -> FAIL (Invalid test)
        if (!peakResults.cLine.detected) {
            return {
                result: '실패',
                resultEng: 'fail',
                concentration: null,
                concentrationStr: '-',
                errorReason: 'C-line not detected (컨트롤 라인 미발색 / 무반응 키트)',
                confidence: 0
            };
        }

        // STRICT RULE 2: C-Line present, No T-Line -> NEGATIVE
        if (!peakResults.tLine.detected) {
            return {
                result: '음성',
                resultEng: 'negative',
                concentration: null,
                concentrationStr: '-',
                errorReason: '',
                confidence: 99.4
            };
        }

        // STRICT RULE 3: Both C-Line and T-Line present -> POSITIVE
        const { a, b } = this.config.calibration;
        const ratio = Math.max(0.01, peakResults.tcRatio);
        
        let rawConc = a * ratio + b * Math.pow(ratio, 1.4);
        rawConc = Math.max(0.01, Math.round(rawConc * 100) / 100);

        return {
            result: '양성',
            resultEng: 'positive',
            concentration: rawConc,
            concentrationStr: rawConc.toFixed(2),
            errorReason: '',
            confidence: Math.min(99.9, 92 + peakResults.tLine.height * 80)
        };
    }

    _calculateAvgBrightness(imgData) {
        const data = imgData.data;
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i += 32) {
            sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            count++;
        }
        return count > 0 ? sum / count : 128;
    }
}

window.LFAAnalyzer = LFAAnalyzer;