/**
 * KitDetector — LFA 키트 자동 검출 및 원근 보정 모듈
 *
 * 촬영된 스마트폰 이미지에서 키트의 특징점(카세트 외곽, 시료 주입 웰, 검사창)을
 * 자동으로 검출하고, 검사창을 정준 strip 이미지로 원근 보정(warp)한다.
 *
 * Pipeline:
 *   1. Preprocess: downscale, grayscale, Sobel gradient
 *   2. Cassette detection: projection profiles + adaptive threshold
 *   3. Well detection: integral-image based circular contrast search
 *   4. Orientation: well position relative to cassette axis
 *   5. Window detection: 1D gradient projection edges
 *   6. Homography: 4-point perspective transform with bilinear interpolation
 *
 * Fallback: detection 실패 시 null 반환 → app.js에서 기존 guide overlay crop 사용
 */

class KitDetector {
    constructor(config = {}) {
        this.config = {
            // 처리 해상도 (성능/정확도 균형)
            processMaxWidth: 480,
            // 정준 strip 이미지 크기
            canonicalStripWidth: 240,
            canonicalStripHeight: 720,
            // 검출 파라미터
            cassetteBrightnessFactor: 1.02,  // 이미지 평균 대비 cassette 밝기 배수
            wellMinContrast: 5,              // 웰 내부/외부 대비 최소값
            wellRadiusRatio: 0.10,           // 카세트 폭 대비 웰 반경 비율
            minConfidence: 0.35,             // 전체 검출 신뢰도 임계값
            maxSkewRatio: 0.35,              // 원근 왜곡 허용 한계 (edge length ratio)
            ...config
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────

    /**
     * 캡처된 이미지에서 키트 특징점 검출
     * @param {HTMLCanvasElement} srcCanvas - 캡처된 원본 캔버스
     * @returns {Object} detection result
     */
    async detect(srcCanvas) {
        const t0 = performance.now();
        try {
            // 1. 전처리: 다운스케일 + 그레이스케일 + Sobel
            const { canvas, scale } = this._preprocess(srcCanvas);
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            const { gray, gradX, gradY, gradMag } = this._computeGrayscaleAndGradient(canvas);

            // 2. 카세트 검출
            const cassette = this._detectCassette(gray, w, h);
            if (!cassette) {
                return this._fail('cassette_not_found', t0);
            }

            // 3. 웰 검출 (적분 영상 기반 원형 대비 검색)
            const integral = this._computeIntegralImage(gray, w, h);
            const wellCandidates = this._detectWell(gray, integral, gradMag, w, h, cassette);
            if (!wellCandidates || wellCandidates.length === 0) {
                return this._fail('well_not_found', t0, { cassette });
            }

            // 4-7. 각 웰 후보에 대해 window 검출 시도
            let bestResult = null;
            for (const well of wellCandidates) {
                const orientation = this._determineOrientation(well, cassette);
                const winResult = this._detectWindow(gray, gradMag, w, h, cassette, well, orientation);
                if (winResult) {
                    const corners = this._orderCorners(winResult.corners, well);
                    const quality = this._validateGeometry(corners);
                    const confidence = this._computeConfidence(cassette, well, winResult, quality);
                    if (!bestResult || confidence > bestResult.confidence) {
                        bestResult = { well, orientation, winResult, corners, quality, confidence };
                    }
                    if (quality.valid && confidence >= this.config.minConfidence) break;
                }
            }

            if (!bestResult) {
                return this._fail('window_not_found', t0, { cassette, well: wellCandidates[0] });
            }

            const { well, orientation, winResult, corners, quality, confidence } = bestResult;

            // 원본 해상도로 스케일백
            const result = {
                success: confidence >= this.config.minConfidence && quality.valid,
                confidence,
                orientation,
                quality,
                cassette: this._scaleRect(cassette, scale),
                well: this._scalePoint(well, scale),
                window: {
                    corners: corners.map(c => ({ x: c.x / scale, y: c.y / scale })),
                    edges: winResult.edges
                },
                processScale: scale,
                elapsedMs: Math.round(performance.now() - t0)
            };

            return result;
        } catch (e) {
            console.error('[KitDetector] detect error:', e);
            return this._fail(e.message, t0);
        }
    }

    /**
     * 검출된 검사창을 정준 strip 이미지로 원근 보정
     * @param {HTMLCanvasElement} srcCanvas - 원본 캔버스
     * @param {Object} detection - detect() 결과
     * @returns {HTMLCanvasElement} 정준 strip 캔버스 (240x720)
     */
    rectifyWindow(srcCanvas, detection) {
        const W = this.config.canonicalStripWidth;
        const H = this.config.canonicalStripHeight;
        const corners = detection.window.corners; // [BL, BR, TR, TL] (near-well → far-well)

        // 정준 좌표: BL=(0,H-1), BR=(W-1,H-1), TR=(W-1,0), TL=(0,0)
        const dstCorners = [
            { x: 0, y: H - 1 },         // BL → near-well-left
            { x: W - 1, y: H - 1 },     // BR → near-well-right
            { x: W - 1, y: 0 },         // TR → far-well-right
            { x: 0, y: 0 }              // TL → far-well-left
        ];

        // Homography: 정준 좌표 → 원본 이미지 좌표 (inverse mapping)
        const Hm = this._solveHomography(dstCorners, corners);
        return this._warpPerspective(srcCanvas, Hm, W, H);
    }

    /**
     * 검출 결과를 캔버스에 시각화 (confirm 화면용)
     */
    drawDetection(canvas, detection) {
        const ctx = canvas.getContext('2d');
        const { cassette, well, window: win } = detection;

        // 카세트 외곽 (녹색)
        if (cassette) {
            ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(cassette.x, cassette.y, cassette.w, cassette.h);
        }

        // 웰 (노란 원)
        if (well) {
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(well.cx, well.cy, well.r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 검사창 (청록 사각형 + 모서리 점)
        if (win && win.corners) {
            ctx.strokeStyle = 'rgba(94, 197, 214, 0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const c = win.corners;
            ctx.moveTo(c[0].x, c[0].y);
            for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
            ctx.closePath();
            ctx.stroke();

            // 모서리 표시
            ctx.fillStyle = 'rgba(94, 197, 214, 1)';
            for (const p of c) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Preprocessing
    // ─────────────────────────────────────────────────────────────

    _preprocess(srcCanvas) {
        const scale = Math.min(1, this.config.processMaxWidth / srcCanvas.width);
        if (scale >= 1) return { canvas: srcCanvas, scale: 1 };
        const w = Math.round(srcCanvas.width * scale);
        const h = Math.round(srcCanvas.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
        return { canvas, scale };
    }

    _computeGrayscaleAndGradient(canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        const gray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        }

        // Sobel gradients
        const gradX = new Float32Array(w * h);
        const gradY = new Float32Array(w * h);
        const gradMag = new Float32Array(w * h);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                // Sobel X
                const gx = (
                    -gray[(y - 1) * w + (x - 1)] - 2 * gray[y * w + (x - 1)] - gray[(y + 1) * w + (x - 1)] +
                    gray[(y - 1) * w + (x + 1)] + 2 * gray[y * w + (x + 1)] + gray[(y + 1) * w + (x + 1)]
                ) / 4;
                // Sobel Y
                const gy = (
                    -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
                    gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)]
                ) / 4;

                gradX[i] = gx;
                gradY[i] = gy;
                gradMag[i] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        return { gray, gradX, gradY, gradMag };
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Integral Image
    // ─────────────────────────────────────────────────────────────

    _computeIntegralImage(gray, w, h) {
        const integral = new Float64Array((w + 1) * (h + 1));
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                rowSum += gray[y * w + x];
                integral[(y + 1) * (w + 1) + (x + 1)] =
                    integral[y * (w + 1) + (x + 1)] + rowSum;
            }
        }
        return integral;
    }

    _rectSum(integral, w, x, y, rw, rh) {
        return integral[(y + rh) * (w + 1) + (x + rw)] -
               integral[y * (w + 1) + (x + rw)] -
               integral[(y + rh) * (w + 1) + x] +
               integral[y * (w + 1) + x];
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Cassette Detection
    // ─────────────────────────────────────────────────────────────

    _detectCassette(gray, w, h) {
        // 1. 투영 프로파일 (행/열 평균 밝기)
        const rowProj = new Float32Array(h);
        const colProj = new Float32Array(w);

        for (let y = 0; y < h; y++) {
            let sum = 0;
            for (let x = 0; x < w; x++) sum += gray[y * w + x];
            rowProj[y] = sum / w;
        }
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let y = 0; y < h; y++) sum += gray[y * w + x];
            colProj[x] = sum / h;
        }

        // 2. 전체 평균
        let totalSum = 0;
        for (let y = 0; y < h; y++) totalSum += rowProj[y];
        const globalMean = totalSum / h;

        const threshold = globalMean * this.config.cassetteBrightnessFactor;

        // 3. 행 투영에서 밝은 구간(카세트) 찾기
        let yMin = -1, yMax = -1;
        for (let y = 0; y < h; y++) {
            if (rowProj[y] > threshold) { yMin = y; break; }
        }
        for (let y = h - 1; y >= 0; y--) {
            if (rowProj[y] > threshold) { yMax = y; break; }
        }
        if (yMin < 0 || yMax < 0 || yMax - yMin < h * 0.15) return null;

        // 4. 열 투영에서 밝은 구간 찾기
        let xMin = -1, xMax = -1;
        for (let x = 0; x < w; x++) {
            if (colProj[x] > threshold) { xMin = x; break; }
        }
        for (let x = w - 1; x >= 0; x--) {
            if (colProj[x] > threshold) { xMax = x; break; }
        }
        if (xMin < 0 || xMax < 0 || xMax - xMin < w * 0.08) return null;

        return {
            x: xMin, y: yMin,
            w: xMax - xMin + 1, h: yMax - yMin + 1,
            cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Well Detection (integral image based)
    // ─────────────────────────────────────────────────────────────

    _detectWell(gray, integral, gradMag, w, h, cassette) {
        // Returns array of well candidates sorted by score
        // 웰 반경: 카세트의 짧은 축 기준
        const minDim = Math.min(cassette.w, cassette.h);
        const wellRadius = Math.max(8, Math.round(minDim * this.config.wellRadiusRatio));
        const ringWidth = Math.max(4, Math.round(wellRadius * 0.5));

        // 카세트 평균 밝기
        const casAvg = this._rectSum(integral, w, cassette.x, cassette.y, cassette.w, cassette.h) / (cassette.w * cassette.h);

        // 하단 45%와 상단 45% 각각에서 가장 어두운 픽셀 검색
        const regions = [
            { yStart: cassette.y + cassette.h * 0.55, yEnd: cassette.y + cassette.h, label: 'bottom' },
            { yStart: cassette.y, yEnd: cassette.y + cassette.h * 0.45, label: 'top' }
        ];

        let best = { cx: 0, cy: 0, contrast: -1, darkness: 0, region: null, score: -1 };
        let candidates = [];

        for (const region of regions) {
            const yStart = Math.max(cassette.y, Math.floor(region.yStart));
            const yEnd = Math.min(cassette.y + cassette.h, Math.floor(region.yEnd));
            const xStart = cassette.x;
            const xEnd = Math.min(cassette.x + cassette.w, w);

            if (yEnd <= yStart) continue;

            // 1단계: 가장 어두운 픽셀 찾기 (raw pixel value, 카세트 내부만)
            let darkest = { x: 0, y: 0, val: 999 };
            const xStartInt = Math.max(cassette.x + 2, xStart);
            const xEndInt = Math.min(cassette.x + cassette.w - 2, xEnd);
            for (let y = yStart; y < yEnd; y++) {
                for (let x = xStartInt; x < xEndInt; x++) {
                    const val = gray[y * w + x];
                    if (val < darkest.val) {
                        darkest = { x, y, val };
                    }
                }
            }

            // 카세트 평균보다 어두워야 함
            if (darkest.val >= casAvg - 5) continue;

            // 2단계: 중심 정밀화 - well 반경 내 어두운 픽셀의 무게중심
            let sumX = 0, sumY = 0, sumW = 0;
            for (let dy = -wellRadius; dy <= wellRadius; dy += 2) {
                for (let dx = -wellRadius; dx <= wellRadius; dx += 2) {
                    const px = darkest.x + dx, py = darkest.y + dy;
                    if (px < 0 || px >= w || py < 0 || py >= h) continue;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > wellRadius) continue;
                    const v = gray[py * w + px];
                    const weight = Math.max(0, casAvg - v); // 어두울수록 가중치 높음
                    if (weight > 0) {
                        sumX += px * weight;
                        sumY += py * weight;
                        sumW += weight;
                    }
                }
            }
            const cx = sumW > 0 ? Math.round(sumX / sumW) : darkest.x;
            const cy = sumW > 0 ? Math.round(sumY / sumW) : darkest.y;

            // 3단계: contrast 검증 (카세트 경계로 클램핑)
            const ix0 = Math.max(cassette.x, cx - wellRadius);
            const iy0 = Math.max(cassette.y, cy - wellRadius);
            const ix1 = Math.min(cassette.x + cassette.w, cx + wellRadius);
            const iy1 = Math.min(cassette.y + cassette.h, cy + wellRadius);
            const iw = ix1 - ix0;
            const ih = iy1 - iy0;
            if (iw < 4 || ih < 4) continue;
            const innerSum = this._rectSum(integral, w, ix0, iy0, iw, ih);
            const innerArea = iw * ih;
            const innerAvg = innerSum / innerArea;

            const ox0 = Math.max(cassette.x, cx - wellRadius - ringWidth);
            const oy0 = Math.max(cassette.y, cy - wellRadius - ringWidth);
            const ox1 = Math.min(cassette.x + cassette.w, cx + wellRadius + ringWidth);
            const oy1 = Math.min(cassette.y + cassette.h, cy + wellRadius + ringWidth);
            const ow = ox1 - ox0;
            const oh = oy1 - oy0;
            if (ow <= iw || oh <= ih) continue;
            const outerSum = this._rectSum(integral, w, ox0, oy0, ow, oh);
            const outerArea = ow * oh;
            const ringArea = outerArea - innerArea;
            if (ringArea < 4) continue;
            const ringAvg = (outerSum - innerSum) / ringArea;
            const contrast = ringAvg - innerAvg;

            candidates.push({ cx, cy, contrast, darkness: casAvg - innerAvg, innerAvg, darkestVal: darkest.val, region: region.label, ringAvg });
        }
        
        
        // contrast 임계값을 통과한 후보만 고려
        const valid = candidates.filter(c => c.contrast >= this.config.wellMinContrast);
        
        // 유효한 후보가 없으면 null
        if (valid.length === 0) return null;
        
        // 그래디언트 링 점수: well 경계의 원형 edge 강도 측정
        for (const c of valid) {
            let gradSum = 0, gradCnt = 0;
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                const px = Math.round(c.cx + Math.cos(angle) * wellRadius);
                const py = Math.round(c.cy + Math.sin(angle) * wellRadius);
                if (px < 0 || px >= w || py < 0 || py >= h) continue;
                gradSum += gradMag[py * w + px];
                gradCnt++;
            }
            c.edgeScore = gradCnt > 0 ? gradSum / gradCnt : 0;
        }
        
        // 원형성 검증: 각 후보에 대해 8방향으로 어두운 영역의 반경 측정
        for (const c of valid) {
            const threshold = (c.innerAvg + c.ringAvg) / 2;
            const radii = [];
            const directions = [
                [0, -1], [1, -1], [1, 0], [1, 1],
                [0, 1], [-1, 1], [-1, 0], [-1, -1]
            ];
            for (const [dx, dy] of directions) {
                let r = 0;
                for (let d = 1; d <= wellRadius * 1.5; d++) {
                    const px = c.cx + Math.round(dx * d);
                    const py = c.cy + Math.round(dy * d);
                    if (px < 0 || px >= w || py < 0 || py >= h) break;
                    if (gray[py * w + px] > threshold) break;
                    r = d;
                }
                radii.push(r);
            }
            // 원형성: 8방향 반경의 표준편차가 평균에 비해 작아야 함
            const avgR = radii.reduce((a, b) => a + b, 0) / radii.length;
            const variance = radii.reduce((s, r) => s + (r - avgR) ** 2, 0) / radii.length;
            const stdR = Math.sqrt(variance);
            c.circularity = avgR > 0 ? Math.max(0, 1 - stdR / avgR) : 0;
            c.avgRadius = avgR;
        }
        
        // edgeScore + 원형성 + 어두움 종합 점수로 정렬
        valid.sort((a, b) => {
            const scoreA = a.edgeScore * 0.4 + a.circularity * 30 - a.darkestVal;
            const scoreB = b.edgeScore * 0.4 + b.circularity * 30 - b.darkestVal;
            return scoreB - scoreA;
        });
        
        // Return all candidates (sorted) for window-based verification
        return valid.map(c => ({
            cx: c.cx, cy: c.cy,
            r: wellRadius,
            contrast: c.contrast,
            region: c.region,
            score: c.edgeScore * 0.4 + c.circularity * 30 - c.darkestVal
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Orientation
    // ─────────────────────────────────────────────────────────────

    _determineOrientation(well, cassette) {
        // well이 카세트 하단에 있으면 'normal' (시료 주입구가 아래)
        // well이 카세트 상단에 있으면 'rotated' (180° 회전)
        const wellRelY = (well.cy - cassette.y) / cassette.h;
        return wellRelY > 0.5 ? 'normal' : 'rotated';
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Window Detection
    // ─────────────────────────────────────────────────────────────

    _detectWindow(gray, gradMag, w, h, cassette, well, orientation) {
        // 검사창은 well과 반대쪽에 위치
        // normal: well이 아래 → window는 위쪽
        // rotated: well이 위 → window는 아래쪽

        const casY = cassette.y, casH = cassette.h;
        const casX = cassette.x, casW = cassette.w;

        // 검사창 검색 영역: well과 카세트 끝 사이
        let winYStart, winYEnd;
        if (orientation === 'normal') {
            // well이 아래 → window는 위쪽 (cassette 상단 ~ well 위)
            winYStart = casY + Math.round(casH * 0.05);
            winYEnd = well.cy - well.r - Math.round(casH * 0.05);
        } else {
            // well이 위 → window는 아래쪽
            winYStart = well.cy + well.r + Math.round(casH * 0.05);
            winYEnd = casY + casH - Math.round(casH * 0.05);
        }

        // 검색 영역이 너무 작으면 실패
        if (winYEnd - winYStart < casH * 0.15) return null;

        // 1. 행 방향 그래디언트 프로파일 (수평 edge 검출: window 상/하단)
        const rowGrad = new Float32Array(winYEnd - winYStart);
        for (let y = 0; y < rowGrad.length; y++) {
            const py = winYStart + y;
            let sum = 0, count = 0;
            for (let x = casX + Math.round(casW * 0.2); x < casX + Math.round(casW * 0.8); x++) {
                const idx = py * w + x;
                sum += gradMag[idx];
                count++;
            }
            rowGrad[y] = count > 0 ? sum / count : 0;
        }

        // 2. 수평 edge 찾기: 상단과 하단 (가장 강한 두 피크)
        const hEdges = this._findTwoPeaks(rowGrad);
        if (!hEdges) return null;

        let topEdge, bottomEdge;
        if (orientation === 'normal') {
            // window의 상단이 먼저, 하단이 나중 (well에서 먼 쪽이 top)
            topEdge = winYStart + hEdges[0];
            bottomEdge = winYStart + hEdges[1];
        } else {
            topEdge = winYStart + hEdges[1];
            bottomEdge = winYStart + hEdges[0];
        }

        // 3. 열 방향 그래디언트 프로파일 (수직 edge 검출: window 좌/우)
        // 카세트 경계를 제외한 중앙 부분만 검색
        const colStart = Math.round(casW * 0.15);
        const colEnd = Math.round(casW * 0.85);
        const colGrad = new Float32Array(colEnd - colStart);
        const winCenterY = (topEdge + bottomEdge) / 2;
        const winHalfH = (bottomEdge - topEdge) / 2;
        for (let x = colStart; x < colEnd; x++) {
            const px = casX + x;
            let sum = 0, count = 0;
            for (let dy = -winHalfH; dy <= winHalfH; dy++) {
                const py = Math.round(winCenterY + dy);
                if (py < 0 || py >= h) continue;
                const idx = py * w + px;
                sum += gradMag[idx];
                count++;
            }
            colGrad[x - colStart] = count > 0 ? sum / count : 0;
        }

        // 4. 수직 edge 찾기: 좌측과 우측
        const vEdges = this._findTwoPeaks(colGrad);
        if (!vEdges) return null;

        const leftEdge = casX + colStart + vEdges[0];
        const rightEdge = casX + colStart + vEdges[1];

        // 5. 모서리 생성
        const corners = [
            { x: leftEdge, y: bottomEdge },  // BL (near well)
            { x: rightEdge, y: bottomEdge }, // BR (near well)
            { x: rightEdge, y: topEdge },    // TR (far from well)
            { x: leftEdge, y: topEdge }      // TL (far from well)
        ];

        // 6. 검증: aspect ratio, 최소 크기
        const winW = rightEdge - leftEdge;
        const winH = bottomEdge - topEdge;
        if (winW < casW * 0.1 || winH < casH * 0.1) return null;
        if (winW > casW * 0.8 || winH > casH * 0.8) return null;

        return {
            corners,
            edges: { top: topEdge, bottom: bottomEdge, left: leftEdge, right: rightEdge }
        };
    }

    _findTwoPeaks(profile) {
        if (profile.length < 4) return null;

        // 평활화
        const smoothed = new Float32Array(profile.length);
        for (let i = 0; i < profile.length; i++) {
            let sum = 0, count = 0;
            for (let k = -1; k <= 1; k++) {
                const idx = i + k;
                if (idx >= 0 && idx < profile.length) { sum += profile[idx]; count++; }
            }
            smoothed[i] = sum / count;
        }

        // 최대값 찾기 (첫 번째 피크)
        let maxIdx1 = 0;
        for (let i = 1; i < smoothed.length; i++) {
            if (smoothed[i] > smoothed[maxIdx1]) maxIdx1 = i;
        }

        // 첫 번째 피크에서 충분히 떨어진 두 번째 피크 찾기
        const minSep = Math.max(3, Math.floor(smoothed.length * 0.2));
        let maxIdx2 = -1;
        for (let i = 0; i < smoothed.length; i++) {
            if (Math.abs(i - maxIdx1) < minSep) continue;
            if (maxIdx2 < 0 || smoothed[i] > smoothed[maxIdx2]) maxIdx2 = i;
        }

        if (maxIdx2 < 0) return null;

        // 순서 정렬
        return maxIdx1 < maxIdx2 ? [maxIdx1, maxIdx2] : [maxIdx2, maxIdx1];
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Corner Ordering & Quality
    // ─────────────────────────────────────────────────────────────

    _orderCorners(corners, well) {
        // well 중심으로부터의 거리로 near/far 분류
        const dists = corners.map((c, i) => ({
            idx: i,
            dist: Math.sqrt((c.x - well.cx) ** 2 + (c.y - well.cy) ** 2),
            corner: c
        }));

        dists.sort((a, b) => a.dist - b.dist);

        // 가까운 2개 = near-well (bottom), 먼 2개 = far-well (top)
        const near = dists.slice(0, 2);
        const far = dists.slice(2, 4);

        // near: x가 작은 것이 BL, 큰 것이 BR
        near.sort((a, b) => a.corner.x - b.corner.x);
        // far: x가 작은 것이 TL, 큰 것이 TR
        far.sort((a, b) => a.corner.x - b.corner.x);

        return [
            near[0].corner,  // BL (near-well-left)
            near[1].corner,  // BR (near-well-right)
            far[1].corner,   // TR (far-well-right)
            far[0].corner    // TL (far-well-left)
        ];
    }

    _validateGeometry(corners) {
        // 4변 길이 계산
        // BL(0) → BR(1) → TR(2) → TL(3) → BL(0)
        const sides = [];
        for (let i = 0; i < 4; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 4];
            sides.push(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2));
        }

        // 대각선 계산
        const diag1 = Math.sqrt((corners[0].x - corners[2].x) ** 2 + (corners[0].y - corners[2].y) ** 2);
        const diag2 = Math.sqrt((corners[1].x - corners[3].x) ** 2 + (corners[1].y - corners[3].y) ** 2);
        const diagRatio = Math.max(diag1, diag2) / Math.max(0.1, Math.min(diag1, diag2));

        // 마주보는 변의 길이 비교 (skew 체크, aspect ratio는 체크하지 않음)
        // sides[0]=BL→BR (bottom), sides[2]=TR→TL (top): 마주보는 변
        // sides[1]=BR→TR (right), sides[3]=TL→BL (left): 마주보는 변
        const hRatio = Math.max(sides[0], sides[2]) / Math.max(0.1, Math.min(sides[0], sides[2]));
        const vRatio = Math.max(sides[1], sides[3]) / Math.max(0.1, Math.min(sides[1], sides[3]));
        const maxOppRatio = Math.max(hRatio, vRatio);

        const valid = maxOppRatio < 1 + this.config.maxSkewRatio &&
                      diagRatio < 1 + this.config.maxSkewRatio &&
                      Math.min(...sides) > 5;

        return { valid, sideRatio: maxOppRatio, diagRatio, sides: [diag1, diag2] };
    }

    _computeConfidence(cassette, well, winResult, quality) {
        let conf = 0;

        // 카세트 검출 (기본 0.2)
        if (cassette) conf += 0.2;

        // 웰 검출 (0.3)
        if (well) {
            conf += 0.15;
            conf += Math.min(0.15, well.contrast / 40);
        }

        // 검사창 검출 (0.3)
        if (winResult) {
            conf += 0.2;
            // edge 강도 평가
            const edges = winResult.edges;
            const winSize = Math.abs(edges.right - edges.left) * Math.abs(edges.bottom - edges.top);
            if (winSize > 100) conf += 0.1;
        }

        // 기하학적 품질 (0.2)
        if (quality.valid) {
            conf += 0.1;
            conf += Math.max(0, 0.1 - (quality.sideRatio - 1) * 0.2);
        }

        return Math.min(1.0, conf);
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Homography & Warp
    // ─────────────────────────────────────────────────────────────

    _solveHomography(src, dst) {
        // 8x8 선형 시스템: A*h = b
        // src → dst 매핑 (정준 좌표 → 원본 좌표, inverse mapping용)
        const A = [];
        const b = [];
        for (let i = 0; i < 4; i++) {
            const { x, y } = src[i];
            const { x: X, y: Y } = dst[i];
            A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
            A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
            b.push(X);
            b.push(Y);
        }

        const h = this._gaussianSolve(A, b);
        return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    }

    _gaussianSolve(A, b) {
        const n = b.length;
        // Augmented matrix
        const M = A.map((row, i) => [...row, b[i]]);

        // Forward elimination with partial pivoting
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
            }
            [M[i], M[maxRow]] = [M[maxRow], M[i]];

            if (Math.abs(M[i][i]) < 1e-12) {
                // 정특이 행렬: 0으로 채움
                M[i][i] = 1e-12;
            }

            for (let k = i + 1; k < n; k++) {
                const factor = M[k][i] / M[i][i];
                for (let j = i; j <= n; j++) {
                    M[k][j] -= factor * M[i][j];
                }
            }
        }

        // Back substitution
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let sum = 0;
            for (let j = i + 1; j < n; j++) sum += M[i][j] * x[j];
            x[i] = (M[i][n] - sum) / M[i][i];
        }
        return x;
    }

    _warpPerspective(srcCanvas, H, outW, outH) {
        const srcCtx = srcCanvas.getContext('2d');
        const srcW = srcCanvas.width;
        const srcH = srcCanvas.height;
        const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        const outImgData = outCtx.createImageData(outW, outH);
        const outData = outImgData.data;

        const h11 = H[0], h12 = H[1], h13 = H[2];
        const h21 = H[3], h22 = H[4], h23 = H[5];
        const h31 = H[6], h32 = H[7];

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const denom = h31 * x + h32 * y + 1;
                const srcX = (h11 * x + h12 * y + h13) / denom;
                const srcY = (h21 * x + h22 * y + h23) / denom;

                // Bilinear interpolation
                const x0 = Math.floor(srcX);
                const y0 = Math.floor(srcY);
                const x1 = x0 + 1;
                const y1 = y0 + 1;
                const dx = srcX - x0;
                const dy = srcY - y0;

                const outIdx = (y * outW + x) * 4;

                if (x0 >= 0 && x1 < srcW && y0 >= 0 && y1 < srcH) {
                    const i00 = (y0 * srcW + x0) * 4;
                    const i01 = (y0 * srcW + x1) * 4;
                    const i10 = (y1 * srcW + x0) * 4;
                    const i11 = (y1 * srcW + x1) * 4;

                    for (let c = 0; c < 4; c++) {
                        outData[outIdx + c] =
                            srcData[i00 + c] * (1 - dx) * (1 - dy) +
                            srcData[i01 + c] * dx * (1 - dy) +
                            srcData[i10 + c] * (1 - dx) * dy +
                            srcData[i11 + c] * dx * dy;
                    }
                } else if (x0 >= 0 && x0 < srcW && y0 >= 0 && y0 < srcH) {
                    // 가장자리: nearest neighbor
                    const idx = (y0 * srcW + x0) * 4;
                    for (let c = 0; c < 4; c++) {
                        outData[outIdx + c] = srcData[idx + c];
                    }
                } else {
                    // 범위 외: 흰색
                    outData[outIdx] = 255;
                    outData[outIdx + 1] = 255;
                    outData[outIdx + 2] = 255;
                    outData[outIdx + 3] = 255;
                }
            }
        }

        outCtx.putImageData(outImgData, 0, 0);
        return outCanvas;
    }

    // ─────────────────────────────────────────────────────────────
    // Private: Utilities
    // ─────────────────────────────────────────────────────────────

    _scaleRect(rect, scale) {
        return {
            x: rect.x / scale,
            y: rect.y / scale,
            w: rect.w / scale,
            h: rect.h / scale,
            cx: rect.cx / scale,
            cy: rect.cy / scale
        };
    }

    _scalePoint(pt, scale) {
        return {
            cx: pt.cx / scale,
            cy: pt.cy / scale,
            r: pt.r / scale,
            contrast: pt.contrast,
            region: pt.region
        };
    }

    _fail(reason, t0, partial = {}) {
        return {
            success: false,
            confidence: 0,
            errorReason: reason,
            ...partial,
            elapsedMs: Math.round(performance.now() - t0)
        };
    }
}

window.KitDetector = KitDetector;
