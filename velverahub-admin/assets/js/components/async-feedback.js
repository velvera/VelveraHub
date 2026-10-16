(function () {
    'use strict';

    let sequence = 0;

    function createRequestId(scope = 'request') {
        sequence += 1;
        return `${String(scope).replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-${Date.now().toString(36)}-${sequence}`;
    }

    function log(scope, requestId, error, context = {}) {
        const { recoverable = false, ...safeContext } = context;
        const details = { request_id: requestId, scope, ...safeContext };
        if (error) {
            window.Observability?.reportError(scope, requestId, error, {
                source: safeContext.source || (recoverable ? 'handled-fallback' : 'handled'),
                action: safeContext.action || '',
                bucket: safeContext.bucket || '',
                mediaType: safeContext.mediaType || '',
                stage: safeContext.stage || '',
                mediaCount: Number.isFinite(safeContext.mediaCount) ? safeContext.mediaCount : null
            });
        }
        return requestId;
    }

    function isTechnicalMessage(value) {
        return /supabase|postgrest|postgres|schema|migration|sqlstate|pgrst|database|permission denied|could not find the table|could not find the column|relation .* does not exist|column .* does not exist|constraint|duplicate key|violates|stack trace|internal server|http\s*\d{3}|status code|failed to fetch|econn(?:refused|reset|timedout)?/i
            .test(String(value || ''));
    }

    function safeUserMessage(error, fallback = 'We could not complete that request. Please try again.') {
        const technicalFallback = 'We could not complete that request. Please try again.';
        if (isTechnicalMessage(fallback)) fallback = technicalFallback;
        if (error) {
            const requestId = createRequestId('ui-error');
            window.Observability?.reportError('ui-action', requestId, error);
            return window.Observability?.userMessage?.(error, fallback) || fallback;
        }
        return fallback || technicalFallback;
    }

    function escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
    }

    function render(container, state, options = {}) {
        if (!container) return;
        const messages = {
            loading: {
                icon: 'fa-spinner fa-spin',
                title: options.loadingTitle || 'Loading',
                message: options.loadingMessage || 'Please wait while we load the latest information.'
            },
            empty: {
                icon: 'fa-box-open',
                title: options.emptyTitle || 'Nothing to show yet',
                message: options.emptyMessage || 'There is no live information available for this view.'
            },
            error: {
                icon: 'fa-triangle-exclamation',
                title: options.errorTitle || 'Something went wrong',
                message: safeUserMessage(null, options.errorMessage || 'We could not load the latest information.')
            }
        };
        const copy = messages[state] || messages.error;
        const retry = typeof options.onRetry === 'function'
            ? `<button type="button" class="async-feedback-retry"><i class="fas fa-rotate"></i> Try again</button>`
            : '';
        container.innerHTML = `
            <div class="async-feedback async-feedback-${escape(state)}" role="${state === 'error' ? 'alert' : 'status'}" aria-live="polite">
                <i class="fas ${copy.icon}" aria-hidden="true"></i>
                <strong>${escape(copy.title)}</strong>
                <span>${escape(copy.message)}</span>
                ${retry}
            </div>`;
        if (typeof options.onRetry === 'function') {
            container.querySelector('.async-feedback-retry')?.addEventListener('click', options.onRetry);
        }
    }

    function bind(container, options = {}) {
        if (!container) return;
        container.classList.add('async-feedback-host');
        if (options.loading) render(container, 'loading', options);
    }

    window.AsyncFeedback = {
        createRequestId,
        log,
        render,
        bind,
        errorMessage(error, fallback = 'We could not complete that request. Please try again.', scope = 'ui-action') {
            if (error) {
                const requestId = createRequestId(scope);
                window.Observability?.reportError(scope, requestId, error);
                return window.Observability?.userMessage?.(error, fallback) || safeUserMessage(null, fallback);
            }
            return safeUserMessage(null, fallback);
        }
    };

    const style = document.createElement('style');
    style.textContent = `
        .async-feedback-host { min-height: 180px; }
        .async-feedback {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: .55rem; min-height: 180px; padding: 2rem 1.25rem; border: 1px solid var(--gray-200, #e5e7eb);
            border-radius: var(--radius-lg, 1rem); background: rgba(255,255,255,.88); text-align: center;
        }
        .async-feedback > i { color: var(--primary, #6d28d9); font-size: 1.55rem; }
        .async-feedback strong { color: var(--gray-900, #111827); font-family: var(--font-display, inherit); }
        .async-feedback span { max-width: 34rem; color: var(--gray-500, #6b7280); font-size: .86rem; line-height: 1.5; }
        .async-feedback-error > i { color: var(--error, #dc2626); }
        .async-feedback-empty > i { color: var(--gray-400, #9ca3af); }
        .async-feedback-retry {
            display: inline-flex; align-items: center; gap: .4rem; margin-top: .35rem; padding: .65rem .9rem;
            border: 0; border-radius: .65rem; background: var(--primary, #6d28d9); color: #fff; font-weight: 700; cursor: pointer;
        }
        .async-feedback-retry:hover { background: var(--primary-dark, #4c1d95); }
    `;
    document.head.appendChild(style);
})();