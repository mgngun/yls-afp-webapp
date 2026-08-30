/**
 * Google Sheets Integration Module for LFA Diagnostic App
 * Handles syncing test results to Google Sheets via Google Apps Script Webhook / API
 */

class GoogleSheetsSync {
    constructor() {
        this.STORAGE_KEY = 'lfa_sheets_config';
        this.QUEUE_KEY = 'lfa_sync_queue';
        this.DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzyZ_TTNI1Yh9LeGFFR3u2dAW7wAOJUr15HS032lEPDUovWq5syJelMRBbEjV2DthF7/exec';
        this.config = this.loadConfig();
    }

    loadConfig() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (!parsed.webhookUrl) {
                    parsed.webhookUrl = this.DEFAULT_WEBHOOK_URL;
                }
                return parsed;
            } catch (e) {}
        }
        return {
            enabled: true,
            webhookUrl: this.DEFAULT_WEBHOOK_URL,
            sheetId: '1ckyAywMytLJCClUgwizQakq5xdQmm_5fNeQYSW4S3jo',
            autoSync: true
        };
    }

    getConfig() {
        return this.config || this.loadConfig();
    }

    isConfigured() {
        return !!(this.config && this.config.webhookUrl && this.config.enabled);
    }

    saveConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.config));
    }

    async syncResult(analysisResult, user = {}, memo = '', cropFilename = '', cropDataUrl = null) {
        if (!analysisResult) return;
        const diag = analysisResult.diagnosis || {};
        return this.recordResult({
            timestamp:         this.formatTimestamp(new Date()),
            userId:            user.username || user.nickname || user.id || 'guest',
            cLineStatus:       diag.cLineStatus,
            tLineStatus:       diag.tLineStatus,
            cLineDetected:     diag.cLineDetected,
            tLineDetected:     diag.tLineDetected,
            result:            diag.result,
            resultEnglish:     diag.resultEnglish,
            concentration:     diag.concentration,
            errorReason:       diag.errorReason,
            memo:              memo,
            cropFilename:      cropFilename,
            cropImageBase64:   cropDataUrl
        });
    }

    /**
     * Records a diagnostic test result.
     * Google Sheets columns (per 1차 개편 spec):
     * timestamp | User_ID | C_line | T_line | result | value | error | Memo | Crop_image
     * Sheet: https://docs.google.com/spreadsheets/d/1ckyAywMytLJCClUgwizQakq5xdQmm_5fNeQYSW4S3jo
     */
    async recordResult(record) {
        const rowData = {
            timestamp:         record.timestamp || this.formatTimestamp(new Date()),
            User_ID:           record.userId    || 'guest',
            C_line:            record.cLineStatus || (record.cLineDetected ? 'ok' : 'none'),
            T_line:            record.tLineStatus || (record.tLineDetected ? 'ok' : 'none'),
            result:            record.resultEnglish ||
                                (record.result === '양성' ? 'positive' :
                                 record.result === '음성' ? 'negative' : 'fail'),
            value:             (record.concentration != null) ? record.concentration : '',
            error:             record.errorReason   || '',
            Memo:              record.memo          || '',
            Crop_image:        record.cropFilename  || '',
            crop_filename:     record.cropFilename  || '',
            crop_image_base64: record.cropImageBase64 || ''
        };

        // 1. Add to local queue / history
        this._enqueue(rowData);

        // 2. If webhook is configured, dispatch HTTP POST
        if (this.config.webhookUrl && this.config.enabled) {
            try {
                const res = await this._sendToWebhook(rowData);
                return { success: true, synced: true, rowData, response: res };
            } catch (err) {
                console.warn('Google Sheets Webhook Sync failed, queued locally:', err);
                return { success: true, synced: false, rowData, error: err.message };
            }
        }

        return { success: true, synced: false, rowData, message: 'Saved locally in queue' };
    }

    formatTimestamp(d) {
        const pad = (n) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const minutes = pad(d.getMinutes());
        const seconds = pad(d.getSeconds());
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    _enqueue(item) {
        const queue = this.getQueue();
        queue.push({
            ...item,
            id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            queuedAt: new Date().toISOString(),
            synced: false
        });
        localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
    }

    getQueue() {
        try {
            const raw = localStorage.getItem(this.QUEUE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    clearQueue() {
        localStorage.removeItem(this.QUEUE_KEY);
    }

    async _sendToWebhook(data) {
        const response = await fetch(this.config.webhookUrl, {
            method: 'POST',
            mode: 'no-cors', // Standard for Google Apps Script Web Apps
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return { status: 'dispatched' };
    }

    /**
     * Exports entire test history as CSV file
     */
    exportCSV() {
        const queue = this.getQueue();
        if (queue.length === 0) {
            alert('내보낼 검사 기록이 없습니다.');
            return;
        }

        const headers = ['timestamp', 'User_ID', 'C_line', 'T_line', 'result', 'value', 'error', 'Memo', 'Crop_image'];
        const rows = queue.map(r => [
            `"${r.timestamp    || ''}"`,
            `"${r.User_ID      || ''}"`,
            `"${r.C_line       || ''}"`,
            `"${r.T_line       || ''}"`,
            `"${r.result       || ''}"`,
            `"${r.value !== undefined ? r.value : ''}"`,
            `"${r.error        || ''}"`,
            `"${r.Memo         || ''}"`,
            `"${r.Crop_image   || ''}"`
        ]);

        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LFA_AFP_Test_Results_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

window.GoogleSheetsSync = GoogleSheetsSync;
