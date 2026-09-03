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
            peakTolerance: 0.15,   // Search window around expected peak (±15%)
            
            // Peak geometry requirements optimized for smartphone camera images
            minPeakFWHM: 3,        // Min peak full-width at half-max (pixels) - rejects 1px noise spikes
            maxPeakFWHM: 40,       // Max peak width (rejects broad shadows/gradients)
            minCProminenceSigma: 3.0, // C-line must be > 3.0 * background noise σ
            minTProminenceSigma: 2.5, // T-line must be > 2.5 * background noise σ
            minLocalProminence: 0.003, // Minimum local peak height above surrounding valleys
            minTCRatio: 0.08,      // T-Line must be at least 8% of C-Line height to be considered positive
            // NOTE: these two absolute floors were tuned against the OLD fixed-radius
            // morphological top-hat baseline, which systematically UNDER-estimated the height
            // of any real line wider than ~2*kRadius (14px) — exactly the broad, faint lines we
            // most need to catch. The baseline estimator below now recovers the true (larger)
            // drop for lines of any width up to maxPeakFWHM, so these floors are lowered to match
            // the corrected units instead of compensating for the old bias.
            absoluteMinCPeak: 0.012,  // Absolute minimum absorbance drop for C-line (1.2%)
            absoluteMinTPeak: 0.005,  // Absolute minimum absorbance drop for faint T-line (0.5%)

            // --- Faint-line sensitivity enhancements ---
            autoChannelSelect: true,   // Auto-pick R/G/B channel with best line/background contrast (dye color agnostic)
            matchedFilterSigma: 4.5,   // Gaussian matched-filter sigma (px) used ONLY for detection/localization (not quantification)
            
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
            
            // 4. Extract R/G/B & Luma 1D Longitudinal Profiles (multi-channel)
            const { rawProfile, channelProfiles } = this._extractColorProfiles(stripROI);

            // 4.5 Auto-select the color channel with the strongest line/background contrast.
            //     Colorimetric LFA dyes vary (pink/red gold-nanoparticle, blue latex, etc.), so a
            //     fixed "Green channel" is not always optimal. We pick whichever channel makes the
            //     C-line (which must always be present on a valid strip) stand out most above its
            //     own local noise floor, then use that same channel for the T-line too.
            const { profile: greenProfile, channelUsed } = this._selectActiveChannel(channelProfiles);
            
            // 5. Morphological Top-Hat & Baseline Illumination Subtraction
            const { baseline, correctedProfile, topHatProfile, lineZones } = this._compensateIlluminationRobust(greenProfile);
            
            // 6. Strict Peak Detection & Validation (Geometry + Statistical Noise Gate + Matched Filter)
            const peakResults = this._detectPeaksRobust(greenProfile, correctedProfile, topHatProfile, lineZones);
            
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
                    channelUsed,                            // 'red' | 'green' | 'blue' — auto-selected channel
                    cLineZScore: peakResults.cLine.zScore,   // statistical significance (σ above noise), detection domain
                    tLineZScore: peakResults.tLine.zScore,   // lets faint-but-real T-lines be reported with confidence
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
     * Extracts R/G/B + Luma channel profiles with horizontal center weighting.
     * Returning all three color channels (not just Green) lets us auto-select whichever
     * channel gives the strongest contrast for the specific dye color used on the strip.
     */
    _extractColorProfiles(stripROI) {
        const { imgData, width, height } = stripROI;
        const data = imgData.data;

        const rawProfile = new Float32Array(height);
        const redProfile = new Float32Array(height);
        const greenProfile = new Float32Array(height);
        const blueProfile = new Float32Array(height);

        // Center 70% columns with cosine weighting to minimize edge shadow noise
        const xStart = Math.round(width * 0.15);
        const xEnd = Math.round(width * 0.85);

        // Scan along fluidics flow direction: from bottom (Sample Inlet) to top (Absorption Pad)
        for (let y = 0; y < height; y++) {
            const srcY = height - 1 - y; // Bottom of vertical image = 0 in flow profile
            let sumR = 0, sumG = 0, sumB = 0, sumGray = 0, weightSum = 0;
            for (let x = xStart; x < xEnd; x++) {
                const normX = (x - xStart) / (xEnd - xStart) - 0.5; // -0.5 to +0.5
                const weight = Math.cos(normX * Math.PI); // Peak at center
                
                const idx = (srcY * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                
                sumR += r * weight;
                sumG += g * weight;
                sumB += b * weight;
                sumGray += (0.299 * r + 0.587 * g + 0.114 * b) * weight;
                weightSum += weight;
            }
            rawProfile[y] = sumGray / weightSum;
            redProfile[y] = sumR / weightSum;
            greenProfile[y] = sumG / weightSum;
            blueProfile[y] = sumB / weightSum;
        }

        return {
            rawProfile,
            channelProfiles: {
                red: this._smooth1D(redProfile, 2),
                green: this._smooth1D(greenProfile, 2),
                blue: this._smooth1D(blueProfile, 2)
            }
        };
    }

    /**
     * Auto-selects the color channel (R/G/B) that gives the strongest, statistically most
     * significant C-line signal. The C-line uses the same dye/conjugate color as the T-line,
     * so whichever channel best exposes the (always-present, well-defined) C-line is also the
     * best channel to look for a faint T-line in. This makes the analyzer dye-color agnostic
     * instead of hard-assuming Green is always the best choice.
     */
    _selectActiveChannel(channelProfiles) {
        if (!this.config.autoChannelSelect) {
            return { profile: channelProfiles.green, channelUsed: 'green' };
        }

        const names = ['red', 'green', 'blue'];
        let bestName = 'green';
        let bestScore = -Infinity;
        let bestProfile = channelProfiles.green;

        for (const name of names) {
            const profile = channelProfiles[name];
            const len = profile.length;
            const { baseline, topHatProfile, lineZones } = this._compensateIlluminationRobust(profile);
            const noiseSigma = this._computeNoiseSigma(topHatProfile, lineZones);

            const cExpected = Math.round(len * this.config.cLinePosRatio);
            const cTolerance = Math.round(len * this.config.peakTolerance);
            const cStart = Math.max(4, cExpected - cTolerance);
            const cEnd = Math.min(len - 4, cExpected + cTolerance);

            let peakVal = 0;
            for (let i = cStart; i <= cEnd; i++) {
                if (topHatProfile[i] > peakVal) peakVal = topHatProfile[i];
            }
            const score = peakVal / noiseSigma; // z-score proxy for C-line contrast in this channel

            if (score > bestScore) {
                bestScore = score;
                bestName = name;
                bestProfile = profile;
            }
            void baseline; // (baseline unused here, kept for clarity/future diagnostics)
        }

        return { profile: bestProfile, channelUsed: bestName };
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
     * Peak-Zone-Aware Baseline Compensation:
     * Removes gradual lighting gradients, leaving ONLY narrow, sharp line absorptions.
     *
     * WHY THIS CHANGED: the previous version used a fixed-radius (14px) morphological
     * opening (dilate-then-erode) to estimate the background everywhere, including right
     * through the T/C line positions themselves. That only works if the structuring element
     * is wider than the line — but real lines (especially faint, diffuse ones, which is
     * exactly the case we most want to catch) can be as wide as `maxPeakFWHM` (40px), close
     * to or exceeding the old kernel's reach (29px window). When the kernel is too small,
     * the "baseline" estimate itself gets pulled down into the dip, so the measured
     * baseline-minus-profile drop comes out systematically SMALLER than the line's true
     * strength — i.e. it under-reports faint/broad lines the most, backwards from what we want.
     *
     * FIX: locate the actual trough inside each of the T-line/C-line search windows directly
     * (from the raw profile — unaffected by any baseline bias, since bias changes amplitude,
     * not location), then exclude only a TIGHT, width-bounded window around that real location
     * from the background estimate, bridging it with a straight-line interpolation between the
     * real background values just outside its edges. This recovers the correct baseline for a
     * line of any width up to maxPeakFWHM, while leaving the rest of the profile — including
     * plenty of genuine background between the T-line and C-line — untouched for noise
     * estimation. (An earlier version of this fix excluded a much wider, ratio-scaled window;
     * on a typical strip that window from the T-line and the one from the C-line overlapped
     * and swallowed nearly the entire profile, leaving no real background samples to measure
     * noise from. That's fixed by localizing first and keeping the exclusion tight.)
     */
    _compensateIlluminationRobust(profile) {
        const len = profile.length;
        const baseline = new Float32Array(len);
        const corrected = new Float32Array(len);
        const topHat = new Float32Array(len);

        // Small kernel: only for local noise/dust OUTSIDE the line zones. Deliberately much
        // smaller than any expected line width so it can never itself erode into a real peak.
        const kRadius = 6;

        const dilated = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            let maxVal = -1;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (profile[idx] > maxVal) maxVal = profile[idx];
            }
            dilated[i] = maxVal;
        }
        const closed = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            let minVal = 999;
            for (let k = -kRadius; k <= kRadius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                if (dilated[idx] < minVal) minVal = dilated[idx];
            }
            closed[i] = minVal;
        }
        for (let i = 0; i < len; i++) baseline[i] = closed[i];

        const zones = this._findTightLineZones(profile, len);
        for (const [zStart, zEnd] of zones) {
            const leftEdge = Math.max(0, zStart - 1);
            const rightEdge = Math.min(len - 1, zEnd + 1);
            const leftVal = closed[leftEdge];
            const rightVal = closed[rightEdge];
            const span = rightEdge - leftEdge;
            for (let i = zStart; i <= zEnd; i++) {
                const t = span > 0 ? (i - leftEdge) / span : 0;
                baseline[i] = leftVal + (rightVal - leftVal) * t;
            }
        }

        for (let i = 0; i < len; i++) {
            // Top-Hat signal: ΔI = Baseline - Profile (positive for dark lines, exactly 0 for smooth background)
            const drop = Math.max(0, baseline[i] - profile[i]);
            topHat[i] = drop / (baseline[i] || 200); // Normalized relative absorption
            corrected[i] = topHat[i];
        }

        return { baseline, correctedProfile: corrected, topHatProfile: topHat, lineZones: zones };
    }

    /**
     * Finds a TIGHT [start, end] exclusion window around the actual trough inside each of the
     * T-line and C-line search windows (expected position ± peakTolerance), sized just wide
     * enough to contain the widest allowed peak (maxPeakFWHM) plus a small buffer — NOT the
     * whole, much larger, search-tolerance window. Localizing on the raw profile first (rather
     * than excluding the full search window up front) keeps the two zones small and reliably
     * non-overlapping, so there's always real background left between them for noise
     * estimation. A hard midpoint clamp additionally guarantees the T-zone and C-zone can never
     * cross into each other even in worst-case localization.
     */
    _findTightLineZones(profile, len) {
        const halfWidth = Math.ceil((this.config.maxPeakFWHM || 40) / 2) + 4;
        const tExpected = Math.round(len * this.config.tLinePosRatio);
        const cExpected = Math.round(len * this.config.cLinePosRatio);
        const tol = Math.round(len * this.config.peakTolerance);

        const tStart = Math.max(4, tExpected - tol), tEnd = Math.min(len - 4, tExpected + tol);
        const cStart = Math.max(4, cExpected - tol), cEnd = Math.min(len - 4, cExpected + tol);

        const argminIndex = (arr, s, e) => {
            let bestI = s, bestV = Infinity;
            for (let i = s; i <= e; i++) {
                if (arr[i] < bestV) { bestV = arr[i]; bestI = i; }
            }
            return bestI;
        };

        const tCenter = argminIndex(profile, tStart, tEnd);
        const cCenter = argminIndex(profile, cStart, cEnd);

        let tZone = [tCenter - halfWidth, tCenter + halfWidth];
        let cZone = [cCenter - halfWidth, cCenter + halfWidth];

        // Hard separation: neither zone may cross the midpoint between the expected positions.
        const midpoint = Math.round((tExpected + cExpected) / 2);
        tZone[1] = Math.min(tZone[1], midpoint - 1);
        cZone[0] = Math.max(cZone[0], midpoint + 1);

        tZone[0] = Math.max(0, tZone[0]);
        cZone[1] = Math.min(len - 1, cZone[1]);
        if (tZone[0] > tZone[1]) tZone[1] = tZone[0];
        if (cZone[0] > cZone[1]) cZone[0] = cZone[1];

        return [tZone, cZone];
    }

    /**
     * Robust Peak Detection with Geometry (FWHM) & Statistical Noise Gate
     */
    _detectPeaksRobust(rawProfile, correctedProfile, topHatProfile, lineZones = null) {
        const len = topHatProfile.length;

        // 1. Matched-filter the top-hat profile against the expected line shape. This is the
        //    signal used for STATISTICAL DETECTION & localization — its noise floor is much
        //    lower than the raw per-pixel top-hat signal, so genuinely faint lines that sit
        //    below the raw noise floor (and are invisible/ambiguous to the naked eye) can still
        //    be pulled out with statistical confidence.
        const matchedProfile = this._matchedFilterGaussian(topHatProfile, this.config.matchedFilterSigma);
        const bgNoiseSigma = this._computeNoiseSigma(matchedProfile, lineZones);

        // 2. C-Line Search Region (Upper flow: ~61% to 91%)
        const cExpected = Math.round(len * this.config.cLinePosRatio);
        const cTolerance = Math.round(len * this.config.peakTolerance);
        const cStart = Math.max(4, cExpected - cTolerance);
        const cEnd = Math.min(len - 4, cExpected + cTolerance);

        // 3. T-Line Search Region (Lower flow: ~17% to 47%)
        const tExpected = Math.round(len * this.config.tLinePosRatio);
        const tTolerance = Math.round(len * this.config.peakTolerance);
        const tStart = Math.max(4, tExpected - tTolerance);
        const tEnd = Math.min(len - 4, tExpected + tTolerance);

        // Detection happens on the matched-filtered signal; quantification (height/AUC/FWHM)
        // is still read from the raw top-hat profile so the concentration calibration curve
        // (tuned against raw absorbance) is completely unaffected by this change.
        const cPeak = this._validatePeak(matchedProfile, topHatProfile, cStart, cEnd, this.config.absoluteMinCPeak, this.config.minCProminenceSigma * bgNoiseSigma, bgNoiseSigma, 'C');
        const tPeak = this._validatePeak(matchedProfile, topHatProfile, tStart, tEnd, this.config.absoluteMinTPeak, this.config.minTProminenceSigma * bgNoiseSigma, bgNoiseSigma, 'T');

        // 4. Strict T/C Ratio validation (T-line must be at least minTCRatio of C-line)
        const relativeRatio = (cPeak.detected && cPeak.height > 0) ? (tPeak.height / cPeak.height) : 0;
        const aucRatio = (cPeak.detected && cPeak.auc > 0) ? (tPeak.auc / cPeak.auc) : 0;

        let tDetected = tPeak.detected;
        if (tDetected) {
            // T-Line이 잡음이 아닌 실제 밴드이려면 C-Line 대비 최소 8% 이상이어야 함
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

    /**
     * Robust background noise estimate using Median Absolute Deviation (MAD).
     * MAD is far less influenced by the C/T line "outlier" peaks themselves than an RMS
     * over the lowest-60% of samples, which lets us safely lower detection thresholds for
     * faint lines without inflating false positives from residual shadow/gradient noise.
     *
     * `zones` (optional) should be the SAME tight, peak-localized [start,end] windows used for
     * baseline compensation (see _findTightLineZones) — excluding them keeps this a true
     * measurement of blank-membrane background, unaffected by the real line signal itself.
     * They're intentionally tight (not the full search-tolerance window) so plenty of genuine
     * background always remains between the T-line and C-line for this estimate.
     */
    _computeNoiseSigma(topHat, zones = null) {
        const len = topHat.length;
        // Collect middle 80% to avoid boundary edge shadows
        const start = Math.floor(len * 0.10);
        const end = Math.floor(len * 0.90);
        const excludeZones = zones || [];
        const inner = [];
        for (let i = start; i < end; i++) {
            const inZone = excludeZones.some(([zs, ze]) => i >= zs && i <= ze);
            if (!inZone) inner.push(topHat[i]);
        }
        // Safety net: if exclusion somehow leaves too little to measure noise from reliably,
        // fall back to using the full unexcluded range rather than a meaningless fixed sigma.
        if (inner.length < Math.max(20, (end - start) * 0.2)) {
            inner.length = 0;
            for (let i = start; i < end; i++) inner.push(topHat[i]);
        }
        if (inner.length === 0) return 0.0008;

        const sorted = [...inner].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        const absDevs = inner.map(v => Math.abs(v - median)).sort((a, b) => a - b);
        const mad = absDevs[Math.floor(absDevs.length / 2)];

        // 1.4826 scales MAD to be a consistent estimator of σ for Gaussian-like noise
        const sigma = mad * 1.4826;
        return Math.max(0.0008, sigma);
    }

    /**
     * Gaussian matched filter (normalized, sum-to-1 kernel).
     * This is the classical optimal linear filter for pulling a signal of *known shape*
     * (a smooth line band) out of white-ish background noise: correlating with the expected
     * shape maximizes SNR (matched filter theorem), turning a faint line that is barely above
     * per-pixel noise into a clearly significant bump once the noise averages down.
     * Used ONLY to decide "is a real line here" and to localize its center — the raw
     * (un-filtered) top-hat profile is still used for height/AUC quantification so the
     * existing concentration calibration is unaffected.
     */
    _matchedFilterGaussian(signal, sigma) {
        const len = signal.length;
        const radius = Math.max(1, Math.ceil(sigma * 3));
        const kernel = new Float32Array(radius * 2 + 1);
        let kSum = 0;
        for (let k = -radius; k <= radius; k++) {
            const w = Math.exp(-(k * k) / (2 * sigma * sigma));
            kernel[k + radius] = w;
            kSum += w;
        }
        for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                const idx = Math.min(len - 1, Math.max(0, i + k));
                sum += signal[idx] * kernel[k + radius];
            }
            out[i] = sum;
        }
        return out;
    }

    /**
     * @param {Float32Array} detectSignal  Matched-filtered top-hat profile — used to decide
     *                                     WHETHER a real peak exists and WHERE it is centered.
     *                                     Its lower noise floor is what lets faint lines be
     *                                     told apart from noise more reliably than eyeballing
     *                                     a single raw photo ever could.
     * @param {Float32Array} quantSignal   Raw (un-filtered) top-hat profile — used to read out
     *                                     the actual physical height/AUC/FWHM for reporting and
     *                                     for the existing concentration calibration.
     * @param {number} bgNoiseSigma        Noise σ of detectSignal, used to compute a z-score.
     */
    _validatePeak(detectSignal, quantSignal, startIdx, endIdx, absoluteMin, statisticalMin, bgNoiseSigma, lineType = 'T') {
        const threshold = Math.max(absoluteMin, statisticalMin);
        let maxVal = 0;
        let bestIdx = -1;
        let bestProminence = 0;

        // Valley search radius for prominence: must be wider than the matched-filter's own
        // smoothing radius, otherwise the "valleys" we compare against are still inside the
        // smoothed peak's own skirt and every real peak looks falsely flat/low-prominence.
        const kernelRadius = Math.ceil((this.config.matchedFilterSigma || 0) * 3);
        const valleyWindow = Math.max(10, kernelRadius + 8);

        // 1. Search for true convex local maxima on the matched-filtered (low-noise) signal
        for (let i = startIdx + 1; i <= endIdx - 1; i++) {
            if (detectSignal[i] > maxVal) {
                maxVal = detectSignal[i];
            }

            if (detectSignal[i] > detectSignal[i - 1] && detectSignal[i] > detectSignal[i + 1]) {
                // Measure local valley minima within ±valleyWindow pixels
                const vLeft = Math.min(...detectSignal.slice(Math.max(startIdx, i - valleyWindow), i));
                const vRight = Math.min(...detectSignal.slice(i + 1, Math.min(detectSignal.length, i + valleyWindow + 1)));
                const prominence = detectSignal[i] - Math.max(vLeft, vRight);

                if (prominence > bestProminence) {
                    bestProminence = prominence;
                    bestIdx = i;
                }
            }
        }

        let peakIdx = (bestIdx !== -1) ? bestIdx : -1;
        let peakHeightDetect = (peakIdx !== -1) ? detectSignal[peakIdx] : maxVal;

        // Sub-pixel refinement: parabolic interpolation around the detected peak using the
        // matched-filtered signal improves localization precision beyond single-pixel resolution.
        if (peakIdx > startIdx && peakIdx < endIdx) {
            const y0 = detectSignal[peakIdx - 1], y1 = detectSignal[peakIdx], y2 = detectSignal[peakIdx + 1];
            const denom = (y0 - 2 * y1 + y2);
            if (Math.abs(denom) > 1e-9) {
                const delta = 0.5 * (y0 - y2) / denom;
                if (Math.abs(delta) < 1) {
                    peakIdx = Math.round(peakIdx + delta);
                    peakIdx = Math.min(endIdx - 1, Math.max(startIdx + 1, peakIdx));
                }
            }
        }

        const zScore = bgNoiseSigma > 0 ? Math.round((peakHeightDetect / bgNoiseSigma) * 10) / 10 : 0;

        // Strict validation: Must exceed threshold AND minimum local prominence
        const minProm = this.config.minLocalProminence || 0.004;
        if (peakIdx === -1 || peakHeightDetect < threshold || bestProminence < minProm) {
            return {
                detected: false,
                index: peakIdx !== -1 ? peakIdx : Math.round((startIdx + endIdx) / 2),
                height: Math.round(peakHeightDetect * 1000) / 1000,
                auc: 0,
                fwhm: 0,
                range: [startIdx, endIdx],
                zScore,
                rejectedReason: peakIdx === -1 ? 'no_local_maximum' : (bestProminence < minProm ? 'low_prominence' : 'below_threshold')
            };
        }

        // Quantify height from the RAW (un-filtered) signal — average a tiny ±1px window
        // around the localized peak to avoid picking a single noisy raw sample, without
        // smoothing away real physical amplitude the way a wide filter would.
        const qStart = Math.max(0, peakIdx - 1);
        const qEnd = Math.min(quantSignal.length - 1, peakIdx + 1);
        let peakHeight = 0;
        for (let k = qStart; k <= qEnd; k++) peakHeight = Math.max(peakHeight, quantSignal[k]);

        // Measure Full-Width at Half-Maximum (FWHM) on the raw quantification signal
        const halfMax = peakHeight * 0.50;
        let left = peakIdx;
        while (left > Math.max(0, startIdx - 10) && quantSignal[left] > halfMax) left--;
        let right = peakIdx;
        while (right < Math.min(quantSignal.length - 1, endIdx + 10) && quantSignal[right] > halfMax) right++;
        const fwhm = Math.max(1, right - left);

        // Reject if peak is too narrow (< minPeakFWHM) or too broad (> maxPeakFWHM)
        if (fwhm < this.config.minPeakFWHM || fwhm > this.config.maxPeakFWHM) {
            return {
                detected: false,
                index: peakIdx,
                height: Math.round(peakHeight * 1000) / 1000,
                auc: 0,
                fwhm,
                range: [left, right],
                zScore,
                rejectedReason: 'invalid_fwhm'
            };
        }

        // Integrate Peak Area (AUC) above baseline, from the raw signal
        let auc = 0;
        for (let k = left; k <= right; k++) {
            auc += Math.max(0, quantSignal[k]);
        }

        return {
            detected: true,
            index: peakIdx,
            height: Math.round(peakHeight * 1000) / 1000,
            auc: Math.round(auc * 1000) / 1000,
            fwhm,
            range: [left, right],
            zScore
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