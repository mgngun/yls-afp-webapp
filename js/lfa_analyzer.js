/**
 * LFA (Lateral Flow Assay) Computer Vision & AI Analysis Engine v6 - Enhanced Signal Edition
 * 
 * Key Improvements over v5:
 * 1. Multi-Channel Color Opponent Response: R/G/B 채널 조합으로 컬러 라인 대비 극대화
 *    - Green absorbance (base) + Blue absorbance (support) - Red absorbance (shadow suppression)
 * 2. Multi-Scale Top-Hat: 커널 [8, 14, 22] 다중 스케일로 최적 baseline 추정
 * 3. Reduced Smoothing: radius 1 (3-tap)로 peak 보존율 향상
 * 4. Weak C-Line Acceptance: 절대 임계값 + SNR + FWHM + prominence 다중 검증
 * 5. Multi-channel noise estimation: 조합된 프로파일에서 noise 재산출
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
            peakTolerance: 0.15,   // Search window around expected peak (±15%)
            
            // Peak geometry requirements
            minPeakFWHM: 3,
            maxPeakFWHM: 40,
            minLocalProminence: 0.003,
            
            // Statistical noise gate
            minCProminenceSigma: 3.5,
            minTProminenceSigma: 3.0,
            
            // Weak C-line acceptance: 다중 기준 충족 시 낮은 절대값도 허용
            absoluteMinCPeak: 0.020,       // Standard threshold
            weakCMinPeak: 0.012,           // Weak threshold (다중 검증 필요)
            weakCMinSNR: 8.0,              // Weak C-line requires SNR >= 8
            absoluteMinTPeak: 0.009,
            weakTMinPeak: 0.006,
            weakTMinSNR: 6.0,
            
            // T/C ratio
            minTCRatio: 0.08,
            
            // Multi-scale top-hat kernel sizes
            topHatKernels: [8, 14, 22],
            
            // Calibration curve coefficients
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
     */
    async analyze(imageSource, cropOptions = null) {
        const startTime = performance.now();
        
        try {
            const srcCanvas = this._toCanvas(imageSource);
            const ctx = srcCanvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
            
            let stripROI;
            let rectifiedCanvas = srcCanvas;

            const isPreCropped = (cropOptions && cropOptions.isPreCropped === true) ||
                                 (srcCanvas.height >= srcCanvas.width * 1.2);

            if (isPreCropped) {
                stripROI = {
                    canvas: srcCanvas,
                    previewCanvas: srcCanvas,
                    imgData: imgData,
                    width: srcCanvas.width,
                    height: srcCanvas.height
                };
            } else {
                const { rectifiedCanvas: rectCanvas } = this._rectifyKit(srcCanvas, imgData);
                rectifiedCanvas = rectCanvas;
                stripROI = this._extractAdaptiveMembraneROI(rectifiedCanvas);
            }
            
            // 4. Extract Multi-Channel Color Profiles (R, G, B) + Segment Profiles
            const { rawProfile, greenProfile, multiProfiles, leftProfile, rightProfile } = this._extractColorProfiles(stripROI);
            
            // 5. Multi-Channel + Multi-Scale Top-Hat Signal Extraction
            const { baseline, correctedProfile, topHatProfile } = this._compensateIlluminationRobust(greenProfile, multiProfiles);
            
            // 5.5. Segment Top-Hat (left/right halves for spatial consistency)
            const leftTopHat = this._topHat1D(leftProfile, 14).topHat;
            const rightTopHat = this._topHat1D(rightProfile, 14).topHat;
            
            // 6. Peak Detection with Weak-Line Acceptance
            const peakResults = this._detectPeaksRobust(greenProfile, correctedProfile, topHatProfile);
            
            // 6.5. Spatial Consistency Validation: reject dots/artifacts
            this._validateSpatialConsistency(peakResults, stripROI, { leftTopHat, rightTopHat, fullTopHat: topHatProfile });
            
            // 7. Diagnostic Classification & Concentration
            const diagnosis = this._classifyResult(peakResults, imgData);
            
            const totalElapsed = Math.round(performance.now() - startTime);

            return {
                success: true,
                timestamp: new Date().toISOString(),
                diagnosis: {
                    result: diagnosis.result,
                    resultEnglish: diagnosis.resultEng,
                    concentration: diagnosis.concentration,
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
                    cLineMethod: peakResults.cLine.method || 'standard',
                    tLineMethod: peakResults.tLine.method || 'standard',
                    elapsedMs: totalElapsed
                },
                visualData: {
                    rectifiedCanvas,
                    stripCanvas: stripROI.previewCanvas || stripROI.canvas,
                    profileLength: greenProfile.length,
                    rawProfile,
                    greenProfile,
                    baseline,
                    correctedProfile: topHatProfile,
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
                    errorReason: err.message || 'unknown_error',
                    confidence: 0
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

        const guideAspect = dw / dh;
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

    _extractAdaptiveMembraneROI(rectifiedCanvas) {
        const w = rectifiedCanvas.width;
        const h = rectifiedCanvas.height;

        const xMin = 0.41;
        const xMax = 0.59;
        const yMin = 0.325;
        const yMax = 0.545;

        const roiX = Math.round(w * xMin);
        const roiY = Math.round(h * yMin);
        const roiW = Math.round(w * (xMax - xMin));
        const roiH = Math.round(h * (yMax - yMin));

        const stripCanvas = document.createElement('canvas');
        stripCanvas.width = roiW;
        stripCanvas.height = roiH;
        const ctx = stripCanvas.getContext('2d');
        ctx.drawImage(rectifiedCanvas, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
        const imgData = ctx.getImageData(0, 0, roiW, roiH);

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

        pCtx.drawImage(rectifiedCanvas, ctxX, ctxY, ctxW, ctxH, 0, 0, ctxW, ctxH);

        const boxX = roiX - ctxX;
        const boxY = roiY - ctxY;
        const boxW = roiW;
        const boxH = roiH;

        pCtx.fillStyle = 'rgba(0, 0, 0, 0.80)';
        pCtx.fillRect(0, 0, ctxW, boxY);
        pCtx.fillRect(0, boxY + boxH, ctxW, ctxH - (boxY + boxH));
        pCtx.fillRect(0, boxY, boxX, boxH);
        pCtx.fillRect(boxX + boxW, boxY, ctxW - (boxX + boxW), boxH);

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
     * Extract Multi-Channel Color Profiles (R, G, B) with horizontal center weighting
     * Also extracts left/right segment profiles for spatial consistency validation
     * Smoothing: radius=1 (3-tap) for better peak preservation
     */
    _extractColorProfiles(stripROI) {
        const { imgData, width, height } = stripROI;
        const data = imgData.data;

        const rProfile = new Float32Array(height);
        const gProfile = new Float32Array(height);
        const bProfile = new Float32Array(height);
        const rawProfile = new Float32Array(height);
        const leftProfile = new Float32Array(height);
        const rightProfile = new Float32Array(height);

        const xStart = Math.round(width * 0.15);
        const xEnd = Math.round(width * 0.85);
        const xMid = Math.round((xStart + xEnd) / 2);

        for (let y = 0; y < height; y++) {
            const srcY = height - 1 - y;
            let sumR = 0, sumG = 0, sumB = 0, sumGray = 0, weightSum = 0;
            let sumL = 0, sumR_half = 0, wL = 0, wR = 0;
            for (let x = xStart; x < xEnd; x++) {
                const normX = (x - xStart) / (xEnd - xStart) - 0.5;
                const weight = Math.cos(normX * Math.PI);
                
                const idx = (srcY * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                
                sumR += r * weight;
                sumG += g * weight;
                sumB += b * weight;
                sumGray += (0.299 * r + 0.587 * g + 0.114 * b) * weight;
                weightSum += weight;
                
                // Left/right segment profiles (simple average, no weighting)
                if (x < xMid) {
                    sumL += g;
                    wL++;
                } else {
                    sumR_half += g;
                    wR++;
                }
            }
            rProfile[y] = sumR / weightSum;
            gProfile[y] = sumG / weightSum;
            bProfile[y] = sumB / weightSum;
            rawProfile[y] = sumGray / weightSum;
            leftProfile[y] = sumL / wL;
            rightProfile[y] = sumR_half / wR;
        }

        // Light smoothing: radius=1 (3-tap) to preserve peak height
        const smoothR = this._smooth1D(rProfile, 1);
        const smoothG = this._smooth1D(gProfile, 1);
        const smoothB = this._smooth1D(bProfile, 1);
        const smoothGray = this._smooth1D(rawProfile, 1);
        const smoothLeft = this._smooth1D(leftProfile, 1);
        const smoothRight = this._smooth1D(rightProfile, 1);

        return { 
            rawProfile: smoothGray, 
            greenProfile: smoothG,
            multiProfiles: { r: smoothR, g: smoothG, b: smoothB },
            leftProfile: smoothLeft,
            rightProfile: smoothRight
        };
    }

    _smooth1D(arr, radius = 1) {
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
     * Compute 1D top-hat for a single profile and kernel size
     */
    _topHat1D(profile, kRadius) {
        const len = profile.length;
        const dilated = new Float32Array(len);
        const topHat = new Float32Array(len);
        const baseline = new Float32Array(len);
        
        // Dilation (local maximum)
        for (let i = 0; i < len; i++) {
            let maxVal = -1;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (profile[idx] > maxVal) maxVal = profile[idx];
            }
            dilated[i] = maxVal;
        }

        // Erosion (local minimum of dilated) → baseline
        for (let i = 0; i < len; i++) {
            let minVal = 999;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (dilated[idx] < minVal) minVal = dilated[idx];
            }
            baseline[i] = minVal;
            topHat[i] = Math.max(0, (minVal - profile[i]) / (minVal || 200));
        }
        
        return { topHat, baseline };
    }

    /**
     * Multi-Channel + Multi-Scale Top-Hat Signal Extraction
     * 
     * Color Opponent Response for colloidal gold (red/pink) LFA lines:
     *   gAbs = (baseG - G) / baseG   ← primary: green absorbance (gold absorbs green)
     *   bAbs = (baseB - B) / baseB   ← support: blue absorbance
     *   rAbs = (baseR - R) / baseR   ← suppress: red channel (shadows/angle artifacts)
     *   
     *   response = max(
     *     gAbs,
     *     0.75 * gAbs + 0.25 * bAbs,           ← green+blue blend
     *     0.85 * gAbs + 0.35 * bAbs - 0.20 * rAbs  ← opponent: boost colored lines, suppress neutral shadows
     *   )
     * 
     * Multi-scale: kRadius ∈ {8, 14, 22}, take max for optimal baseline at each position
     */
    _compensateIlluminationRobust(profile, multiProfiles) {
        const len = profile.length;
        const kernels = this.config.topHatKernels || [14];
        
        // If no multi-channel profiles, fall back to single-channel
        if (!multiProfiles) {
            const { topHat, baseline } = this._topHat1D(profile, kernels[0]);
            return { baseline, correctedProfile: topHat, topHatProfile: topHat };
        }

        const { r: rProf, g: gProf, b: bProf } = multiProfiles;
        
        // Compute top-hat for each channel at each scale
        const gResults = kernels.map(k => this._topHat1D(gProf, k));
        const bResults = kernels.map(k => this._topHat1D(bProf, k));
        const rResults = kernels.map(k => this._topHat1D(rProf, k));
        
        // Combine: multi-scale max for each channel
        const gAbs = new Float32Array(len);
        const bAbs = new Float32Array(len);
        const rAbs = new Float32Array(len);
        const baseline = new Float32Array(len);
        
        for (let i = 0; i < len; i++) {
            // Multi-scale max: pick the scale with highest signal
            let gMax = 0, bMax = 0, rMax = 0, bestBL = gProf[i];
            for (let s = 0; s < kernels.length; s++) {
                if (gResults[s].topHat[i] > gMax) {
                    gMax = gResults[s].topHat[i];
                    bestBL = gResults[s].baseline[i];
                }
                if (bResults[s].topHat[i] > bMax) bMax = bResults[s].topHat[i];
                if (rResults[s].topHat[i] > rMax) rMax = rResults[s].topHat[i];
            }
            gAbs[i] = gMax;
            bAbs[i] = bMax;
            rAbs[i] = rMax;
            baseline[i] = bestBL;
        }
        
        // Color Opponent Response: boost colored line contrast
        const topHat = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const g = gAbs[i];
            const b = bAbs[i];
            const r = rAbs[i];
            
            // Three response modes, take maximum:
            // 1. Pure green absorbance (best for strong gold lines)
            // 2. Green+Blue blend (captures broader color spectrum)
            // 3. Opponent: g+b boosted, red suppressed (suppresses neutral shadows from phone angle)
            const resp1 = g;
            const resp2 = 0.75 * g + 0.25 * b;
            const resp3 = 0.85 * g + 0.35 * b - 0.20 * r;
            
            topHat[i] = Math.max(0, Math.max(resp1, Math.max(resp2, resp3)));
        }
        
        return { baseline, correctedProfile: topHat, topHatProfile: topHat };
    }

    /**
     * Peak Detection with Weak-Line Acceptance
     * 
     * Standard: peak >= absoluteMin AND prominence >= minCProminenceSigma * σ
     * Weak:     peak >= weakCMinPeak AND SNR >= weakCMinSNR AND FWHM valid AND prominence valid
     */
    _detectPeaksRobust(rawProfile, correctedProfile, topHatProfile) {
        const len = topHatProfile.length;

        const bgNoiseSigma = this._computeNoiseSigma(topHatProfile);

        const cExpected = Math.round(len * this.config.cLinePosRatio);
        const cTolerance = Math.round(len * this.config.peakTolerance);
        const cStart = Math.max(4, cExpected - cTolerance);
        const cEnd = Math.min(len - 4, cExpected + cTolerance);

        const tExpected = Math.round(len * this.config.tLinePosRatio);
        const tTolerance = Math.round(len * this.config.peakTolerance);
        const tStart = Math.max(4, tExpected - tTolerance);
        const tEnd = Math.min(len - 4, tExpected + tTolerance);

        const cPeak = this._validatePeakEnhanced(topHatProfile, cStart, cEnd, bgNoiseSigma, 'C');
        const tPeak = this._validatePeakEnhanced(topHatProfile, tStart, tEnd, bgNoiseSigma, 'T');

        const relativeRatio = (cPeak.detected && cPeak.height > 0) ? (tPeak.height / cPeak.height) : 0;
        const aucRatio = (cPeak.detected && cPeak.auc > 0) ? (tPeak.auc / cPeak.auc) : 0;

        let tDetected = tPeak.detected;
        if (tDetected) {
            if (relativeRatio < this.config.minTCRatio || aucRatio < 0.05) {
                tDetected = false;
                tPeak.detected = false;
                tPeak.rejectedReason = 'insufficient_tc_ratio';
            }
        }

        const snr = bgNoiseSigma > 0.0001 ? (cPeak.height / bgNoiseSigma) : 0.0;
        const tcRatio = (cPeak.detected && tDetected) ? aucRatio : 0.0;

        return {
            cLine: cPeak,
            tLine: { ...tPeak, detected: tDetected },
            tcRatio,
            relativeRatio,
            snr,
            bgNoiseSigma
        };
    }

    _computeNoiseSigma(topHat) {
        const len = topHat.length;
        const inner = [];
        const start = Math.floor(len * 0.10);
        const end = Math.floor(len * 0.90);
        for (let i = start; i < end; i++) {
            inner.push(topHat[i]);
        }
        inner.sort((a, b) => a - b);
        const cutoff = Math.floor(inner.length * 0.60);
        let sumSq = 0;
        for (let i = 0; i < cutoff; i++) {
            sumSq += inner[i] * inner[i];
        }
        const sigma = Math.sqrt(sumSq / (cutoff || 1));
        return Math.max(0.0008, sigma);
    }

    /**
     * Enhanced peak validation with weak-line acceptance
     */
    _validatePeakEnhanced(signal, startIdx, endIdx, bgNoiseSigma, lineType = 'T') {
        const absoluteMin = lineType === 'C' ? this.config.absoluteMinCPeak : this.config.absoluteMinTPeak;
        const weakMin = lineType === 'C' ? this.config.weakCMinPeak : this.config.weakTMinPeak;
        const weakMinSNR = lineType === 'C' ? this.config.weakCMinSNR : this.config.weakTMinSNR;
        const statSigma = lineType === 'C' ? this.config.minCProminenceSigma : this.config.minTProminenceSigma;
        
        let maxVal = 0;
        let bestIdx = -1;
        let bestProminence = 0;

        for (let i = startIdx + 1; i <= endIdx - 1; i++) {
            if (signal[i] > maxVal) {
                maxVal = signal[i];
            }

            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
                const vLeft = Math.min(...signal.slice(Math.max(startIdx, i - 10), i));
                const vRight = Math.min(...signal.slice(i + 1, Math.min(signal.length, i + 11)));
                const prominence = signal[i] - Math.max(vLeft, vRight);

                if (prominence > bestProminence) {
                    bestProminence = prominence;
                    bestIdx = i;
                }
            }
        }

        const peakIdx = (bestIdx !== -1) ? bestIdx : -1;
        const peakHeight = (peakIdx !== -1) ? signal[peakIdx] : maxVal;
        const snr = bgNoiseSigma > 0.0001 ? (peakHeight / bgNoiseSigma) : 0;

        const minProm = this.config.minLocalProminence || 0.003;
        
        // No local maximum found
        if (peakIdx === -1) {
            return {
                detected: false,
                index: Math.round((startIdx + endIdx) / 2),
                height: Math.round(peakHeight * 1000) / 1000,
                auc: 0,
                fwhm: 0,
                snr: Math.round(snr * 10) / 10,
                range: [startIdx, endIdx],
                rejectedReason: 'no_local_maximum',
                method: 'none'
            };
        }

        // Measure FWHM
        const halfMax = peakHeight * 0.50;
        let left = peakIdx;
        while (left > Math.max(0, startIdx - 10) && signal[left] > halfMax) left--;
        let right = peakIdx;
        while (right < Math.min(signal.length - 1, endIdx + 10) && signal[right] > halfMax) right++;
        const fwhm = Math.max(1, right - left);

        // Check FWHM validity
        const fwhmValid = fwhm >= this.config.minPeakFWHM && fwhm <= this.config.maxPeakFWHM;
        
        // Check prominence
        const promValid = bestProminence >= minProm;
        
        // Standard threshold: absolute + statistical
        const statThreshold = statSigma * bgNoiseSigma;
        const standardThreshold = Math.max(absoluteMin, statThreshold);
        const passesStandard = peakHeight >= standardThreshold && fwhmValid && promValid;
        
        // Weak threshold: lower absolute, but requires strong SNR + valid FWHM + valid prominence
        const weakThreshold = Math.max(weakMin, statThreshold * 0.6);
        const passesWeak = peakHeight >= weakThreshold 
            && snr >= weakMinSNR 
            && fwhmValid 
            && promValid;

        if (passesStandard) {
            let auc = 0;
            for (let k = left; k <= right; k++) {
                auc += Math.max(0, signal[k]);
            }
            return {
                detected: true,
                index: peakIdx,
                height: Math.round(peakHeight * 1000) / 1000,
                auc: Math.round(auc * 1000) / 1000,
                fwhm,
                snr: Math.round(snr * 10) / 10,
                range: [left, right],
                rejectedReason: '',
                method: 'standard'
            };
        }
        
        if (passesWeak) {
            let auc = 0;
            for (let k = left; k <= right; k++) {
                auc += Math.max(0, signal[k]);
            }
            return {
                detected: true,
                index: peakIdx,
                height: Math.round(peakHeight * 1000) / 1000,
                auc: Math.round(auc * 1000) / 1000,
                fwhm,
                snr: Math.round(snr * 10) / 10,
                range: [left, right],
                rejectedReason: '',
                method: 'weak_acceptance'
            };
        }

        // Not detected — determine rejection reason
        let reason = 'below_threshold';
        if (!fwhmValid) reason = fwhm < this.config.minPeakFWHM ? 'invalid_fwhm_too_narrow' : 'invalid_fwhm_too_broad';
        else if (!promValid) reason = 'low_prominence';
        else if (peakHeight < weakThreshold) reason = 'below_threshold';
        else if (snr < weakMinSNR) reason = 'low_snr';

        return {
            detected: false,
            index: peakIdx,
            height: Math.round(peakHeight * 1000) / 1000,
            auc: 0,
            fwhm,
            snr: Math.round(snr * 10) / 10,
            range: [left, right],
            rejectedReason: reason,
            method: 'none'
        };
    }

    /**
     * Spatial Consistency Validation: Reject dots, specks, and localized artifacts
     * 
     * Uses LEFT/RIGHT segment profile consistency:
     * - A real LFA line spans the full membrane width → appears in BOTH left and right profiles
     * - A dot/speck is localized → appears in only ONE half's profile
     * 
     * Also uses pixel-level horizontal coverage as secondary check.
     */
    _validateSpatialConsistency(peakResults, stripROI, segmentData) {
        const { imgData, width, height } = stripROI;
        const data = imgData.data;
        const { leftTopHat, rightTopHat, fullTopHat } = segmentData;
        
        const xStart = Math.round(width * 0.15);
        const xEnd = Math.round(width * 0.85);
        
        for (const lineKey of ['cLine', 'tLine']) {
            const line = peakResults[lineKey];
            if (!line.detected || line.index < 0) continue;
            
            const peakIdx = line.index;
            const fullHeight = fullTopHat[peakIdx] || 0;
            
            // === CHECK 1: Left/Right Segment Consistency ===
            // A real line appears in both left and right half-profiles.
            // A dot only appears in the half where it's located.
            const leftVal = leftTopHat[peakIdx] || 0;
            const rightVal = rightTopHat[peakIdx] || 0;
            
            // For a real line: both segments should have >= 40% of the full-width signal
            // For a dot: one segment has most of the signal, the other has almost none
            const leftRatio = fullHeight > 0 ? leftVal / fullHeight : 0;
            const rightRatio = fullHeight > 0 ? rightVal / fullHeight : 0;
            
            // Also check neighborhood (±2 pixels) for robustness
            let leftMax = 0, rightMax = 0;
            for (let k = -2; k <= 2; k++) {
                const idx = peakIdx + k;
                if (idx >= 0 && idx < leftTopHat.length) {
                    if (leftTopHat[idx] > leftMax) leftMax = leftTopHat[idx];
                    if (rightTopHat[idx] > rightMax) rightMax = rightTopHat[idx];
                }
            }
            const leftMaxRatio = fullHeight > 0 ? leftMax / fullHeight : 0;
            const rightMaxRatio = fullHeight > 0 ? rightMax / fullHeight : 0;
            
            // The weaker half must have at least 30% of the full-width signal
            // This rejects dots that only appear in one half
            const minSegmentRatio = 0.30;
            
            // Use the max in neighborhood (more robust to slight position shifts)
            const weakerMaxRatio = Math.min(leftMaxRatio, rightMaxRatio);
            
            // === CHECK 2: Pixel-level horizontal coverage ===
            // At the peak row, count dark pixels across the width
            const srcY = height - 1 - peakIdx;
            let coverage = 0;
            if (srcY >= 0 && srcY < height) {
                const values = [];
                for (let x = xStart; x < xEnd; x++) {
                    const idx = (srcY * width + x) * 4;
                    const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                    values.push(gray);
                }
                const sorted = [...values].sort((a, b) => a - b);
                const median = sorted[Math.floor(sorted.length / 2)];
                
                // Compute IQR for noise estimation
                const q1 = sorted[Math.floor(sorted.length * 0.25)];
                const q3 = sorted[Math.floor(sorted.length * 0.75)];
                const iqr = q3 - q1;
                const noiseSigma = Math.max(iqr / 1.349, 1.0);
                
                // Threshold: median - max(2*noise, 5 pixels, 50% of expected drop)
                const rawDrop = line.height * (median || 200);
                const threshold = median - Math.max(noiseSigma * 2, 5, rawDrop * 0.5);
                
                let darkCount = 0;
                for (const v of values) {
                    if (v < threshold) darkCount++;
                }
                coverage = darkCount / values.length;
            }
            
            line.horizontalCoverage = Math.round(coverage * 100) / 100;
            line.leftSegmentRatio = Math.round(leftMaxRatio * 100) / 100;
            line.rightSegmentRatio = Math.round(rightMaxRatio * 100) / 100;
            
            // === DECISION ===
            // Reject if:
            // 1. Weaker segment has < 30% of full signal → localized artifact (dot in one half)
            // 2. OR pixel coverage < 20% AND weaker segment < 50% → small dot
            // 3. OR pixel coverage < 10% → very small artifact
            
            if (weakerMaxRatio < minSegmentRatio) {
                line.detected = false;
                line.rejectedReason = 'segment_inconsistent';
            } else if (coverage < 0.10) {
                line.detected = false;
                line.rejectedReason = 'insufficient_coverage';
            } else if (coverage < 0.20 && weakerMaxRatio < 0.50) {
                line.detected = false;
                line.rejectedReason = 'localized_artifact';
            }
        }
        
        // Update tcRatio after spatial validation
        if (!peakResults.tLine.detected) {
            peakResults.tcRatio = 0;
            peakResults.relativeRatio = 0;
        }
        
        // Recompute SNR
        const snr = peakResults.bgNoiseSigma > 0.0001 
            ? (peakResults.cLine.height / peakResults.bgNoiseSigma) 
            : 0.0;
        peakResults.snr = snr;
    }

    _classifyResult(peakResults, rawImgData) {
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

        if (!peakResults.tLine.detected) {
            const cQuality = Math.min(1.0, peakResults.cLine.height / 0.05);
            return {
                result: '음성',
                resultEng: 'negative',
                concentration: null,
                concentrationStr: '-',
                errorReason: '',
                confidence: Math.round((96.0 + cQuality * 3.8) * 10) / 10
            };
        }

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
            confidence: Math.min(99.9, Math.round((91 + peakResults.tLine.height * 90) * 10) / 10)
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
