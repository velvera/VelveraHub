(function () {
    'use strict';
    let enabledCache = { value: false, expiresAt: 0 };
    const client = () => window.SupabaseClient?.isConfigured?.() ? window.SupabaseClient.get() : null;
    function normalizeNigerianPhone(value) {
        const input = String(value || '').trim();
        if (!input || input.length > 40) return '';
        let digits = input.replace(/\D/g, '');
        if (digits.startsWith('234')) digits = digits.slice(3);
        else if (digits.startsWith('0')) digits = digits.slice(1);
        return /^[789]\d{9}$/.test(digits) ? `+234${digits}` : '';
    }
    async function isEnabled(force = false) {
        if (!force && enabledCache.expiresAt > Date.now()) return enabledCache.value;
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        try {
            const supabase = client();
            if (!supabase) return false;
            const { data, error } = await supabase.rpc('get_phone_verification_enabled');
            if (error) throw error;
            enabledCache = { value: data === true, expiresAt: Date.now() + 15000 };
            return enabledCache.value;
        } catch (_) {
            enabledCache = { value: false, expiresAt: Date.now() + 5000 };
            return false;
        }
    }
    async function invoke(action, payload = {}) {
        const supabase = client();
        if (!supabase) throw new Error('Phone verification is unavailable. Please try again later.');
        const { data, error } = await supabase.functions.invoke('phone-verification', { body: { action, ...payload } });
        if (!error) return data || {};
        let response = null;
        try { response = await error.context?.clone?.().json(); } catch (_) {}
        throw new Error(response?.error || error.message || 'Phone verification failed. Please try again.');
    }
    function ensureStyles() {
        if (document.getElementById('phoneVerificationDialogStyles')) return;
        const style = document.createElement('style');
        style.id = 'phoneVerificationDialogStyles';
        style.textContent = `.phone-verification-backdrop{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:20px;background:rgba(14,10,31,.62)}.phone-verification-dialog{width:min(100%,460px);padding:24px;border:1px solid #e8e5ef;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(13,8,30,.28);color:#171717}.phone-verification-dialog h2{margin:0 0 8px;font-size:1.35rem}.phone-verification-dialog p{margin:0 0 16px;color:#5b5566;line-height:1.55}.phone-verification-dialog label{display:block;margin:14px 0 6px;font-weight:600}.phone-verification-dialog input{width:100%;min-height:46px;padding:10px 12px;border:1px solid #cfc9da;border-radius:9px}.phone-verification-dialog button{min-height:44px;padding:10px 14px;border:0;border-radius:9px;font-weight:700}.phone-verification-dialog .phone-verification-primary{width:100%;margin-top:16px;background:#6d28d9;color:white}.phone-verification-dialog .phone-verification-close{float:right;background:transparent;color:#514b5a}.phone-verification-dialog .phone-verification-message{min-height:24px;margin:12px 0 0;font-size:.93rem}.phone-verification-dialog .phone-verification-message[data-type=error]{color:#b42318}.phone-verification-dialog .phone-verification-message[data-type=success]{color:#16794b}.phone-verification-dialog .phone-verification-timing{font-size:.88rem}@media(max-width:480px){.phone-verification-dialog{padding:20px}}`;
        document.head.append(style);
    }
    function openDialog({ mode, email = '', initialPhone = '' }) {
        ensureStyles();
        document.getElementById('phoneVerificationBackdrop')?.remove();
        const backdrop = document.createElement('div');
        backdrop.className = 'phone-verification-backdrop';
        backdrop.id = 'phoneVerificationBackdrop';
        backdrop.innerHTML = `<section class="phone-verification-dialog" role="dialog" aria-modal="true" aria-labelledby="phoneVerificationTitle"><button class="phone-verification-close" type="button" aria-label="Close phone verification">Close</button><h2 id="phoneVerificationTitle">${mode === 'signup' ? 'Verify your Nigerian phone' : 'Verify your phone number'}</h2><p>${mode === 'signup' ? 'We will text a six-digit code to your Nigerian mobile number. You must verify it before creating your account.' : 'We will text a six-digit code to your new Nigerian mobile number. Your account number changes only after the code is verified.'}</p><label for="phoneVerificationNumber">Nigerian mobile number</label><input id="phoneVerificationNumber" type="tel" inputmode="tel" autocomplete="tel" placeholder="0801 234 5678" maxlength="40"><div class="phone-verification-code-row" hidden><label for="phoneVerificationCode">Six-digit code</label><input id="phoneVerificationCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456"><p class="phone-verification-timing">Codes expire after 5 minutes. Request another after 60 seconds.</p></div><p class="phone-verification-message" role="status" aria-live="polite"></p><button class="phone-verification-primary" type="button">Send code</button><button class="phone-verification-primary phone-verification-verify" type="button" hidden>Verify number</button></section>`;
        document.body.append(backdrop);
        const dialog = backdrop.querySelector('.phone-verification-dialog');
        const phoneInput = dialog.querySelector('#phoneVerificationNumber');
        const codeRow = dialog.querySelector('.phone-verification-code-row');
        const codeInput = dialog.querySelector('#phoneVerificationCode');
        const message = dialog.querySelector('.phone-verification-message');
        const sendButton = dialog.querySelector('.phone-verification-primary:not(.phone-verification-verify)');
        const verifyButton = dialog.querySelector('.phone-verification-verify');
        phoneInput.value = initialPhone || '';
        let resendAt = 0, timer = null, finished = false;
        return new Promise((resolve) => {
            const finish = (value) => {
                if (finished) return;
                finished = true;
                if (timer) window.clearInterval(timer);
                document.removeEventListener('keydown', onKey);
                backdrop.remove();
                resolve(value);
            };
            const setMessage = (text, type = 'error') => { message.textContent = text || ''; message.dataset.type = type; };
            const refreshResend = () => {
                const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
                sendButton.disabled = remaining > 0;
                sendButton.textContent = remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code';
                if (!remaining && timer) { window.clearInterval(timer); timer = null; }
            };
            const onKey = (event) => { if (event.key === 'Escape') finish(null); };
            document.addEventListener('keydown', onKey);
            dialog.querySelector('.phone-verification-close').addEventListener('click', () => finish(null));
            phoneInput.focus();
            sendButton.addEventListener('click', async () => {
                const phone = normalizeNigerianPhone(phoneInput.value);
                if (!phone) { setMessage('Enter a valid Nigerian mobile number, such as 0801 234 5678.'); phoneInput.focus(); return; }
                sendButton.disabled = true;
                setMessage('Sending your code…', 'success');
                try {
                    const result = await invoke(mode === 'signup' ? 'send_signup' : 'send_update', { phone, ...(mode === 'signup' ? { email } : {}) });
                    phoneInput.value = result.phone || phone;
                    phoneInput.readOnly = true;
                    codeRow.hidden = false;
                    verifyButton.hidden = false;
                    resendAt = Date.now() + 60000;
                    setMessage(result.message || 'A six-digit code was sent by SMS.', 'success');
                    refreshResend();
                    timer = window.setInterval(refreshResend, 1000);
                    codeInput.focus();
                } catch (error) { setMessage(error.message || 'The code could not be sent. Please try again.'); sendButton.disabled = false; sendButton.textContent = 'Send code'; }
            });
            verifyButton.addEventListener('click', async () => {
                const code = codeInput.value.trim();
                if (!/^\d{6}$/.test(code)) { setMessage('Enter the six-digit code from your SMS.'); codeInput.focus(); return; }
                verifyButton.disabled = true;
                setMessage('Checking your code…', 'success');
                try {
                    const result = await invoke(mode === 'signup' ? 'verify_signup' : 'verify_update', { phone: phoneInput.value, code, ...(mode === 'signup' ? { email } : {}) });
                    enabledCache = { value: true, expiresAt: Date.now() + 15000 };
                    if (mode === 'update') {
                        const profile = window.AuthService?.getProfile?.();
                        if (profile) Object.assign(profile, { phone: result.phone, phone_e164: result.phone, phone_verified: true, phone_verified_at: new Date().toISOString() });
                        setMessage('Your phone number is verified and saved.', 'success');
                        window.setTimeout(() => finish(true), 500);
                    } else {
                        setMessage('Phone verified. Creating your account…', 'success');
                        finish({ phone: result.phone, ticket: result.ticket });
                    }
                } catch (error) { setMessage(error.message || 'That code could not be verified. Please try again.'); verifyButton.disabled = false; }
            });
        });
    }
    async function verifyForSignup(email, initialPhone = '') {
        if (!await isEnabled(true)) return null;
        return openDialog({ mode: 'signup', email, initialPhone });
    }
    async function requireVerifiedPhone(options = {}) {
        if (!await isEnabled(true)) return true;
        const profile = window.AuthService?.getProfile?.() || {};
        if (profile.phone_verified === true && !options.change) return true;
        return (await openDialog({ mode: 'update', initialPhone: options.change ? '' : (profile.phone_e164 || '') })) === true;
    }
    async function showAccountSettings(container) {
        if (!container || !await isEnabled(true)) return false;
        const profile = window.AuthService?.getProfile?.() || {};
        container.hidden = false;
        const status = container.querySelector('[data-phone-verification-status]');
        const button = container.querySelector('[data-phone-verification-change]');
        if (status) status.textContent = profile.phone_verified ? `Verified number: ${profile.phone_e164 || profile.phone}` : 'Phone verification has not been completed for this account.';
        if (button) {
            button.textContent = profile.phone_verified ? 'Change phone number' : 'Verify phone number';
            button.addEventListener('click', async () => {
                if (await requireVerifiedPhone({ change: true })) await showAccountSettings(container);
            }, { once: true });
        }
        return true;
    }
    window.PhoneVerification = { normalizeNigerianPhone, isEnabled, verifyForSignup, requireVerifiedPhone, showAccountSettings };
})();
