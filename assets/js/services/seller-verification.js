(function () {
    const IDENTITY_CONSENT_VERSION = '2026-11-27';
    const PRIVATE_BUCKET = 'seller-identity-private';
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    let sellerContext = null;
    let countryConfig = [];
    let adminSupabase = null;
    let adminHandlersBound = false;
    let currentAdminUserId = null;
    let identityLoading = false;
    let inspectionsLoading = false;

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
        return Number.isNaN(date.getTime())
            ? 'Not available'
            : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }

    function statusLabel(status) {
        return ({
            not_started: 'Not started',
            draft: 'Draft saved',
            submitted: 'Submitted',
            pending_provider: 'Waiting for provider',
            pending_review: 'Waiting for manual review',
            action_required: 'Action required',
            approved: 'Approved',
            rejected: 'Rejected',
            expired: 'Expired',
            suspended: 'Suspended',
            revoked: 'Revoked',
            requested: 'Inspection requested',
            scheduled: 'Inspection scheduled',
            pending: 'Pending review',
            resubmission_required: 'Action required'
        })[status] || 'Status unavailable';
    }

    function renderStatus(status, detail = '') {
        const safeStatus = String(status || 'not_started').replace(/[^a-z_]/g, '');
        return `<span class="seller-verification-status seller-verification-status--${safeStatus}">${escapeHtml(statusLabel(safeStatus))}</span>${detail ? `<p class="seller-verification-detail">${escapeHtml(detail)}</p>` : ''}`;
    }

    function setMessage(node, message, isError = false) {
        if (!node) return;
        node.textContent = message || '';
        node.hidden = !message;
        node.classList.toggle('is-error', Boolean(isError && message));
    }

    function allowedIdentityDocumentTypes(country) {
        return Array.isArray(country?.identity_document_types)
            ? country.identity_document_types
            : [];
    }

    function documentLabel(value) {
        return ({
            passport: 'Passport',
            national_id: 'National identity document',
            drivers_license: 'Driving licence',
            voters_card: 'Voter card',
            residence_permit: 'Residence permit',
            other: 'Other government photo ID'
        })[value] || value;
    }

    async function fetchIdentityCase(supabase) {
        const { data, error } = await supabase.rpc('seller_get_identity_verification');
        if (error) throw error;
        return data || { status: 'not_started' };
    }

    async function fetchBusinessStatus(context) {
        if (!context.shop?.id) return null;
        const { data, error } = await context.supabase
            .from('shop_verification_submissions')
            .select('status, submitted_at, reviewed_at, review_note, registry_checked, registry_checked_at, representative_authorized, business_verification_basis')
            .eq('shop_id', context.shop.id)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function fetchPhysicalInspection(context) {
        if (!context.shop?.id) return { status: 'not_started' };
        const { data, error } = await context.supabase.rpc('seller_get_physical_store_inspection', {
            p_shop_id: context.shop.id
        });
        if (error) throw error;
        return data || { status: 'not_started' };
    }

    function renderSellerCards(container, context, records) {
        const emailVerified = Boolean(context.user?.email_confirmed_at || context.user?.confirmed_at);
        const phoneVerified = context.profile?.phone_verified === true;
        const contactVerified = emailVerified && phoneVerified;
        const identity = records.identity || { status: 'not_started' };
        const identityStatus = identity.status || 'not_started';
        const business = records.business;
        const physical = records.physical || { status: 'not_started' };
        const countryCode = identity.country_code
            || (window.RegionService?.isUK ? 'GB' : 'NG');
        const selectedCountry = countryConfig.find((country) => country.country_code === countryCode)
            || countryConfig[0];
        const currentShop = context.shop;
        const businessVerified = Boolean(
            business?.status === 'approved'
            && (
                (business.business_verification_basis === 'registry' && business.registry_checked === true)
                || business.business_verification_basis === 'sole_trader_manual'
            )
            && business.representative_authorized === true
        );
        const identityEditable = ['not_started', 'draft', 'action_required', 'rejected', 'expired'].includes(identityStatus);
        const showForm = identityEditable && countryConfig.length > 0;
        const identityHistory = Array.isArray(identity.history) ? identity.history : [];
        const latestSellerMessage = identityHistory.find((event) => event.seller_message)?.seller_message;
        const documentOptions = allowedIdentityDocumentTypes(selectedCountry);
        const countryOptions = countryConfig.map((country) => `
            <option value="${escapeHtml(country.country_code)}" ${country.country_code === countryCode ? 'selected' : ''}>
                ${escapeHtml(country.country_name)}
            </option>
        `).join('');
        const typeOptions = documentOptions.map((type) => `
            <option value="${escapeHtml(type)}" ${type === identity.identity_document_type ? 'selected' : ''}>
                ${escapeHtml(documentLabel(type))}
            </option>
        `).join('');
        const eventHistory = identityHistory.length
            ? `<ol class="seller-verification-history">${identityHistory.map((event) => `
                <li><strong>${escapeHtml(statusLabel(event.to_status || event.event_type))}</strong>
                    <time datetime="${escapeHtml(event.created_at || '')}">${escapeHtml(formatDate(event.created_at))}</time>
                    ${event.seller_message ? `<p>${escapeHtml(event.seller_message)}</p>` : ''}
                </li>`).join('')}</ol>`
            : '';

        container.hidden = false;
        container.innerHTML = `
            <div class="seller-verification-heading">
                <p class="seller-verification-eyebrow">Seller trust</p>
                <h2>Verification progress</h2>
                <p>Complete only the checks that apply to your account. Verification records do not change your normal marketplace permissions.</p>
            </div>
            <ol class="seller-verification-progress" aria-label="Verification levels">
                <li class="${contactVerified ? 'is-complete' : ''}"><span>1</span><strong>Contact</strong><small>${contactVerified ? 'Email and phone confirmed' : 'Email and phone required'}</small></li>
                <li class="${identityStatus === 'approved' ? 'is-complete' : ''}"><span>2</span><strong>Identity</strong><small>${escapeHtml(statusLabel(identityStatus))}</small></li>
                <li class="${businessVerified ? 'is-complete' : ''}"><span>3</span><strong>Business</strong><small>${businessVerified ? 'Registry and representative checked' : 'Shop documents reviewed separately'}</small></li>
                <li class="${physical.status === 'approved' ? 'is-complete' : ''}"><span>4</span><strong>Physical premises</strong><small>${escapeHtml(statusLabel(physical.status))}</small></li>
            </ol>
            <div class="seller-verification-cards">
                <article class="seller-verification-card">
                    <div class="seller-verification-card-heading"><div><h3>Contact Verified</h3><p>Confirms control of the account email and phone number.</p></div>${renderStatus(contactVerified ? 'approved' : 'not_started')}</div>
                    ${!contactVerified ? `<p class="seller-verification-detail">${emailVerified ? 'Confirm your phone number in account settings.' : 'Confirm your email and phone number in account settings.'} ${window.RegionService?.isUK && !phoneVerified ? 'The current OTP provider is configured for Nigeria; UK phone verification is not available yet.' : ''}</p>` : ''}
                </article>
                <article class="seller-verification-card">
                    <div class="seller-verification-card-heading"><div><h3>Identity review</h3><p>Manual review is used until a qualified provider is configured. A submitted image is never marked as verified automatically.</p></div>${renderStatus(identityStatus, identity.expires_at && identityStatus === 'approved' ? `Verified until ${formatDate(identity.expires_at)}` : identity.submitted_at ? `Submitted ${formatDate(identity.submitted_at)}` : '')}</div>
                    ${identity.case_id ? `<p class="seller-verification-detail">Case ID: <code>${escapeHtml(identity.case_id)}</code></p>` : ''}
                    ${latestSellerMessage ? `<p class="seller-verification-message">${escapeHtml(latestSellerMessage)}</p>` : ''}
                    ${showForm ? `
                        <form class="seller-identity-form" id="sellerIdentityForm">
                            <div class="seller-verification-form-grid">
                                <label>Country of residence
                                    <select name="country_code" required>${countryOptions}</select>
                                </label>
                                <label>Account type
                                    <select name="seller_type" required>
                                        <option value="individual" ${identity.seller_type === 'individual' ? 'selected' : ''}>Individual seller</option>
                                        <option value="registered_business" ${identity.seller_type === 'registered_business' ? 'selected' : ''}>Registered business representative</option>
                                        <option value="sole_trader" ${identity.seller_type === 'sole_trader' ? 'selected' : ''}>Sole trader</option>
                                    </select>
                                </label>
                                <label>Legal first name
                                    <input name="legal_first_name" type="text" autocomplete="given-name" minlength="1" maxlength="100" value="${escapeHtml(identity.legal_first_name || '')}" required>
                                </label>
                                <label>Legal last name
                                    <input name="legal_last_name" type="text" autocomplete="family-name" minlength="1" maxlength="100" value="${escapeHtml(identity.legal_last_name || '')}" required>
                                </label>
                                <label>Document type
                                    <select name="document_type" required>${typeOptions}</select>
                                </label>
                                <label>Identity document
                                    <input name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png">
                                    <small>PDF, JPG, or PNG · maximum 5 MB. File contents are checked before private storage.</small>
                                </label>
                            </div>
                            <label class="seller-verification-consent">
                                <input name="consent" type="checkbox" required>
                                <span>I consent to VelveraHub using this information and document for seller identity review under privacy notice ${escapeHtml(selectedCountry?.privacy_notice_version || IDENTITY_CONSENT_VERSION)}. I understand this is manual review, not an automated identity-provider result.</span>
                            </label>
                            <p class="seller-verification-form-message" id="sellerIdentityMessage" role="status" aria-live="polite" hidden></p>
                            <div class="seller-verification-actions">
                                <button class="admin-secondary-button" type="button" data-save-identity-draft>Save draft</button>
                                <button class="admin-primary-button" type="submit">Submit for manual review</button>
                            </div>
                            <p class="seller-verification-privacy">We do not ask for a date of birth or ID number in this manual flow. Only authorized reviewers can access the uploaded document. Do not upload unrelated personal information.</p>
                        </form>
                    ` : ''}
                    ${eventHistory}
                </article>
                <article class="seller-verification-card">
                    <div class="seller-verification-card-heading"><div><h3>Business Verified</h3><p>Registered businesses need an official registry check. Sole traders need documented evidence and confirmation that the applicant is the proprietor.</p></div>${renderStatus(businessVerified ? 'approved' : business?.status || 'not_started', business?.reviewed_at ? `Reviewed ${formatDate(business.reviewed_at)}` : '')}</div>
                    ${business?.review_note ? `<p class="seller-verification-message">${escapeHtml(business.review_note)}</p>` : ''}
                    ${business?.status === 'approved' && !businessVerified ? '<p class="seller-verification-detail">Shop documents were reviewed, but the required business evidence and representative checks are not recorded. No Business Verified badge is shown.</p>' : ''}
                    ${!currentShop ? '<p class="seller-verification-detail">Create a shop profile to start business verification. Existing shop onboarding rules are unchanged.</p>' : ''}
                </article>
                <article class="seller-verification-card">
                    <div class="seller-verification-card-heading"><div><h3>Physical Store Verified</h3><p>Available after an approved physical location and a completed in-person inspection.</p></div>${renderStatus(physical.status || 'not_started', physical.inspected_at ? `Inspected ${formatDate(physical.inspected_at)}` : '')}</div>
                    ${physical.seller_message ? `<p class="seller-verification-message">${escapeHtml(physical.seller_message)}</p>` : ''}
                    ${currentShop?.id && currentShop.status === 'active' && physical.status !== 'approved' && physical.status !== 'suspended' ? '<button class="admin-secondary-button" type="button" data-request-physical-inspection>Request an inspection</button><p class="seller-verification-detail">An approved shop location is required first. A submitted shop photo alone does not qualify for this badge.</p>' : ''}
                    ${!currentShop ? '<p class="seller-verification-detail">Create and approve a shop before requesting a premises inspection.</p>' : ''}
                </article>
            </div>
        `;

        const identityForm = container.querySelector('#sellerIdentityForm');
        identityForm?.querySelector('[name="country_code"]')?.addEventListener('change', (event) => {
            const selected = countryConfig.find((country) => country.country_code === event.currentTarget.value);
            const documentSelect = identityForm.querySelector('[name="document_type"]');
            if (!documentSelect || !selected) return;
            documentSelect.innerHTML = allowedIdentityDocumentTypes(selected)
                .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(documentLabel(type))}</option>`)
                .join('');
        });
        container.querySelector('[data-save-identity-draft]')?.addEventListener('click', () => saveIdentityDraft(identityForm));
        identityForm?.addEventListener('submit', submitIdentityCase);
        container.querySelector('[data-request-physical-inspection]')?.addEventListener('click', requestPhysicalInspection);
    }

    function readIdentityForm(form) {
        return {
            countryCode: form.elements.country_code.value,
            sellerType: form.elements.seller_type.value,
            legalFirstName: form.elements.legal_first_name.value.trim(),
            legalLastName: form.elements.legal_last_name.value.trim(),
            documentType: form.elements.document_type.value,
            consent: form.elements.consent.checked,
            consentVersion: countryConfig.find((country) => country.country_code === form.elements.country_code.value)?.privacy_notice_version || IDENTITY_CONSENT_VERSION,
            shopId: sellerContext?.shop?.id || null
        };
    }

    async function prepareIdentityCase(form) {
        const values = readIdentityForm(form);
        const { data: caseId, error } = await sellerContext.supabase.rpc('seller_prepare_identity_verification', {
            p_country_code: values.countryCode,
            p_seller_type: values.sellerType,
            p_legal_first_name: values.legalFirstName,
            p_legal_last_name: values.legalLastName,
            p_document_type: values.documentType,
            p_consent_version: values.consentVersion,
            p_shop_id: values.shopId,
            p_consent: values.consent
        });
        if (error) throw error;
        if (typeof caseId !== 'string') throw new Error('The verification draft could not be saved.');
        return caseId;
    }

    async function saveIdentityDraft(form) {
        if (!form?.reportValidity()) return;
        const button = form.querySelector('[data-save-identity-draft]');
        const message = form.querySelector('#sellerIdentityMessage');
        button.disabled = true;
        setMessage(message, '');
        try {
            await prepareIdentityCase(form);
            setMessage(message, 'Draft saved. Return here to upload your document and submit when you are ready.');
            await refreshSellerPanel();
        } catch (error) {
            setMessage(message, error.message || 'The draft could not be saved. Try again.', true);
        } finally {
            button.disabled = false;
        }
    }

    async function submitIdentityCase(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = form.querySelector('#sellerIdentityMessage');
        const submit = form.querySelector('button[type="submit"]');
        const file = form.elements.document.files?.[0];
        if (!form.reportValidity()) return;
        if (!file || file.size > MAX_FILE_BYTES) {
            setMessage(message, 'Choose a PDF, JPG, or PNG document up to 5 MB.', true);
            return;
        }
        submit.disabled = true;
        setMessage(message, 'Saving your draft and checking the document…');
        try {
            const caseId = await prepareIdentityCase(form);
            const uploadForm = new FormData();
            uploadForm.append('case_id', caseId);
            uploadForm.append('document', file, 'identity-document');
            const { data, error: uploadError } = await sellerContext.supabase.functions.invoke(
                'seller-verification-documents',
                { body: uploadForm }
            );
            if (uploadError || !data?.path) {
                throw new Error(data?.error || 'Secure upload is unavailable. Confirm the document service is configured and try again.');
            }
            const { error } = await sellerContext.supabase.rpc('seller_submit_identity_verification', {
                p_case_id: caseId,
                p_storage_path: data.path
            });
            if (error) throw error;
            await refreshSellerPanel();
        } catch (error) {
            setMessage(message, error.message || 'Your identity submission could not be completed.', true);
        } finally {
            submit.disabled = false;
        }
    }

    async function requestPhysicalInspection(event) {
        const button = event.currentTarget;
        button.disabled = true;
        const card = button.closest('.seller-verification-card');
        const message = card?.querySelector('.seller-verification-detail');
        try {
            const { error } = await sellerContext.supabase.rpc('shop_owner_request_physical_store_inspection', {
                p_shop_id: sellerContext.shop.id
            });
            if (error) throw error;
            await refreshSellerPanel();
        } catch (error) {
            setMessage(message, error.message || 'The inspection request could not be submitted.', true);
            button.disabled = false;
        }
    }

    async function refreshSellerPanel() {
        const container = document.getElementById('sellerVerificationPanel');
        if (!container || !sellerContext?.supabase) return;
        try {
            const [identity, business, physical] = await Promise.all([
                fetchIdentityCase(sellerContext.supabase),
                fetchBusinessStatus(sellerContext).catch((error) => {
                    if (/does not exist|schema cache/i.test(error.message || '')) return null;
                    throw error;
                }),
                fetchPhysicalInspection(sellerContext).catch((error) => {
                    if (/does not exist|schema cache/i.test(error.message || '')) return { status: 'not_started' };
                    throw error;
                })
            ]);
            renderSellerCards(container, sellerContext, { identity, business, physical });
        } catch (error) {
            container.hidden = false;
            container.innerHTML = `
                <div class="seller-verification-heading">
                    <p class="seller-verification-eyebrow">Seller trust</p>
                    <h2>Verification progress</h2>
                </div>
                <p class="seller-verification-message is-error" role="alert">${escapeHtml(/does not exist|schema cache|function/i.test(error.message || '')
                    ? 'Seller verification is not installed yet. Apply database/seller-trust-verification.sql and deploy its secure upload function.'
                    : 'Verification status is temporarily unavailable. Refresh the page and try again.')}</p>
            `;
        }
    }

    async function mountSellerPanel(context) {
        sellerContext = context;
        const container = document.getElementById('sellerVerificationPanel');
        if (!container || !context?.supabase || !context?.user) return;
        const { data, error } = await context.supabase
            .from('seller_verification_country_config')
            .select('country_code, country_name, identity_document_types, privacy_notice_version')
            .order('country_name');
        countryConfig = !error && Array.isArray(data) ? data : [];
        await refreshSellerPanel();
    }

    function adminContainer(id, text) {
        const node = document.getElementById(id);
        if (!node) return null;
        node.setAttribute('aria-busy', String(text === 'Loading…'));
        node.innerHTML = `<p class="table-empty">${escapeHtml(text)}</p>`;
        return node;
    }

    function identityFilters() {
        return {
            p_status: document.getElementById('sellerIdentityStatus')?.value || 'pending_review',
            p_country_code: document.getElementById('sellerIdentityCountry')?.value || null,
            p_seller_type: document.getElementById('sellerIdentityType')?.value || null,
            p_submitted_after: document.getElementById('sellerIdentityAfter')?.value
                ? new Date(`${document.getElementById('sellerIdentityAfter').value}T00:00:00`).toISOString()
                : null,
            p_submitted_before: document.getElementById('sellerIdentityBefore')?.value
                ? new Date(`${document.getElementById('sellerIdentityBefore').value}T23:59:59.999`).toISOString()
                : null
        };
    }

    function renderIdentityQueue(cases) {
        const container = document.getElementById('sellerIdentityQueue');
        if (!container) return;
        if (!cases.length) {
            container.innerHTML = '<p class="table-empty">No identity cases match these filters.</p>';
            return;
        }
        container.innerHTML = cases.map((item) => {
            const history = Array.isArray(item.review_history) ? item.review_history : [];
            const canReview = ['submitted', 'pending_provider', 'pending_review'].includes(item.status)
                && (!item.assigned_reviewer_id || item.assigned_reviewer_id === currentAdminUserId);
            const canAssign = ['submitted', 'pending_provider', 'pending_review'].includes(item.status)
                && !item.assigned_reviewer_id;
            const canRevoke = item.status === 'approved';
            const canRestore = item.status === 'suspended';
            const historyHtml = history.length
                ? `<ol class="seller-verification-history">${history.map((event) => `
                    <li><strong>${escapeHtml(statusLabel(event.to_status || event.event_type))}</strong>
                        <time>${escapeHtml(formatDate(event.created_at))}</time>
                        <p>${escapeHtml(event.internal_note || event.seller_message || '')}</p>
                    </li>`).join('')}</ol>`
                : '<p class="seller-verification-detail">No review history yet.</p>';
            return `
                <article class="seller-verification-admin-case" data-identity-case="${escapeHtml(item.case_id)}">
                    <header><div><h3>${escapeHtml(`${item.legal_first_name} ${item.legal_last_name}`)}</h3><p>${escapeHtml(item.country_code)} · ${escapeHtml(item.seller_type)} · ${escapeHtml(documentLabel(item.identity_document_type))}</p></div>${renderStatus(item.status)}</header>
                    <dl class="seller-verification-admin-details">
                        <div><dt>Case</dt><dd>${escapeHtml(item.case_id)}</dd></div>
                        <div><dt>Applicant</dt><dd>${escapeHtml(item.applicant_user_id)}</dd></div>
                        <div><dt>Submitted</dt><dd>${escapeHtml(formatDate(item.submitted_at))}</dd></div>
                        <div><dt>Assigned reviewer</dt><dd>${escapeHtml(item.assigned_reviewer_id === currentAdminUserId ? 'You' : item.assigned_reviewer_id || 'Unassigned')}</dd></div>
                        <div><dt>Expiry</dt><dd>${escapeHtml(formatDate(item.expires_at))}</dd></div>
                    </dl>
                    <div class="seller-verification-admin-actions">
                        <button class="admin-secondary-button" type="button" data-open-identity-document="${escapeHtml(item.document_path || '')}" ${item.document_path ? '' : 'disabled'}>Open private document</button>
                        ${canAssign ? '<button class="admin-secondary-button" type="button" data-assign-identity>Assign to me</button>' : ''}
                    </div>
                    ${canReview || canRevoke || canRestore ? `
                        <form class="seller-identity-review-form">
                            <label>Message for seller <textarea name="seller_message" maxlength="2000" rows="2" ${canReview && item.status !== 'pending_review' ? 'required' : ''} placeholder="Explain the decision or next step."></textarea></label>
                            <label>Internal review note <textarea name="internal_note" maxlength="4000" rows="2" required placeholder="Record what was checked. Visible to authorized admins only."></textarea></label>
                            ${canReview ? '<label>Verified until (optional) <input name="expires_at" type="date"></label>' : ''}
                            <div class="seller-verification-admin-actions">
                                ${canReview ? '<button class="admin-primary-button" type="button" data-identity-decision="approve">Approve identity</button><button class="admin-secondary-button" type="button" data-identity-decision="request_info">Request more information</button><button class="admin-secondary-button" type="button" data-identity-decision="reject">Reject</button>' : ''}
                                ${canRevoke ? '<button class="admin-secondary-button" type="button" data-identity-decision="suspend">Suspend</button><button class="admin-secondary-button" type="button" data-identity-decision="revoke">Revoke</button>' : ''}
                                ${canRestore ? '<button class="admin-primary-button" type="button" data-identity-decision="restore">Restore to action required</button>' : ''}
                            </div>
                            <p class="seller-verification-form-message" role="status" aria-live="polite" hidden></p>
                        </form>
                    ` : ''}
                    ${historyHtml}
                </article>`;
        }).join('');
    }

    async function loadAdminIdentityQueue() {
        if (!adminSupabase || identityLoading) return;
        identityLoading = true;
        const container = adminContainer('sellerIdentityQueue', 'Loading identity cases…');
        try {
            const { data: { user } = {}, error: userError } = await adminSupabase.auth.getUser();
            if (userError) throw userError;
            currentAdminUserId = user?.id || null;
            const { data, error } = await adminSupabase.rpc('admin_list_seller_identity_cases', identityFilters());
            if (error) throw error;
            renderIdentityQueue(Array.isArray(data) ? data : []);
            const summary = document.getElementById('sellerIdentitySummary');
            if (summary) summary.textContent = `${Array.isArray(data) ? data.length : 0} identity case(s)`;
        } catch (error) {
            if (container) container.innerHTML = `<p class="table-empty" role="alert">${escapeHtml(/does not exist|schema cache|function/i.test(error.message || '')
                ? 'Identity review is not installed. Apply the seller verification migration.'
                : 'Identity cases could not be loaded. Refresh and try again.')}</p>`;
        } finally {
            identityLoading = false;
            if (container) container.setAttribute('aria-busy', 'false');
        }
    }

    function renderInspectionQueue(items) {
        const container = document.getElementById('sellerInspectionQueue');
        if (!container) return;
        if (!items.length) {
            container.innerHTML = '<p class="table-empty">No physical-store inspection requests match this filter.</p>';
            return;
        }
        container.innerHTML = items.map((item) => `
            <article class="seller-verification-admin-case" data-inspection-id="${escapeHtml(item.inspection_id)}">
                <header><div><h3>${escapeHtml(item.shop_name)}</h3><p>${escapeHtml([item.city, item.country].filter(Boolean).join(', '))}</p></div>${renderStatus(item.status)}</header>
                <dl class="seller-verification-admin-details">
                    <div><dt>Premises</dt><dd>${escapeHtml(item.address)}</dd></div>
                    <div><dt>Location review</dt><dd>${escapeHtml(item.location_status)}</dd></div>
                    <div><dt>Requested by</dt><dd>${escapeHtml(item.requested_by)}</dd></div>
                    <div><dt>Scheduled</dt><dd>${escapeHtml(formatDate(item.scheduled_at))}</dd></div>
                    <div><dt>Inspection date</dt><dd>${escapeHtml(formatDate(item.inspected_at))}</dd></div>
                </dl>
                ${item.inspection_notes ? `<p class="seller-verification-detail"><strong>Internal notes:</strong> ${escapeHtml(item.inspection_notes)}</p>` : ''}
                ${item.evidence_reference ? `<p class="seller-verification-detail"><strong>Evidence reference:</strong> ${escapeHtml(item.evidence_reference)}</p>` : ''}
                <form class="seller-inspection-review-form">
                    <label>Seller message <textarea name="seller_message" maxlength="2000" rows="2" placeholder="Share the outcome or next step."></textarea></label>
                    <label>Internal inspection notes <textarea name="inspection_notes" maxlength="4000" rows="2" placeholder="Record what was inspected and observed."></textarea></label>
                    <label>Evidence reference <input name="evidence_reference" maxlength="500" placeholder="Internal evidence reference"></label>
                    <label>Schedule time <input name="scheduled_at" type="datetime-local"></label>
                    <label>Actual inspection date <input name="inspected_at" type="datetime-local"></label>
                    <label>Inspection outcome <select name="outcome"><option value="">Choose an outcome</option><option value="passed">Passed</option><option value="not_confirmed">Not confirmed</option></select></label>
                    <div class="seller-verification-admin-actions">
                        ${['requested', 'rejected', 'revoked'].includes(item.status) ? '<button class="admin-secondary-button" type="button" data-inspection-action="schedule">Schedule inspection</button>' : ''}
                        ${item.status === 'scheduled' ? '<button class="admin-primary-button" type="button" data-inspection-action="complete">Record completed inspection</button>' : ''}
                        ${item.status === 'approved' ? '<button class="admin-secondary-button" type="button" data-inspection-action="suspend">Suspend</button><button class="admin-secondary-button" type="button" data-inspection-action="revoke">Revoke</button>' : ''}
                    </div>
                    <p class="seller-verification-form-message" role="status" aria-live="polite" hidden></p>
                </form>
            </article>
        `).join('');
    }

    async function loadPhysicalInspectionQueue() {
        if (!adminSupabase || inspectionsLoading) return;
        inspectionsLoading = true;
        const container = adminContainer('sellerInspectionQueue', 'Loading inspection requests…');
        try {
            const status = document.getElementById('sellerInspectionStatus')?.value || 'requested';
            const { data, error } = await adminSupabase.rpc('admin_list_physical_store_inspections', {
                p_status: status
            });
            if (error) throw error;
            renderInspectionQueue(Array.isArray(data) ? data : []);
            const summary = document.getElementById('sellerInspectionSummary');
            if (summary) summary.textContent = `${Array.isArray(data) ? data.length : 0} inspection request(s)`;
        } catch (error) {
            if (container) container.innerHTML = `<p class="table-empty" role="alert">${escapeHtml(/does not exist|schema cache|function/i.test(error.message || '')
                ? 'Physical inspection review is not installed. Apply the seller verification migration.'
                : 'Inspection requests could not be loaded. Refresh and try again.')}</p>`;
        } finally {
            inspectionsLoading = false;
            if (container) container.setAttribute('aria-busy', 'false');
        }
    }

    async function openIdentityDocument(path, button) {
        if (!path || !adminSupabase) return;
        button.disabled = true;
        let popup = null;
        try {
            popup = window.open('about:blank', '_blank');
            if (!popup) throw new Error('Allow pop-ups to open the private document.');
            popup.opener = null;
            const { data, error } = await adminSupabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 120);
            if (error || !data?.signedUrl) throw new Error('Document access is unavailable.');
            popup.location.replace(data.signedUrl);
        } catch (error) {
            popup?.close();
            const card = button.closest('.seller-verification-admin-case');
            const message = card?.querySelector('.seller-verification-form-message');
            if (message) setMessage(message, error.message, true);
            else window.alert(error.message);
        } finally {
            button.disabled = false;
        }
    }

    async function handleIdentityReview(button) {
        const card = button.closest('[data-identity-case]');
        const form = card?.querySelector('.seller-identity-review-form');
        const message = form?.querySelector('.seller-verification-form-message');
        if (!card || !form || !form.reportValidity()) return;
        const decision = button.dataset.identityDecision;
        const sellerMessage = form.elements.seller_message.value.trim();
        const internalNote = form.elements.internal_note.value.trim();
        if (['reject', 'suspend', 'revoke', 'restore', 'request_info'].includes(decision) && sellerMessage.length < 3) {
            setMessage(message, 'Add a clear reason or next step for the seller.', true);
            return;
        }
        if (['suspend', 'revoke', 'reject'].includes(decision)
            && !window.confirm(`Confirm ${decision} for this identity case?`)) return;
        button.disabled = true;
        try {
            const expiry = form.elements.expires_at?.value;
            const { error } = await adminSupabase.rpc('admin_review_seller_identity_case', {
                p_case_id: card.dataset.identityCase,
                p_decision: decision,
                p_seller_message: sellerMessage || null,
                p_internal_note: internalNote,
                p_expires_at: expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null
            });
            if (error) throw error;
            await loadAdminIdentityQueue();
        } catch (error) {
            setMessage(message, error.message || 'The review could not be saved.', true);
            button.disabled = false;
        }
    }

    async function handleInspectionAction(button) {
        const card = button.closest('[data-inspection-id]');
        const form = card?.querySelector('.seller-inspection-review-form');
        const message = form?.querySelector('.seller-verification-form-message');
        if (!card || !form) return;
        const action = button.dataset.inspectionAction;
        const scheduled = form.elements.scheduled_at.value;
        const inspected = form.elements.inspected_at.value;
        const sellerMessage = form.elements.seller_message.value.trim();
        const notes = form.elements.inspection_notes.value.trim();
        const evidence = form.elements.evidence_reference.value.trim();
        if (action === 'schedule' && (!scheduled || !sellerMessage)) {
            setMessage(message, 'Choose a future time and tell the seller what to expect.', true);
            return;
        }
        if (['complete', 'suspend', 'revoke'].includes(action) && (!sellerMessage || !notes)) {
            setMessage(message, 'Add inspection notes and a seller-facing outcome or reason.', true);
            return;
        }
        if (action === 'complete' && (!inspected || !form.elements.outcome.value)) {
            setMessage(message, 'Record the actual inspection date and outcome.', true);
            return;
        }
        if (['suspend', 'revoke'].includes(action)
            && !window.confirm(`Confirm ${action} for this physical-store verification?`)) return;
        button.disabled = true;
        try {
            const { error } = await adminSupabase.rpc('admin_update_physical_store_inspection', {
                p_inspection_id: card.dataset.inspectionId,
                p_action: action,
                p_scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
                p_inspected_at: inspected ? new Date(inspected).toISOString() : null,
                p_outcome: form.elements.outcome.value || null,
                p_seller_message: sellerMessage || null,
                p_inspection_notes: notes || null,
                p_evidence_reference: evidence || null
            });
            if (error) throw error;
            await loadPhysicalInspectionQueue();
        } catch (error) {
            setMessage(message, error.message || 'The inspection update could not be saved.', true);
            button.disabled = false;
        }
    }

    function initAdmin(supabase) {
        adminSupabase = supabase;
        const countrySelect = document.getElementById('sellerIdentityCountry');
        if (countrySelect && supabase?.from) {
            supabase.from('seller_verification_country_config')
                .select('country_code, country_name')
                .order('country_name')
                .then(({ data, error }) => {
                    if (error || !Array.isArray(data)) return;
                    const selected = countrySelect.value;
                    countrySelect.replaceChildren(new Option('All configured countries', ''));
                    data.forEach((country) => {
                        countrySelect.add(new Option(
                            `${country.country_name} (${country.country_code})`,
                            country.country_code
                        ));
                    });
                    countrySelect.value = data.some((country) => country.country_code === selected)
                        ? selected
                        : '';
                });
        }
        if (adminHandlersBound) return;
        adminHandlersBound = true;
        document.getElementById('sellerIdentityFilterForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadAdminIdentityQueue();
        });
        document.getElementById('sellerIdentityRefresh')?.addEventListener('click', loadAdminIdentityQueue);
        document.getElementById('sellerInspectionStatus')?.addEventListener('change', loadPhysicalInspectionQueue);
        document.getElementById('sellerInspectionRefresh')?.addEventListener('click', loadPhysicalInspectionQueue);
        document.getElementById('sellerIdentityQueue')?.addEventListener('click', (event) => {
            const openButton = event.target.closest('[data-open-identity-document]');
            if (openButton) {
                openIdentityDocument(openButton.dataset.openIdentityDocument, openButton);
                return;
            }
            const assignButton = event.target.closest('[data-assign-identity]');
            if (assignButton) {
                const caseId = assignButton.closest('[data-identity-case]')?.dataset.identityCase;
                assignButton.disabled = true;
                adminSupabase.rpc('admin_assign_seller_identity_case', { p_case_id: caseId })
                    .then(({ error }) => {
                        if (error) throw error;
                        return loadAdminIdentityQueue();
                    })
                    .catch((error) => {
                        const message = assignButton.closest('[data-identity-case]')?.querySelector('.seller-verification-form-message');
                        setMessage(message, error.message || 'The case could not be assigned.', true);
                        assignButton.disabled = false;
                    });
                return;
            }
            const decisionButton = event.target.closest('[data-identity-decision]');
            if (decisionButton) handleIdentityReview(decisionButton);
        });
        document.getElementById('sellerInspectionQueue')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-inspection-action]');
            if (button) handleInspectionAction(button);
        });
    }

    window.SellerVerification = {
        mountSellerPanel,
        initAdmin,
        loadAdminIdentityQueue,
        loadPhysicalInspectionQueue
    };
})();
