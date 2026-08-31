/**
 * YLS - Google Sheets User Authentication (development)
 *
 * 사용자 계정의 원본 DB는 Google Sheets의 "Users" 시트입니다.
 * 실제 서비스 전환 전에는 평문 Password 저장을 제거하고 서버 측 해시 인증으로 교체하세요.
 */
const USER_AUTH_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwIHUB6gmBFyauYse4jSofsvlGLHNO-9Jf5D6G3niJYjwmq5FjTRBqxDOYVJNJdjWsovw/exec';

const GoogleUserAuth = (() => {
    function assertConfigured() {
        if (!USER_AUTH_SCRIPT_URL || USER_AUTH_SCRIPT_URL.includes('PASTE_YOUR_')) {
            throw new Error('USER_AUTH_SCRIPT_URL is not configured.');
        }
    }

    function request(action, params = {}) {
        assertConfigured();
        return new Promise((resolve, reject) => {
            const callbackName = '__ylsUserAuth_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            const script = document.createElement('script');
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Google Apps Script request timeout'));
            }, 15000);

            function cleanup() {
                clearTimeout(timeout);
                try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
                if (script.parentNode) script.parentNode.removeChild(script);
            }

            window[callbackName] = (data) => {
                cleanup();
                resolve(data || { success: false, message: 'Empty response' });
            };

            const query = new URLSearchParams({
                action,
                callback: callbackName,
                ...params
            });

            script.onerror = () => {
                cleanup();
                reject(new Error('Google Apps Script load failed'));
            };
            script.src = USER_AUTH_SCRIPT_URL + (USER_AUTH_SCRIPT_URL.includes('?') ? '&' : '?') + query.toString();
            document.head.appendChild(script);
        });
    }

    return {
        register(username, password) {
            return request('registerUser', { username, password });
        },
        login(username, password) {
            return request('loginUser', { username, password });
        },
        changePassword(username, currentPassword, newPassword) {
            return request('changePassword', {
                username,
                currentPassword,
                newPassword
            });
        }
    };
})();
