const DEFAULT_SELLER_IMAGE = '/img/seller/seller.jpg';

function updateSellerAvatar(imageUrl) {
    const source = String(imageUrl || DEFAULT_SELLER_IMAGE).trim() || DEFAULT_SELLER_IMAGE;
    document.querySelectorAll('.user-avatar, .user-dropdown img').forEach((image) => {
        image.src = source;
        image.alt = source === DEFAULT_SELLER_IMAGE ? 'Shop owner store image' : 'Shop image';
    });
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
        initProductTableFilters();
        if (new URLSearchParams(window.location.search).has('mobile-test')) {
            window.__VelveraSellerMobileTest = {
                ...(window.__VelveraSellerMobileTest || {}),
                setProducts(products) {
                    currentProducts = Array.isArray(products) ? products : [];
                    renderProductsTable(currentProducts, true);
                }
            };
        }
        window.VelveraHubDomains?.publicUrl && document.querySelectorAll('a[href="/"]').forEach((link) => {
            link.href = window.VelveraHubDomains.publicUrl('/');
        });
        document.querySelectorAll('[data-marketplace-link]').forEach((link) => {
            const path = link.dataset.marketplaceLink;
            link.href = window.VelveraHubDomains?.publicUrl?.(path) || path;
        });
        initSidebar();
        initModals();
        if (window.supabaseConfigReady) await withSellerBootTimeout(window.supabaseConfigReady, 'catalogue configuration');
        if (window.AuthService) await withSellerBootTimeout(window.AuthService.init(), 'authentication');
        if (!window.AuthService?.isLoggedIn()) {
            renderSellerAuthState();
            return;
        }
        const context = await getSupabaseSellerContext();
        updateSellerAvatar(context?.shop?.logo_url);
        updateShopNavigation(context);
        document.getElementById('userRoleLabel')?.replaceChildren(
            document.createTextNode(sellerListingLabel(context))
        );
        initNavigation();
        initProductForm();
        syncSellerCurrencyCopy();
        initShopOnboarding();
        initShopSettings();
        loadProductsTable();
        await withSellerBootTimeout(checkSupabaseStatus(), 'seller data');
        const params = new URLSearchParams(window.location.search);
        const requestedView = params.get('view');
        const requestedEdit = params.get('edit');
        if (requestedEdit) {
            await withSellerBootTimeout(loadProductsTable(), 'seller products');
            document.querySelector('.nav-item[data-page="products"]')?.click();
            if (currentProducts.some((product) => String(product.id) === requestedEdit)) {
                editProduct(requestedEdit);
            } else {
                showToast('That listing is unavailable or is not owned by this account.', 'error');
            }
        } else if (['notifications', 'messages', 'analytics', 'products', 'orders', 'reviews', 'advertisements'].includes(requestedView)) {
            document.querySelector(`.nav-item[data-page="${requestedView}"]`)?.click();
        }
    } catch (error) {
        const requestId = window.AsyncFeedback?.createRequestId('seller-boot') || `seller-boot-${Date.now()}`;
        window.AsyncFeedback?.log('seller-boot', requestId, error);
        renderSellerLoadError();
    }
});

function withSellerBootTimeout(promise, label, timeoutMs = 12000) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs))
    ]);
}

function renderSellerLoadError() {
    const content = document.getElementById('dashboardContent');
    if (!content) return;
    if (window.AsyncFeedback) {
        AsyncFeedback.render(content, 'error', {
            errorTitle: 'Seller workspace could not load',
            errorMessage: 'We could not finish loading this workspace. Check your connection and try again.',
            onRetry: () => window.location.reload()
        });
        return;
    }
    content.innerHTML = `
        <div class="empty-page admin-access-state">
            <i class="fas fa-triangle-exclamation"></i>
            <h3>Seller workspace could not load</h3>
            <p>We could not finish loading this workspace. Check your connection and try again.</p>
            <button class="btn btn-primary" type="button" onclick="window.location.reload()">Try again</button>
        </div>`;
}

function renderSellerAuthState() {
    const content = document.getElementById('dashboardContent');
    if (!content) return;
    const loginUrl = '/pages/auth.html?mode=login';
    content.innerHTML = `
        <div class="empty-page admin-access-state">
            <i class="fas fa-lock"></i>
            <h3>Seller account</h3>
            <p>Create a seller account or sign in. New shops are reviewed before they can publish shop listings.</p>
            <div class="surface-auth-modes" role="tablist" aria-label="Seller account">
                <button type="button" class="active" data-surface-auth-mode="login" role="tab" aria-selected="true">Sign in</button>
                <button type="button" data-surface-auth-mode="register" role="tab" aria-selected="false">Create account</button>
            </div>
            <p class="surface-auth-status" id="surfaceAuthStatus" role="status" aria-live="polite" hidden></p>
            <form id="surfaceLoginForm" class="surface-login-form">
                <label for="surfaceLoginEmail">Email</label>
                <input id="surfaceLoginEmail" name="email" type="email" autocomplete="username" placeholder="you@example.com" required>
                <label for="surfaceLoginPassword">Password</label>
                <input id="surfaceLoginPassword" name="password" type="password" autocomplete="current-password" required>
                <button class="btn btn-primary" type="submit">Sign in</button>
                <p class="surface-login-error" role="alert" hidden></p>
            </form>
            <form id="surfaceRegisterForm" class="surface-login-form" hidden>
                <label for="surfaceRegisterFirstName">First name</label>
                <input id="surfaceRegisterFirstName" name="firstName" type="text" maxlength="80" autocomplete="given-name" required>
                <label for="surfaceRegisterLastName">Last name</label>
                <input id="surfaceRegisterLastName" name="lastName" type="text" maxlength="80" autocomplete="family-name" required>
                <label for="surfaceRegisterEmail">Email</label>
                <input id="surfaceRegisterEmail" name="email" type="email" autocomplete="email" required>
                <label for="surfaceRegisterPassword">Password</label>
                <input id="surfaceRegisterPassword" name="password" type="password" minlength="8" autocomplete="new-password" required>
                <label class="surface-consent">
                    <input name="ageConfirmed" type="checkbox" required>
                    <span>I confirm that I am 18 years or older and will not use VelveraHub to collect, target, or solicit children's personal data.</span>
                </label>
                <label class="surface-consent">
                    <input name="terms" type="checkbox" required>
                    <span>I accept the <a href="/pages/legal.html#terms" target="_blank" rel="noopener">Terms</a> and <a href="/pages/legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
                </label>
                <button class="btn btn-primary" type="submit">Create seller account</button>
                <p class="surface-login-error" role="alert" hidden></p>
                <small>We may ask you to confirm your email before you can submit a shop application.</small>
            </form>
            <a class="surface-return-link" href="${window.VelveraHubDomains?.publicUrl('/') || loginUrl}">Return to storefront</a>
        </div>`;
    const loginForm = document.getElementById('surfaceLoginForm');
    const registerForm = document.getElementById('surfaceRegisterForm');
    const statusNode = document.getElementById('surfaceAuthStatus');
    const modes = [...content.querySelectorAll('[data-surface-auth-mode]')];

    const setMode = (mode) => {
        const register = mode === 'register';
        loginForm.hidden = register;
        registerForm.hidden = !register;
        modes.forEach((button) => {
            const selected = button.dataset.surfaceAuthMode === mode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
        });
        statusNode.hidden = true;
    };
    modes.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.surfaceAuthMode)));

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        const errorNode = form.querySelector('.surface-login-error');
        submit.disabled = true;
        errorNode.hidden = true;
        try {
            const { error } = await window.AuthService.signIn(
                form.elements.email.value.trim(),
                form.elements.password.value
            );
            if (error) throw error;
            window.location.reload();
        } catch (error) {
            errorNode.textContent = window.AsyncFeedback?.errorMessage(error, 'Sign-in could not be completed. Please try again.', 'seller-sign-in') || 'Sign-in could not be completed. Please try again.';
            errorNode.hidden = false;
            submit.disabled = false;
        }
    });

    registerForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        const errorNode = form.querySelector('.surface-login-error');
        errorNode.hidden = true;
        statusNode.hidden = true;
        if (!form.reportValidity()) return;
        submit.disabled = true;
        try {
            const { data, error } = await window.AuthService.signUp(
                form.elements.email.value.trim(),
                form.elements.password.value,
                {
                    firstName: form.elements.firstName.value.trim(),
                    lastName: form.elements.lastName.value.trim(),
                    accountType: 'seller',
                    ageConfirmed: form.elements.ageConfirmed.checked,
                    termsAccepted: form.elements.terms.checked
                }
            );
            if (error) throw error;
            if (data) {
                window.location.reload();
                return;
            }
            loginForm.elements.email.value = form.elements.email.value.trim();
            form.elements.password.value = '';
            setMode('login');
            statusNode.textContent = 'Account created. Confirm your email, then sign in here to submit your shop application.';
            statusNode.hidden = false;
        } catch (error) {
            errorNode.textContent = window.AsyncFeedback?.errorMessage(error, 'Account creation could not be completed. Please try again.', 'seller-sign-up') || 'Account creation could not be completed. Please try again.';
            errorNode.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });
}

async function getSupabaseSellerContext() {
    if (window.supabaseConfigReady) await window.supabaseConfigReady;
    const supabase = window.SupabaseClient?.get();
    if (!supabase || !window.SupabaseClient.isConfigured()) return null;

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return null;

    // Supabase Auth IDs and the marketplace profiles table are separate in
    // imported projects. Resolve the profile first so both schemas work.
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, user_id, role, first_name, last_name, email, avatar_url')
        .or(`user_id.eq.${user.id},id.eq.${user.id}`)
        .limit(1)
        .maybeSingle();
    const ownerIds = [...new Set([user.id, profile?.id].filter(Boolean))];
    const ownerFilters = ownerIds
        .flatMap((id) => [`owner_id.eq.${id}`, `current_owner_id.eq.${id}`])
        .join(',');
    if (!ownerFilters) return null;

    const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('id, logo_url, name, slug, status, verified, address, email, phone, city, country, service_location, description, whatsapp, facebook, instagram, twitter, other_contact_label, other_contact_url, shop_key')
        .or(ownerFilters)
        .limit(1)
        .maybeSingle();
    if (shopError && !/column|schema cache/i.test(shopError.message || '')) {
        window.AsyncFeedback?.log('seller-shop-lookup', window.AsyncFeedback?.createRequestId('seller-shop-lookup'), shopError);
    }
    return {
        supabase,
        user,
        profile,
        shop: shop || null,
        identityIds: ownerIds
    };
}

function isStoreOwner(context) {
    return Boolean(context?.shop?.id);
}

function isApprovedShop(context) {
    return String(context?.shop?.status || '').toLowerCase() === 'active';
}

function updateShopNavigation(context) {
    const settingsLink = document.querySelector('.nav-item[data-page="shop-settings"]');
    const settingsLabel = settingsLink?.querySelector('[data-shop-settings-label]');
    const ownerLabel = settingsLink?.querySelector('[data-shop-settings-owner-label]');
    const hasShop = isStoreOwner(context);
    const approved = isApprovedShop(context);

    if (settingsLabel) {
        settingsLabel.textContent = !hasShop ? 'Create a shop' : approved ? 'Shop Settings' : 'Shop status';
    }
    if (ownerLabel) ownerLabel.hidden = !approved;

    const promotionsLink = document.querySelector('.nav-item[data-page="promotions"]');
    if (!promotionsLink) return;
    promotionsLink.classList.toggle('seller-owner-only', !approved);
    if (approved) {
        promotionsLink.removeAttribute('aria-disabled');
        promotionsLink.removeAttribute('title');
    } else {
        promotionsLink.setAttribute('aria-disabled', 'true');
        promotionsLink.title = hasShop
            ? 'Available after your shop is approved'
            : 'Available after you create and receive approval for a shop';
    }
}

function shopApprovalPresentation(status) {
    switch (String(status || '').toLowerCase()) {
        case 'pending':
            return {
                label: 'Pending review',
                className: 'warning',
                message: 'Your shop has been submitted. It cannot publish shop listings until it is approved.'
            };
        case 'active':
            return {
                label: 'Approved',
                className: 'success',
                message: 'Your shop is approved. You can manage its settings and publish shop listings.'
            };
        case 'rejected':
            return {
                label: 'Rejected',
                className: 'danger',
                message: 'Your shop application was rejected. Contact VelveraHub support if you need help with the decision.'
            };
        case 'suspended':
            return {
                label: 'Suspended',
                className: 'danger',
                message: 'Your shop is suspended. Contact VelveraHub support for assistance.'
            };
        default:
            return {
                label: 'Status unavailable',
                className: 'warning',
                message: 'We could not identify your shop status. Refresh this page or contact support if the problem continues.'
            };
    }
}

async function renderShopPortalState(context) {
    const panel = document.getElementById('shopOnboardingPanel');
    const title = document.getElementById('shopOnboardingTitle');
    const message = document.getElementById('shopOnboardingMessage');
    const statusBadge = document.getElementById('shopOnboardingStatusBadge');
    const form = document.getElementById('shopOnboardingForm');
    const refreshButton = document.getElementById('refreshShopStatus');
    const settings = document.getElementById('existingShopSettings');
    const verificationPanel = document.getElementById('shopVerificationPanel');
    const verificationForm = document.getElementById('shopVerificationForm');
    if (!panel || !form || !settings) return;

    panel.hidden = false;
    settings.classList.add('hidden');
    form.hidden = true;
    if (verificationPanel) verificationPanel.hidden = true;
    statusBadge.hidden = true;
    refreshButton.hidden = true;
    message.classList.remove('is-error');

    if (!context?.user || !context?.supabase) {
        title.textContent = 'Shop account unavailable';
        message.textContent = 'Sign in with an account that is ready to manage shop onboarding.';
        return;
    }

    if (!context.shop) {
        title.textContent = 'Create your shop';
        message.textContent = 'Create your shop profile first. You will then upload verification documents for admin review before shop listings can be published.';
        form.hidden = false;

        const email = document.getElementById('onboardingShopEmail');
        const country = document.getElementById('onboardingShopCountry');
        if (email && !email.value) email.value = context.user.email || context.profile?.email || '';
        if (country && !form.dataset.regionInitialized) {
            country.value = window.RegionService?.countryName === 'United Kingdom'
                ? 'United Kingdom'
                : 'Nigeria';
            form.dataset.regionInitialized = 'true';
        }
        return;
    }

    const status = String(context.shop.status || '').toLowerCase();
    title.textContent = 'Shop application status';
    statusBadge.hidden = false;
    refreshButton.hidden = false;

    if (status === 'active') {
        const presentation = shopApprovalPresentation(status);
        statusBadge.textContent = presentation.label;
        statusBadge.className = `status-badge ${presentation.className}`;
        message.textContent = presentation.message;
        settings.classList.remove('hidden');
        let verification = null;
        let verificationError = null;
        try {
            const result = await context.supabase
                .from('shop_verification_submissions')
                .select('status')
                .eq('shop_id', context.shop.id)
                .maybeSingle();
            verification = result.data;
            verificationError = result.error;
        } catch (error) {
            verificationError = error;
        }
        const kycApproved = context.shop.verified === true
            && String(verification?.status || '').toLowerCase() === 'approved'
            && !verificationError;
        await loadShopSettings({ context, kycApproved, verificationError });
        return;
    }

    let submission = null;
    const { data, error } = await context.supabase
        .from('shop_verification_submissions')
        .select('id, status, review_note, legal_name, business_name, registration_number, business_type')
        .eq('shop_id', context.shop.id)
        .maybeSingle();
    if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
    if (!error) submission = data;

    const verificationStatus = String(submission?.status || '').toLowerCase();
    const presentations = {
        pending: ['Documents under review', 'warning', 'Your verification documents are with the review team. Shop listings stay unavailable until the application is approved.'],
        resubmission_required: ['Documents need updates', 'warning', 'The review team requested updated information or documents. Review the note and submit the corrected documents below.'],
        rejected: ['Application rejected', 'danger', 'This application was rejected. Contact VelveraHub support if you believe this decision needs review.']
    };
    const [label, className, statusMessage] = presentations[verificationStatus]
        || (status === 'rejected'
            ? ['Application rejected', 'danger', shopApprovalPresentation(status).message]
            : ['Documents required', 'warning', 'Your shop profile is saved, but your application is not in the review queue until you upload the required documents.']);
    statusBadge.textContent = label;
    statusBadge.className = `status-badge ${className}`;
    message.textContent = statusMessage;

    if (submission?.review_note) {
        message.textContent += ` Review note: ${submission.review_note}`;
    }
    if (verificationForm && verificationPanel && status !== 'rejected'
        && verificationStatus !== 'pending' && verificationStatus !== 'rejected') {
        verificationPanel.hidden = false;
        const fields = {
            onboardingLegalName: submission?.legal_name,
            onboardingBusinessName: submission?.business_name,
            onboardingRegistrationNumber: submission?.registration_number,
            onboardingBusinessType: submission?.business_type
        };
        Object.entries(fields).forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input && value && !input.value) input.value = value;
        });
    }
}

function slugifyShopName(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70)
        .replace(/-+$/g, '');
}

function showShopOnboardingError(error) {
    const message = String(error?.message || '');
    const code = String(error?.code || '');
    if (code === '23505' && /slug/i.test(message)) {
        return 'That shop handle is already in use. Choose a different handle.';
    }
    return window.AsyncFeedback?.errorMessage(
        error,
        'Your shop could not be submitted. Please check your details and try again.',
        'shop-onboarding'
    ) || 'Your shop could not be submitted. Please check your details and try again.';
}

async function submitShopOnboarding(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('submitShopOnboarding');
    const message = document.getElementById('shopOnboardingFormMessage');
    const name = document.getElementById('onboardingShopName').value.trim();
    const slug = document.getElementById('onboardingShopSlug').value.trim().toLowerCase();
    const country = document.getElementById('onboardingShopCountry').value;
    const city = document.getElementById('onboardingShopCity').value.trim();
    const email = document.getElementById('onboardingShopEmail').value.trim();
    const description = document.getElementById('onboardingShopDescription').value.trim();

    message.hidden = true;
    message.textContent = '';
    if (!form.reportValidity()) return;

    if (name.length < 2 || city.length < 2) {
        message.textContent = 'Enter a shop name and city with at least two characters.';
        message.hidden = false;
        return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 70) {
        message.textContent = 'Use a shop handle with lowercase letters and numbers separated by single hyphens.';
        message.hidden = false;
        return;
    }
    if (!['Nigeria', 'United Kingdom'].includes(country)) {
        message.textContent = 'Select Nigeria or United Kingdom.';
        message.hidden = false;
        return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';
    try {
        const context = await getSupabaseSellerContext();
        if (!context?.supabase || !context?.user) {
            throw new Error('Sign in to a seller account before submitting a shop.');
        }

        const { data: shopId, error } = await context.supabase.rpc('shop_owner_create_shop', {
            p_name: name,
            p_slug: slug,
            p_country: country,
            p_city: city,
            p_email: email,
            p_description: description
        });
        if (error) throw error;
        if (typeof shopId !== 'string' || !shopId.trim()) {
            throw new Error('The shop service did not return a shop ID. Refresh the page and check your shop status before trying again.');
        }

        let refreshedContext = null;
        try {
            refreshedContext = await getSupabaseSellerContext();
        } catch (refreshError) {
            window.AsyncFeedback?.log('seller-shop-status-refresh', window.AsyncFeedback?.createRequestId('seller-shop-status-refresh'), refreshError);
        }
        const createdContext = refreshedContext?.shop?.id === shopId
            ? refreshedContext
            : {
                ...context,
                shop: { id: shopId, name, slug, country, city, email, description, status: 'pending' }
            };

        updateSellerAvatar(createdContext.shop.logo_url);
        updateShopNavigation(createdContext);
        document.getElementById('userRoleLabel')?.replaceChildren(
            document.createTextNode(sellerListingLabel(createdContext))
        );
        await renderShopPortalState(createdContext);
    } catch (error) {
        let latestContext = null;
        try {
            latestContext = await getSupabaseSellerContext();
        } catch {
            // Keep the original RPC error visible if the status refresh also fails.
        }
        if (latestContext?.shop) {
            updateShopNavigation(latestContext);
            await renderShopPortalState(latestContext);
            return;
        }
        message.textContent = showShopOnboardingError(error);
        message.classList.add('is-error');
        message.hidden = false;
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-paper-plane"></i> Submit shop for review';
    }
}

function safeDocumentFilename(value) {
    return String(value || 'verification-document')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(-100) || 'verification-document';
}

async function submitShopVerification(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('submitShopVerification');
    const message = document.getElementById('shopVerificationFormMessage');
    const fileInput = document.getElementById('onboardingVerificationDocuments');
    const files = [...(fileInput?.files || [])];
    const uploadedPaths = [];
    message.hidden = true;
    message.textContent = '';

    if (!form.reportValidity()) return;
    if (files.length < 1 || files.length > 5) {
        message.textContent = 'Choose between 1 and 5 verification documents.';
        message.hidden = false;
        return;
    }
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    const invalidFile = files.find((file) => !allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024);
    if (invalidFile) {
        message.textContent = `${invalidFile.name} is not supported. Use PDF, JPG, or PNG files up to 5 MB each.`;
        message.hidden = false;
        return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading securely…';
    try {
        const context = await getSupabaseSellerContext();
        if (!context?.supabase || !context?.user || !context?.shop?.id) {
            throw new Error('Sign in to the seller account that owns this shop before uploading documents.');
        }
        const storage = context.supabase.storage.from('shop-verification-private');
        for (const file of files) {
            const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const path = `${context.shop.id}/${id}-${safeDocumentFilename(file.name)}`;
            const { error } = await storage.upload(path, file, {
                cacheControl: '3600',
                contentType: file.type,
                upsert: false
            });
            if (error) throw error;
            uploadedPaths.push(path);
        }

        const { error } = await context.supabase.rpc('shop_owner_submit_verification_documents', {
            p_shop_id: context.shop.id,
            p_legal_name: document.getElementById('onboardingLegalName').value.trim(),
            p_business_name: document.getElementById('onboardingBusinessName').value.trim(),
            p_registration_number: document.getElementById('onboardingRegistrationNumber').value.trim(),
            p_business_type: document.getElementById('onboardingBusinessType').value,
            p_document_paths: uploadedPaths
        });
        if (error) throw error;
        form.reset();
        await renderShopPortalState(await getSupabaseSellerContext());
    } catch (error) {
        if (uploadedPaths.length) {
            const context = await getSupabaseSellerContext().catch(() => null);
            if (context?.supabase) {
                const { error: cleanupError } = await context.supabase
                    .storage.from('shop-verification-private').remove(uploadedPaths);
                if (cleanupError) window.AsyncFeedback?.log('seller-verification-cleanup', window.AsyncFeedback?.createRequestId('seller-verification-cleanup'), cleanupError);
            }
        }
        message.textContent = showShopOnboardingError(error);
        message.classList.add('is-error');
        message.hidden = false;
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-lock"></i> Upload documents & submit for review';
    }
}

function initShopOnboarding() {
    const form = document.getElementById('shopOnboardingForm');
    const verificationForm = document.getElementById('shopVerificationForm');
    const name = document.getElementById('onboardingShopName');
    const slug = document.getElementById('onboardingShopSlug');
    const refreshButton = document.getElementById('refreshShopStatus');
    let slugManuallyEdited = false;

    name?.addEventListener('input', () => {
        if (!slugManuallyEdited && slug) slug.value = slugifyShopName(name.value);
    });
    slug?.addEventListener('input', () => {
        slugManuallyEdited = true;
    });
    form?.addEventListener('submit', submitShopOnboarding);
    verificationForm?.addEventListener('submit', submitShopVerification);
    refreshButton?.addEventListener('click', async () => {
        refreshButton.disabled = true;
        try {
            const context = await getSupabaseSellerContext();
            updateShopNavigation(context);
            await renderShopPortalState(context);
        } catch (error) {
            const message = document.getElementById('shopOnboardingMessage');
            message.textContent = window.AsyncFeedback?.errorMessage(error, 'Could not refresh your shop status. Please try again.', 'seller-shop-status') || 'Could not refresh your shop status. Please try again.';
            message.classList.add('is-error');
        } finally {
            refreshButton.disabled = false;
        }
    });
}

function scopeSellerProducts(query, context) {
    const clauses = [];
    if (context?.shop?.id) clauses.push(`shop_id.eq.${context.shop.id}`);
    for (const id of context?.identityIds || []) clauses.push(`seller_id.eq.${id}`);
    return clauses.length ? query.or(clauses.join(',')) : query.eq('id', '00000000-0000-0000-0000-000000000000');
}

function sellerListingLabel(context) {
    return isStoreOwner(context) ? 'Store owner' : 'Seller';
}

const SELLER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SELLER_IMAGE_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_SELLER_IMAGE_UPLOAD_BYTES = 40 * 1024 * 1024;
const sellerImageBlobsByPreviewUrl = new Map();
const UUID_PATH_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_V4_PATH_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

async function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !SELLER_IMAGE_TYPES.has(file.type) || !file.size) {
            reject(new Error('Choose a JPEG, PNG, or WebP image.'));
            return;
        }
        if (file.size > MAX_SELLER_IMAGE_INPUT_BYTES) {
            reject(new Error('Images must be 40 MiB or smaller before compression.'));
            return;
        }
        const image = new Image();
        const sourceUrl = URL.createObjectURL(file);
        image.onerror = () => {
            URL.revokeObjectURL(sourceUrl);
            reject(new Error('Could not process image'));
        };
        image.onload = () => {
                URL.revokeObjectURL(sourceUrl);
                const maxDimension = 1200;
                const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) {
                    reject(new Error('This image could not be processed by your browser.'));
                    return;
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (!blob || blob.type !== 'image/webp' || !blob.size) {
                        reject(new Error('This image could not be converted to WebP.'));
                        return;
                    }
                    if (blob.size > MAX_SELLER_IMAGE_UPLOAD_BYTES) {
                        reject(new Error('This image is still over the 40 MiB upload limit after compression.'));
                        return;
                    }
                    resolve(blob);
                }, 'image/webp', 0.82);
        };
        image.src = sourceUrl;
    });
}

function uploadProductImage(supabase, imagePreviewUrl, productId, onProgress, maxBytes = MAX_SELLER_IMAGE_UPLOAD_BYTES) {
    if (!imagePreviewUrl || (!sellerImageBlobsByPreviewUrl.has(imagePreviewUrl) && !imagePreviewUrl.startsWith('data:'))) {
        return { promise: Promise.resolve(imagePreviewUrl || null), cancel() {} };
    }
    if (!(new RegExp(`^${UUID_PATH_SEGMENT}$`)).test(String(productId || ''))) {
        return { promise: Promise.reject(new Error('This product is missing a valid listing ID for its images.')), cancel() {} };
    }
    if (!window.crypto?.randomUUID) {
        return { promise: Promise.reject(new Error('Secure image filenames are unavailable in this browser.')), cancel() {} };
    }
    const path = `${productId}/${window.crypto.randomUUID()}.webp`;
    if (!(new RegExp(`^${UUID_PATH_SEGMENT}/${UUID_V4_PATH_SEGMENT}\\.webp$`)).test(path)) {
        return { promise: Promise.reject(new Error('Could not create a valid image filename.')), cancel() {} };
    }
    let storageTask = null;
    let cancelled = false;
    const promise = (async () => {
        let blob = sellerImageBlobsByPreviewUrl.get(imagePreviewUrl);
        if (!blob && imagePreviewUrl.startsWith('data:')) {
            const response = await fetch(imagePreviewUrl);
            blob = await response.blob();
        }
        if (cancelled) {
            const error = new Error('Upload cancelled.');
            error.name = 'AbortError';
            throw error;
        }
        if (blob.type !== 'image/webp' || !blob.size || blob.size > maxBytes) {
            throw new Error(`This image must be a WebP file no larger than ${Math.floor(maxBytes / 1048576)} MiB.`);
        }
        if (!window.StorageUploadService?.upload) {
            throw new Error('The secure upload service is unavailable. Refresh and try again.');
        }
        storageTask = window.StorageUploadService.upload(supabase, 'product-images', path, blob, {
            contentType: 'image/webp',
            upsert: false,
            onProgress
        });
        const { error } = await storageTask.promise;
        if (error) throw error;
        return {
            path,
            url: supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
        };
    })();
    return {
        promise,
        cancel() {
            cancelled = true;
            storageTask?.cancel();
        }
    };
}

function storagePathFromUrl(url) {
    if (!url) return null;
    const marker = '/storage/v1/object/public/product-images/';
    const index = String(url).indexOf(marker);
    return index === -1 ? null : decodeURIComponent(String(url).slice(index + marker.length).split('?')[0]);
}

async function removeStoredImages(supabase, urls) {
    const paths = [...new Set((urls || []).map(storagePathFromUrl).filter(Boolean))];
    if (!paths.length) return;
    const { error } = await supabase.storage.from('product-images').remove(paths);
    if (error) window.AsyncFeedback?.log('seller-image-cleanup', window.AsyncFeedback?.createRequestId('seller-image-cleanup'), error);
}

async function checkSupabaseStatus() {
    const isConfigured = window.SupabaseClient?.isConfigured();
    
    if (isConfigured) {
        console.log('Supabase connected - loading real data');
        await loadRealData();
    } else {
        console.info('Live seller information is unavailable in this environment.');
        renderDashboardSummary([], []);
        updateProductsDisplay([]);
        renderRecentOrders([]);
        window.SupabaseClient?.showConfigPrompt?.();
    }
}

async function loadRealData() {
    const context = await getSupabaseSellerContext();
    if (!context) {
        renderDashboardSummary([], []);
        updateProductsDisplay([]);
        renderRecentOrders([]);
        return;
    }
    
    try {
        let productQuery = context.supabase
            .from('products')
            .select('*, product_images(url, is_primary, display_order)');
        productQuery = scopeSellerProducts(productQuery, context)
            .order('created_at', { ascending: false })
            .limit(100);
        const ordersQuery = context.shop
            ? context.supabase
                .from('orders')
                .select('id, order_number, customer_id, status, total, created_at, order_items(title, quantity)')
                .eq('shop_id', context.shop.id)
                .order('created_at', { ascending: false })
                .limit(50)
            : Promise.resolve({ data: [], error: null });
        const [{ data: products, error: productsError }, { data: orders, error: ordersError }] = await Promise.all([
            productQuery,
            ordersQuery
        ]);

        if (productsError) throw productsError;
        if (ordersError) window.AsyncFeedback?.log('seller-orders-load', window.AsyncFeedback?.createRequestId('seller-orders-load'), ordersError);

        const liveProducts = (products || []).map(product => ({
                ...product,
                image_url: product.image_url || getPrimaryImage(product)
        }));
        const liveOrders = orders || [];
        currentProducts = liveProducts;
        renderDashboardSummary(liveProducts, liveOrders);
        updateProductsDisplay(liveProducts);
        renderRecentOrders(liveOrders.slice(0, 4));
    } catch (error) {
        window.AsyncFeedback?.log('seller-product-load', window.AsyncFeedback?.createRequestId('seller-product-load'), error);
        renderDashboardSummary([], []);
        updateProductsDisplay([]);
        renderRecentOrders([]);
    }
}

function getPrimaryImage(product) {
    return product?.product_images
        ?.slice()
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) ||
            (a.display_order || 0) - (b.display_order || 0))[0]?.url || null;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
}

function formatSellerPrice(amount) {
    return window.RegionService?.formatPrice
        ? window.RegionService.formatPrice(amount)
        : `$${Number(amount || 0).toFixed(2)}`;
}

function localSellerAmountToBase(amount) {
    const value = Number(amount);
    const factor = Number(window.RegionService?.conversionFactor || 1);
    return Number.isFinite(value) ? value / factor : 0;
}

function baseSellerAmountToLocal(amount) {
    const value = Number(amount);
    const factor = Number(window.RegionService?.conversionFactor || 1);
    return Number.isFinite(value) ? value * factor : 0;
}

function syncSellerCurrencyCopy() {
    const currency = window.RegionService?.currency;
    const isUK = window.RegionService?.countryName === 'United Kingdom';
    const code = document.getElementById('productCurrencyCode');
    const help = document.getElementById('productCurrencyHelp');
    if (currency && code) code.textContent = currency.code;
    if (currency && help) {
        help.textContent = `Enter the amount customers will pay in ${currency.code}. Marketplace prices are stored safely in the platform base currency and displayed in ${currency.code}.`;
    }
    const phonePlaceholder = isUK ? '+44 7700 900123' : '+234 801 234 5678';
    const cityPlaceholder = isUK ? 'e.g. London' : 'e.g. Lagos';
    const serviceLocationPlaceholder = isUK
        ? 'e.g. Camden, London'
        : 'e.g. Bariga, Lagos or UNILAG Akoka';
    for (const id of ['shopPhone', 'whatsappHandle']) {
        const input = document.getElementById(id);
        if (input) input.placeholder = phonePlaceholder;
    }
    const city = document.getElementById('shopCity');
    if (city) city.placeholder = cityPlaceholder;
    const serviceLocation = document.getElementById('shopServiceLocation');
    if (serviceLocation) serviceLocation.placeholder = serviceLocationPlaceholder;
}

function renderDashboardSummary(products = [], orders = []) {
    const revenue = orders
        .filter(order => !['cancelled', 'refunded'].includes(String(order.status || '').toLowerCase()))
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
    const customerCount = new Set(orders.map(order => order.customer_id).filter(Boolean)).size;
    const setMetric = (id, value, change = '') => {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
        const changeNode = document.getElementById(`${id}Change`);
        if (changeNode) changeNode.innerHTML = change;
    };

    setMetric('revenueMetric', formatSellerPrice(revenue), orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'}` : 'No orders yet');
    setMetric('ordersMetric', orders.length.toLocaleString(), orders.length ? 'Live orders' : 'No orders yet');
    setMetric('productsMetric', products.length.toLocaleString(), products.length ? 'Live listings' : 'No listings yet');
    setMetric('customersMetric', customerCount.toLocaleString(), customerCount ? 'Unique customers' : 'No customers yet');

    const productBadge = document.getElementById('productCountBadge');
    const orderBadge = document.getElementById('orderCountBadge');
    if (productBadge) productBadge.textContent = products.length;
    if (orderBadge) orderBadge.textContent = orders.filter(order => ['pending', 'confirmed', 'processing'].includes(order.status)).length;
}

function updateProductsDisplay(products) {
    const topProducts = document.getElementById('topProducts');
    if (!topProducts) return;
    if (!products.length) {
        topProducts.innerHTML = '<div class="empty-page dashboard-placeholder"><i class="fas fa-box-open"></i><h3>No products yet</h3><p>Your top listings will appear here after you add your first product.</p></div>';
        return;
    }
    
    topProducts.innerHTML = products.slice(0, 3).map(product => `
        <div class="product-item">
            <img src="${escapeHtml(product.image_url || '/img/basket.png')}" alt="${escapeHtml(product.title)}">
            <div class="product-details">
                <h4>${escapeHtml(product.title)}</h4>
                <p class="product-category">${escapeHtml(product.category || 'General')}</p>
            </div>
            <div class="product-stats">
                <span class="product-price">${formatSellerPrice(product.price)}</span>
                <span class="product-sold">${product.sales_count || 0} sold</span>
            </div>
            <div class="product-actions">
                <button class="icon-btn" onclick="editProduct('${product.id}')"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" onclick="deleteProduct('${product.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

function renderRecentOrders(orders = []) {
    const container = document.getElementById('recentOrders');
    if (!container) return;
    if (!orders.length) {
        container.innerHTML = '<tr><td colspan="6" class="table-empty">No orders yet. New customer orders will appear here.</td></tr>';
        return;
    }
    container.innerHTML = orders.map(order => {
        const items = (order.order_items || []).map(item => `${escapeHtml(item.title || 'Item')} ×${item.quantity || 1}`).join(', ') || 'Order items';
        return `<tr>
            <td>${escapeHtml(order.order_number || order.id)}</td>
            <td><span class="customer-placeholder"><i class="fas fa-user"></i> Customer</span></td>
            <td>${items}</td>
            <td>${formatSellerPrice(order.total)}</td>
            <td><span class="status-badge ${escapeHtml(order.status || 'pending')}">${escapeHtml(order.status || 'pending')}</span></td>
            <td><button class="action-btn-sm" type="button" data-page-link="orders">View</button></td>
        </tr>`;
    }).join('');
}

function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mobileToggle = document.getElementById('mobileToggle');
    
    sidebarToggle?.addEventListener('click', () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
        sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    });
    
    mobileToggle?.addEventListener('click', () => {
        const active = sidebar.classList.toggle('active');
        mobileToggle.setAttribute('aria-expanded', String(active));
        mobileToggle.setAttribute('aria-label', active ? 'Close seller navigation' : 'Open seller navigation');
    });
    
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && 
            !sidebar.contains(e.target) && 
            !mobileToggle.contains(e.target)) {
            sidebar.classList.remove('active');
            mobileToggle?.setAttribute('aria-expanded', 'false');
            mobileToggle?.setAttribute('aria-label', 'Open seller navigation');
        }
    });
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    const dashboardContent = document.getElementById('dashboardContent');
    const productsPage = document.getElementById('productsPage');
    const shopSettingsPage = document.getElementById('shopSettingsPage');
    const pageTitle = document.querySelector('.page-title');
    
    navItems.forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            if (sellerMessagesRefreshTimer) {
                window.clearInterval(sellerMessagesRefreshTimer);
                sellerMessagesRefreshTimer = null;
            }
            const page = item.dataset.page;
            if (item.classList.contains('seller-owner-only')) {
                showToast('Promotions are available after your shop is approved.', 'info');
                return;
            }
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            dashboardContent.classList.add('hidden');
            productsPage.classList.add('hidden');
            shopSettingsPage?.classList.add('hidden');
            
            if (page === 'dashboard') {
                dashboardContent.classList.remove('hidden');
                pageTitle.textContent = 'Dashboard';
            } else if (page === 'products') {
                productsPage.classList.remove('hidden');
                pageTitle.textContent = 'Products';
            } else if (page === 'operations') {
                pageTitle.textContent = 'Seller Operations';
                await renderSellerPage(page);
            } else if (page === 'shop-settings') {
                shopSettingsPage?.classList.remove('hidden');
                const context = await getSupabaseSellerContext();
                updateShopNavigation(context);
                pageTitle.textContent = isApprovedShop(context) ? 'Shop Settings' : 'Shop onboarding';
                await renderShopPortalState(context);
            } else if (page === 'settings') {
                shopSettingsPage?.classList.remove('hidden');
                pageTitle.textContent = 'Account Settings';
                const context = await getSupabaseSellerContext();
                updateShopNavigation(context);
                await renderShopPortalState(context);
            } else {
                dashboardContent.classList.remove('hidden');
                pageTitle.textContent = page.charAt(0).toUpperCase() + page.slice(1).replace('-', ' ');
                await renderSellerPage(page);
            }
            
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('active');
            }
        });
    });

    document.addEventListener('click', (event) => {
        const link = event.target.closest('[data-page-link]');
        if (!link) return;
        event.preventDefault();
        document.querySelector(`.nav-item[data-page="${link.dataset.pageLink}"]`)?.click();
    });
}

function parseListingAttributes(value) {
    return String(value || '').split('\n').map(line => line.trim()).filter(Boolean).reduce((attributes, line) => {
        const separator = line.indexOf(':');
        if (separator > 0) attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        return attributes;
    }, {});
}

function listingSimilarity(left, right) {
    const words = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2));
    const a = words(left);
    const b = words(right);
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter(word => b.has(word)).length;
    return intersection / new Set([...a, ...b]).size;
}

function analyzeListing(product, existingProducts = []) {
    const title = String(product.title || '').trim();
    const description = String(product.description || '').trim();
    const category = String(product.category || '').toLowerCase();
    const images = Array.isArray(product.images) ? product.images : [];
    const errors = [];
    const warnings = [];
    if (title.length < 12) errors.push('Use a more descriptive title (12+ characters).');
    if (description.length < 40) warnings.push('Add more detail to improve buyer confidence.');
    if (!category) errors.push('Choose a category.');
    if (Number(product.price) <= 0) errors.push('Add a valid price.');
    if (!images.length) warnings.push('Add at least one product image.');
    if (['electronics', 'beauty', 'automotive'].some(risk => category.includes(risk)) && !product.provenanceUrl && !product.provenance_url) {
        warnings.push('Add an authenticity or provenance reference for this category.');
    }
    if (/(cure|guaranteed cure|miracle|100% risk[- ]free|fake review)/i.test(`${title} ${description}`)) {
        errors.push('Remove unsupported medical, guarantee, or review claims.');
    }
    const duplicate = existingProducts.find(candidate =>
        String(candidate.id) !== String(product.id) && listingSimilarity(title, candidate.title) >= 0.78
    );
    if (duplicate) errors.push(`Possible duplicate of “${duplicate.title}”.`);
    return {
        score: Math.max(0, Math.min(100, 100 - (errors.length * 24) - (warnings.length * 10))),
        errors,
        warnings,
        duplicate: duplicate || null
    };
}

function renderSellerOperations(products = [], insights = {}) {
    if (!products.length) {
        return sellerEmpty('Add products to unlock demand forecasts, reorder alerts, pricing suggestions, and listing quality checks.');
    }
    const reorderItems = products.map(product => {
        const sales = Number(product.sales_count || 0);
        const views = Number(product.view_count || 0);
        const dailyDemand = Math.max(0.15, (sales / 30) || (views * 0.02 / 30));
        const forecast = Math.ceil(dailyDemand * 14);
        const stock = Number(product.stock || 0);
        return { product, forecast, stock, reorder: Math.max(0, Math.ceil((dailyDemand * 21) - stock)) };
    }).filter(item => item.stock <= Math.max(5, item.forecast));
    const pricing = products.map(product => {
        const sales = Number(product.sales_count || 0);
        const views = Number(product.view_count || 0);
        const conversion = views ? sales / views : 0;
        const suggestion = conversion < 0.02 && views > 25
            ? 'Test a 5–10% price reduction'
            : conversion > 0.08 && Number(product.stock || 0) < 10
                ? 'Demand is strong — test a small price increase'
                : 'Price signal is stable';
        return { product, suggestion };
    }).filter(item => item.suggestion !== 'Price signal is stable').slice(0, 5);
    const quality = products.map(product => ({ product, result: analyzeListing(product, products) }));
    const actions = [
        ...reorderItems.slice(0, 3).map(item => `Reorder ${item.product.title} — projected ${item.forecast} units in 14 days.`),
        ...quality.filter(item => item.result.score < 80).slice(0, 2).map(item => `Improve ${item.product.title} — listing quality is ${item.result.score}%.`),
        ...pricing.slice(0, 2).map(item => `${item.product.title}: ${item.suggestion}.`),
        ...(insights.assortmentGaps || []).slice(0, 2).map(item => `Explore ${item.category} in ${item.location || 'your market'} — demand is ahead of supply.`)
    ].slice(0, 5);
    const benchmarks = insights.benchmarks || [];
    const benchmarkHtml = benchmarks.length ? `
        <div class="dashboard-card">
            <div class="card-header"><h2><i class="fas fa-scale-balanced"></i> Private seller benchmarks</h2><span class="ops-muted">Aggregated comparison only</span></div>
            <div class="ops-quality-grid">${benchmarks.slice(0, 6).map(item => {
                const marketSales = Number(item.market_avg_sales || 0);
                const delta = marketSales ? Math.round((Number(item.sales || 0) / Math.max(1, Number(item.listings || 1)) / marketSales) * 100) : null;
                return `<div class="ops-quality-item"><div><strong>${escapeHtml(item.category || 'General')} · ${escapeHtml(item.location || 'All areas')}</strong><small>${item.sales || 0} sales · market average ${marketSales || '—'}</small></div><span class="quality-score ${delta !== null && delta >= 100 ? 'good' : 'review'}">${delta !== null ? `${delta}%` : '—'}</span></div>`;
            }).join('')}</div>
        </div>` : '';
    const gapsHtml = (insights.assortmentGaps || []).length ? `
        <div class="dashboard-card">
            <div class="card-header"><h2><i class="fas fa-compass"></i> Local assortment opportunities</h2><span class="ops-muted">Privacy-safe demand signals</span></div>
            <div class="ops-action-list">${insights.assortmentGaps.slice(0, 5).map(item => `<div class="ops-action"><i class="fas fa-location-dot"></i><span>${escapeHtml(item.category)} in ${escapeHtml(item.location || 'your market')} · ${item.demand_events} interest events · ${item.supply_count} listings</span></div>`).join('')}</div>
        </div>` : '';
    return `
        <div class="page-header"><div><h2>Seller Operations</h2><p>Practical signals for the next 14–21 days, based on your current catalog.</p></div></div>
        <div class="seller-metric-grid ops-metrics">
            <div class="dashboard-card"><span class="ops-icon warning"><i class="fas fa-boxes-stacked"></i></span><h3>${reorderItems.length}</h3><p>Reorder alerts</p></div>
            <div class="dashboard-card"><span class="ops-icon info"><i class="fas fa-chart-line"></i></span><h3>${Math.round(products.reduce((sum, p) => sum + (Number(p.sales_count || 0) / 30 * 14), 0))}</h3><p>Forecast units · 14 days</p></div>
            <div class="dashboard-card"><span class="ops-icon success"><i class="fas fa-list-check"></i></span><h3>${quality.filter(item => item.result.score >= 80).length}/${products.length}</h3><p>Listings ready to scale</p></div>
            <div class="dashboard-card"><span class="ops-icon primary"><i class="fas fa-tags"></i></span><h3>${pricing.length}</h3><p>Pricing tests suggested</p></div>
        </div>
        <div class="ops-grid">
            <div class="dashboard-card">
                <div class="card-header"><h2><i class="fas fa-inbox"></i> Next best actions</h2></div>
                <div class="ops-action-list">${actions.length ? actions.map(action => `<div class="ops-action"><i class="fas fa-arrow-right"></i><span>${escapeHtml(action)}</span></div>`).join('') : '<div class="empty-page"><i class="fas fa-circle-check"></i><p>No urgent actions. Keep monitoring your catalog.</p></div>'}</div>
            </div>
            <div class="dashboard-card">
                <div class="card-header"><h2><i class="fas fa-rotate"></i> Reorder alerts</h2></div>
                <div class="ops-table">${reorderItems.length ? reorderItems.slice(0, 8).map(item => `<div class="ops-row"><div><strong>${escapeHtml(item.product.title)}</strong><small>${item.stock} in stock · ${item.forecast} projected</small></div><span class="status-badge warning">Order ${item.reorder}</span></div>`).join('') : '<p class="ops-muted">Stock levels are healthy.</p>'}</div>
            </div>
        </div>
        ${benchmarkHtml}
        ${gapsHtml}
        <div class="dashboard-card">
            <div class="card-header"><h2><i class="fas fa-shield-check"></i> Listing quality & provenance</h2><span class="ops-muted">Quality checks run before scale</span></div>
            <div class="ops-quality-grid">${quality.slice(0, 12).map(item => `<div class="ops-quality-item"><div><strong>${escapeHtml(item.product.title)}</strong><small>${item.result.errors[0] || item.result.warnings[0] || 'Structured listing looks healthy'}</small></div><span class="quality-score ${item.result.score >= 80 ? 'good' : item.result.score >= 60 ? 'review' : 'blocked'}">${item.result.score}%</span></div>`).join('')}</div>
        </div>`;
}

async function renderSellerPage(page) {
    if (sellerMessagesRefreshTimer) {
        window.clearInterval(sellerMessagesRefreshTimer);
        sellerMessagesRefreshTimer = null;
    }
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    const labels = {
        orders: ['Orders', 'Track and manage your customer orders.'],
        messages: ['Messages', 'Reply to private buyer questions about your listings.'],
        reviews: ['Reviews', 'Read customer feedback about your products.'],
        promotions: ['Promotions', 'Create and review shop promotions.'],
        advertisements: ['Advertisements', 'Promote a product for ₦999 after payment review.'],
        notifications: ['Listing updates', 'Review your current listing status and saved promotion decisions.'],
        operations: ['Seller Operations', 'Turn stock, demand, pricing, and listing signals into your next best actions.'],
        analytics: ['Analytics', 'Understand how your shop is performing.'],
        reports: ['Reports', 'Export your shop data for accounting and planning.'],
        settings: ['Account Settings', 'Manage your seller account and security.']
    };
    const [title, description] = labels[page] || ['Seller workspace', ''];
    container.innerHTML = `
        <div class="page-header"><div><h2>${title}</h2><p>${description}</p></div>
            ${page === 'reports' ? '<button class="btn btn-primary" id="exportSellerReport"><i class="fas fa-download"></i> Export CSV</button>' : ''}
        </div>
        <div class="${page === 'notifications' ? 'seller-live-page seller-live-page--updates' : 'dashboard-card seller-live-page'}" id="sellerPageBody">
            <div class="page-loading"><i class="fas fa-spinner fa-spin"></i> Loading your ${title.toLowerCase()}...</div>
        </div>`;

    if (page === 'settings') {
        document.getElementById('shopSettingsPage')?.classList.remove('hidden');
        container.innerHTML = '<div class="page-loading">Use Shop Settings to manage your shop profile and security.</div>';
        return;
    }
    if (page === 'operations') {
        // Keep this page fully usable on Pages: the seller signals are derived
        // from the same Supabase product set used by the rest of the dashboard.
        if (!currentProducts.length) await loadProductsTable();
        document.getElementById('sellerPageBody').innerHTML = renderSellerOperations(currentProducts);
        return;
    }
    if (page === 'notifications') {
        const context = await getSupabaseSellerContext();
        if (!context) {
            document.getElementById('sellerPageBody').innerHTML = '<div class="empty-page"><i class="fas fa-lock"></i><h3>Sign in required</h3><p>Sign in to view updates for your listings.</p></div>';
            return;
        }
        if (!currentProducts.length) await loadProductsTable();
        let promotionRequests = [];
        let promotionError = '';
        if (['seller', 'admin'].includes(String(context.profile?.role || '').toLowerCase())) {
            const { data, error } = await context.supabase.rpc('seller_list_advertisements');
            if (error) promotionError = window.AsyncFeedback?.errorMessage(error, 'Promotion review history is temporarily unavailable.', 'seller-promotion-history') || 'Promotion review history is temporarily unavailable.';
            else promotionRequests = Array.isArray(data) ? data : [];
        }
        document.getElementById('sellerPageBody').innerHTML = renderSellerListingUpdates(
            currentProducts,
            promotionRequests,
            promotionError
        );
        document.querySelectorAll('[data-edit-listing]').forEach((button) => {
            button.addEventListener('click', async () => {
                const id = button.dataset.editListing;
                if (!currentProducts.some((product) => String(product.id) === String(id))) {
                    await loadProductsTable();
                }
                editProduct(id);
            });
        });
        return;
    }
    if (page === 'messages') {
        const context = await getSupabaseSellerContext();
        if (!context) {
            document.getElementById('sellerPageBody').innerHTML = '<div class="empty-page"><i class="fas fa-lock"></i><h3>Sign in required</h3><p>Sign in to view buyer conversations.</p></div>';
            return;
        }
        await renderSellerMessagesPage(context);
        return;
    }
    if (page === 'advertisements') {
        const context = await getSupabaseSellerContext();
        if (!context) {
            document.getElementById('sellerPageBody').innerHTML = '<div class="empty-page"><i class="fas fa-lock"></i><h3>Sign in required</h3><p>Sign in again to submit an advertisement.</p></div>';
            return;
        }
        try {
            if (!currentProducts.length) await loadProductsTable();
            const [{ data: settings }, { data: ads, error: adsError }] = await Promise.all([
                context.supabase.from('advertisement_settings').select('amount_ngn, bank_name, account_name, account_number, instructions').limit(1).maybeSingle(),
                context.supabase.rpc('seller_list_advertisements')
            ]);
            if (adsError) throw adsError;
            const productOptions = currentProducts.filter(product => product.id).map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.title)}</option>`).join('');
            const promotionAmount = Number(settings?.amount_ngn) || 999;
            document.getElementById('sellerPageBody').innerHTML = `
             <div class="dashboard-card" style="margin-bottom:1rem">
                    <div class="card-header"><h2><i class="fas fa-fire"></i> Boost a product</h2><span class="status-badge warning">₦${promotionAmount.toLocaleString('en-NG')}</span></div>
                    <p>Transfer the fixed advertisement fee to the admin account below. After payment, submit your reference for approval. Approved ads appear first and carry a Hot sale tag across the marketplace and your shop.</p>
                    <div class="seller-ad-payment" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;padding:1rem;background:var(--gray-50);border-radius:12px;margin:1rem 0">
                        <div><small>Bank</small><strong>${escapeHtml(settings.bank_name || 'Admin payment details pending')}</strong></div>
                        <div><small>Account name</small><strong>${escapeHtml(settings.account_name || 'Not set')}</strong></div>
                        <div><small>Account number</small><strong>${escapeHtml(settings.account_number || 'Not set')}</strong></div>
                    </div>
                    <p class="ops-muted">${escapeHtml(settings.instructions || 'Pay ₦999 and keep your transfer reference.')}</p>
                    <form id="sellerAdForm" class="settings-form">
                        <div class="form-group"><label for="adProduct">Product to advertise</label><select id="adProduct" required><option value="">Choose a product</option>${productOptions}</select></div>
                        <div class="form-group"><label for="adPaymentReference">Bank transfer reference</label><input id="adPaymentReference" required maxlength="120" placeholder="Enter the payment reference"></div>
                        <button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i> Submit for admin approval</button>
                    </form>
                </div>
                <div class="dashboard-card"><div class="card-header"><h2><i class="fas fa-clock-rotate-left"></i> Advertisement history</h2></div>
                    ${ads.length ? `<div class="ops-table">${ads.map(ad => `<div class="ops-row"><div><strong>${escapeHtml(ad.product_title || 'Product')}</strong><small>₦${Number(ad.amount_ngn || 999).toLocaleString('en-NG')} · ${escapeHtml(ad.payment_reference || '')}</small></div><span class="status-badge ${ad.status === 'approved' ? 'success' : ad.status === 'rejected' ? 'danger' : 'warning'}">${escapeHtml(ad.status)}</span></div>`).join('')}</div>` : '<p class="ops-muted">No advertisement requests yet.</p>'}
                </div>`;
            window.CustomSelect?.enhanceAll(document.getElementById('sellerPageBody'));
            const requestedProductId = new URLSearchParams(window.location.search).get('promote');
            const promotionProductSelect = document.getElementById('adProduct');
            if (requestedProductId && promotionProductSelect &&
                currentProducts.some(product => String(product.id) === requestedProductId)) {
                promotionProductSelect.value = requestedProductId;
                window.CustomSelect?.refresh(promotionProductSelect);
            }
            document.getElementById('sellerAdForm')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                const button = event.currentTarget.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    const { error } = await context.supabase.rpc('seller_submit_advertisement', {
                        p_product_id: document.getElementById('adProduct').value,
                        p_payment_reference: document.getElementById('adPaymentReference').value
                    });
                    if (error) throw error;
                    showToast('Advertisement submitted for admin approval.', 'success');
                    await renderSellerPage('advertisements');
                } catch (error) {
                    showToast(window.AsyncFeedback?.errorMessage(error, 'Your advertisement could not be submitted. Please try again.', 'seller-ad-submit') || 'Your advertisement could not be submitted. Please try again.', 'error');
                    button.disabled = false;
                }
            });
        } catch (error) {
            const safeMessage = window.AsyncFeedback?.errorMessage(error, 'We could not load advertisements. Please try again.', 'seller-ad-load') || 'We could not load advertisements. Please try again.';
            document.getElementById('sellerPageBody').innerHTML = `<div class="empty-page"><i class="fas fa-triangle-exclamation"></i><h3>Advertisements unavailable</h3><p>${escapeHtml(safeMessage)}</p></div>`;
        }
        return;
    }
    if (page === 'reports') {
        document.getElementById('exportSellerReport')?.addEventListener('click', exportSellerReport);
    }

    const context = await getSupabaseSellerContext();
    const body = document.getElementById('sellerPageBody');
    if (!context) {
        body.innerHTML = `<div class="empty-page"><i class="fas fa-lock"></i><h3>Sign in required</h3><p>Sign in to load live ${title.toLowerCase()}.</p></div>`;
        return;
    }

    try {
        const { supabase, shop } = context;
        if (page === 'orders') {
            if (!shop) {
                body.innerHTML = sellerEmpty('Orders are available when your listing is connected to a shop. Your independent listings can be managed from Products.');
                return;
            }
            const { data, error } = await supabase.from('orders').select('id, order_number, status, total, created_at, order_items(title, quantity)').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            let pendingManualPayments = [];
            const paymentResult = await supabase.rpc('shop_owner_list_pending_manual_payment_orders', {
                p_shop_id: shop.id
            });
            if (paymentResult.error) {
                window.AsyncFeedback?.log('seller-manual-payment-orders', window.AsyncFeedback?.createRequestId('seller-manual-payment-orders'), paymentResult.error);
            } else if (Array.isArray(paymentResult.data)) {
                pendingManualPayments = paymentResult.data;
            }
            body.innerHTML = renderSellerOrders(data || [], pendingManualPayments);
        } else if (page === 'reviews') {
            if (!shop) {
                body.innerHTML = sellerEmpty('Reviews appear after customers complete verified purchases.');
                return;
            }
            const { data, error } = await supabase.from('reviews').select('id, rating, title, comment, created_at, is_verified_purchase, is_approved, products!inner(title, shop_id)').eq('products.shop_id', shop.id).eq('is_verified_purchase', true).eq('is_approved', true).order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            body.innerHTML = renderSellerReviews(data || []);
        } else if (page === 'promotions') {
            if (!shop) {
                body.innerHTML = sellerEmpty('Promotions are a shop-owner feature. Your listings can still be published and managed from Products.');
                return;
            }
            const { data, error } = await supabase.from('promotions').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
            if (error) throw error;
            body.innerHTML = renderSellerPromotions(data || []);
        } else if (page === 'analytics') {
            const { data, error } = await scopeSellerProducts(supabase.from('products').select('title, price, stock, sales_count, view_count'), context).limit(1000);
            if (error) throw error;
            body.innerHTML = renderSellerAnalytics(data || []);
        } else if (page === 'reports') {
            body.innerHTML = '<div class="empty-page"><i class="fas fa-file-csv"></i><h3>Reports are ready</h3><p>Export your current products, stock, sales and views as a CSV file.</p></div>';
        }
    } catch (error) {
        const safeMessage = window.AsyncFeedback?.errorMessage(error, 'We could not load this page. Please try again.', 'seller-page-load') || 'We could not load this page. Please try again.';
        body.innerHTML = `<div class="empty-page"><i class="fas fa-triangle-exclamation"></i><h3>We could not load this page</h3><p>${escapeHtml(safeMessage)}</p><button class="btn btn-primary" onclick="renderSellerPage('${page}')">Try again</button></div>`;
    }
}

function sellerEmpty(message) {
    return `<div class="empty-page"><i class="fas fa-inbox"></i><h3>Nothing here yet</h3><p>${message}</p></div>`;
}

function renderSellerListingUpdates(products = [], promotionRequests = [], promotionError = '') {
    const labels = {
        active: 'Live',
        draft: 'Draft',
        inactive: 'Paused',
        out_of_stock: 'Out of stock'
    };
    const listingStatuses = ['active', 'draft', 'inactive', 'out_of_stock'];
    const counts = Object.fromEntries(listingStatuses.map((status) => [
        status,
        products.filter((product) => String(product.status || '').toLowerCase() === status).length
    ]));
    const dateLabel = (value) => {
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime())
            ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
            : 'Date unavailable';
    };
    const savedProductPromotions = products.filter((product) => {
        const status = String(product.ad_status || '').toLowerCase();
        return status && !['none', 'not_requested', 'inactive'].includes(status);
    });
    const promotionEntries = promotionRequests.length
        ? promotionRequests.map((request) => ({
            title: request.product_title || 'Product promotion',
            status: String(request.status || 'pending').toLowerCase(),
            note: request.review_note,
            created_at: request.created_at
        }))
        : savedProductPromotions.map((product) => ({
            title: product.title,
            status: String(product.ad_status || 'pending').toLowerCase(),
            note: '',
            created_at: product.updated_at
        }));
    const promotionHtml = promotionEntries.length
        ? `<div class="ops-table">${promotionEntries.slice(0, 12).map((entry) => {
            const status = ['approved', 'rejected', 'pending'].includes(entry.status) ? entry.status : 'pending';
            const title = status === 'approved'
                ? 'Promotion approved'
                : status === 'rejected'
                    ? 'Promotion needs attention'
                    : 'Promotion under review';
            return `<div class="ops-row seller-update-row">
                <div><strong>${escapeHtml(entry.title)}</strong><small>${title} · ${dateLabel(entry.created_at)}</small>
                    ${entry.note ? `<small class="seller-update-note">${escapeHtml(entry.note)}</small>` : ''}
                </div>
                <span class="status-badge ${status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}">${escapeHtml(status)}</span>
            </div>`;
        }).join('')}</div>`
        : promotionError
            ? `<p class="seller-update-message" role="status">Promotion review history is temporarily unavailable. ${escapeHtml(promotionError)}</p>`
            : '<p class="seller-update-message">No promotion review decisions are recorded yet.</p>';
    const statusCards = listingStatuses.map((status) => `
        <div class="seller-update-stat">
            <span>${labels[status]}</span>
            <strong>${counts[status]}</strong>
        </div>`).join('');
    const moderationEntries = products.filter((product) => {
        const status = String(product.moderation_status || 'approved').toLowerCase();
        return status === 'pending' || status === 'rejected' ||
            (status === 'approved' && Boolean(product.moderated_at));
    }).slice(0, 12);
    const moderationHtml = moderationEntries.length
        ? `<div class="seller-moderation-list">${moderationEntries.map((product) => {
            const status = String(product.moderation_status || '').toLowerCase();
            const badge = status === 'rejected' ? 'danger' : status === 'approved' ? 'success' : 'warning';
            const label = status === 'rejected' ? 'Changes requested' : status === 'approved' ? 'Approved' : 'Awaiting review';
            return `<article class="seller-moderation-row">
                <div><strong>${escapeHtml(product.title || 'Untitled listing')}</strong>
                    <small>${label}${product.moderated_at ? ` · ${dateLabel(product.moderated_at)}` : ''}</small>
                    ${status === 'rejected' ? `<p>${escapeHtml(product.moderation_note || 'The admin requested a listing change.')}</p>` : ''}
                </div>
                <span class="status-badge ${badge}">${label}</span>
                ${status === 'rejected' ? `<button class="btn btn-secondary" type="button" data-edit-listing="${escapeHtml(product.id)}">Edit and resubmit</button>` : ''}
            </article>`;
        }).join('')}</div>`
        : '<p class="seller-update-message">No listing review decisions need attention.</p>';

    return `
        <div class="seller-update-grid">
            <section class="dashboard-card seller-update-card seller-update-card--summary">
                <div class="card-header"><h2><i class="fas fa-list-check"></i> Current listing status</h2>
                    <a class="seller-update-link" href="#" data-page-link="products">Manage products <i class="fas fa-arrow-right"></i></a>
                </div>
                <p class="seller-update-message">A live summary of saved listing statuses, not a read/unread notification history.</p>
                <div class="seller-update-stats">${statusCards}</div>
            </section>
            <section class="dashboard-card seller-update-card">
                <div class="card-header"><h2><i class="fas fa-clipboard-check"></i> Listing moderation</h2></div>
                <p class="seller-update-message">Listing review is separate from product availability and paid promotion decisions.</p>
                ${moderationHtml}
            </section>
            <section class="dashboard-card seller-update-card">
                <div class="card-header"><h2><i class="fas fa-bullhorn"></i> Promotion review</h2></div>
                ${promotionHtml}
            </section>
        </div>`;
}

async function renderSellerMessagesPage(context) {
    const body = document.getElementById('sellerPageBody');
    const supabase = context.supabase;
    const userId = context.user.id;
    let activeConversationId = null;
    let conversations = [];

    body.innerHTML = `
        <div class="seller-messages-layout">
            <aside class="seller-message-inbox" aria-label="Buyer conversations">
                <div class="seller-message-inbox-heading"><h3>Conversations</h3><span data-message-count>0</span></div>
                <div class="seller-message-conversation-list" data-conversation-list aria-live="polite"></div>
            </aside>
            <section class="seller-message-thread" aria-label="Selected conversation">
                <div class="seller-message-empty" data-message-empty><i class="fas fa-comments" aria-hidden="true"></i><strong>Select a conversation</strong><span>Buyer questions appear here, grouped by product.</span></div>
                <div class="seller-message-log" data-message-log role="log" aria-live="polite" hidden></div>
                <form class="seller-message-reply" data-message-form hidden>
                    <label for="sellerMessageReply">Reply to buyer</label>
                    <textarea id="sellerMessageReply" rows="3" maxlength="2000" required placeholder="Write a reply…"></textarea>
                    <div><span>Keep payment and delivery details clear.</span><button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane" aria-hidden="true"></i> Send reply</button></div>
                    <p class="seller-message-feedback" data-message-feedback role="status" aria-live="polite"></p>
                </form>
            </section>
        </div>`;

    const list = body.querySelector('[data-conversation-list]');
    const messageLog = body.querySelector('[data-message-log]');
    const empty = body.querySelector('[data-message-empty]');
    const form = body.querySelector('[data-message-form]');
    const input = form.querySelector('textarea');
    const feedback = form.querySelector('[data-message-feedback]');

    async function openConversation(id) {
        const conversation = conversations.find((item) => String(item.id) === String(id));
        if (!conversation) return;
        activeConversationId = conversation.id;
        selectedSellerConversationId = conversation.id;
        list.querySelectorAll('[data-conversation-id]').forEach((button) => {
            const selected = String(button.dataset.conversationId) === String(id);
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        const { data, error } = await supabase
            .from('product_conversation_messages')
            .select('id,sender_id,body,created_at')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true })
            .limit(150);
        if (error) throw error;
        messageLog.innerHTML = (data || []).map((message) => {
            const own = String(message.sender_id) === String(userId);
            const date = message.created_at ? new Date(message.created_at) : null;
            const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '';
            return `<article class="seller-message-bubble${own ? ' is-mine' : ''}">
                <small>${own ? 'You' : 'Buyer'}${dateLabel ? ` · ${escapeHtml(dateLabel)}` : ''}</small>
                <p>${escapeHtml(message.body || '')}</p>
            </article>`;
        }).join('') || '<p class="seller-message-no-replies">No messages in this conversation yet.</p>';
        messageLog.hidden = false;
        form.hidden = false;
        empty.hidden = true;
        messageLog.scrollTop = messageLog.scrollHeight;
    }

    async function loadConversations(preferredId = activeConversationId) {
        const { data, error } = await supabase
            .from('product_conversations')
            .select('id,product_id,buyer_id,seller_id,created_at,last_message_at')
            .eq('seller_id', userId)
            .order('last_message_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        conversations = Array.isArray(data) ? data : [];
        const productIds = [...new Set(conversations.map((item) => item.product_id).filter(Boolean))];
        const productsResult = productIds.length
            ? await supabase.from('products').select('id,title').in('id', productIds)
            : { data: [], error: null };
        if (productsResult.error) throw productsResult.error;
        const titles = new Map((productsResult.data || []).map((product) => [String(product.id), product.title]));
        body.querySelector('[data-message-count]').textContent = String(conversations.length);
        list.innerHTML = conversations.length
            ? conversations.map((conversation) => {
                const date = conversation.last_message_at ? new Date(conversation.last_message_at) : null;
                const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '';
                return `<button class="seller-message-conversation" type="button" data-conversation-id="${escapeHtml(conversation.id)}" aria-pressed="false">
                    <strong>${escapeHtml(titles.get(String(conversation.product_id)) || 'Product listing')}</strong>
                    <span>Buyer conversation</span><small>${escapeHtml(dateLabel)}</small>
                </button>`;
            }).join('')
            : '<div class="seller-message-list-empty"><i class="fas fa-inbox" aria-hidden="true"></i><strong>No buyer messages yet</strong><span>Conversations started from your product pages will appear here.</span></div>';
        list.querySelectorAll('[data-conversation-id]').forEach((button) => {
            button.addEventListener('click', () => openConversation(button.dataset.conversationId).catch(showSellerMessageError));
        });
        const nextId = conversations.some((item) => String(item.id) === String(preferredId))
            ? preferredId
            : conversations[0]?.id;
        if (nextId) await openConversation(nextId);
        else {
            messageLog.hidden = true;
            form.hidden = true;
            empty.hidden = false;
        }
    }

    function showSellerMessageError(error) {
        feedback.textContent = window.AsyncFeedback?.errorMessage(error, 'The conversation could not be loaded. Please try again.', 'seller-conversation-load') || 'The conversation could not be loaded. Please try again.';
        feedback.classList.add('is-error');
        feedback.hidden = false;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = input.value.trim();
        if (!activeConversationId || !message || message.length > 2000) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        feedback.hidden = true;
        try {
            const { error } = await supabase.rpc('send_product_conversation_message', {
                p_conversation_id: activeConversationId,
                p_message: message
            });
            if (error) throw error;
            input.value = '';
            feedback.classList.remove('is-error');
            feedback.textContent = 'Reply sent.';
            feedback.hidden = false;
            await loadConversations(activeConversationId);
        } catch (error) {
            showSellerMessageError(error);
        } finally {
            button.disabled = false;
        }
    });

    try {
        await loadConversations(selectedSellerConversationId);
        sellerMessagesRefreshTimer = window.setInterval(() => {
            if (!document.hidden && document.getElementById('sellerPageBody') === body) {
                loadConversations(activeConversationId).catch(showSellerMessageError);
            }
        }, 10000);
    } catch (error) {
        const safeMessage = window.AsyncFeedback?.errorMessage(error, 'Messages could not load. Please try again.', 'seller-messages-load') || 'Messages could not load. Please try again.';
        body.innerHTML = `<div class="empty-page"><i class="fas fa-triangle-exclamation"></i><h3>Messages could not load</h3><p>${escapeHtml(safeMessage)}</p></div>`;
    }
}

function renderSellerOrders(orders, pendingManualPayments = []) {
    const paymentQueue = pendingManualPayments.length
        ? `<section class="seller-manual-payment-queue"><h2>Pending seller-direct payments</h2><p>Confirm only after you independently verify that the payment has cleared to you.</p>${pendingManualPayments.map(order => {
            const payment = order.payment || {};
            return `<article class="seller-manual-payment-card"><div><strong>${escapeHtml(order.order_number || order.id)}</strong><p>${escapeHtml(payment.method || 'Manual payment')} · item subtotal ${formatSellerPrice(payment.shop_total || 0)}</p><p class="seller-manual-payment-instructions">${escapeHtml(payment.instructions || 'Confirm the agreed payment details with the buyer in chat.')}</p></div><button class="action-btn-sm" type="button" data-confirm-seller-manual-payment="${escapeHtml(order.id)}">Confirm payment received</button><p class="seller-manual-payment-status" role="status" aria-live="polite"></p></article>`;
        }).join('')}</section>`
        : '';
    if (!orders.length) return `${paymentQueue}${sellerEmpty('New orders will appear here when customers purchase from your shop.')}`;
    return `${paymentQueue}<div class="orders-table"><table><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th></tr></thead><tbody>${orders.map(order => `<tr><td>${escapeHtml(order.order_number || order.id)}</td><td>${escapeHtml((order.order_items || []).map(item => `${item.title || 'Item'} ×${item.quantity || 1}`).join(', ') || 'Order items')}</td><td>${formatSellerPrice(order.total)}</td><td><span class="status-badge ${escapeHtml(order.status || 'pending')}">${escapeHtml(order.status || 'pending')}</span></td><td>${order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-confirm-seller-manual-payment]');
    if (!button || !window.confirm('Confirm only if the full payment for your shop has cleared. Mark this payment as received?')) return;
    event.preventDefault();
    button.disabled = true;
    const card = button.closest('.seller-manual-payment-card');
    const status = card?.querySelector('.seller-manual-payment-status');
    try {
        const context = await getSupabaseSellerContext();
        if (!context?.supabase) throw new Error('Sign in to the seller account that owns this shop.');
        const { data, error } = await context.supabase.rpc('shop_owner_confirm_manual_payment_receipt', {
            p_order_id: button.dataset.confirmSellerManualPayment
        });
        if (error) throw error;
        if (status) {
            status.textContent = data?.payment_status === 'paid'
                ? 'Payment is confirmed and all payment recipients have reported receipt.'
                : 'Your receipt is recorded. The order will stay pending until all other payment recipients confirm.';
        }
        button.remove();
    } catch (error) {
        if (status) {
            status.textContent = window.AsyncFeedback?.errorMessage(
                error,
                'Payment could not be confirmed. Refresh the orders page and try again.',
                'seller-manual-payment-confirm'
            ) || 'Payment could not be confirmed. Refresh the orders page and try again.';
        }
        button.disabled = false;
    }
});

function renderSellerReviews(reviews) {
    if (!reviews.length) return sellerEmpty('Customer reviews will appear here after verified purchases.');
    return `<div class="seller-review-list">${reviews.map(review => `<article class="seller-review"><div class="product-rating"><span class="stars">${'★'.repeat(Math.max(0, Math.min(5, review.rating || 0)))}</span><strong>${review.rating || 0}/5</strong></div><h3>${escapeHtml(review.title || review.products?.title || 'Product review')}</h3><p>${escapeHtml(review.comment || 'No written comment.')}</p><small>${new Date(review.created_at).toLocaleDateString()}</small></article>`).join('')}</div>`;
}

function renderSellerPromotions(promotions) {
    if (!promotions.length) return sellerEmpty('Create your first promotion from your shop workspace to show it here.');
    return `<div class="seller-metric-grid">${promotions.map(promotion => `<div class="dashboard-card"><h3>${escapeHtml(promotion.title || promotion.code)}</h3><p>${escapeHtml(promotion.description || 'Shop promotion')}</p><strong>${escapeHtml(String(promotion.discount_value || 0))}${promotion.discount_type === 'percentage' ? '%' : ''} off</strong><small>${promotion.is_active ? 'Active' : 'Inactive'}</small></div>`).join('')}</div>`;
}

function renderSellerAnalytics(products) {
    if (!products.length) return sellerEmpty('Add products to start seeing shop analytics.');
    const sales = products.reduce((sum, product) => sum + Number(product.sales_count || 0), 0);
    const views = products.reduce((sum, product) => sum + Number(product.view_count || 0), 0);
    const stock = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
    return `<div class="seller-metric-grid"><div class="dashboard-card"><h3>${products.length}</h3><p>Live products</p></div><div class="dashboard-card"><h3>${sales}</h3><p>Units sold</p></div><div class="dashboard-card"><h3>${views}</h3><p>Product views</p></div><div class="dashboard-card"><h3>${stock}</h3><p>Units in stock</p></div></div><div class="dashboard-card"><h2>Top products</h2><div class="products-list">${products.slice().sort((a,b) => Number(b.sales_count || 0) - Number(a.sales_count || 0)).slice(0, 10).map(p => `<div class="product-item"><div class="product-details"><h4>${escapeHtml(p.title)}</h4><p>${p.sales_count || 0} sold · ${p.view_count || 0} views</p></div><strong>${window.RegionService?.formatPrice(p.price) || p.price}</strong></div>`).join('')}</div></div>`;
}

async function exportSellerReport() {
    const context = await getSupabaseSellerContext();
    if (!context) return showToast('Sign in first.', 'warning');
    const { data, error } = await scopeSellerProducts(
        context.supabase.from('products').select('title, category, price, stock, sales_count, view_count, status, location'),
        context
    );
    if (error) return showToast(window.AsyncFeedback?.errorMessage(error, 'Your report could not be exported. Please try again.', 'seller-report-export') || 'Your report could not be exported. Please try again.', 'error');
    const rows = [['Title', 'Category', 'Price', 'Stock', 'Sales', 'Views', 'Status', 'Location'], ...(data || []).map(p => [p.title, p.category, p.price, p.stock, p.sales_count, p.view_count, p.status, p.location])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `velverahub-products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function initModals() {
    const addProductModal = document.getElementById('addProductModal');
    const addProductBtn = document.getElementById('addProductBtn');
    const addNewProductBtn = document.getElementById('addNewProductBtn');
    const cancelAddProduct = document.getElementById('cancelAddProduct');
    
    function resetProductForm() {
        editingProductId = null;
        const form = document.getElementById('addProductForm');
        form?.reset();
        const moderationNotice = document.getElementById('productModerationNotice');
        if (moderationNotice) {
            moderationNotice.hidden = true;
            moderationNotice.classList.remove('is-rejected');
            moderationNotice.textContent = '';
        }
        document.getElementById('uploadedImages').innerHTML = '';
        document.getElementById('productImages').value = '';
        document.querySelector('#addProductModal h2').textContent = 'Add New Product';
        const submitBtn = form?.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Product';
        const promotionButton = document.getElementById('promoteCurrentProduct');
        if (promotionButton) {
            promotionButton.disabled = true;
            promotionButton.textContent = 'Save this product before requesting promotion';
        }
        window.CustomSelect?.refresh(document.getElementById('productCategory'));
        window.CustomSelect?.refresh(document.getElementById('productLocation'));
    }

    function openModal() {
        resetProductForm();
        addProductModal?.classList.add('active');
    }
    
    function closeModal() {
        addProductModal?.classList.remove('active');
    }
    
    addProductBtn?.addEventListener('click', openModal);
    addNewProductBtn?.addEventListener('click', openModal);
    cancelAddProduct?.addEventListener('click', closeModal);
    
    addProductModal?.querySelector('.modal-close')?.addEventListener('click', closeModal);
    addProductModal?.querySelector('.modal-overlay')?.addEventListener('click', closeModal);
    if (new URLSearchParams(window.location.search).has('mobile-test')) {
        window.__VelveraSellerMobileTest = {
            ...(window.__VelveraSellerMobileTest || {}),
            openProductModal: openModal
        };
    }
}

function initProductForm() {
    const form = document.getElementById('addProductForm');
    const imageUploadArea = document.getElementById('imageUploadArea');
    const imageInput = document.getElementById('productImages');
    const uploadedImages = document.getElementById('uploadedImages');
    const uploadProgress = document.getElementById('productImageUploadProgress');
    const cancelUploadsButton = document.getElementById('cancelProductImageUploads');
    let sellerImageProgressRows = [];
    let activeSellerImageTasks = [];
    const locationSelect = document.getElementById('productLocation');
    const schoolSelect = document.getElementById('productSchool');
    const promotionButton = document.getElementById('promoteCurrentProduct');
    cancelUploadsButton?.addEventListener('click', () => {
        activeSellerImageTasks.forEach((task) => task.cancel());
        showToast('Cancelling image uploads…', 'info');
    });

    function renderSellerImageProgress(files) {
        if (!uploadProgress) return;
        uploadProgress.replaceChildren();
        sellerImageProgressRows = [];
        uploadProgress.hidden = !files.length;
        files.forEach((file) => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = file.name || 'Product photo';
            const progress = document.createElement('progress');
            progress.max = 100;
            progress.value = 0;
            progress.setAttribute('aria-label', `Upload progress for ${file.name || 'product photo'}`);
            const state = document.createElement('span');
            state.textContent = 'Ready to upload';
            row.append(name, progress, state);
            uploadProgress.appendChild(row);
            sellerImageProgressRows.push({ progress, state });
        });
    }

    function updateSellerImageProgress(index, percent, label) {
        const row = sellerImageProgressRows[index];
        if (!row) return;
        row.progress.value = Math.max(0, Math.min(100, Number(percent) || 0));
        row.state.textContent = label || `${Math.round(row.progress.value)}%`;
    }

    function releaseImagePreviews() {
        uploadedImages?.querySelectorAll('img').forEach((image) => {
            if (sellerImageBlobsByPreviewUrl.has(image.src)) {
                sellerImageBlobsByPreviewUrl.delete(image.src);
                URL.revokeObjectURL(image.src);
            }
        });
    }

    async function loadSellerMediaLimits(supabase) {
        const { data, error } = await supabase.rpc('get_marketplace_media_limits');
        if (error) throw error;
        const limits = {
            product_image_limit: Number(data?.product_image_limit),
            product_image_max_bytes: Number(data?.product_image_max_bytes)
        };
        if (
            !Number.isInteger(limits.product_image_limit) ||
            limits.product_image_limit < 1 ||
            limits.product_image_limit > 100 ||
            !Number.isSafeInteger(limits.product_image_max_bytes) ||
            limits.product_image_max_bytes < 5 * 1048576 ||
            limits.product_image_max_bytes > 40 * 1048576
        ) {
            throw new Error('The marketplace photo limits are unavailable. Refresh and try again.');
        }
        return limits;
    }

    async function uploadSelectedImages(supabase, productId, selectedImages, configuredLimits = null) {
        const newImages = selectedImages
            .map((url) => {
                const image = Array.from(uploadedImages?.querySelectorAll('img') || []).find((item) => item.src === url);
                return { url, name: image?.dataset.uploadFileName || 'Product photo' };
            })
            .filter((image) => sellerImageBlobsByPreviewUrl.has(image.url) || image.url.startsWith('data:'));
        if (!newImages.length) return [];
        const limits = configuredLimits || await loadSellerMediaLimits(supabase);
        if (selectedImages.length > limits.product_image_limit) {
            throw new Error(`A listing can have no more than ${limits.product_image_limit} photos.`);
        }
        renderSellerImageProgress(newImages);
        const uploaded = [];
        cancelUploadsButton.hidden = !newImages.length;
        activeSellerImageTasks = [];
        try {
            for (let index = 0; index < newImages.length; index += 1) {
                const image = newImages[index];
                updateSellerImageProgress(index, 0, 'Starting upload');
                const task = uploadProductImage(
                    supabase,
                    image.url,
                    productId,
                    (percent) => updateSellerImageProgress(index, percent, `Uploading ${percent}%`),
                    limits.product_image_max_bytes
                );
                activeSellerImageTasks.push(task);
                try {
                    uploaded.push(await task.promise);
                    updateSellerImageProgress(index, 100, 'Uploaded');
                } catch (error) {
                    updateSellerImageProgress(index, 0, error?.name === 'AbortError' ? 'Cancelled' : 'Upload failed');
                    throw error;
                } finally {
                    activeSellerImageTasks = activeSellerImageTasks.filter((activeTask) => activeTask !== task);
                }
            }
            return uploaded;
        } finally {
            cancelUploadsButton.hidden = true;
            activeSellerImageTasks = [];
        }
    }
    promotionButton?.addEventListener('click', () => {
        if (!editingProductId) return;
        const isShopOwner = window.VELVERAHUB_CONFIG?.APP_TYPE === 'shop-owner';
        const route = isShopOwner ? (window.location.pathname || '/') : '/veeve/seller.html';
        const promotionUrl = new URL(route, window.location.origin);
        promotionUrl.searchParams.set('view', 'advertisements');
        promotionUrl.searchParams.set('promote', String(editingProductId));
        const opened = window.open(promotionUrl.href, '_blank');
        if (opened) opened.opener = null;
        else showToast('Allow pop-ups to open the promotion request in a new tab.', 'info');
    });
    if (locationSelect && window.RegionService) {
        locationSelect.dataset.searchable = 'true';
        locationSelect.dataset.searchPlaceholder = 'Search locations...';
        locationSelect.dataset.searchLabel = 'Search locations';
        locationSelect.dataset.emptyLabel = 'No locations found';
        window.RegionService.appendLocationOptions(locationSelect, false);
        window.CustomSelect?.refresh(locationSelect);
    }
    function populateProductSchools(state) {
        if (!schoolSelect) return;
        const schools = window.CampusService?.getByState(state) || [];
        schoolSelect.innerHTML = '<option value="">State-wide listing</option>' +
            schools.map(school => `<option value="${school.slug}">${escapeHtml(school.name)} · ${escapeHtml(school.city)}</option>`).join('');
        window.CustomSelect?.refresh(schoolSelect);
    }
    locationSelect?.addEventListener('change', () => populateProductSchools(locationSelect.value));
    populateProductSchools(locationSelect?.value);
    
    imageUploadArea?.addEventListener('click', () => {
        imageInput?.click();
    });
    
    imageUploadArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUploadArea.style.borderColor = 'var(--primary)';
    });
    
    imageUploadArea?.addEventListener('dragleave', () => {
        imageUploadArea.style.borderColor = 'var(--gray-300)';
    });
    
    imageUploadArea?.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUploadArea.style.borderColor = 'var(--gray-300)';
        handleFiles(e.dataTransfer.files);
    });
    
    imageInput?.addEventListener('change', () => {
        handleFiles(imageInput.files);
    });
    
    async function handleFiles(files) {
        const selectedFiles = Array.from(files || []);
        if (!selectedFiles.length) {
            showToast('Choose one or more product images.', 'error');
            return;
        }
        if (selectedFiles.length > 10) {
            imageInput.value = '';
            showToast('Choose no more than 10 images for one listing.', 'error');
            return;
        }
        const invalidFile = selectedFiles.find(candidate =>
            !SELLER_IMAGE_TYPES.has(candidate.type) ||
            !candidate.size ||
            candidate.size > MAX_SELLER_IMAGE_INPUT_BYTES
        );
        if (invalidFile) {
            imageInput.value = '';
            showToast('Use non-empty JPEG, PNG, or WebP images up to 40 MiB each.', 'error');
            return;
        }
        try {
            const compressedImages = [];
            for (const file of selectedFiles) compressedImages.push(await compressImage(file));
            releaseImagePreviews();
            uploadedImages.replaceChildren();
            const progressFiles = [];
            compressedImages.forEach((compressedImage, index) => {
            const div = document.createElement('div');
            div.className = 'uploaded-image';
            const previewUrl = URL.createObjectURL(compressedImage);
            sellerImageBlobsByPreviewUrl.set(previewUrl, compressedImage);
            progressFiles.push({ name: selectedFiles[index].name || `Image ${index + 1}` });
            const image = document.createElement('img');
            image.src = previewUrl;
            image.alt = `Product image preview ${index + 1}`;
            image.dataset.uploadFileName = selectedFiles[index].name || `Image ${index + 1}`;
            const label = document.createElement('span');
            label.className = 'image-label';
            label.textContent = index === 0 ? 'Primary image' : `Image ${index + 1}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'remove-btn';
            remove.setAttribute('aria-label', 'Remove selected image');
            remove.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            div.append(image, label, remove);
            remove.addEventListener('click', () => {
                sellerImageBlobsByPreviewUrl.delete(previewUrl);
                URL.revokeObjectURL(previewUrl);
                div.remove();
                imageInput.value = '';
            });
            uploadedImages.appendChild(div);
            });
            renderSellerImageProgress(progressFiles);
        } catch (error) {
            showToast(window.AsyncFeedback?.errorMessage(error, 'One of these images could not be processed. Choose another image and try again.', 'seller-image-process') || 'One of these images could not be processed. Choose another image and try again.', 'error');
        }
    }
    
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('productTitle').value.trim();
        const category = document.getElementById('productCategory').value;
        const localPrice = parseFloat(document.getElementById('productPrice').value);
        const price = localSellerAmountToBase(localPrice);
        const stock = parseInt(document.getElementById('productStock').value) || 0;
        const discountPercent = Math.min(99, Math.max(0, parseInt(document.getElementById('productDiscount').value) || 0));
        const description = document.getElementById('productDescription').value.trim();
        const location = document.getElementById('productLocation').value;
        const school = window.CampusService?.find(document.getElementById('productSchool')?.value);
        const condition = document.getElementById('productCondition')?.value || null;
        const campusArea = document.getElementById('productCampusArea')?.value.trim() || null;
        const deliveryOptions = {
            pickup: document.getElementById('productDeliveryPickup')?.checked === true,
            local_delivery: document.getElementById('productDeliveryLocal')?.checked === true,
            regional_delivery: document.getElementById('productDeliveryRegional')?.checked === true,
            notes: String(document.getElementById('productDeliveryNotes')?.value || '').trim().slice(0, 300)
        };
        const specifications = parseListingAttributes(document.getElementById('productAttributes')?.value);
        const provenanceUrl = document.getElementById('productProvenance')?.value.trim() || null;

        if (!title || !category || !location || isNaN(localPrice) || localPrice < 0) {
            showToast('Please fill in title, category, state and price.', 'error');
            return;
        }

        const selectedImages = Array.from(uploadedImages?.querySelectorAll('img') || []).map(image => image.src);
        if (selectedImages.length > 10) {
            showToast('A listing can have no more than 10 images.', 'error');
            return;
        }
        const hasNewImages = selectedImages.some(image => sellerImageBlobsByPreviewUrl.has(image) || image.startsWith('data:'));
        const existingImageUrls = Array.from(uploadedImages?.querySelectorAll('.existing-image img') || [])
            .map(image => image.src)
            .filter(Boolean);

        const payload = {
            title,
            category,
            price,
            stock,
            discountPercent,
            description,
            shortDescription: description.slice(0, 150),
            location,
            school_slug: school?.slug || null,
            school_name: school?.name || null,
            school_city: school?.city || null,
            campus_area: campusArea,
            condition,
            delivery_options: deliveryOptions,
            specifications,
            provenanceUrl,
            imageUrl: selectedImages[0] || null
        };

        const qualityCheck = analyzeListing({ ...payload, images: selectedImages }, currentProducts);
        if (qualityCheck.errors.length) {
            showToast(qualityCheck.errors[0], 'error');
            return;
        }
        if (qualityCheck.warnings.length) {
            showToast(`Listing saved with a review note: ${qualityCheck.warnings[0]}`, 'info');
        }

        const isEditing = !!editingProductId;
        let deliveryOptionsSaved = true;
        const supabaseContext = await getSupabaseSellerContext();
        if (supabaseContext && window.PhoneVerification && !await window.PhoneVerification.requireVerifiedPhone()) {
            showToast('Verify your Nigerian phone number before publishing a listing.', 'warning');
            return;
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        if (supabaseContext) {
            let uploadedImageResults = [];
            try {
                const { supabase, shop } = supabaseContext;
                const mediaLimits = hasNewImages ? await loadSellerMediaLimits(supabase) : null;
                if (mediaLimits) {
                    if (selectedImages.length > mediaLimits.product_image_limit) {
                        throw new Error(`A listing can have no more than ${mediaLimits.product_image_limit} photos.`);
                    }
                    const newImageBlobs = selectedImages
                        .map((url) => sellerImageBlobsByPreviewUrl.get(url))
                        .filter(Boolean);
                    if (newImageBlobs.some((image) => image.size > mediaLimits.product_image_max_bytes)) {
                        throw new Error(`Each compressed photo must be ${Math.floor(mediaLimits.product_image_max_bytes / 1048576)} MiB or smaller.`);
                    }
                }

                if (isEditing) {
                    uploadedImageResults = await uploadSelectedImages(supabase, editingProductId, selectedImages, mediaLimits);
                    const trustFields = {
                        specifications,
                        provenance_documents: provenanceUrl ? [{ url: provenanceUrl, type: 'reference' }] : [],
                        provenance_status: provenanceUrl ? 'submitted' : 'not_required',
                        quality_score: qualityCheck.score,
                        policy_status: qualityCheck.policyStatus
                    };
                    const baseFields = {
                        title, category, location, price, stock, discount_percent: discountPercent,
                        moderation_status: 'pending',
                        school_slug: school?.slug || null, school_name: school?.name || null,
                        school_city: school?.city || null, campus_area: campusArea, condition,
                        delivery_options: deliveryOptions,
                        description, short_description: description.slice(0, 150),
                        original_price: discountPercent ? price / (1 - discountPercent / 100) : price
                    };
                    let updateResult = await scopeSellerProducts(
                        supabase.from('products').update({ ...baseFields, ...trustFields }).eq('id', editingProductId),
                        supabaseContext
                    );
                    if (updateResult.error && /column|schema cache|PGRST204/i.test(updateResult.error.message || '')) {
                        window.AsyncFeedback?.log('seller-product-update-schema', window.AsyncFeedback?.createRequestId('seller-product-update-schema'), updateResult.error, { action: 'update-product' });
                        if (/delivery_options/i.test(updateResult.error.message || '')) {
                            delete baseFields.delivery_options;
                            deliveryOptionsSaved = false;
                        }
                        updateResult = await scopeSellerProducts(
                            supabase.from('products').update(baseFields).eq('id', editingProductId),
                            supabaseContext
                        );
                    }
                    if (updateResult.error && /delivery_options/i.test(updateResult.error.message || '')) {
                        window.AsyncFeedback?.log('seller-product-delivery-options', window.AsyncFeedback?.createRequestId('seller-product-delivery-options'), updateResult.error, { action: 'update-product' });
                        delete baseFields.delivery_options;
                        deliveryOptionsSaved = false;
                        updateResult = await scopeSellerProducts(
                            supabase.from('products').update(baseFields).eq('id', editingProductId),
                            supabaseContext
                        );
                    }
                    if (updateResult.error) throw updateResult.error;
                    if (hasNewImages) {
                        const { data: oldImages, error: oldImagesError } = await supabase
                            .from('product_images')
                            .select('url')
                            .eq('product_id', editingProductId);
                        if (oldImagesError) throw oldImagesError;
                        const { error: deleteImagesError } = await supabase.from('product_images')
                            .delete().eq('product_id', editingProductId);
                        if (deleteImagesError) throw deleteImagesError;
                        const imageRows = uploadedImageResults.map((image, index) => ({
                            product_id: editingProductId,
                            url: image.url,
                            is_primary: index === 0,
                            display_order: index
                        }));
                        const imageResult = imageRows.length
                            ? await supabase.from('product_images').insert(imageRows)
                            : { error: null };
                        if (imageResult.error) throw imageResult.error;
                        await removeStoredImages(supabase, (oldImages || []).map(image => image.url));
                    }
                } else {
                    const baseFields = {
                        ...(shop
                            ? { shop_id: shop.id }
                            : {
                                shop_id: null,
                                seller_id: supabaseContext.user.id,
                                seller_display_name: [supabaseContext.profile?.first_name, supabaseContext.profile?.last_name].filter(Boolean).join(' ') || supabaseContext.user.email?.split('@')[0] || 'Seller',
                                seller_avatar_url: supabaseContext.profile?.avatar_url || supabaseContext.user.user_metadata?.avatar_url || null
                            }),
                        title, category, location, price, stock,
                        school_slug: school?.slug || null, school_name: school?.name || null,
                        school_city: school?.city || null, campus_area: campusArea, condition,
                        delivery_options: deliveryOptions,
                        discount_percent: discountPercent, original_price: discountPercent ? price / (1 - discountPercent / 100) : price,
                        description, short_description: description.slice(0, 150), status: 'active',
                        moderation_status: 'pending'
                    };
                    const trustFields = {
                        specifications,
                        provenance_documents: provenanceUrl ? [{ url: provenanceUrl, type: 'reference' }] : [],
                        provenance_status: provenanceUrl ? 'submitted' : 'not_required',
                        quality_score: qualityCheck.score,
                        policy_status: qualityCheck.policyStatus
                    };
                    let insertResult = await supabase.from('products').insert({ ...baseFields, ...trustFields }).select().single();
                    if (insertResult.error && /column|schema cache|PGRST204/i.test(insertResult.error.message || '')) {
                        window.AsyncFeedback?.log('seller-product-insert-schema', window.AsyncFeedback?.createRequestId('seller-product-insert-schema'), insertResult.error, { action: 'create-product' });
                        const fallbackFields = { ...baseFields };
                        if (/delivery_options/i.test(insertResult.error.message || '')) {
                            delete fallbackFields.delivery_options;
                            deliveryOptionsSaved = false;
                        }
                        insertResult = await supabase.from('products').insert({ ...fallbackFields, ...trustFields }).select().single();
                        if (insertResult.error && /column|schema cache|PGRST204/i.test(insertResult.error.message || '')) {
                            window.AsyncFeedback?.log('seller-product-insert-schema', window.AsyncFeedback?.createRequestId('seller-product-insert-schema'), insertResult.error, { action: 'create-product-fallback' });
                            if (/delivery_options/i.test(insertResult.error.message || '')) {
                                delete fallbackFields.delivery_options;
                                deliveryOptionsSaved = false;
                            }
                            insertResult = await supabase.from('products').insert(fallbackFields).select().single();
                        }
                    }
                    if (insertResult.error) throw insertResult.error;
                    const product = insertResult.data;
                    uploadedImageResults = await uploadSelectedImages(supabase, product.id, selectedImages, mediaLimits);
                    const imageRows = uploadedImageResults.map((image, index) => ({
                        product_id: product.id,
                        url: image.url,
                        is_primary: index === 0,
                        display_order: index
                    }));
                    if (imageRows.length) {
                        const imageResult = await supabase.from('product_images').insert(imageRows);
                        if (imageResult.error) throw imageResult.error;
                    }
                }
                showToast(
                    deliveryOptionsSaved
                        ? (isEditing ? 'Listing changes submitted for review.' : 'Product submitted for review.')
                        : 'Listing submitted for review, but delivery options could not be saved. You can update them later.',
                    deliveryOptionsSaved ? 'success' : 'info'
                );
            } catch (error) {
                window.Observability?.track('seller_publish_error', { action: isEditing ? 'update_product' : 'create_product' });
                if (uploadedImageResults.length) {
                    await removeStoredImages(supabaseContext.supabase, uploadedImageResults.map(image => image.url));
                }
                showToast(window.AsyncFeedback?.errorMessage(error, 'Your listing could not be saved. Please try again.', 'seller-product-save') || 'Your listing could not be saved. Please try again.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = isEditing ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-plus"></i> Add Product';
                }
                return;
            }
        } else {
            showToast('Sign in to save products.', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = isEditing ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-plus"></i> Add Product';
            }
            return;
        }

        editingProductId = null;
        if (promotionButton) {
            promotionButton.disabled = true;
            promotionButton.textContent = 'Save this product before requesting promotion';
        }
        const modalTitle = document.querySelector('#addProductModal .modal-title, #addProductModal h2');
        if (modalTitle) modalTitle.textContent = 'Add New Product';
        if (submitBtn) submitBtn.textContent = 'Add Product';

        document.getElementById('addProductModal').classList.remove('active');
        form.reset();
        releaseImagePreviews();
        uploadedImages.replaceChildren();
        uploadProgress.replaceChildren();
        uploadProgress.hidden = true;
        imageInput.value = '';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Product';
        }
        loadProductsTable();
    });
}

let currentProducts = [];
let sellerMessagesRefreshTimer = null;
let selectedSellerConversationId = null;
let editingProductId = null;
async function loadProductsTable() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    const requestId = window.AsyncFeedback?.createRequestId('seller-products') || `seller-products-${Date.now()}`;
    if (window.AsyncFeedback) {
        renderSellerTableFeedback(tbody, 'loading', {
            loadingTitle: 'Loading your products',
            loadingMessage: 'Checking the latest live inventory.'
        });
    }

    /*
     * Supabase Auth sessions do not populate the legacy JWT token used by the
     * Express fallback. Prefer the same authenticated shop context used for
     * create/update/delete, otherwise a logged-in seller sees an empty table.
     */
    const supabaseContext = await getSupabaseSellerContext();
    if (supabaseContext) {
        try {
            const { data, error } = await scopeSellerProducts(
                supabaseContext.supabase
                .from('products')
                .select('*, product_images(url, is_primary, display_order)'),
                supabaseContext
            )
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            currentProducts = (data || []).map((product) => ({
                ...product,
                image_url: product.image_url || getPrimaryImage(product)
            }));
            renderProductsTable(currentProducts, true);
            return;
        } catch (error) {
            window.AsyncFeedback?.log('seller-products', requestId, error);
            if (window.AsyncFeedback) {
                renderSellerTableFeedback(tbody, 'error', {
                    errorTitle: 'Products are temporarily unavailable',
                    errorMessage: 'We could not load your live listings. Try again.',
                    onRetry: loadProductsTable
                });
            }
            return;
        }
    }

    currentProducts = [];
    renderProductsTable(currentProducts, false);
    if (!window.AuthService?.isLoggedIn()) {
        showToast('Sign in to manage your live products.', 'warning');
    } else {
        showToast('No listings yet. Add your first product to start selling.', 'info');
    }
}

function renderSellerTableFeedback(tbody, state, options = {}) {
    if (!tbody || !window.AsyncFeedback) return;
    const temporaryContainer = document.createElement('div');
    AsyncFeedback.render(temporaryContainer, state, options);
    tbody.innerHTML = `<tr><td colspan="7">${temporaryContainer.innerHTML}</td></tr>`;
}

function initProductTableFilters() {
    const categoryFilter = document.getElementById('productCategoryFilter');
    if (!categoryFilter || categoryFilter.dataset.categoryFilterReady === 'true') return;
    categoryFilter.dataset.categoryFilterReady = 'true';
    categoryFilter.addEventListener('change', () => renderProductsTable(currentProducts, true));
}

function renderProductsTable(products, isReal) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    const categoryFilter = document.getElementById('productCategoryFilter')?.value;
    const matchingCategoryValues = categoryFilter && categoryFilter !== 'all'
        ? (window.VelveraCategories?.getValues(categoryFilter) || [categoryFilter])
        : null;
    const visibleProducts = matchingCategoryValues
        ? products.filter((product) => matchingCategoryValues.includes(String(product.category || '')))
        : products;

    if (!visibleProducts.length) {
        const emptyMessage = products.length && matchingCategoryValues
            ? 'No products match this category.'
            : 'No products yet. Click "Add Product" to create your first listing.';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--gray-500);">${emptyMessage}</td></tr>`;
        const summary = document.getElementById('productsTableSummary');
        if (summary) summary.textContent = 'Showing 0 products';
        return;
    }

    tbody.innerHTML = visibleProducts.map(product => `
        <tr>
            <td><input type="checkbox" class="product-checkbox" data-id="${product.id}"></td>
            <td>
                <div class="product-table-cell">
                    <img src="${escapeHtml(product.image_url || '/img/basket.png')}" alt="${escapeHtml(product.title)}">
                    <h4>${escapeHtml(product.title)}</h4>
                </div>
            </td>
            <td>${escapeHtml(product.category || 'General')}</td>
            <td>${formatSellerPrice(product.price)}</td>
            <td>${product.stock ?? 0}</td>
            <td><span class="status-badge ${escapeHtml(product.status || 'active')}">${escapeHtml((product.status || 'active').replace('-', ' '))}</span></td>
            <td>
                <div class="product-actions">
                    <button class="icon-btn" onclick="editProduct('${product.id}')"><i class="fas fa-edit"></i></button>
                    <button class="icon-btn" onclick="deleteProduct('${product.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
    const summary = document.getElementById('productsTableSummary');
    if (summary) summary.textContent = `Showing ${visibleProducts.length} product${visibleProducts.length === 1 ? '' : 's'}`;
}

function editProduct(id) {
    const product = currentProducts.find(p => String(p.id) === String(id));
    if (!product) {
        showToast('Product not found', 'error');
        return;
    }

    editingProductId = id;
    const moderationNotice = document.getElementById('productModerationNotice');
    const moderationStatus = String(product.moderation_status || 'approved').toLowerCase();
    if (moderationNotice) {
        moderationNotice.hidden = !['pending', 'rejected'].includes(moderationStatus);
        moderationNotice.classList.toggle('is-rejected', moderationStatus === 'rejected');
        moderationNotice.textContent = moderationStatus === 'rejected'
            ? `This listing was declined: ${product.moderation_note || 'The admin requested a change.'} Edit the listing and save to resubmit it for review.`
            : moderationStatus === 'pending'
                ? 'This listing is awaiting review. Saving your changes will send it back for review.'
                : '';
    }

    const titleEl = document.getElementById('productTitle');
    const categoryEl = document.getElementById('productCategory');
    const priceEl = document.getElementById('productPrice');
    const stockEl = document.getElementById('productStock');
    const discountEl = document.getElementById('productDiscount');
    const descriptionEl = document.getElementById('productDescription');
    const locationEl = document.getElementById('productLocation');
    const schoolEl = document.getElementById('productSchool');
    const conditionEl = document.getElementById('productCondition');
    const campusAreaEl = document.getElementById('productCampusArea');

    if (titleEl) titleEl.value = product.title || '';
    if (categoryEl) { categoryEl.value = product.category || ''; window.CustomSelect?.refresh(categoryEl); }
    if (priceEl) {
        priceEl.value = product.price == null
            ? ''
            : baseSellerAmountToLocal(product.price).toFixed(2);
    }
    if (stockEl) stockEl.value = product.stock || 0;
    if (discountEl) discountEl.value = product.discount_percent || 0;
    if (descriptionEl) descriptionEl.value = product.description || '';
    if (locationEl) {
        locationEl.value = product.location || '';
        window.CustomSelect?.refresh(locationEl);
    }
    if (schoolEl) {
        const schools = window.CampusService?.getByState(product.location) || [];
        schoolEl.innerHTML = '<option value="">State-wide listing</option>' +
            schools.map(school => `<option value="${school.slug}">${escapeHtml(school.name)} · ${escapeHtml(school.city)}</option>`).join('');
        schoolEl.value = product.school_slug || '';
        window.CustomSelect?.refresh(schoolEl);
    }
    if (conditionEl) {
        conditionEl.value = product.condition || '';
        window.CustomSelect?.refresh(conditionEl);
    }
    if (campusAreaEl) campusAreaEl.value = product.campus_area || '';
    const deliveryOptions = product.delivery_options && typeof product.delivery_options === 'object'
        ? product.delivery_options
        : {};
    const pickupOption = document.getElementById('productDeliveryPickup');
    const localDeliveryOption = document.getElementById('productDeliveryLocal');
    const regionalDeliveryOption = document.getElementById('productDeliveryRegional');
    const deliveryNotes = document.getElementById('productDeliveryNotes');
    if (pickupOption) pickupOption.checked = deliveryOptions.pickup === true;
    if (localDeliveryOption) localDeliveryOption.checked = deliveryOptions.local_delivery === true;
    if (regionalDeliveryOption) regionalDeliveryOption.checked = deliveryOptions.regional_delivery === true;
    if (deliveryNotes) deliveryNotes.value = String(deliveryOptions.notes || '').slice(0, 300);
    const promotionButton = document.getElementById('promoteCurrentProduct');
    if (promotionButton) {
        const canPromote = String(product.status || '').toLowerCase() === 'active' && Number(product.stock) > 0;
        promotionButton.disabled = !canPromote;
        promotionButton.textContent = canPromote
            ? 'Open promotion request in a new tab'
            : 'Make listing active and in stock before requesting promotion';
    }
    const uploadedImages = document.getElementById('uploadedImages');
    const existingImages = (product.product_images || [])
        .slice()
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.display_order || 0) - (b.display_order || 0));
    if (!existingImages.length && product.image_url) existingImages.push({ url: product.image_url, is_primary: true });
    uploadedImages.innerHTML = existingImages.map((image, index) => `
        <div class="uploaded-image existing-image">
            <img src="${escapeHtml(image.url)}" alt="${escapeHtml(product.title)} image ${index + 1}">
            <span class="image-label">${index === 0 ? 'Current primary image' : `Current image ${index + 1}`}</span>
        </div>
    `).join('');

    const modalTitle = document.querySelector('#addProductModal .modal-title, #addProductModal h2');
    if (modalTitle) modalTitle.textContent = 'Edit Product';
    const submitBtn = document.querySelector('#addProductForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = moderationStatus === 'rejected' ? 'Save and resubmit' : 'Save Changes';

    document.getElementById('addProductModal')?.classList.add('active');
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;

    const supabaseContext = await getSupabaseSellerContext();
    if (supabaseContext) {
        const { supabase } = supabaseContext;
        const { data: images } = await supabase.from('product_images').select('url').eq('product_id', id);
        const { error } = await scopeSellerProducts(
            supabase.from('products').delete().eq('id', id),
            supabaseContext
        );
        if (error) {
            showToast(window.AsyncFeedback?.errorMessage(error, 'Your listing could not be deleted. Please try again.', 'seller-product-delete') || 'Your listing could not be deleted. Please try again.', 'error');
            return;
        }
        await removeStoredImages(supabase, (images || []).map(image => image.url));
        await supabase.from('product_images').delete().eq('product_id', id);
        showToast('Product deleted successfully!', 'success');
        loadProductsTable();
        return;
    }

    currentProducts = currentProducts.filter(p => String(p.id) !== String(id));
    renderProductsTable(currentProducts, false);
        showToast('Sign in to delete products.', 'error');
}

function showToast(message, type = 'info') {
    const container = document.body;
    let displayMessage = String(message?.message || message || '');
    if (type === 'error' || type === 'warning') {
        const technical = /supabase|postgrest|postgres|schema cache|schema|migration|sqlstate|pgrst\d|database error|permission denied|could not find the table|could not find the .+ column|relation .+ does not exist|column .+ does not exist|constraint|duplicate key|violates|stack trace|internal server|http\s*\d{3}|status code|failed to fetch|econn(?:refused|reset|timedout)?/i;
        if (technical.test(displayMessage) || displayMessage.length > 300) {
            const diagnostic = new Error(displayMessage);
            const requestId = window.AsyncFeedback?.createRequestId('seller-notification') || `seller-${Date.now().toString(36)}`;
            window.Observability?.reportError('seller-notification', requestId, diagnostic, { source: 'toast' });
            displayMessage = window.Observability?.userMessage?.(
                diagnostic,
                'We could not complete that request. Please try again.'
            ) || 'We could not complete that request. Please try again.';
        }
    }
    
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        toastContainer.style.cssText = 'position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;';
        container.appendChild(toastContainer);
    }
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        background: white;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        margin-top: 0.75rem;
        border-left: 4px solid ${colors[type]};
        animation: slideIn 0.3s ease;
    `;
    
    toast.innerHTML = `
        <i class="fas ${icons[type]}" style="color: ${colors[type]}; font-size: 1.25rem;"></i>
        <span style="color: #374151;">${escapeHtml(displayMessage)}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

const toastStyles = document.createElement('style');
toastStyles.textContent = `
    @keyframes slideIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100%); }
    }
`;
document.head.appendChild(toastStyles);

let currentShopKey = '';
let shopKeyVisible = false;

function initShopSettings() {
    try {
        const shopInfoForm = document.getElementById('shopInfoForm');
        const socialMediaForm = document.getElementById('socialMediaForm');
        const paymentPreferencesForm = document.getElementById('sellerPaymentPreferencesForm');
        const paymentPreference = document.getElementById('manualPaymentPreference');
        const passwordForm = document.getElementById('passwordForm');
        const copyShopKeyBtn = document.getElementById('copyShopKey');
        const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
        const regenerateKeyBtn = document.getElementById('regenerateKey');
        const newPasswordInput = document.getElementById('newPassword');
        
        if (shopInfoForm) {
            shopInfoForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = shopInfoForm.querySelector('button[type="submit"]');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
                }
                await saveShopInfo();
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                }
            });
        }
        
        if (socialMediaForm) {
            socialMediaForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = socialMediaForm.querySelector('button[type="submit"]');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
                }
                await saveSocialMedia();
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save Social Links';
                }
            });
        }

        paymentPreference?.addEventListener('change', syncSellerManualPaymentFields);
        paymentPreferencesForm?.addEventListener('submit', saveSellerManualPaymentPreferences);
        
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = passwordForm.querySelector('button[type="submit"]');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
                }
                await changePassword();
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-key"></i> Update Password';
                }
            });
        }
        
        if (copyShopKeyBtn) {
            copyShopKeyBtn.addEventListener('click', () => {
                if (currentShopKey) {
                    navigator.clipboard.writeText(currentShopKey).then(() => {
                        showToast('Shop key copied to clipboard!', 'success');
                    }).catch(() => {
                        const tempInput = document.createElement('input');
                        tempInput.value = currentShopKey;
                        document.body.appendChild(tempInput);
                        tempInput.select();
                        document.execCommand('copy');
                        document.body.removeChild(tempInput);
                        showToast('Shop key copied!', 'success');
                    });
                } else {
                    showToast('No shop key available', 'warning');
                }
            });
        }
        
        if (toggleKeyBtn) {
            toggleKeyBtn.addEventListener('click', () => {
                const keyInput = document.getElementById('shopKeyDisplay');
                const icon = toggleKeyBtn.querySelector('i');
                
                if (!keyInput || !icon) return;
                
                shopKeyVisible = !shopKeyVisible;
                
                if (shopKeyVisible) {
                    keyInput.value = currentShopKey || 'SHOP-XXXX-XXXX-XXXX';
                    icon.classList.replace('fa-eye', 'fa-eye-slash');
                } else {
                    keyInput.value = currentShopKey ? maskShopKey(currentShopKey) : 'SHOP-****-****-****';
                    icon.classList.replace('fa-eye-slash', 'fa-eye');
                }
            });
        }
        
        if (regenerateKeyBtn) {
            regenerateKeyBtn.addEventListener('click', async () => {
                if (confirm('Are you sure you want to regenerate your shop key? This will invalidate the current key.')) {
                    regenerateKeyBtn.disabled = true;
                    regenerateKeyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerating...';
                    await regenerateShopKey();
                    regenerateKeyBtn.disabled = false;
                    regenerateKeyBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Regenerate Key';
                }
            });
        }
        
        if (newPasswordInput) {
            newPasswordInput.addEventListener('input', () => {
                const strength = calculatePasswordStrength(newPasswordInput.value);
                const strengthBar = document.getElementById('newPasswordStrength');
                if (strengthBar) {
                    strengthBar.className = 'password-strength-bar ' + strength;
                }
            });
        }
        
    } catch (error) {
        window.AsyncFeedback?.log('seller-settings-init', window.AsyncFeedback?.createRequestId('seller-settings-init'), error);
    }
}

function generateShopKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'SHOP';
    
    const randomValues = new Uint32Array(12);
    if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(randomValues);
    } else {
        for (let i = 0; i < 12; i++) {
            randomValues[i] = Math.floor(Math.random() * 0xFFFFFFFF);
        }
    }
    
    let idx = 0;
    for (let i = 0; i < 3; i++) {
        key += '-';
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(randomValues[idx++] % chars.length);
        }
    }
    return key;
}

function maskShopKey(key) {
    if (!key) return 'SHOP-****-****-****';
    const parts = key.split('-');
    return parts[0] + '-****-****-' + parts[parts.length - 1];
}

function syncSellerManualPaymentFields() {
    const preference = document.getElementById('manualPaymentPreference');
    const fields = document.getElementById('sellerDirectPaymentFields');
    const method = document.getElementById('manualPaymentMethod');
    const instructions = document.getElementById('manualPaymentInstructions');
    const sellerDirect = preference?.value === 'seller_direct';
    if (fields) fields.hidden = !sellerDirect;
    if (method) method.required = Boolean(sellerDirect);
    if (instructions) instructions.required = Boolean(sellerDirect);
}

async function loadSellerManualPaymentPreferences(context, kycApproved, verificationError) {
    const panel = document.getElementById('sellerPaymentSettings');
    const notice = document.getElementById('sellerPaymentKycNotice');
    const form = document.getElementById('sellerPaymentPreferencesForm');
    const message = document.getElementById('sellerPaymentPreferenceMessage');
    if (!panel || !notice || !form) return;

    panel.hidden = true;
    notice.hidden = true;
    message.hidden = true;
    if (!kycApproved) {
        notice.hidden = false;
        if (verificationError) {
            const noticeCopy = notice.querySelector('.form-help');
            if (noticeCopy) noticeCopy.textContent = 'Manual payment settings are unavailable until your shop’s KYC approval can be confirmed.';
        }
        return;
    }

    panel.hidden = false;
    const button = form.querySelector('button[type="submit"]');
    try {
        const { data, error } = await context.supabase
            .from('shops')
            .select('manual_payment_preference, manual_payment_method, manual_payment_instructions')
            .eq('id', context.shop.id)
            .single();
        if (error) throw error;
        document.getElementById('manualPaymentPreference').value = data.manual_payment_preference || 'velverahub';
        document.getElementById('manualPaymentMethod').value = data.manual_payment_method || '';
        document.getElementById('manualPaymentInstructions').value = data.manual_payment_instructions || '';
        syncSellerManualPaymentFields();
    } catch (error) {
        message.textContent = /column|schema cache|does not exist/i.test(error?.message || '')
            ? 'Payment settings are not installed yet. Apply database/marketplace-manual-payments.sql, then refresh this page.'
            : window.AsyncFeedback?.errorMessage(error, 'Payment preferences could not be loaded. Please try again.', 'seller-payment-settings-load') || 'Payment preferences could not be loaded. Please try again.';
        message.classList.add('is-error');
        message.hidden = false;
        if (button) button.disabled = true;
    }
}

async function saveSellerManualPaymentPreferences(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('sellerPaymentPreferenceMessage');
    const button = form.querySelector('button[type="submit"]');
    const preference = document.getElementById('manualPaymentPreference').value;
    const method = document.getElementById('manualPaymentMethod').value.trim();
    const instructions = document.getElementById('manualPaymentInstructions').value.trim();
    message.hidden = true;
    message.classList.remove('is-error');
    if (!form.reportValidity()) return;

    button.disabled = true;
    try {
        const context = await getSupabaseSellerContext();
        if (!context?.shop?.id || !context?.supabase) {
            throw new Error('Sign in to the seller account that owns this shop.');
        }
        const { error } = await context.supabase.rpc('shop_owner_save_manual_payment_preferences', {
            p_shop_id: context.shop.id,
            p_preference: preference,
            p_method: method,
            p_instructions: instructions
        });
        if (error) throw error;
        message.textContent = 'Payment preference saved. Buyers will be asked to agree on payment and delivery with you before paying.';
        message.hidden = false;
    } catch (error) {
        message.textContent = window.AsyncFeedback?.errorMessage(
            error,
            'Payment preference could not be saved. Confirm your KYC approval and try again.',
            'seller-payment-settings-save'
        ) || 'Payment preference could not be saved. Confirm your KYC approval and try again.';
        message.classList.add('is-error');
        message.hidden = false;
    } finally {
        button.disabled = false;
    }
}

async function loadShopSettings(options = {}) {
    const supabase = window.SupabaseClient?.get();
    
    if (!currentShopKey) {
        currentShopKey = generateShopKey();
    }
    
    const keyInput = document.getElementById('shopKeyDisplay');
    if (keyInput) {
        keyInput.value = shopKeyVisible ? currentShopKey : maskShopKey(currentShopKey);
    }
    
    if (supabase && window.SupabaseClient?.isConfigured()) {
        try {
            const context = options.context || await getSupabaseSellerContext();
            if (context?.shop) {
                const { shop } = context;
                document.getElementById('shopName').value = shop.name || '';
                document.getElementById('shopAddress').value = shop.address || '';
                document.getElementById('shopEmail').value = shop.email || '';
                document.getElementById('shopPhone').value = shop.phone || '';
                document.getElementById('shopCity').value = shop.city || '';
                document.getElementById('shopCountry').value = shop.country || window.RegionService?.countryName || 'Nigeria';
                document.getElementById('shopServiceLocation').value = shop.service_location || shop.address || '';
                document.getElementById('shopDescription').value = shop.description || '';
                document.getElementById('whatsappHandle').value = shop.whatsapp || '';
                document.getElementById('facebookHandle').value = shop.facebook || '';
                document.getElementById('instagramHandle').value = shop.instagram || '';
                document.getElementById('twitterHandle').value = shop.twitter || '';
                document.getElementById('otherContactLabel').value = shop.other_contact_label || '';
                document.getElementById('otherContactUrl').value = shop.other_contact_url || '';

                if (shop.shop_key) {
                    currentShopKey = shop.shop_key;
                    if (keyInput) keyInput.value = shopKeyVisible ? currentShopKey : maskShopKey(currentShopKey);
                }
                await loadSellerManualPaymentPreferences(context, options.kycApproved === true, options.verificationError);
            }
        } catch (error) {
            window.AsyncFeedback?.log('seller-settings-load', window.AsyncFeedback?.createRequestId('seller-settings-load'), error);
        }
    }
}

async function saveShopInfo() {
    const shopData = {
        name: document.getElementById('shopName').value,
        address: document.getElementById('shopAddress').value,
        email: document.getElementById('shopEmail').value,
        phone: document.getElementById('shopPhone').value,
        city: document.getElementById('shopCity').value,
        country: document.getElementById('shopCountry').value,
        serviceLocation: document.getElementById('shopServiceLocation').value,
        description: document.getElementById('shopDescription').value
    };
    
    const context = await getSupabaseSellerContext();
    if (!context) {
        showToast('Sign in with a shop owner account linked to a shop before saving.', 'error');
        return;
    }

    try {
        const { serviceLocation, ...shopFields } = shopData;
        const { error } = await context.supabase
            .from('shops')
            .update({
                ...shopFields,
                service_location: serviceLocation,
                shop_key: currentShopKey,
                updated_at: new Date().toISOString()
            })
            .eq('id', context.shop.id);
        if (error) throw error;
        showToast('Shop information saved successfully!', 'success');
    } catch (error) {
        showToast(window.AsyncFeedback?.errorMessage(error, 'Your shop information could not be saved. Please try again.', 'seller-shop-info-save') || 'Your shop information could not be saved. Please try again.', 'error');
    }
}

async function saveSocialMedia() {
    const socialData = {
        whatsapp: document.getElementById('whatsappHandle').value,
        facebook: document.getElementById('facebookHandle').value,
        instagram: document.getElementById('instagramHandle').value,
        twitter: document.getElementById('twitterHandle').value,
        other_contact_label: document.getElementById('otherContactLabel').value.trim(),
        other_contact_url: document.getElementById('otherContactUrl').value.trim() || null
    };

    if (Boolean(socialData.other_contact_label) !== Boolean(socialData.other_contact_url)) {
        showToast('Enter both the other contact label and its link, or leave both blank.', 'error');
        return;
    }
    if (socialData.other_contact_url) {
        try {
            const url = new URL(socialData.other_contact_url);
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        } catch (_) {
            showToast('The other contact link must be a valid HTTPS URL.', 'error');
            return;
        }
    }
    
    const context = await getSupabaseSellerContext();
    if (!context) {
        showToast('Sign in with a shop owner account linked to a shop before saving.', 'error');
        return;
    }

    try {
        const { error } = await context.supabase
            .from('shops')
            .update({
                ...socialData,
                updated_at: new Date().toISOString()
            })
            .eq('id', context.shop.id);
        if (error) throw error;
        showToast('Social media links saved!', 'success');
    } catch (error) {
        showToast(window.AsyncFeedback?.errorMessage(error, 'Your social links could not be saved. Please try again.', 'seller-social-links-save') || 'Your social links could not be saved. Please try again.', 'error');
    }
}

async function regenerateShopKey() {
    const newKey = generateShopKey();
    const keyInput = document.getElementById('shopKeyDisplay');
    
    const context = await getSupabaseSellerContext();
    if (!context) {
        showToast('Sign in with a shop owner account linked to a shop before regenerating the key.', 'error');
        return;
    }

    try {
        const { error } = await context.supabase
            .from('shops')
            .update({
                shop_key: newKey,
                updated_at: new Date().toISOString()
            })
            .eq('id', context.shop.id);
        if (error) throw error;
        currentShopKey = newKey;
        keyInput.value = shopKeyVisible ? newKey : maskShopKey(newKey);
        showToast('Shop key regenerated successfully!', 'success');
    } catch (error) {
        showToast(window.AsyncFeedback?.errorMessage(error, 'Your shop key could not be regenerated. Please try again.', 'seller-shop-key-regenerate') || 'Your shop key could not be regenerated. Please try again.', 'error');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    
    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match!', 'error');
        return;
    }
    
    if (newPassword.length < 8) {
        showToast('Password must be at least 8 characters!', 'error');
        return;
    }
    
    const supabase = window.SupabaseClient?.get();
    if (!supabase || !window.SupabaseClient?.isConfigured()) {
        showToast('Password changes require a live authenticated account.', 'error');
        return;
    }

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email && currentPassword) {
            const { error: verificationError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPassword
            });
            if (verificationError) throw new Error('Current password is incorrect.');
        }
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        document.getElementById('passwordForm').reset();
        showToast('Password updated successfully!', 'success');
    } catch (error) {
        showToast(window.AsyncFeedback?.errorMessage(error, 'Your password could not be updated. Please check your current password and try again.', 'seller-password-update') || 'Your password could not be updated. Please check your current password and try again.', 'error');
    }
}

function calculatePasswordStrength(password) {
    if (password.length < 6) return 'weak';
    
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    if (score <= 1) return 'weak';
    if (score <= 2) return 'medium';
    return 'strong';
}

let currentCoverageRegion = 'ng';
let selectedCoverageAreas = new Set();

const NIGERIAN_STATES = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
    'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
    'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa',
    'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
    'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
];

const UK_REGIONS = [
    'London', 'South East England', 'South West England',
    'East of England', 'East Midlands', 'West Midlands',
    'Yorkshire & The Humber', 'North West England', 'North East England',
    'Scotland', 'Wales', 'Northern Ireland'
];

function setCoverageRegion(region) {
    currentCoverageRegion = region;
    selectedCoverageAreas.clear();
    renderCoverageAreas();
    
    document.getElementById('coverageNgBtn')?.classList.toggle('btn-primary', region === 'ng');
    document.getElementById('coverageNgBtn')?.classList.toggle('btn-secondary', region !== 'ng');
    document.getElementById('coverageUkBtn')?.classList.toggle('btn-primary', region === 'uk');
    document.getElementById('coverageUkBtn')?.classList.toggle('btn-secondary', region !== 'uk');
}

function renderCoverageAreas() {
    const container = document.getElementById('coverageAreasList');
    if (!container) return;
    
    const areas = currentCoverageRegion === 'uk' ? UK_REGIONS : NIGERIAN_STATES;
    
    container.innerHTML = areas.map(area => `
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.625rem;background:var(--gray-50);border-radius:0.375rem;cursor:pointer;border:1.5px solid ${selectedCoverageAreas.has(area) ? 'var(--primary)' : 'var(--gray-200)'};transition:all 0.15s;font-size:0.85rem;">
            <input type="checkbox" ${selectedCoverageAreas.has(area) ? 'checked' : ''} 
                   onchange="toggleCoverageArea('${area}', this.checked)"
                   style="accent-color:var(--primary);">
            <span>${area}</span>
        </label>
    `).join('');
    
    updateCoverageCount();
}

function toggleCoverageArea(area, checked) {
    if (checked) {
        selectedCoverageAreas.add(area);
    } else {
        selectedCoverageAreas.delete(area);
    }
    renderCoverageAreas();
}

function updateCoverageCount() {
    const countEl = document.getElementById('coverageCount');
    if (countEl) {
        const count = selectedCoverageAreas.size;
        countEl.textContent = `${count} area${count !== 1 ? 's' : ''} selected`;
    }
}

function selectAllCoverage() {
    const areas = currentCoverageRegion === 'uk' ? UK_REGIONS : NIGERIAN_STATES;
    areas.forEach(a => selectedCoverageAreas.add(a));
    renderCoverageAreas();
}

function clearAllCoverage() {
    selectedCoverageAreas.clear();
    renderCoverageAreas();
}

async function saveCoverageAreas() {
    const areas = Array.from(selectedCoverageAreas);
    const context = await getSupabaseSellerContext();
    if (context) {
        const { error } = await context.supabase
            .from('shops')
            .update({ coverage_areas: areas, updated_at: new Date().toISOString() })
            .eq('id', context.shop.id);
        if (error) {
            showToast(window.AsyncFeedback?.errorMessage(error, 'Your coverage areas could not be saved. Please try again.', 'seller-coverage-save') || 'Your coverage areas could not be saved. Please try again.', 'error');
            return;
        }
        showToast(`Coverage areas saved! (${areas.length} area${areas.length !== 1 ? 's' : ''})`, 'success');
        return;
    }

    showToast('Sign in with a shop owner account linked to a shop before saving coverage areas.', 'error');
}

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        setCoverageRegion('ng');
    }, 100);
});
