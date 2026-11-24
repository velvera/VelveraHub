(function () {
    const state = {
        supabase: null,
        applications: [],
        loading: false,
        deletionRequests: [],
        deletionLoading: false,
        productListings: [],
        productReviewLoading: false,
        systemErrors: [],
        systemErrorsLoading: false,
        paymentDestinations: [],
        paymentSettingsLoading: false,
        mediaSettingsLoading: false,
        mediaLimits: null,
        phoneVerificationSettingsLoading: false,
        phoneVerificationSettings: null,
        pendingManualPayments: [],
        manualPaymentsLoading: false,
        activeView: 'verification'
    };

    const byId = (id) => document.getElementById(id);

    function setGlobalMessage(text, isError = false) {
        const node = byId('adminGlobalMessage');
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('is-error', isError);
        node.hidden = !text;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function formatDate(value) {
        if (!value) return 'Not available';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Not available';
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function safeImageUrl(value) {
        if (!value) return '';
        try {
            const url = new URL(String(value), window.location.origin);
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    function statusLabel(status) {
        return ({
            pending: 'Awaiting review',
            resubmission_required: 'Changes requested',
            approved: 'Approved',
            rejected: 'Rejected'
        })[status] || status || 'Unknown';
    }

    function deletionStatusLabel(status) {
        return ({
            received: 'Awaiting review',
            in_review: 'In review',
            completed: 'Completed',
            rejected: 'Rejected'
        })[status] || status || 'Unknown';
    }

    function showPanel(panelId) {
        for (const id of ['adminAuthPanel', 'adminDeniedPanel', 'adminWorkspace']) {
            byId(id).hidden = id !== panelId;
        }
    }

    async function checkAdminAccess() {
        const { data: { user }, error: userError } = await state.supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
            showPanel('adminAuthPanel');
            return false;
        }

        const { data: role, error } = await state.supabase.rpc('current_profile_role');
        if (error) throw error;
        if (role !== 'admin') {
            showPanel('adminDeniedPanel');
            return false;
        }
        showPanel('adminWorkspace');
        return true;
    }

    function renderQueue() {
        const list = byId('verificationList');
        const summary = byId('queueSummary');
        list.replaceChildren();
        summary.textContent = `${state.applications.length} application${state.applications.length === 1 ? '' : 's'}`;

        if (!state.applications.length) {
            const empty = document.createElement('section');
            empty.className = 'queue-empty';
            empty.innerHTML = '<h2>No applications in this view</h2><p>New applications appear after a seller uploads the required documents.</p>';
            list.append(empty);
            return;
        }

        for (const application of state.applications) {
            list.append(renderApplication(application));
        }
    }

    function renderDeletionQueue() {
        const list = byId('deletionList');
        const summary = byId('deletionSummary');
        list.replaceChildren();
        summary.textContent = `${state.deletionRequests.length} request${state.deletionRequests.length === 1 ? '' : 's'}`;

        if (!state.deletionRequests.length) {
            const empty = document.createElement('section');
            empty.className = 'queue-empty';
            empty.innerHTML = '<h2>No requests in this view</h2><p>New account deletion requests will appear here after a user submits one.</p>';
            list.append(empty);
            return;
        }

        for (const request of state.deletionRequests) {
            const card = document.createElement('article');
            card.className = 'application-card';
            const canReview = request.status === 'received' || request.status === 'in_review';
            const actions = request.status === 'received'
                ? '<button class="review-action request" type="button" data-deletion-status="in_review">Start review</button>'
                : request.status === 'in_review'
                    ? '<button class="review-action approve" type="button" data-deletion-status="completed">Mark complete</button>'
                    : '';
            card.innerHTML = `
                <header class="application-header">
                    <div>
                        <h2>Request ${escapeHtml(request.request_id)}</h2>
                        <p class="application-handle">Submitted ${escapeHtml(formatDate(request.created_at))}</p>
                    </div>
                    <span class="status-pill ${request.status === 'completed' ? 'approved' : request.status === 'rejected' ? 'rejected' : ''}">${escapeHtml(deletionStatusLabel(request.status))}</span>
                </header>
                <div class="application-details">
                    <div><span class="detail-label">Account email</span><span class="detail-value">${escapeHtml(request.email_at_request || 'Unavailable')}</span></div>
                    <div><span class="detail-label">Request reference</span><span class="detail-value">${escapeHtml(request.request_id)}</span></div>
                </div>
                ${canReview ? `
                    <div class="review-actions">
                        <p class="review-action-message" role="alert" hidden></p>
                        <div class="review-action-buttons">
                            ${actions}
                            <button class="review-action reject" type="button" data-deletion-status="rejected">Reject request</button>
                        </div>
                    </div>` : ''}
            `;
            card.querySelectorAll('[data-deletion-status]').forEach((button) => {
                button.addEventListener('click', () => updateDeletionRequest(card, request, button.dataset.deletionStatus));
            });
            list.append(card);
        }
    }

    function renderProductReviewQueue() {
        const list = byId('listingReviewList');
        const summary = byId('listingReviewSummary');
        list.replaceChildren();
        summary.textContent = `${state.productListings.length} listing${state.productListings.length === 1 ? '' : 's'}`;

        if (!state.productListings.length) {
            const empty = document.createElement('section');
            empty.className = 'queue-empty';
            empty.innerHTML = '<h2>No product listings in this view</h2><p>New and resubmitted listings appear here while awaiting review.</p>';
            list.append(empty);
            return;
        }
        state.productListings.forEach((listing) => list.append(renderProductListing(listing)));
    }

    function renderProductListing(listing) {
        const card = document.createElement('article');
        card.className = 'application-card listing-review-card';
        const status = String(listing.moderation_status || 'pending').toLowerCase();
        const imageUrl = safeImageUrl(listing.image_url);
        const canReview = status === 'pending';
        const noteId = `listingReviewNote-${String(listing.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
        card.innerHTML = `
            <header class="application-header">
                <div>
                    <h2>${escapeHtml(listing.title || 'Untitled listing')}</h2>
                    <p class="application-handle">${escapeHtml(listing.seller_name || 'Marketplace seller')} · Submitted ${escapeHtml(formatDate(listing.created_at))}</p>
                </div>
                <span class="status-pill ${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : ''}">${escapeHtml(statusLabel(status))}</span>
            </header>
            <div class="listing-review-content">
                ${imageUrl ? `<img class="listing-review-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(listing.title || 'Product')} listing photo" loading="lazy">` : ''}
                <div class="listing-review-description">
                    <p>${escapeHtml(listing.description || 'No description provided.')}</p>
                    <div class="application-details">
                        <div><span class="detail-label">Price</span><span class="detail-value">${escapeHtml(String(listing.price ?? 'Not provided'))}</span></div>
                        <div><span class="detail-label">Category</span><span class="detail-value">${escapeHtml(listing.category || 'Not provided')}</span></div>
                        <div><span class="detail-label">Location</span><span class="detail-value">${escapeHtml([listing.location, listing.school_name].filter(Boolean).join(' · ') || 'Not provided')}</span></div>
                    </div>
                </div>
            </div>
            ${status === 'rejected' && listing.moderation_note ? `<p class="listing-review-reason"><strong>Decline reason:</strong> ${escapeHtml(listing.moderation_note)}</p>` : ''}
            ${canReview ? `
                <div class="review-actions">
                    <label for="${escapeHtml(noteId)}">Review note <span>(required to decline; max 500 characters)</span></label>
                    <textarea class="review-note" id="${escapeHtml(noteId)}" maxlength="500" data-listing-review-note placeholder="Explain the correction the seller needs to make."></textarea>
                    <p class="review-action-message" role="alert" hidden></p>
                    <div class="review-action-buttons">
                        <button class="review-action approve" type="button" data-listing-decision="approved">Approve listing</button>
                        <button class="review-action reject" type="button" data-listing-decision="rejected">Decline with reason</button>
                    </div>
                </div>` : ''}
        `;
        card.querySelectorAll('[data-listing-decision]').forEach((button) => {
            button.addEventListener('click', () => reviewProductListing(card, listing, button.dataset.listingDecision));
        });
        return card;
    }

    function renderApplication(application) {
        const card = document.createElement('article');
        card.className = 'application-card';
        const badgeClass = application.verification_status === 'approved'
            ? 'approved'
            : application.verification_status === 'rejected' ? 'rejected' : '';
        const history = Array.isArray(application.review_history) ? application.review_history : [];
        const historyHtml = history.length
            ? `<div class="review-history" aria-label="Previous review history">${history.map((entry) => `
                <div class="history-entry">
                    <strong>${escapeHtml(statusLabel(entry.decision))}</strong>
                    · ${escapeHtml(formatDate(entry.created_at))}
                    ${entry.reviewer_email ? ` · ${escapeHtml(entry.reviewer_email)}` : ''}
                    ${entry.note ? `<br>${escapeHtml(entry.note)}` : ''}
                </div>`).join('')}</div>`
            : '<p class="application-submitted">No prior review actions.</p>';
        const details = [
            ['Owner account', application.owner_email || 'Not available'],
            ['Legal owner / business', application.legal_name],
            ['Trading name', application.business_name],
            ['Registration number', application.registration_number || 'Not provided'],
            ['Business type', application.business_type],
            ['Location', [application.city, application.country].filter(Boolean).join(', ') || 'Not provided']
        ];
        const canReview = application.verification_status === 'pending';

        card.innerHTML = `
            <header class="application-header">
                <div>
                    <h2>${escapeHtml(application.shop_name)}</h2>
                    <p class="application-handle">/${escapeHtml(application.shop_slug)} · Submitted ${escapeHtml(formatDate(application.submitted_at))}</p>
                </div>
                <span class="status-pill ${badgeClass}">${escapeHtml(statusLabel(application.verification_status))}</span>
            </header>
            <div class="application-details">
                ${details.map(([label, value]) => `<div><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`).join('')}
            </div>
            <section aria-label="Verification documents">
                <span class="detail-label">Private verification documents</span>
                <div class="document-list"></div>
            </section>
            <section aria-label="Review history">
                <span class="detail-label">Review history</span>
                ${historyHtml}
            </section>
            ${canReview ? `
                <form class="review-actions" data-submission-id="${escapeHtml(application.submission_id)}">
                    <label for="review-note-${escapeHtml(application.submission_id)}">Review note <span>(required for changes or rejection)</span></label>
                    <textarea class="review-note" id="review-note-${escapeHtml(application.submission_id)}" maxlength="2000" placeholder="Explain what is missing or why the application cannot be approved."></textarea>
                    <p class="review-action-message" role="alert" hidden></p>
                    <div class="review-action-buttons">
                        <button class="review-action approve" type="button" data-review-decision="approve">Approve shop</button>
                        <button class="review-action request" type="button" data-review-decision="request_resubmission">Request updated documents</button>
                        <button class="review-action reject" type="button" data-review-decision="reject">Reject application</button>
                    </div>
                </form>` : ''}
        `;

        const documentList = card.querySelector('.document-list');
        const paths = Array.isArray(application.document_paths) ? application.document_paths : [];
        if (!paths.length) {
            documentList.textContent = 'No documents were attached.';
        } else {
            paths.forEach((documentPath, index) => {
                const button = document.createElement('button');
                const fileName = String(documentPath).split('/').pop() || `Document ${index + 1}`;
                button.className = 'document-button';
                button.type = 'button';
                button.textContent = `Open ${fileName}`;
                button.addEventListener('click', () => openPrivateDocument(documentPath));
                documentList.append(button);
            });
        }

        card.querySelectorAll('[data-review-decision]').forEach((button) => {
            button.addEventListener('click', () => reviewApplication(card, application, button.dataset.reviewDecision));
        });
        return card;
    }

    if (new URLSearchParams(window.location.search).has('mobile-test')) {
        window.__VelveraAdminMobileTest = { renderApplication };
    }

    async function openPrivateDocument(path) {
        const popup = window.open('about:blank', '_blank');
        if (!popup) {
            setGlobalMessage('Allow pop-ups for this site to open a verification document.', true);
            return;
        }
        popup.opener = null;
        setGlobalMessage('Preparing a private document link…');
        const { data, error } = await state.supabase
            .storage.from('shop-verification-private')
            .createSignedUrl(path, 120);
        if (error || !data?.signedUrl) {
            popup.close();
            window.AsyncFeedback?.log('admin-document-open', window.AsyncFeedback?.createRequestId('admin-document-open'), error);
            setGlobalMessage('The document could not be opened. Please try again.', true);
            return;
        }
        popup.location.replace(data.signedUrl);
        setGlobalMessage('The private document link expires after two minutes.');
    }

    async function reviewApplication(card, application, decision) {
        const form = card.querySelector('.review-actions');
        const note = form.querySelector('.review-note').value.trim();
        const error = form.querySelector('.review-action-message');
        const buttons = [...form.querySelectorAll('button')];
        if (decision !== 'approve' && note.length < 3) {
            error.textContent = 'Enter a note explaining this decision.';
            error.hidden = false;
            return;
        }
        if (decision === 'approve' && !window.confirm(`Approve ${application.shop_name} and enable its shop listings?`)) {
            return;
        }
        error.hidden = true;
        buttons.forEach((button) => { button.disabled = true; });
        try {
            const { error: reviewError } = await state.supabase.rpc('admin_review_shop_verification', {
                p_submission_id: application.submission_id,
                p_decision: decision,
                p_note: note || null
            });
            if (reviewError) throw reviewError;
            await loadQueue();
            setGlobalMessage(`Review saved: ${statusLabel(decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'resubmission_required')}.`);
        } catch (reviewError) {
            const requestId = window.AsyncFeedback?.createRequestId('admin-review') || `admin-review-${Date.now()}`;
            window.AsyncFeedback?.log('admin-review', requestId, reviewError, {
                submission_id: application.submission_id,
                decision
            });
            window.Observability?.track('seller_publish_error', { action: 'admin_review' });
            error.textContent = window.AsyncFeedback?.errorMessage(
                reviewError,
                'The review could not be saved. Please try again.',
                'admin-review'
            ) || 'The review could not be saved. Please try again.';
            error.hidden = false;
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    async function loadQueue() {
        if (state.loading) return;
        state.loading = true;
        byId('refreshQueue').disabled = true;
        byId('queueStatus').disabled = true;
        const requestId = window.AsyncFeedback?.createRequestId('admin-queue') || `admin-queue-${Date.now()}`;
        byId('queueSummary').textContent = 'Loading applications…';
        window.AsyncFeedback?.render(byId('verificationList'), 'loading', {
            loadingTitle: 'Loading applications',
            loadingMessage: 'Checking the latest seller verification queue.'
        });
        try {
            const { data, error } = await state.supabase.rpc('admin_list_shop_verification_requests', {
                p_status: byId('queueStatus').value
            });
            if (error) throw error;
            state.applications = Array.isArray(data) ? data : [];
            renderQueue();
            setGlobalMessage('');
        } catch (error) {
            state.applications = [];
            byId('queueSummary').textContent = 'Applications unavailable';
            window.AsyncFeedback?.log('admin-queue', requestId, error);
            window.AsyncFeedback?.render(byId('verificationList'), 'error', {
                errorTitle: 'Verification queue unavailable',
                errorMessage: 'We could not load the latest applications. Try again.',
                onRetry: loadQueue
            });
            setGlobalMessage('We could not load shop applications. Please try again.', true);
        } finally {
            state.loading = false;
            byId('refreshQueue').disabled = false;
            byId('queueStatus').disabled = false;
        }
    }

    async function updateDeletionRequest(card, request, status) {
        if (status === 'completed' && !window.confirm(
            'Have you verified this request, deleted the exact user through Supabase Auth, and completed eligible data cleanup? This only records the queue status. If any step is incomplete, cancel and leave the request in review.'
        )) return;

        const buttons = [...card.querySelectorAll('[data-deletion-status]')];
        const message = card.querySelector('.review-action-message');
        buttons.forEach((button) => { button.disabled = true; });
        if (message) message.hidden = true;
        try {
            const { error } = await state.supabase.rpc('admin_update_account_deletion_request', {
                p_request_id: request.id,
                p_status: status
            });
            if (error) throw error;
            await loadDeletionQueue();
            setGlobalMessage(`Account deletion request ${request.request_id} updated to ${deletionStatusLabel(status).toLowerCase()}.`);
        } catch (error) {
            if (message) {
                window.AsyncFeedback?.log('admin-deletion-review', window.AsyncFeedback?.createRequestId('admin-deletion-review'), error);
                message.textContent = window.AsyncFeedback?.errorMessage(
                    error,
                    'The request could not be updated. Please try again.',
                    'admin-deletion-review'
                ) || 'The request could not be updated. Please try again.';
                message.hidden = false;
            }
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    async function loadDeletionQueue() {
        if (state.deletionLoading) return;
        state.deletionLoading = true;
        byId('deletionStatus').disabled = true;
        byId('refreshQueue').disabled = true;
        byId('deletionSummary').textContent = 'Loading requests…';
        window.AsyncFeedback?.render(byId('deletionList'), 'loading', {
            loadingTitle: 'Loading account deletion requests',
            loadingMessage: 'Checking the latest privacy requests.'
        });
        try {
            const { data, error } = await state.supabase.rpc('admin_list_account_deletion_requests', {
                p_status: byId('deletionStatus').value
            });
            if (error) throw error;
            state.deletionRequests = Array.isArray(data) ? data : [];
            renderDeletionQueue();
            setGlobalMessage('');
        } catch (error) {
            state.deletionRequests = [];
            byId('deletionSummary').textContent = 'Requests unavailable';
            window.AsyncFeedback?.log('admin-deletion-queue', window.AsyncFeedback?.createRequestId('admin-deletion-queue'), error);
            window.AsyncFeedback?.render(byId('deletionList'), 'error', {
                errorTitle: 'Account deletion queue unavailable',
                errorMessage: 'We could not load the latest requests. Try again.',
                onRetry: loadDeletionQueue
            });
            setGlobalMessage('We could not load account deletion requests. Please try again.', true);
        } finally {
            state.deletionLoading = false;
            byId('deletionStatus').disabled = false;
            byId('refreshQueue').disabled = false;
        }
    }

    async function loadProductReviewQueue() {
        if (state.productReviewLoading) return;
        state.productReviewLoading = true;
        byId('listingReviewStatus').disabled = true;
        byId('refreshQueue').disabled = true;
        byId('listingReviewSummary').textContent = 'Loading listings…';
        window.AsyncFeedback?.render(byId('listingReviewList'), 'loading', {
            loadingTitle: 'Loading product reviews',
            loadingMessage: 'Checking the latest listing moderation queue.'
        });
        try {
            const { data, error } = await state.supabase.rpc('admin_list_product_reviews', {
                p_status: byId('listingReviewStatus').value
            });
            if (error) throw error;
            state.productListings = Array.isArray(data) ? data : [];
            renderProductReviewQueue();
            setGlobalMessage('');
        } catch (error) {
            state.productListings = [];
            byId('listingReviewSummary').textContent = 'Listings unavailable';
            window.AsyncFeedback?.log('admin-listing-queue', window.AsyncFeedback?.createRequestId('admin-listing-queue'), error);
            window.AsyncFeedback?.render(byId('listingReviewList'), 'error', {
                errorTitle: 'Listing review queue unavailable',
                errorMessage: 'We could not load the latest listings. Try again.',
                onRetry: loadProductReviewQueue
            });
            setGlobalMessage('We could not load product listings. Please try again.', true);
        } finally {
            state.productReviewLoading = false;
            byId('listingReviewStatus').disabled = false;
            byId('refreshQueue').disabled = false;
        }
    }

    async function reviewProductListing(card, listing, decision) {
        const note = card.querySelector('[data-listing-review-note]')?.value.trim() || '';
        const message = card.querySelector('.review-action-message');
        if (decision === 'rejected' && !note) {
            message.textContent = 'Enter a clear correction reason before declining this listing.';
            message.hidden = false;
            card.querySelector('[data-listing-review-note]')?.focus();
            return;
        }
        const buttons = [...card.querySelectorAll('[data-listing-decision]')];
        buttons.forEach((button) => { button.disabled = true; });
        message.hidden = true;
        try {
            const { error } = await state.supabase.rpc('admin_review_product_listing', {
                p_product_id: listing.id,
                p_status: decision,
                p_review_note: note
            });
            if (error) throw error;
            await loadProductReviewQueue();
            setGlobalMessage(decision === 'approved'
                ? 'Listing approved. It is now eligible to appear in the marketplace.'
                : 'Listing declined. The seller can see the reason and resubmit it after editing.');
        } catch (error) {
            window.AsyncFeedback?.log('admin-listing-review', window.AsyncFeedback?.createRequestId('admin-listing-review'), error);
            message.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'The listing review could not be saved. Please try again.',
                'admin-listing-review'
            ) || 'The listing review could not be saved. Please try again.';
            message.hidden = false;
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    function switchAdminView(view) {
        const views = {
            verification: ['verificationPanel', 'verificationTab'],
            deletion: ['deletionPanel', 'deletionTab'],
            listingReviews: ['listingReviewPanel', 'listingReviewTab'],
            systemErrors: ['systemErrorsPanel', 'systemErrorsTab'],
            paymentSettings: ['paymentSettingsPanel', 'paymentSettingsTab'],
            mediaSettings: ['mediaSettingsPanel', 'mediaSettingsTab'],
            phoneVerificationSettings: ['phoneVerificationSettingsPanel', 'phoneVerificationSettingsTab']
        };
        if (!views[view]) return;
        state.activeView = view;
        Object.entries(views).forEach(([name, [panelId, tabId]]) => {
            byId(panelId).hidden = name !== view;
            byId(tabId).classList.toggle('is-active', name === view);
            byId(tabId).setAttribute('aria-pressed', String(name === view));
        });
        if (view === 'deletion') loadDeletionQueue();
        else if (view === 'listingReviews') loadProductReviewQueue();
        else if (view === 'systemErrors') loadSystemErrors();
        else if (view === 'paymentSettings') {
            loadMarketplacePaymentSettings();
            loadPendingManualPayments();
        }
        else if (view === 'mediaSettings') loadMarketplaceMediaLimits();
        else if (view === 'phoneVerificationSettings') loadPhoneVerificationSettings();
        else loadQueue();
    }

    function setPaymentFieldRequirements() {
        const enabled = byId('marketplacePaymentEnabled').checked;
        const region = byId('marketplacePaymentRegion').value;
        for (const id of ['marketplacePaymentBank', 'marketplacePaymentAccountName', 'marketplacePaymentAccountNumber']) {
            byId(id).required = enabled;
        }
        byId('marketplacePaymentSortCode').required = enabled && region === 'uk';
        byId('marketplaceSortCodeField').hidden = region !== 'uk';
    }

    function renderMarketplacePaymentSettings() {
        const region = byId('marketplacePaymentRegion').value;
        const destination = state.paymentDestinations.find((item) => item.region === region) || {};
        byId('marketplacePaymentEnabled').checked = destination.enabled === true;
        byId('marketplacePaymentBank').value = destination.bank_name || '';
        byId('marketplacePaymentAccountName').value = destination.account_name || '';
        byId('marketplacePaymentAccountNumber').value = destination.account_number || '';
        byId('marketplacePaymentSortCode').value = destination.sort_code || '';
        byId('marketplacePaymentInstructions').value = destination.instructions || '';
        setPaymentFieldRequirements();
    }

    async function loadMarketplacePaymentSettings() {
        if (state.paymentSettingsLoading) return;
        state.paymentSettingsLoading = true;
        const message = byId('marketplacePaymentSettingsMessage');
        message.hidden = true;
        try {
            const { data, error } = await state.supabase
                .from('marketplace_payment_destinations')
                .select('region, bank_name, account_name, account_number, sort_code, instructions, enabled, updated_at');
            if (error) throw error;
            state.paymentDestinations = data || [];
            renderMarketplacePaymentSettings();
        } catch (error) {
            message.textContent = /does not exist|schema cache|column/i.test(error?.message || '')
                ? 'Payment settings are not installed yet. Apply database/marketplace-manual-payments.sql, then refresh this page.'
                : window.AsyncFeedback?.errorMessage(error, 'Payment settings could not be loaded. Please try again.', 'admin-payment-settings-load') || 'Payment settings could not be loaded. Please try again.';
            message.classList.add('is-error');
            message.hidden = false;
        } finally {
            state.paymentSettingsLoading = false;
        }
    }

    async function saveMarketplacePaymentSettings(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const button = byId('saveMarketplacePaymentSettings');
        const message = byId('marketplacePaymentSettingsMessage');
        const region = byId('marketplacePaymentRegion').value;
        const enabled = byId('marketplacePaymentEnabled').checked;
        button.disabled = true;
        message.hidden = true;
        message.classList.remove('is-error');
        try {
            const { data, error } = await state.supabase.rpc('admin_save_marketplace_payment_destination', {
                p_region: region,
                p_enabled: enabled,
                p_bank_name: byId('marketplacePaymentBank').value.trim(),
                p_account_name: byId('marketplacePaymentAccountName').value.trim(),
                p_account_number: byId('marketplacePaymentAccountNumber').value.trim(),
                p_sort_code: byId('marketplacePaymentSortCode').value.trim(),
                p_instructions: byId('marketplacePaymentInstructions').value.trim()
            });
            if (error) throw error;
            state.paymentDestinations = state.paymentDestinations.filter((item) => item.region !== region);
            if (data) state.paymentDestinations.push(data);
            renderMarketplacePaymentSettings();
            message.textContent = enabled
                ? 'VelveraHub manual payment is enabled for this market.'
                : 'VelveraHub manual payment is disabled for this market.';
            message.hidden = false;
        } catch (error) {
            message.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'Payment settings could not be saved. Confirm the bank details and try again.',
                'admin-payment-settings-save'
            ) || 'Payment settings could not be saved. Confirm the bank details and try again.';
            message.classList.add('is-error');
            message.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    function renderMarketplaceMediaLimits() {
        const limits = state.mediaLimits;
        if (!limits) return;
        byId('productMediaLimit').value = String(limits.product_image_limit);
        byId('productImageMaxMib').value = String(limits.product_image_max_bytes / 1048576);
        byId('productVideoMaxMib').value = String(limits.product_video_max_bytes / 1048576);
    }

    async function loadMarketplaceMediaLimits() {
        if (state.mediaSettingsLoading) return;
        state.mediaSettingsLoading = true;
        const message = byId('marketplaceMediaSettingsMessage');
        message.hidden = true;
        message.classList.remove('is-error');
        try {
            const { data, error } = await state.supabase.rpc('get_marketplace_media_limits');
            if (error) throw error;
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('The media settings response is invalid.');
            }
            const limits = {
                product_image_limit: Number(data.product_image_limit),
                product_image_max_bytes: Number(data.product_image_max_bytes),
                product_video_max_bytes: Number(data.product_video_max_bytes)
            };
            if (
                !Number.isInteger(limits.product_image_limit) ||
                !Number.isInteger(limits.product_image_max_bytes) ||
                !Number.isInteger(limits.product_video_max_bytes) ||
                limits.product_image_max_bytes % 1048576 !== 0 ||
                limits.product_video_max_bytes % 1048576 !== 0 ||
                limits.product_image_max_bytes < 5 * 1048576 ||
                limits.product_image_max_bytes > 40 * 1048576 ||
                limits.product_video_max_bytes < 5 * 1048576 ||
                limits.product_video_max_bytes > 40 * 1048576
            ) {
                throw new Error('The media settings response is incomplete.');
            }
            state.mediaLimits = limits;
            renderMarketplaceMediaLimits();
        } catch (error) {
            message.textContent = /does not exist|schema cache|function/i.test(error?.message || '')
                ? 'Media settings are not installed yet. Apply database/marketplace-media-settings.sql, then refresh this page.'
                : window.AsyncFeedback?.errorMessage(error, 'Media limits could not be loaded. Please try again.', 'admin-media-settings-load') || 'Media limits could not be loaded. Please try again.';
            message.classList.add('is-error');
            message.hidden = false;
        } finally {
            state.mediaSettingsLoading = false;
        }
    }

    async function saveMarketplaceMediaLimits(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const button = byId('saveMarketplaceMediaSettings');
        const message = byId('marketplaceMediaSettingsMessage');
        button.disabled = true;
        message.hidden = true;
        message.classList.remove('is-error');
        try {
            const { data, error } = await state.supabase.rpc('admin_update_marketplace_media_limits', {
                p_product_image_limit: Number(byId('productMediaLimit').value),
                p_product_image_max_mib: Number(byId('productImageMaxMib').value),
                p_product_video_max_mib: Number(byId('productVideoMaxMib').value)
            });
            if (error) throw error;
            state.mediaLimits = data;
            renderMarketplaceMediaLimits();
            message.textContent = 'Media limits saved. The new limits apply to uploads started after this change.';
            message.hidden = false;
        } catch (error) {
            message.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'Media limits could not be saved. Check the values and try again.',
                'admin-media-settings-save'
            ) || 'Media limits could not be saved. Check the values and try again.';
            message.classList.add('is-error');
            message.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    function renderPhoneVerificationSettings() {
        const settings = state.phoneVerificationSettings;
        if (!settings) return;
        byId('phoneVerificationEnabled').checked = settings.enabled === true;
        byId('phoneVerificationMode').textContent = settings.mode || (settings.enabled ? 'Enabled' : 'Disabled');
        byId('phoneVerificationProviderStatus').textContent = settings.providerStatus || 'Not configured';
        byId('phoneVerificationProviderValidation').textContent = settings.providerValidation || 'Not checked';
        byId('phoneVerificationMediaAccess').textContent = settings.mediaAccessStatus || 'Unavailable';
        byId('phoneVerificationReadiness').textContent = settings.configurationReady
            ? (settings.enabled
                ? 'Active configuration validated'
                : 'Secrets present; Termii will be checked on activation')
            : 'Not ready — check Supabase bucket access and Termii Function secrets';
        byId('savePhoneVerificationSettings').disabled = byId('phoneVerificationEnabled').checked
            && settings.configurationReady !== true
            && settings.enabled !== true;
    }

    async function loadPhoneVerificationSettings() {
        if (state.phoneVerificationSettingsLoading) return;
        state.phoneVerificationSettingsLoading = true;
        const message = byId('phoneVerificationSettingsMessage');
        message.hidden = true;
        message.classList.remove('is-error');
        try {
            const { data, error } = await state.supabase.functions.invoke('phone-verification', {
                body: { action: 'admin_status' }
            });
            if (error) {
                let payload = null;
                try { payload = await error.context?.clone?.().json(); } catch (_) {}
                throw new Error(payload?.error || error.message || 'Phone verification settings are unavailable.');
            }
            if (!data || typeof data.enabled !== 'boolean' || typeof data.configurationReady !== 'boolean') {
                throw new Error('The phone verification settings response is incomplete.');
            }
            state.phoneVerificationSettings = data;
            renderPhoneVerificationSettings();
        } catch (error) {
            message.textContent = /function.*not found|not deployed|404/i.test(error?.message || '')
                ? 'Phone verification controls are not installed yet. Deploy the phone-verification Supabase Function and apply database/phone-verification.sql.'
                : window.AsyncFeedback?.errorMessage(error, 'Phone verification settings could not be loaded.', 'admin-phone-verification-load') || 'Phone verification settings could not be loaded.';
            message.classList.add('is-error');
            message.hidden = false;
            byId('phoneVerificationReadiness').textContent = 'Unavailable';
            byId('phoneVerificationProviderStatus').textContent = 'Unavailable';
            byId('phoneVerificationProviderValidation').textContent = 'Unavailable';
            byId('phoneVerificationMode').textContent = 'Unavailable';
            byId('phoneVerificationMediaAccess').textContent = 'Unavailable';
            byId('savePhoneVerificationSettings').disabled = true;
        } finally {
            state.phoneVerificationSettingsLoading = false;
        }
    }

    async function savePhoneVerificationSettings(event) {
        event.preventDefault();
        const button = byId('savePhoneVerificationSettings');
        const message = byId('phoneVerificationSettingsMessage');
        const enabled = byId('phoneVerificationEnabled').checked;
        button.disabled = true;
        message.hidden = true;
        message.classList.remove('is-error');
        try {
            const { data, error } = await state.supabase.functions.invoke('phone-verification', {
                body: { action: 'admin_set', enabled }
            });
            if (error) {
                let payload = null;
                try { payload = await error.context?.clone?.().json(); } catch (_) {}
                throw new Error(payload?.error || error.message || 'Phone verification setting could not be saved.');
            }
            if (!data || data.enabled !== enabled) throw new Error('The saved setting could not be confirmed.');
            state.phoneVerificationSettings = data;
            renderPhoneVerificationSettings();
            message.textContent = data.warning || (enabled
                ? 'Phone verification is enabled. New registration and publishing checks now use Termii.'
                : 'Phone verification is disabled. New OTP activity has stopped; existing records were kept.');
            message.classList.toggle('is-error', Boolean(data.warning));
            message.hidden = false;
        } catch (error) {
            message.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'Phone verification setting could not be saved. Check the Termii setup and try again.',
                'admin-phone-verification-save'
            ) || 'Phone verification setting could not be saved. Check the Termii setup and try again.';
            message.classList.add('is-error');
            message.hidden = false;
            await loadPhoneVerificationSettings();
        } finally {
            button.disabled = false;
        }
    }

    function renderPendingManualPayments() {
        const container = byId('pendingManualPaymentOrders');
        if (!state.pendingManualPayments.length) {
            container.innerHTML = '<p class="table-empty">No pending VelveraHub manual payments.</p>';
            return;
        }

        container.innerHTML = state.pendingManualPayments.map((order) => {
            const details = order.payment_details || {};
            const entries = Array.isArray(details.destinations) ? details.destinations : [];
            const destination = entries[0] || {};
            const shopNames = [...new Set(entries.map((entry) => entry.shop_name).filter(Boolean))].join(', ');
            const currency = order.region === 'uk' ? 'GBP' : 'NGN';
            const total = new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency
            }).format(Number(order.total) || 0);
            const instructionFields = [
                ['Market', order.region === 'uk' ? 'United Kingdom' : 'Nigeria'],
                ['Bank', destination.bank_name],
                ['Account name', destination.account_name],
                ['Account number', destination.account_number],
                ['Sort code', destination.sort_code],
                ['Shops', shopNames],
                ['Payment instructions', destination.instructions]
            ].filter(([, value]) => value);
            return `
                <article class="manual-payment-order">
                    <header class="manual-payment-order-heading">
                        <div>
                            <h3>${escapeHtml(order.order_number || order.id)}</h3>
                            <p>Created ${escapeHtml(formatDate(order.created_at))}</p>
                        </div>
                        <div class="manual-payment-order-total"><small>Item subtotal due to VelveraHub</small><strong>${escapeHtml(total)}</strong></div>
                    </header>
                    <dl class="manual-payment-order-details">
                        ${instructionFields.map(([label, value]) => `
                            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
                        `).join('')}
                    </dl>
                    <button class="admin-primary-button" type="button" data-confirm-manual-payment="${escapeHtml(order.id)}">Confirm funds received</button>
                </article>
            `;
        }).join('');
    }

    async function loadPendingManualPayments() {
        if (state.manualPaymentsLoading) return;
        state.manualPaymentsLoading = true;
        const container = byId('pendingManualPaymentOrders');
        container.innerHTML = '<p class="table-empty">Loading pending payments…</p>';
        try {
            const { data, error } = await state.supabase.rpc('admin_list_pending_platform_manual_payments');
            if (error) throw error;
            state.pendingManualPayments = Array.isArray(data) ? data : [];
            renderPendingManualPayments();
        } catch (error) {
            container.innerHTML = '';
            const message = document.createElement('p');
            message.className = 'table-empty';
            message.textContent = /does not exist|schema cache|function/i.test(error?.message || '')
                ? 'Payment review is not installed yet. Apply database/marketplace-manual-payments.sql, then refresh this page.'
                : window.AsyncFeedback?.errorMessage(error, 'Pending payments could not be loaded.', 'admin-manual-payment-queue') || 'Pending payments could not be loaded.';
            container.appendChild(message);
        } finally {
            state.manualPaymentsLoading = false;
        }
    }

    async function confirmManualPayment(orderId, button) {
        if (!window.confirm('Confirm only if the full payment has cleared into the VelveraHub account. Mark this order as paid?')) return;
        button.disabled = true;
        try {
            const { data, error } = await state.supabase.rpc('admin_confirm_platform_manual_payment', {
                p_order_id: orderId
            });
            if (error) throw error;
            setGlobalMessage(data?.order_confirmed
                ? 'Payment confirmed. All recipients are confirmed and the order is marked paid.'
                : 'VelveraHub receipt recorded. The order remains pending until the other payment recipients confirm.');
            await loadPendingManualPayments();
        } catch (error) {
            window.AsyncFeedback?.log('admin-manual-payment-confirm', window.AsyncFeedback?.createRequestId('admin-manual-payment-confirm'), error);
            setGlobalMessage(
                window.AsyncFeedback?.errorMessage(error, 'Payment could not be confirmed. Refresh the queue and try again.', 'admin-manual-payment-confirm') || 'Payment could not be confirmed. Refresh the queue and try again.',
                true
            );
            button.disabled = false;
        }
    }

    function renderSystemErrors() {
        const list = byId('systemErrorList');
        const summary = byId('systemErrorSummary');
        list.replaceChildren();
        summary.textContent = `${state.systemErrors.length} recent issue${state.systemErrors.length === 1 ? '' : 's'}`;
        if (!state.systemErrors.length) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.innerHTML = '<h2>No recent system errors</h2><p>New technical issues will appear here for administrators.</p>';
            list.append(empty);
            return;
        }

        state.systemErrors.forEach((entry) => {
            const properties = entry.properties && typeof entry.properties === 'object' ? entry.properties : {};
            const card = document.createElement('article');
            card.className = 'system-error-entry';
            const header = document.createElement('div');
            header.className = 'system-error-header';
            const title = document.createElement('strong');
            title.textContent = properties.scope || properties.source || 'Application error';
            const timestamp = document.createElement('time');
            timestamp.dateTime = entry.occurred_at || '';
            timestamp.textContent = formatDate(entry.occurred_at);
            header.append(title, timestamp);

            const metadata = document.createElement('p');
            metadata.className = 'system-error-meta';
            const parts = [
                entry.route || 'Unknown page',
                properties.errorName || '',
                properties.errorCode ? `Code ${properties.errorCode}` : '',
                entry.request_id ? `Request ${entry.request_id}` : ''
            ].filter(Boolean);
            metadata.textContent = parts.join(' · ');

            const details = document.createElement('details');
            const summaryNode = document.createElement('summary');
            summaryNode.textContent = 'Technical details';
            const diagnostic = document.createElement('pre');
            diagnostic.textContent = properties.diagnostic || 'No technical detail was recorded.';
            details.append(summaryNode, diagnostic);
            card.append(header, metadata, details);
            list.append(card);
        });
    }

    async function loadSystemErrors() {
        if (state.systemErrorsLoading) return;
        state.systemErrorsLoading = true;
        byId('refreshSystemErrors').disabled = true;
        byId('systemErrorSummary').textContent = 'Loading system errors…';
        window.AsyncFeedback?.render(byId('systemErrorList'), 'loading', {
            loadingTitle: 'Loading system errors',
            loadingMessage: 'Checking recent operational diagnostics.'
        });
        try {
            const { data: { session } = {}, error: sessionError } = await state.supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session?.access_token) throw new Error('Admin session unavailable');
            const apiFetch = window.VelveraAPI?.fetch || fetch;
            const response = await apiFetch('/api/admin/observability/errors?limit=100', {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'The system error log is unavailable.');
            state.systemErrors = Array.isArray(payload.errors) ? payload.errors : [];
            renderSystemErrors();
        } catch (error) {
            state.systemErrors = [];
            byId('systemErrorSummary').textContent = 'System errors unavailable';
            window.AsyncFeedback?.log('admin-system-errors', window.AsyncFeedback?.createRequestId('admin-system-errors'), error);
            window.AsyncFeedback?.render(byId('systemErrorList'), 'error', {
                errorTitle: 'System error log unavailable',
                errorMessage: 'We could not load recent issues. Try again.',
                onRetry: loadSystemErrors
            });
        } finally {
            state.systemErrorsLoading = false;
            byId('refreshSystemErrors').disabled = false;
        }
    }

    async function signOut() {
        const { error } = await state.supabase.auth.signOut();
        if (error) {
            window.AsyncFeedback?.log('admin-sign-out', window.AsyncFeedback?.createRequestId('admin-sign-out'), error);
            setGlobalMessage('We could not sign out. Please try again.', true);
            return;
        }
        showPanel('adminAuthPanel');
    }

    async function initialize() {
        const form = byId('adminLoginForm');
        const loginError = byId('adminLoginError');

        try {
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            state.supabase = window.SupabaseClient?.get();
            if (!state.supabase || !window.SupabaseClient.isConfigured()) {
                throw new Error('Supabase is not configured. Add the public Supabase URL and anon key to this app before deployment.');
            }
            if (window.AuthService) await window.AuthService.init();
            if (await checkAdminAccess()) await loadQueue();
        } catch (error) {
            showPanel('adminAuthPanel');
            loginError.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'The admin workspace could not start. Please try again.',
                'admin-initialize'
            ) || 'The admin workspace could not start. Please try again.';
            loginError.hidden = false;
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            loginError.hidden = true;
            try {
                const { error } = await window.AuthService.signIn(
                    form.elements.email.value.trim(),
                    form.elements.password.value
                );
                if (error) throw error;
                if (await checkAdminAccess()) await loadQueue();
            } catch (error) {
                loginError.textContent = window.AsyncFeedback?.errorMessage(
                    error,
                    'Sign-in could not be completed. Check your details and try again.',
                    'admin-sign-in'
                ) || 'Sign-in could not be completed. Check your details and try again.';
                loginError.hidden = false;
            } finally {
                button.disabled = false;
            }
        });

        byId('adminDeniedSignOut').addEventListener('click', signOut);
        byId('adminSignOut').addEventListener('click', signOut);
        byId('refreshQueue').addEventListener('click', () => {
            if (state.activeView === 'deletion') loadDeletionQueue();
            else if (state.activeView === 'listingReviews') loadProductReviewQueue();
            else if (state.activeView === 'systemErrors') loadSystemErrors();
            else if (state.activeView === 'paymentSettings') {
                loadMarketplacePaymentSettings();
                loadPendingManualPayments();
            }
            else if (state.activeView === 'mediaSettings') loadMarketplaceMediaLimits();
            else if (state.activeView === 'phoneVerificationSettings') loadPhoneVerificationSettings();
            else loadQueue();
        });
        byId('refreshSystemErrors').addEventListener('click', loadSystemErrors);
        byId('queueStatus').addEventListener('change', loadQueue);
        byId('deletionStatus').addEventListener('change', loadDeletionQueue);
        byId('listingReviewStatus').addEventListener('change', loadProductReviewQueue);
        byId('marketplacePaymentSettingsForm').addEventListener('submit', saveMarketplacePaymentSettings);
        byId('marketplaceMediaSettingsForm').addEventListener('submit', saveMarketplaceMediaLimits);
        byId('phoneVerificationSettingsForm').addEventListener('submit', savePhoneVerificationSettings);
        byId('marketplacePaymentRegion').addEventListener('change', renderMarketplacePaymentSettings);
        byId('marketplacePaymentEnabled').addEventListener('change', setPaymentFieldRequirements);
        byId('refreshManualPaymentOrders').addEventListener('click', loadPendingManualPayments);
        byId('pendingManualPaymentOrders').addEventListener('click', (event) => {
            const button = event.target.closest('[data-confirm-manual-payment]');
            if (button) confirmManualPayment(button.dataset.confirmManualPayment, button);
        });
        document.querySelectorAll('[data-admin-view]').forEach((tab) => {
            tab.addEventListener('click', () => switchAdminView(tab.dataset.adminView));
        });
        window.setInterval(() => {
            if (state.activeView === 'systemErrors') loadSystemErrors();
        }, 30000);
    }

    document.addEventListener('DOMContentLoaded', initialize);
})();