(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const button = document.querySelector('[data-account-delete]');
        const status = document.getElementById('accountDeleteStatus');
        if (!button || !status) return;
        button.addEventListener('click', async () => {
            const confirmed = window.confirm('This submits your account deletion request for admin review. Your account will remain active until a trusted admin completes the deletion. Some transaction records may be retained. Continue?');
            if (!confirmed) return;
            button.disabled = true;
            status.hidden = false;
            status.textContent = 'Submitting your request…';
            try {
                if (window.supabaseConfigReady) await window.supabaseConfigReady;
                const supabase = window.SupabaseClient?.get();
                if (!supabase || !window.SupabaseClient.isConfigured()) {
                    throw new Error('The account deletion service is unavailable.');
                }
                const { data, error } = await supabase.rpc('request_account_deletion');
                if (error) throw error;
                const reference = data?.request?.request_id || data?.request_id;
                status.textContent = reference
                    ? `Request received for admin review. Reference: ${reference}. Your account is not deleted until an administrator completes the request.`
                    : data?.message || 'Your request was received for admin review. Your account is not deleted yet.';
                button.textContent = 'Request received';
            } catch (error) {
                status.textContent = window.AsyncFeedback?.errorMessage(
                    error,
                    'We could not complete your account deletion request. Please try again.',
                    'account-deletion-request'
                ) || 'We could not complete your account deletion request. Please try again.';
                button.disabled = false;
            }
        });
    });
})();