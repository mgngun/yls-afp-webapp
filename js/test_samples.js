/**
 * LFA Test Sample Generator & Image Repository
 * Generates synthetic and realistic LFA strip images for testing without a physical kit.
 */

class LFATestSamples {
    static getSamples() {
        return [
            {
                id: 'real_kit',
                title: '실제 키트 촬영본 (Real Kit Sample)',
                description: '실물 LFA 키트 양성 반응 이미지',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.85,
                    tLine: 0.45,
                    noise: 0.03,
                    shadow: true,
                    wellAtBottom: true
                })
            },
            {
                id: 'strong_positive',
                title: '강양성 샘플 (Strong Positive, 0.05 mg/dL)',
                description: 'C라인과 선명한 T라인 발색',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.90,
                    tLine: 0.75,
                    noise: 0.02,
                    shadow: false,
                    wellAtBottom: true
                })
            },
            {
                id: 'faint_positive',
                title: '미세 양성 샘플 (Faint Line, 0.01 mg/dL)',
                description: '육안 판별이 어려운 극미량 T라인 (Green 채널 고감도 검출)',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.88,
                    tLine: 0.08,  // Very faint test line
                    noise: 0.04,
                    shadow: true,
                    wellAtBottom: true
                })
            },
            {
                id: 'negative',
                title: '음성 샘플 (Negative, 0.00 mg/dL)',
                description: 'C라인만 정상 발색, T라인 없음',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.85,
                    tLine: 0.0,
                    noise: 0.03,
                    shadow: false,
                    wellAtBottom: true
                })
            },
            {
                id: 'invalid_no_c',
                title: '검사 실패 샘플 (Invalid - No C Line)',
                description: 'C라인 미발색으로 인한 유효성 검증 실패',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.0,
                    tLine: 0.0,
                    noise: 0.05,
                    shadow: true,
                    wellAtBottom: true
                })
            },
            {
                id: 'upside_down',
                title: '상하 반전 샘플 (Inverted / Upside Down)',
                description: '키트가 180도 뒤집혀 촬영된 상태 (자동 감지 및 회전 보정 테스트)',
                generate: () => LFATestSamples.createSyntheticKit({
                    cLine: 0.85,
                    tLine: 0.35,
                    noise: 0.03,
                    shadow: true,
                    wellAtBottom: false // Inverted!
                })
            }
        ];
    }

    /**
     * Creates a photorealistic synthetic LFA kit canvas
     */
    static createSyntheticKit(options = {}) {
        const {
            cLine = 0.85,
            tLine = 0.40,
            noise = 0.03,
            shadow = true,
            wellAtBottom = true
        } = options;

        const w = 480;
        const h = 1440;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Background desk surface
        ctx.fillStyle = '#dfe5ea';
        ctx.fillRect(0, 0, w, h);

        // Kit bounds
        const kw = w * 0.70;
        const kh = h * 0.88;
        const kx = (w - kw) / 2;
        const ky = (h - kh) / 2;
        const r = 24;

        // Shadow behind kit
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetX = 8;
        ctx.shadowOffsetY = 15;

        // White plastic cassette body
        ctx.beginPath();
        ctx.roundRect(kx, ky, kw, kh, r);
        const kitGrad = ctx.createLinearGradient(kx, ky, kx + kw, ky + kh);
        kitGrad.addColorStop(0, '#f9fafb');
        kitGrad.addColorStop(0.5, '#f0f3f6');
        kitGrad.addColorStop(1, '#e5e9ee');
        ctx.fillStyle = kitGrad;
        ctx.fill();
        ctx.restore();

        // Kit border stroke
        ctx.beginPath();
        ctx.roundRect(kx, ky, kw, kh, r);
        ctx.strokeStyle = '#d0d7de';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Reading Window (Recessed rectangular groove)
        const winW = kw * 0.36;
        const winH = kh * 0.32;
        const winX = kx + (kw - winW) / 2;
        const winY = ky + kh * 0.28;

        // Bevel outer depression
        ctx.fillStyle = '#dbe1e8';
        ctx.beginPath();
        ctx.roundRect(winX - 6, winY - 6, winW + 12, winH + 12, 8);
        ctx.fill();

        // Nitrocellulose Membrane (White paper strip)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(winX, winY, winW, winH);

        // Subtle membrane texture/noise
        const memData = ctx.getImageData(winX, winY, winW, winH);
        for (let i = 0; i < memData.data.length; i += 4) {
            const n = (Math.random() - 0.5) * 15;
            memData.data[i] = Math.min(255, Math.max(220, 252 + n));
            memData.data[i + 1] = Math.min(255, Math.max(220, 250 + n));
            memData.data[i + 2] = Math.min(255, Math.max(220, 248 + n));
        }
        ctx.putImageData(memData, winX, winY);

        // Draw Control Line (C Line) - Burgundy/Reddish Colloidal Gold
        if (cLine > 0) {
            const cY = winY + winH * 0.28;
            LFATestSamples._drawColloidalLine(ctx, winX, cY, winW, cLine);
        }

        // Draw Test Line (T Line)
        if (tLine > 0) {
            const tY = winY + winH * 0.72;
            LFATestSamples._drawColloidalLine(ctx, winX, tY, winW, tLine);
        }

        // Embossed Labels "C" and "T"
        ctx.font = 'bold 20px -apple-system, sans-serif';
        ctx.fillStyle = '#9aa5b1';
        ctx.textAlign = 'right';
        ctx.fillText('C', winX - 16, winY + winH * 0.30);
        ctx.fillText('T', winX - 16, winY + winH * 0.74);

        // Sample Well (Circular indentation)
        const wellRadius = kw * 0.22;
        const wellCenterX = kx + kw / 2;
        let wellCenterY = ky + kh * 0.82; // Default at bottom

        if (!wellAtBottom) {
            // Invert the entire canvas at the end, or draw well at top
            wellCenterY = ky + kh * 0.12;
        }

        // Outer depression bevel
        const wellGrad = ctx.createRadialGradient(
            wellCenterX - 4, wellCenterY - 4, wellRadius * 0.1,
            wellCenterX, wellCenterY, wellRadius
        );
        wellGrad.addColorStop(0, '#e2e8f0');
        wellGrad.addColorStop(0.7, '#cbd5e1');
        wellGrad.addColorStop(1, '#f8fafc');

        ctx.beginPath();
        ctx.arc(wellCenterX, wellCenterY, wellRadius, 0, Math.PI * 2);
        ctx.fillStyle = wellGrad;
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner sample hole
        ctx.beginPath();
        ctx.arc(wellCenterX, wellCenterY, wellRadius * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = '#475569';
        ctx.fill();

        // Optional non-uniform shadow / illumination gradient
        if (shadow) {
            const shadowGrad = ctx.createLinearGradient(0, 0, w, h);
            shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.0)');
            shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
            ctx.fillStyle = shadowGrad;
            ctx.fillRect(0, 0, w, h);
        }

        if (!wellAtBottom) {
            // Flip the entire canvas 180 degrees to simulate true inverted photo
            const flipCanvas = document.createElement('canvas');
            flipCanvas.width = w;
            flipCanvas.height = h;
            const flipCtx = flipCanvas.getContext('2d');
            flipCtx.translate(w / 2, h / 2);
            flipCtx.rotate(Math.PI);
            flipCtx.drawImage(canvas, -w / 2, -h / 2);
            return flipCanvas;
        }

        return canvas;
    }

    static _drawColloidalLine(ctx, x, y, width, intensity) {
        ctx.save();
        const lineH = 7;
        const grad = ctx.createLinearGradient(x, y - lineH, x, y + lineH);
        
        // Colloidal gold absorption gives wine-red / burgundy color
        // Peak absorption in Green (530nm)
        const alpha = Math.min(0.95, intensity * 0.9 + 0.05);
        grad.addColorStop(0, `rgba(168, 48, 72, 0.0)`);
        grad.addColorStop(0.3, `rgba(168, 48, 72, ${alpha * 0.7})`);
        grad.addColorStop(0.5, `rgba(160, 36, 62, ${alpha})`);
        grad.addColorStop(0.7, `rgba(168, 48, 72, ${alpha * 0.7})`);
        grad.addColorStop(1, `rgba(168, 48, 72, 0.0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(x + 2, y - lineH / 2, width - 4, lineH);
        ctx.restore();
    }
}

window.LFATestSamples = LFATestSamples;
