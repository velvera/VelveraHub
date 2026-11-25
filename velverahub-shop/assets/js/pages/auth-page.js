(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(window.location.search);
    const trustedRedirect = params.get('redirect');

    function redirectAfterAuth() {
        if (trustedRedirect && trustedRedirect.startsWith('/') && !trustedRedirect.startsWith('//')) {
            window.location.assign(trustedRedirect);
        } else if (window.AuthService?.isSellerAccount?.()) {
            window.location.assign(
                window.VelveraHubDomains?.sellerUrl?.('/') || '/pages/seller.html'
            );
        } else {
            window.location.assign('/pages/account.html');
        }
    }

    function redirectAfterRegistration(emailPending = false) {
        const next = trustedRedirect && trustedRedirect.startsWith('/') && !trustedRedirect.startsWith('//')
            ? trustedRedirect
            : window.AuthService?.isSellerAccount?.()
                ? (window.VelveraHubDomains?.sellerUrl?.('/') || '/pages/seller.html')
                : '/pages/account.html';
        const params = new URLSearchParams({
            type: 'registration',
            next
        });
        if (emailPending) params.set('pending', '1');
        window.location.assign(`/pages/success.html?${params.toString()}`);
    }

    function showFeedback(message, type = 'error') {
        const node = $('authFeedback');
        if (!node) return;
        node.textContent = message;
        node.dataset.type = type;
        node.hidden = false;
    }

    function validateBeforeSubmit(form) {
        return window.VelveraInteractionFeedback?.validateForm?.(form) ?? form.checkValidity();
    }

    function setMode(mode) {
        const register = mode === 'register';
        $('authLoginForm')?.toggleAttribute('hidden', register);
        $('authRegisterForm')?.toggleAttribute('hidden', !register);
        document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
            const active = tab.dataset.authMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        const title = $('authTitle');
        const subtitle = $('authSubtitle');
        if (title) title.textContent = register ? 'Create your Veeve account' : 'Welcome back';
        if (subtitle) subtitle.textContent = register
            ? 'Join a trusted marketplace where you can shop, sell, and grow.'
            : 'Sign in to manage orders, saved products, and your marketplace activity.';
        const url = new URL(window.location.href);
        url.searchParams.set('mode', register ? 'register' : 'login');
        if (trustedRedirect) url.searchParams.set('redirect', trustedRedirect);
        window.history.replaceState({}, '', url);
    }

    function syncSellerFields() {
        const isSeller = document.querySelector('input[name="accountType"]:checked')?.value === 'seller';
        $('authSellerFields')?.toggleAttribute('hidden', !isSeller);
        ['authBusinessName', 'authBusinessState'].forEach((id) => $(id)?.toggleAttribute('required', isSeller));
    }

    async function init() {
        if (window.RegionService) {
            window.RegionService.appendLocationOptions($('authBusinessState'), false);
        }
        await window.AuthService?.init?.();
        if (window.AuthService?.isLoggedIn()) {
            redirectAfterAuth();
            return;
        }

        setMode(params.get('mode') === 'register' ? 'register' : 'login');
        document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
            tab.addEventListener('click', () => setMode(tab.dataset.authMode));
        });
        document.querySelectorAll('input[name="accountType"]').forEach((input) => {
            input.addEventListener('change', syncSellerFields);
        });
        syncSellerFields();

        $('authLoginForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (!validateBeforeSubmit(form)) return;
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                const { error } = await window.AuthService.signIn(form.email.value.trim(), form.password.value);
                if (error) {
                    showFeedback(window.AsyncFeedback?.errorMessage(
                        error,
                        'Sign-in could not be completed. Check your details and try again.',
                        'auth-sign-in'
                    ) || window.AuthService.errorMessage?.(error) || 'Sign-in could not be completed. Check your details and try again.');
                    return;
                }
                showFeedback('Signed in successfully. Redirecting…', 'success');
                redirectAfterAuth();
            } catch (error) {
                showFeedback(window.AsyncFeedback?.errorMessage(
                    error,
                    'Sign-in could not be completed. Please try again.',
                    'auth-sign-in'
                ) || 'Sign-in could not be completed. Please try again.');
            } finally {
                button.disabled = false;
            }
        });

        $('authRegisterForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (!validateBeforeSubmit(form)) return;
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                const { error, data } = await window.AuthService.signUp(
                    form.email.value.trim(),
                    form.password.value,
                    {
                        firstName: form.firstName.value.trim(),
                        lastName: form.lastName.value.trim(),
                        accountType: form.accountType.value,
                        ageConfirmed: form.elements.ageConfirmed.checked,
                        termsAccepted: form.elements.terms.checked,
                        businessName: form.businessName?.value.trim() || '',
                        businessPhone: form.businessPhone?.value.trim() || '',
                        businessState: form.businessState?.value || ''
                    }
                );
                if (error) {
                    showFeedback(window.AsyncFeedback?.errorMessage(
                        error,
                        'Account creation could not be completed. Please review your details and try again.',
                        'auth-sign-up'
                    ) || 'Account creation could not be completed. Please review your details and try again.');
                    return;
                }
                if (data) {
                    redirectAfterRegistration(false);
                } else {
                    redirectAfterRegistration(true);
                }
            } catch (error) {
                showFeedback(window.AsyncFeedback?.errorMessage(
                    error,
                    'Account creation could not be completed. Please try again.',
                    'auth-sign-up'
                ) || 'Account creation could not be completed. Please try again.');
            } finally {
                button.disabled = false;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();