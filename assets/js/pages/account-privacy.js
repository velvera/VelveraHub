(function () {
    'use strict';

    function statusMessage(request) {
        if (!request?.status) return 'No account deletion request is currently recorded.';
        const reference = request.request_id ? `Request ${request.request_id}. ` : '';
        const date = request.created_at
            ? `Submitted ${new Date(request.created_at).toLocaleDateString()}. `
            : '';
        switch (request.status) {
            case 'received':
                return `${reference}${date}Your request is awaiting review. Your sign-in and account data remain active; submitting a request does not delete them.`;
            case 'in_review':
                return `${reference}${date}Your request is being reviewed. Your account remains active until the required deletion steps are completed.`;
            case 'completed':
                return `${reference}The request is marked complete in the review queue. This status alone cannot verify Supabase Auth deletion or cleanup of related data.`;
            case 'rejected':
                return `${reference}The request was rejected. Your account and data remain active; you may submit a new request.`;
            default:
                return 'The request status is unavailable. Your account has not been deleted by this status check.';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const button = document.querySelector('[data-account-delete]');
        const status = document.getElementById('accountDeleteStatus');
        if (!button || !status) return;

        function renderRequest(request) {
            status.hidden = false;
            status.textContent = statusMessage(request);
            status.dataset.requestStatus = request?.status || 'none';
            const activeRequest = ['received', 'in_review'].includes(request?.status);
            button.disabled = activeRequest;
            button.textContent = activeRequest ? 'Request in review' : 'Request account deletion';
        }

        async function loadRequestStatus() {
            try {
                if (window.supabaseConfigReady) await window.supabaseConfigReady;
                const supabase = window.SupabaseClient?.get();
                if (!supabase || !window.SupabaseClient.isConfigured()) {
                    status.textContent = 'Request status is unavailable right now. You can still submit a request after signing in.';
                    return;
                }
                const { data, error } = await supabase.rpc('get_my_account_deletion_request');
                if (error) throw error;
                renderRequest(data);
            } catch (_) {
                // Keep the duplicate-safe request action available if the
                // status-only migration has not reached this deployment yet.
                status.textContent = 'Request status is unavailable in this version. Your account is not deleted by this status check.';
            }
        }

        loadRequestStatus();

        button.addEventListener('click', async () => {
            if (button.disabled) return;
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
                const request = data?.request || data;
                if (request?.status) {
                    renderRequest(request);
                } else {
                    status.hidden = false;
                    status.textContent = data?.message || 'Your request was received for admin review. Your account is not deleted yet.';
                    button.textContent = 'Request received';
                    button.disabled = true;
                }
            } catch (error) {
                status.textContent = window.AsyncFeedback?.errorMessage(
                    error,
                    'We could not complete your account deletion request. Please try again.',
                    'account-deletion-request'
                ) || 'We could not complete your account deletion request. Please try again.';
                status.hidden = false;
                button.disabled = false;
            }
        });
    });
})();