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
            minCProminenceSigma: 3.5, // C-line must be > 3.5 * background noise σ
            minTProminenceSigma: 3.0, // T-line must be > 3.0 * background noise σ
            minLocalProminence: 0.004, // Minimum local peak height above surrounding valleys
            minTCRatio: 0.08,      // T-Line must be at least 8% of C-Line height to be considered positive
            absoluteMinCPeak: 0.020,  // Absolute minimum absorbance drop for C-line (2.0%)
            absoluteMinTPeak: 0.009,  // Absolute minimum absorbance drop for faint T-line (0.9%)
            
            // Calibration curve coefficients: Conc = a * (T/C) + b * (T/C)^1.4
            calibration: {
                a: 0.05,
                b: 0.25,
                unit: 'mg/dL'
            },

            // Minimum confidence required to trust automatic kit-boundary
            // detection / membrane-window detection / sample-well detection
            // before falling back to the legacy fixed-ratio methods.
            minBoundaryConfidence: 1.25,
            minWindowConfidence: 1.15,
            minWellScore: 0.16,

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
            let rectifyMeta = null;
            let windowMeta = null;

            // 크롭 옵션이 명시적으로 지정된 경우 이를 최우선으로 따르고,
            // 명시되지 않은 경우에만 세로형 스트립 이미지 여부로 추정한다.
            const isPreCropped = (cropOptions && typeof cropOptions.isPreCropped === 'boolean')
                ? cropOptions.isPreCropped
                : (srcCanvas.height >= srcCanvas.width * 1.2);

            if (isPreCropped) {
                // 이미 멤브레인 스트립만 담긴 이미지를 직접 스트립 ROI로 사용
                stripROI = {
                    canvas: srcCanvas,
                    previewCanvas: srcCanvas,
                    imgData: imgData,
                    width: srcCanvas.width,
                    height: srcCanvas.height
                };
            } else {
                // 2. 키트 외곽 자동 검출 + 원근 보정(Perspective Rectification)
                const rectResult = this._rectifyKit(srcCanvas, imgData);
                rectifiedCanvas = rectResult.rectifiedCanvas;
                rectifyMeta = rectResult;

                // 3. 실제 이미지 특징 기반 멤브레인 창 위치 자동 검출
                stripROI = this._extractAdaptiveMembraneROI(rectifiedCanvas);
                windowMeta = stripROI.detection || null;
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
                    tLineRange: peakResults.tLine.range,
                    boundaryDetectionUsed: rectifyMeta ? !!rectifyMeta.detectionUsed : null,
                    boundaryDetectionConfidence: rectifyMeta ? rectifyMeta.detectionConfidence : null,
                    orientationMethod: rectifyMeta ? rectifyMeta.orientationMethod : null,
                    windowDetectionUsed: windowMeta ? !!windowMeta.detected : null
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

    /**
     * ========================================================================
     * KIT BOUNDARY DETECTION & PERSPECTIVE RECTIFICATION (신규)
     * ------------------------------------------------------------------------
     * 기존 방식: 화면 가이드 사각형에 사용자가 직접 맞춘다는 가정 하에
     *            이미지 중앙에서 고정 비율(90%)만 잘라내는 방식 → 정렬이
     *            조금만 틀어져도 멤브레인 위치가 어긋남.
     * 신규 방식: 이미지의 실제 에지(경계선) 신호를 분석하여 키트 카세트의
     *            네 모서리를 직접 검출하고, 호모그래피(원근 변환)로 반듯하게
     *            펴서 표준 캔버스에 투영한다. 검출 신뢰도가 낮을 때만
     *            안전하게 기존 고정비율 방식으로 폴백한다.
     * ========================================================================
     */
    _rectifyKit(srcCanvas, imgData) {
        const dw = this.config.canonicalWidth;
        const dh = this.config.canonicalHeight;

        let rectifiedCanvas = null;
        let detectionUsed = false;
        let detectionConfidence = 0;

        try {
            const detection = this._detectKitBoundary(srcCanvas);
            if (detection && detection.confidence >= (this.config.minBoundaryConfidence || 1.25)) {
                const warped = this._warpToCanonical(srcCanvas, detection.corners, dw, dh);
                if (warped) {
                    rectifiedCanvas = warped;
                    detectionUsed = true;
                    detectionConfidence = detection.confidence;
                }
            }
        } catch (e) {
            console.warn('Kit boundary auto-detection failed, falling back to center-crop:', e);
        }

        if (!rectifiedCanvas) {
            rectifiedCanvas = this._legacyCenterCropRectify(srcCanvas, dw, dh);
        }

        // Determine orientation: prefer detecting the circular sample well
        // (a real geometric feature) over the old brightness/gradient proxy.
        const orientation = this._resolveOrientation(rectifiedCanvas);
        let finalCanvas = rectifiedCanvas;
        if (orientation.shouldFlip) {
            finalCanvas = this._rotate180(rectifiedCanvas);
        }

        return {
            rectifiedCanvas: finalCanvas,
            orientation: orientation.shouldFlip ? 'inverted_corrected' : 'normal',
            isFlipped: orientation.shouldFlip,
            orientationMethod: orientation.method,
            detectionUsed,
            detectionConfidence
        };
    }

    /**
     * Legacy fallback: assumes the kit fills ~90% of the frame, centered,
     * with negligible rotation/perspective skew. Used only when automatic
     * boundary detection cannot find a confident quadrilateral.
     */
    _legacyCenterCropRectify(srcCanvas, dw, dh) {
        const { width: sw, height: sh } = srcCanvas;
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
        return outCanvas;
    }

    /**
     * Detects the kit cassette's 4 corners in the source photo using
     * gradient-edge projection profiles (a lightweight, dependency-free
     * stand-in for Hough-line based rectangle detection). Tolerant of mild
     * rotation/keystone by sampling the left/right edges independently near
     * the top and bottom of the kit, rather than assuming a pure axis-
     * aligned rectangle.
     *
     * Returns null (triggering fallback) when the edge signal is too weak
     * or ambiguous to trust (e.g. busy background, poor lighting).
     */
    _detectKitBoundary(srcCanvas) {
        const maxWork = 480;
        const scale = Math.min(1, maxWork / Math.max(srcCanvas.width, srcCanvas.height));
        const ww = Math.max(8, Math.round(srcCanvas.width * scale));
        const wh = Math.max(8, Math.round(srcCanvas.height * scale));

        const work = document.createElement('canvas');
        work.width = ww;
        work.height = wh;
        const wctx = work.getContext('2d');
        wctx.drawImage(srcCanvas, 0, 0, ww, wh);
        const imgData = wctx.getImageData(0, 0, ww, wh);

        const gray = this._toGrayscaleArray(imgData);
        const { gx, gy } = this._sobel(gray, ww, wh);

        // 1. Top/bottom edges: strong horizontal-edge (gy) response, summed
        //    across the central 60% of columns to ignore side clutter.
        const colLo = Math.round(ww * 0.20);
        const colHi = Math.round(ww * 0.80);
        const rowProj = this._rowProjection(gy, ww, colLo, colHi);

        const topBand = [Math.round(wh * 0.02), Math.round(wh * 0.40)];
        const botBand = [Math.round(wh * 0.60), Math.round(wh * 0.98)];
        const yTop = this._findPeak(rowProj, topBand[0], topBand[1]);
        const yBot = this._findPeak(rowProj, botBand[0], botBand[1]);

        if (yTop.index < 0 || yBot.index < 0 || (yBot.index - yTop.index) < wh * 0.30) {
            return null;
        }

        // 2. Left/right edges: strong vertical-edge (gx) response, sampled
        //    separately near the top and bottom of the kit so mild rotation
        //    or keystone distortion is captured rather than averaged away.
        const bandH = Math.max(6, Math.round((yBot.index - yTop.index) * 0.14));
        const topRowLo = yTop.index;
        const topRowHi = Math.min(wh - 1, yTop.index + bandH);
        const botRowLo = Math.max(0, yBot.index - bandH);
        const botRowHi = yBot.index;

        const colProjTop = this._colProjection(gx, ww, topRowLo, topRowHi);
        const colProjBot = this._colProjection(gx, ww, botRowLo, botRowHi);

        const leftBand = [Math.round(ww * 0.04), Math.round(ww * 0.48)];
        const rightBand = [Math.round(ww * 0.52), Math.round(ww * 0.96)];

        const xLeftTop = this._findPeak(colProjTop, leftBand[0], leftBand[1]);
        const xRightTop = this._findPeak(colProjTop, rightBand[0], rightBand[1]);
        const xLeftBot = this._findPeak(colProjBot, leftBand[0], leftBand[1]);
        const xRightBot = this._findPeak(colProjBot, rightBand[0], rightBand[1]);

        if (xLeftTop.index < 0 || xRightTop.index < 0 || xLeftBot.index < 0 || xRightBot.index < 0) {
            return null;
        }

        const wTopEdge = xRightTop.index - xLeftTop.index;
        const wBotEdge = xRightBot.index - xLeftBot.index;
        if (wTopEdge < ww * 0.12 || wBotEdge < ww * 0.12) return null;

        // Reject implausible trapezoids (e.g. two unrelated edges picked up)
        const widthRatio = wTopEdge / wBotEdge;
        if (widthRatio < 0.55 || widthRatio > 1.8) return null;

        const invScale = 1 / scale;
        const corners = {
            tl: { x: xLeftTop.index * invScale, y: yTop.index * invScale },
            tr: { x: xRightTop.index * invScale, y: yTop.index * invScale },
            bl: { x: xLeftBot.index * invScale, y: yBot.index * invScale },
            br: { x: xRightBot.index * invScale, y: yBot.index * invScale }
        };

        const confidence = (
            yTop.prominence + yBot.prominence +
            xLeftTop.prominence + xRightTop.prominence +
            xLeftBot.prominence + xRightBot.prominence
        ) / 6;

        return { corners, confidence };
    }

    /**
     * Warps the detected quadrilateral (in source-image pixel coordinates)
     * onto the canonical dw x dh rectangle using a full projective
     * (homography) transform, correcting perspective/keystone distortion
     * rather than a simple axis-aligned crop.
     */
    _warpToCanonical(srcCanvas, corners, dw, dh) {
        const srcW = srcCanvas.width;
        const srcH = srcCanvas.height;
        const srcCtx = srcCanvas.getContext('2d');
        const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

        const dstPts = [{ x: 0, y: 0 }, { x: dw, y: 0 }, { x: dw, y: dh }, { x: 0, y: dh }];
        const srcPts = [corners.tl, corners.tr, corners.br, corners.bl];
        const H = this._computeHomographyDstToSrc(dstPts, srcPts);
        if (!H) return null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = dw;
        outCanvas.height = dh;
        const outCtx = outCanvas.getContext('2d');
        const outImgData = outCtx.createImageData(dw, dh);
        const outData = outImgData.data;

        for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
                const denom = H[6] * (x + 0.5) + H[7] * (y + 0.5) + H[8];
                const sx = (H[0] * (x + 0.5) + H[1] * (y + 0.5) + H[2]) / denom;
                const sy = (H[3] * (x + 0.5) + H[4] * (y + 0.5) + H[5]) / denom;
                const outIdx = (y * dw + x) * 4;

                if (!(sx >= 0 && sy >= 0 && sx < srcW - 1 && sy < srcH - 1)) {
                    outData[outIdx] = 255;
                    outData[outIdx + 1] = 255;
                    outData[outIdx + 2] = 255;
                    outData[outIdx + 3] = 255;
                    continue;
                }

                const x0 = Math.floor(sx), y0 = Math.floor(sy);
                const fx = sx - x0, fy = sy - y0;
                const x1 = Math.min(srcW - 1, x0 + 1), y1 = Math.min(srcH - 1, y0 + 1);

                for (let ch = 0; ch < 3; ch++) {
                    const v00 = srcData[(y0 * srcW + x0) * 4 + ch];
                    const v10 = srcData[(y0 * srcW + x1) * 4 + ch];
                    const v01 = srcData[(y1 * srcW + x0) * 4 + ch];
                    const v11 = srcData[(y1 * srcW + x1) * 4 + ch];
                    const top = v00 * (1 - fx) + v10 * fx;
                    const bot = v01 * (1 - fx) + v11 * fx;
                    outData[outIdx + ch] = top * (1 - fy) + bot * fy;
                }
                outData[outIdx + 3] = 255;
            }
        }

        outCtx.putImageData(outImgData, 0, 0);
        return outCanvas;
    }

    /**
     * Solves for a 3x3 homography H (dst -> src, with h33 fixed to 1) given
     * 4 point correspondences, via direct linear transform + Gaussian
     * elimination. No external linear-algebra library required.
     */
    _computeHomographyDstToSrc(dstPts, srcPts) {
        const A = [];
        const b = [];
        for (let i = 0; i < 4; i++) {
            const { x, y } = dstPts[i];
            const { x: xp, y: yp } = srcPts[i];
            A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
            b.push(xp);
            A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
            b.push(yp);
        }
        const h = this._solveLinearSystem(A, b);
        if (!h) return null;
        return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    }

    _solveLinearSystem(A, b) {
        const n = A.length;
        const M = A.map((row, i) => [...row, b[i]]);

        for (let col = 0; col < n; col++) {
            let pivotRow = col;
            let maxAbs = Math.abs(M[col][col]);
            for (let r = col + 1; r < n; r++) {
                if (Math.abs(M[r][col]) > maxAbs) { maxAbs = Math.abs(M[r][col]); pivotRow = r; }
            }
            if (maxAbs < 1e-9) return null;
            if (pivotRow !== col) { const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp; }

            const pivotVal = M[col][col];
            for (let c = col; c <= n; c++) M[col][c] /= pivotVal;

            for (let r = 0; r < n; r++) {
                if (r === col) continue;
                const factor = M[r][col];
                if (factor === 0) continue;
                for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
            }
        }
        return M.map(row => row[n]);
    }

    _rotate180(canvas) {
        const w = canvas.width, h = canvas.height;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const octx = out.getContext('2d');
        octx.translate(w / 2, h / 2);
        octx.rotate(Math.PI);
        octx.drawImage(canvas, -w / 2, -h / 2);
        return out;
    }

    /**
     * Decides whether the rectified kit needs a 180° flip. Primary method:
     * detect the circular sample well (a real geometric feature) near the
     * top vs bottom of the image using a gradient-direction Hough-circle
     * vote. Falls back to the previous gradient-variance heuristic only if
     * neither end yields a confident circular signal.
     */
    _resolveOrientation(canvas) {
        try {
            const wellTop = this._detectCircularWell(canvas, 'top');
            const wellBottom = this._detectCircularWell(canvas, 'bottom');
            const minWellScore = this.config.minWellScore || 0.16;

            if (wellTop.score >= minWellScore || wellBottom.score >= minWellScore) {
                // Sample well belongs at the bottom of the canonical image.
                return { shouldFlip: wellTop.score > wellBottom.score, method: 'well-detect', wellTop, wellBottom };
            }
        } catch (e) {
            console.warn('Sample well detection failed, falling back:', e);
        }

        return { shouldFlip: this._checkOrientationLegacy(canvas), method: 'gradient-variance' };
    }

    /**
     * Simplified circular Hough transform restricted to a horizontal band
     * near one end of the rectified kit. For each strong edge pixel, votes
     * are cast along the local gradient direction at several candidate
     * radii; a real circular feature (the sample well) produces a sharp
     * accumulator peak near its true center.
     */
    _detectCircularWell(canvas, end) {
        const w = canvas.width;
        const h = canvas.height;
        const regionH = Math.max(10, Math.round(h * 0.24));
        const regionY = end === 'top' ? 0 : Math.max(0, h - regionH);

        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, regionY, w, regionH);
        const gray = this._toGrayscaleArray(imgData);
        const { gx, gy } = this._sobel(gray, w, regionH);

        const minR = Math.max(3, Math.round(w * 0.12));
        const maxR = Math.max(minR + 1, Math.round(w * 0.30));
        const radii = [];
        const step = Math.max(1, Math.round((maxR - minR) / 4));
        for (let r = minR; r <= maxR; r += step) radii.push(r);

        const acc = new Float32Array(w * regionH);
        const gradThresh = 12;

        for (let y = 1; y < regionH - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const dx = gx[idx], dy = gy[idx];
                const mag = Math.hypot(dx, dy);
                if (mag < gradThresh) continue;
                const angle = Math.atan2(dy, dx);
                const cosA = Math.cos(angle), sinA = Math.sin(angle);
                for (let ri = 0; ri < radii.length; ri++) {
                    const r = radii[ri];
                    for (let sign = -1; sign <= 1; sign += 2) {
                        const cx = Math.round(x + sign * r * cosA);
                        const cy = Math.round(y + sign * r * sinA);
                        if (cx >= 0 && cx < w && cy >= 0 && cy < regionH) {
                            acc[cy * w + cx] += 1;
                        }
                    }
                }
            }
        }

        let maxVal = 0;
        for (let i = 0; i < acc.length; i++) if (acc[i] > maxVal) maxVal = acc[i];

        const midR = (minR + maxR) / 2;
        const expectedVotes = Math.max(1, 2 * Math.PI * midR * 0.15);
        const score = maxVal / expectedVotes;

        return { score };
    }

    /** Legacy orientation heuristic (gradient-texture asymmetry), kept as a fallback. */
    _checkOrientationLegacy(canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        const topData = ctx.getImageData(w * 0.25, h * 0.05, w * 0.5, h * 0.25);
        const botData = ctx.getImageData(w * 0.25, h * 0.70, w * 0.5, h * 0.25);

        const topVar = this._computeGradientVariance(topData);
        const botVar = this._computeGradientVariance(botData);

        return topVar > botVar * 1.8;
    }

    // ── Low-level image processing primitives ──────────────────────────

    _toGrayscaleArray(imgData) {
        const { data, width, height } = imgData;
        const out = new Float32Array(width * height);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        return out;
    }

    _sobel(gray, w, h) {
        const gx = new Float32Array(w * h);
        const gy = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const tl = gray[idx - w - 1], tc = gray[idx - w], tr = gray[idx - w + 1];
                const ml = gray[idx - 1], mr = gray[idx + 1];
                const bl = gray[idx + w - 1], bc = gray[idx + w], br = gray[idx + w + 1];
                gx[idx] = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
                gy[idx] = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
            }
        }
        return { gx, gy };
    }

    /** Sum of |gx| (vertical-edge strength) per column, over rows [rowLo, rowHi]. */
    _colProjection(gxArr, width, rowLo, rowHi) {
        const height = Math.floor(gxArr.length / width);
        rowLo = Math.max(0, Math.round(rowLo));
        rowHi = Math.min(height - 1, Math.round(rowHi));
        const out = new Float32Array(width);
        for (let x = 0; x < width; x++) {
            let s = 0;
            for (let y = rowLo; y <= rowHi; y++) s += Math.abs(gxArr[y * width + x]);
            out[x] = s;
        }
        return out;
    }

    /** Sum of |gy| (horizontal-edge strength) per row, over columns [colLo, colHi]. */
    _rowProjection(gyArr, width, colLo, colHi) {
        const height = Math.floor(gyArr.length / width);
        colLo = Math.max(0, Math.round(colLo));
        colHi = Math.min(width - 1, Math.round(colHi));
        const out = new Float32Array(height);
        for (let y = 0; y < height; y++) {
            let s = 0;
            for (let x = colLo; x <= colHi; x++) s += Math.abs(gyArr[y * width + x]);
            out[y] = s;
        }
        return out;
    }

    /** Finds the strongest single peak in [lo, hi] with a minimum prominence over the local mean. */
    _findPeak(arr, lo, hi) {
        lo = Math.max(0, Math.round(lo));
        hi = Math.min(arr.length - 1, Math.round(hi));
        let maxV = -1, maxI = -1, sum = 0, count = 0;
        for (let i = lo; i <= hi; i++) {
            sum += arr[i];
            count++;
            if (arr[i] > maxV) { maxV = arr[i]; maxI = i; }
        }
        const mean = count > 0 ? sum / count : 0;
        const prominence = mean > 1e-6 ? maxV / mean : 0;
        if (maxI < 0 || prominence < 1.3) return { index: -1, value: maxV, prominence };
        return { index: maxI, value: maxV, prominence };
    }

    /** Mean brightness over a rectangular region. */
    _regionMeanBrightness(gray, width, x, y, w, h) {
        const height = Math.floor(gray.length / width);
        x = Math.max(0, Math.round(x));
        y = Math.max(0, Math.round(y));
        const x1 = Math.min(width, x + Math.max(1, Math.round(w)));
        const y1 = Math.min(height, y + Math.max(1, Math.round(h)));
        let sum = 0, count = 0;
        for (let yy = y; yy < y1; yy++) {
            for (let xx = x; xx < x1; xx++) { sum += gray[yy * width + xx]; count++; }
        }
        return count > 0 ? sum / count : 0;
    }

    /** Mean brightness of a thin ring just outside the given box (for contrast validation). */
    _borderRingBrightness(gray, width, x, y, w, h, ringPx = 8) {
        const height = Math.floor(gray.length / width);
        const outerX = Math.max(0, Math.round(x - ringPx));
        const outerY = Math.max(0, Math.round(y - ringPx));
        const outerX1 = Math.min(width, Math.round(x + w + ringPx));
        const outerY1 = Math.min(height, Math.round(y + h + ringPx));
        let sum = 0, count = 0;
        for (let yy = outerY; yy < outerY1; yy++) {
            for (let xx = outerX; xx < outerX1; xx++) {
                const insideBox = xx >= x && xx < x + w && yy >= y && yy < y + h;
                if (insideBox) continue;
                sum += gray[yy * width + xx];
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
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
     * ========================================================================
     * MEMBRANE WINDOW LOCALIZATION (신규)
     * ------------------------------------------------------------------------
     * 기존 방식: 정렬이 완벽하다는 가정 하에 고정 비율(x:0.41~0.59,
     *            y:0.325~0.545)로 잘라내는 방식 → 실제 창 위치가 조금만
     *            달라도 라인 판독 영역이 어긋남.
     * 신규 방식: 정류(rectify)된 캔버스에서 실제 명암 경계(에지)를 분석해
     *            멤브레인 창의 좌/우/상/하 경계를 직접 검출한다. 창 내부가
     *            주변 베젤보다 밝은지 대조 검증까지 통과해야 채택하며,
     *            신뢰도가 낮으면 기존 고정비율 방식으로 안전하게 폴백한다.
     * ========================================================================
     */
    _extractAdaptiveMembraneROI(rectifiedCanvas) {
        return this._locateMembraneWindow(rectifiedCanvas);
    }

    _locateMembraneWindow(rectifiedCanvas) {
        const w = rectifiedCanvas.width;
        const h = rectifiedCanvas.height;
        const ctx = rectifiedCanvas.getContext('2d');
        const full = ctx.getImageData(0, 0, w, h);
        const gray = this._toGrayscaleArray(full);
        const { gx, gy } = this._sobel(gray, w, h);

        // Generous search region (tolerant of residual misalignment/design variance)
        const searchX0 = Math.round(w * 0.24);
        const searchX1 = Math.round(w * 0.76);
        const searchY0 = Math.round(h * 0.16);
        const searchY1 = Math.round(h * 0.64);

        let roiX = null, roiY = null, roiW = null, roiH = null, confidence = 0;

        // 1. Left/right edges via vertical-edge (gx) column projection
        const colProj = this._colProjection(gx, w, searchY0, searchY1);
        const minWinW = w * 0.12, maxWinW = w * 0.36;
        const lr = this._findBestEdgePair(colProj, searchX0, searchX1, minWinW, maxWinW);

        if (lr.left != null && lr.right != null) {
            // 2. Top/bottom edges via horizontal-edge (gy) row projection,
            //    restricted to the just-detected column range.
            const rowProj = this._rowProjection(gy, w, lr.left, lr.right);
            const minWinH = h * 0.16, maxWinH = h * 0.44;
            const tb = this._findBestEdgePair(rowProj, searchY0, searchY1, minWinH, maxWinH);

            if (tb.left != null && tb.right != null) {
                roiX = lr.left;
                roiY = tb.left;
                roiW = lr.right - lr.left;
                roiH = tb.right - tb.left;
                confidence = (lr.score + tb.score) / 2;
            }
        }

        let validated = false;
        if (roiW && roiH) {
            const insideMean = this._regionMeanBrightness(gray, w, roiX, roiY, roiW, roiH);
            const ringMean = this._borderRingBrightness(gray, w, roiX, roiY, roiW, roiH, Math.round(Math.min(roiW, roiH) * 0.18));
            // The nitrocellulose membrane should be at least roughly as bright
            // as the surrounding recessed bezel — a real photometric sanity check.
            validated = insideMean > ringMean - 4;
        }

        if (!validated || confidence < (this.config.minWindowConfidence || 1.15)) {
            return this._legacyMembraneROI(rectifiedCanvas);
        }

        const result = this._buildMembraneROI(rectifiedCanvas, roiX, roiY, roiW, roiH);
        result.detection = { detected: true, confidence };
        return result;
    }

    /** Legacy fixed-ratio membrane window (fallback when detection is not confident). */
    _legacyMembraneROI(rectifiedCanvas) {
        const w = rectifiedCanvas.width;
        const h = rectifiedCanvas.height;
        const xMin = 0.41, xMax = 0.59, yMin = 0.325, yMax = 0.545;
        const result = this._buildMembraneROI(
            rectifiedCanvas,
            w * xMin, h * yMin, w * (xMax - xMin), h * (yMax - yMin)
        );
        result.detection = { detected: false, confidence: 0 };
        return result;
    }

    /**
     * Given a membrane-window ROI box (in rectified-canvas coordinates),
     * builds (a) the pure analysis-ready strip canvas and (b) a preview
     * canvas with surrounding context + dimmed mask, for UI display.
     */
    _buildMembraneROI(rectifiedCanvas, roiX, roiY, roiW, roiH) {
        const w = rectifiedCanvas.width;
        const h = rectifiedCanvas.height;

        roiX = Math.max(0, Math.round(roiX));
        roiY = Math.max(0, Math.round(roiY));
        roiW = Math.max(4, Math.min(w - roiX, Math.round(roiW)));
        roiH = Math.max(4, Math.min(h - roiY, Math.round(roiH)));

        // 1. Pure membrane canvas used for quantitative math analysis
        const stripCanvas = document.createElement('canvas');
        stripCanvas.width = roiW;
        stripCanvas.height = roiH;
        const ctx = stripCanvas.getContext('2d');
        ctx.drawImage(rectifiedCanvas, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
        const imgData = ctx.getImageData(0, 0, roiW, roiH);

        // 2. Visual Preview Canvas with surrounding context & 80% black mask outside the analyzed ROI
        const padX = Math.round(roiW * 0.20);
        const padY = Math.round(roiH * 0.18);
        const ctxX = Math.max(0, roiX - padX);
        const ctxY = Math.max(0, roiY - padY);
        const ctxW = Math.min(w - ctxX, roiW + padX * 2);
        const ctxH = Math.min(h - ctxY, roiH + padY * 2);

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
        pCtx.fillRect(0, 0, ctxW, boxY);
        pCtx.fillRect(0, boxY + boxH, ctxW, ctxH - (boxY + boxH));
        pCtx.fillRect(0, boxY, boxX, boxH);
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
     * Finds the best pair of edge-projection peaks (left+right, or top+bottom)
     * within [lo, hi] whose separation falls in [minSep, maxSep] — i.e. the
     * two strongest, most plausible boundaries of a rectangular window.
     */
    _findBestEdgePair(proj, lo, hi, minSep, maxSep) {
        lo = Math.max(1, Math.round(lo));
        hi = Math.min(proj.length - 2, Math.round(hi));

        let meanVal = 0, count = 0;
        for (let i = lo; i <= hi; i++) { meanVal += proj[i]; count++; }
        meanVal = count > 0 ? meanVal / count : 0;

        const peaks = [];
        for (let i = lo + 1; i < hi; i++) {
            if (proj[i] > proj[i - 1] && proj[i] >= proj[i + 1] && proj[i] > meanVal * 1.2) {
                peaks.push({ idx: i, val: proj[i] });
            }
        }

        let best = null;
        for (let a = 0; a < peaks.length; a++) {
            for (let b = a + 1; b < peaks.length; b++) {
                const sep = peaks[b].idx - peaks[a].idx;
                if (sep < minSep || sep > maxSep) continue;
                const score = (peaks[a].val + peaks[b].val) / (2 * (meanVal + 1e-6));
                if (!best || score > best.score) {
                    best = { left: peaks[a].idx, right: peaks[b].idx, score };
                }
            }
        }

        return best || { left: null, right: null, score: 0 };
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

        // 1. Compute Local Background Noise Standard Deviation (σ_bg)
        const bgNoiseSigma = this._computeNoiseSigma(topHatProfile);

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

        const cPeak = this._validatePeak(topHatProfile, cStart, cEnd, this.config.absoluteMinCPeak, this.config.minCProminenceSigma * bgNoiseSigma, 'C');
        const tPeak = this._validatePeak(topHatProfile, tStart, tEnd, this.config.absoluteMinTPeak, this.config.minTProminenceSigma * bgNoiseSigma, 'T');

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

    _computeNoiseSigma(topHat) {
        const len = topHat.length;
        // Collect middle 75% to avoid boundary edge shadows
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

    _validatePeak(signal, startIdx, endIdx, absoluteMin, statisticalMin, lineType = 'T') {
        const threshold = Math.max(absoluteMin, statisticalMin);
        let maxVal = 0;
        let bestIdx = -1;
        let bestProminence = 0;

        // 1. Search for true convex local maxima (must be higher than both neighbors)
        for (let i = startIdx + 1; i <= endIdx - 1; i++) {
            if (signal[i] > maxVal) {
                maxVal = signal[i];
            }

            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
                // Measure local valley minima within ±10 pixels
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

        // Strict validation: Must exceed threshold AND minimum local prominence
        const minProm = this.config.minLocalProminence || 0.004;
        if (peakIdx === -1 || peakHeight < threshold || bestProminence < minProm) {
            return {
                detected: false,
                index: peakIdx !== -1 ? peakIdx : Math.round((startIdx + endIdx) / 2),
                height: Math.round(peakHeight * 1000) / 1000,
                auc: 0,
                fwhm: 0,
                range: [startIdx, endIdx],
                rejectedReason: peakIdx === -1 ? 'no_local_maximum' : (bestProminence < minProm ? 'low_prominence' : 'below_threshold')
            };
        }

        // Measure Full-Width at Half-Maximum (FWHM)
        const halfMax = peakHeight * 0.50;
        let left = peakIdx;
        while (left > Math.max(0, startIdx - 10) && signal[left] > halfMax) left--;
        let right = peakIdx;
        while (right < Math.min(signal.length - 1, endIdx + 10) && signal[right] > halfMax) right++;
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
                rejectedReason: 'invalid_fwhm'
            };
        }

        // Integrate Peak Area (AUC) above baseline
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