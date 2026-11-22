(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const stateSelect = $('listingState');
    const schoolSelect = $('listingSchool');
    const form = $('studentListingForm');
    const status = $('listingStatus');
    const gate = $('listingAuthGate');
    const formWrap = $('listingFormWrap');
    const imageInput = $('listingImages');
    const preview = $('listingImagePreview');
    const boostInput = $('listingBoost');
    const boostPayment = $('listingBoostPayment');
    const adReferenceWrap = $('listingAdReferenceWrap');
    const adReference = $('listingAdReference');
    const MAX_IMAGE_INPUT_BYTES = 40 * 1024 * 1024;
    const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
    let marketplaceMediaLimitsPromise = null;
    let mediaProgressRows = [];
    let activeMediaUploadTasks = [];

    async function loadMarketplaceMediaLimits(supabase) {
        if (!supabase) throw new Error('Marketplace upload settings are unavailable.');
        if (!marketplaceMediaLimitsPromise) {
            marketplaceMediaLimitsPromise = (async () => {
                const { data, error } = await supabase.rpc('get_marketplace_media_limits');
                if (error) throw error;
                const limits = {
                    student_listing_media_limit: Number(data?.student_listing_media_limit),
                    product_image_max_bytes: Number(data?.product_image_max_bytes),
                    product_video_max_bytes: Number(data?.product_video_max_bytes)
                };
                if (
                    !Number.isInteger(limits.student_listing_media_limit) ||
                    limits.student_listing_media_limit < 1 ||
                    limits.student_listing_media_limit > 100 ||
                    !Number.isSafeInteger(limits.product_image_max_bytes) ||
                    limits.product_image_max_bytes < 5 * 1024 * 1024 ||
                    limits.product_image_max_bytes > 40 * 1024 * 1024 ||
                    !Number.isSafeInteger(limits.product_video_max_bytes) ||
                    limits.product_video_max_bytes < 5 * 1024 * 1024 ||
                    limits.product_video_max_bytes > 40 * 1024 * 1024
                ) {
                    throw new Error('Marketplace upload settings are invalid. Contact the administrator.');
                }
                return limits;
            })();
        }
        const request = marketplaceMediaLimitsPromise;
        try {
            return await request;
        } finally {
            if (marketplaceMediaLimitsPromise === request) marketplaceMediaLimitsPromise = null;
        }
    }

    function mediaSelectionError(files, limits) {
        if (!limits) return 'Marketplace upload settings are unavailable. Refresh and try again.';
        if (files.length > limits.student_listing_media_limit) {
            return `Choose no more than ${limits.student_listing_media_limit} photos or videos for one listing.`;
        }
        for (const file of files) {
            if (IMAGE_TYPES.has(file.type)) {
                if (!file.size) return 'Selected images cannot be empty files.';
                if (file.size > MAX_IMAGE_INPUT_BYTES) return 'Each original photo must be 40 MiB or smaller before compression.';
            } else if (VIDEO_TYPES.has(file.type)) {
                if (!file.size) return 'Selected videos cannot be empty files.';
                if (file.size > limits.product_video_max_bytes) {
                    return `Each video must be ${Math.floor(limits.product_video_max_bytes / 1048576)} MiB or smaller.`;
                }
            } else {
                return 'Use JPEG, PNG, or WebP photos, or MP4, WebM, or QuickTime videos.';
            }
        }
        return '';
    }

    function setStatus(message, type) {
        status.textContent = message || '';
        status.style.color = type === 'error' ? '#b42318' :
            type === 'success' ? '#087443' : type === 'warning' ? '#8a5a00' : '';
    }

    function renderMediaProgress(files) {
        preview.replaceChildren();
        mediaProgressRows = [];
        if (!files.length) {
            preview.hidden = true;
            return;
        }

        const list = document.createElement('ul');
        list.className = 'campus-media-upload-list';
        for (const file of files) {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = file.name || 'Selected file';
            const progress = document.createElement('progress');
            progress.max = 100;
            progress.value = 0;
            progress.setAttribute('aria-label', `Upload progress for ${file.name || 'selected file'}`);
            const state = document.createElement('span');
            state.textContent = 'Ready to upload';
            row.append(name, progress, state);
            list.appendChild(row);
            mediaProgressRows.push({ progress, state });
        }

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-secondary';
        cancel.textContent = 'Cancel uploads';
        cancel.hidden = true;
        cancel.addEventListener('click', () => {
            activeMediaUploadTasks.forEach((task) => task.cancel());
            setStatus('Cancelling uploads…', 'warning');
        });
        preview.append(list, cancel);
        preview.hidden = false;
    }

    function updateMediaProgress(index, percent, message) {
        const row = mediaProgressRows[index];
        if (!row) return;
        row.progress.value = Math.max(0, Math.min(100, Number(percent) || 0));
        row.state.textContent = message || `${Math.round(row.progress.value)}%`;
    }

    function setMediaUploadActive(active) {
        const cancel = preview.querySelector('button');
        if (cancel) cancel.hidden = !active;
    }

    function populateSchools(state) {
        const schools = window.CampusService?.getByState(state) || [];
        schoolSelect.innerHTML = '<option value="">Choose an institution</option>' +
            schools.map((school) => `<option value="${school.slug}">${school.name} · ${school.city}</option>`).join('');
        schoolSelect.disabled = !schools.length;
        window.CustomSelect?.refresh(schoolSelect);
    }

    function compressImage(file, limits) {
        return new Promise((resolve, reject) => {
            if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_INPUT_BYTES) {
                reject(new Error('Choose a JPEG, PNG, or WebP photo up to 40 MiB.'));
                return;
            }
            const image = new Image();
            const objectUrl = URL.createObjectURL(file);
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Could not process an image.'));
            };
            image.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (!context) {
                        reject(new Error('This photo could not be processed by your browser.'));
                        return;
                    }
                    const resize = (maxDimension) => {
                        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                        context.drawImage(image, 0, 0, canvas.width, canvas.height);
                    };
                    const encode = (quality) => new Promise((done) => {
                        canvas.toBlob(done, 'image/webp', quality);
                    });
                    (async () => {
                        let maxDimension = 1400;
                        for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
                            resize(maxDimension);
                            for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) {
                                const blob = await encode(quality);
                                if ((!blob || blob.type !== 'image/webp') &&
                                    file.type === 'image/webp' && file.size <= limits.product_image_max_bytes) {
                                    resolve(file);
                                    return;
                                }
                                if (!blob || blob.type !== 'image/webp') {
                                    reject(new Error('This browser cannot convert photos to WebP. Update your browser and try again.'));
                                    return;
                                }
                                if (blob.size <= limits.product_image_max_bytes) {
                                    resolve(blob);
                                    return;
                                }
                            }
                            maxDimension = Math.max(320, Math.floor(maxDimension * 0.8));
                        }
                        reject(new Error(`This photo remains larger than the ${Math.floor(limits.product_image_max_bytes / 1048576)} MiB upload limit after compression.`));
                    })().catch(reject);
            };
            image.src = objectUrl;
        });
    }

    function readVideo(file, limits) {
        if (!VIDEO_TYPES.has(file.type) || !file.size || file.size > limits.product_video_max_bytes) {
            throw new Error(`Choose an MP4, WebM, or QuickTime video no larger than ${Math.floor(limits.product_video_max_bytes / 1048576)} MiB.`);
        }
        // Upload the File directly instead of expanding large videos into base64
        // strings, which uses substantially more memory on mobile devices.
        return file;
    }

    function uploadMedia(supabase, blob, productId, mediaType, mediaCount = 1, limits, onProgress, onCancelCleanupError) {
        const allowedTypes = mediaType === 'video' ? VIDEO_TYPES : new Set(['image/webp']);
        const maxBytes = mediaType === 'video' ? limits.product_video_max_bytes : limits.product_image_max_bytes;
        if (!allowedTypes.has(blob.type) || !blob.size || blob.size > maxBytes) {
            return { promise: Promise.reject(new Error('This file does not meet the marketplace upload limits.')), cancel() {} };
        }
        if (!window.crypto?.randomUUID) {
            return { promise: Promise.reject(new Error('Secure file naming is unavailable in this browser. Open the site over HTTPS and try again.')), cancel() {} };
        }
        const extension = mediaType === 'video'
            ? (blob.type === 'video/webm' ? 'webm' : blob.type === 'video/quicktime' ? 'mov' : 'mp4')
            : 'webp';
        const path = `${productId}/${window.crypto.randomUUID()}.${extension}`;
        const bucket = mediaType === 'video' ? 'product-videos' : 'product-images';
        if (!window.StorageUploadService?.upload) {
            return { promise: Promise.reject(new Error('The secure upload service is unavailable. Refresh and try again.')), cancel() {} };
        }
        const task = window.StorageUploadService.upload(supabase, bucket, path, blob, {
            contentType: blob.type,
            cacheControl: '3600',
            upsert: false,
            onProgress,
            onCancelCleanupError
        });
        const promise = task.promise.then(async (result) => {
            if (result.error) throw result.error;
            const publicUrl = supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl;
            if (!publicUrl) {
                const cleanup = await supabase.storage.from(bucket).remove([path]);
                if (cleanup.error) {
                    window.AsyncFeedback?.log(
                        'student-listing-media-cleanup',
                        window.AsyncFeedback?.createRequestId('student-listing-media-cleanup'),
                        cleanup.error
                    );
                }
                throw new Error('The uploaded media could not be prepared for this listing.');
            }
            return { bucket, path, url: publicUrl, mediaType };
        }).catch((error) => {
            const requestId = window.AsyncFeedback?.createRequestId('student-listing-media-upload') || 'media-upload';
            const diagnostic = window.Observability?.formatErrorDiagnostic?.(error) ||
                'Storage request failed; diagnostic formatter is unavailable.';
            const status = Number(error?.statusCode ?? error?.status);
            console.error('[VelveraHub] Product media upload failed', {
                requestId,
                bucket,
                mediaType,
                mediaCount,
                httpStatus: Number.isFinite(status) && status > 0 ? status : null,
                diagnostic
            });
            window.AsyncFeedback?.log('student-listing-media-upload', requestId, error, {
                source: 'storage-upload',
                action: 'student-listing-media-upload',
                bucket,
                mediaType,
                stage: 'upload',
                mediaCount
            });
            throw error;
        });
        return { promise, cancel: task.cancel };
    }

    function submissionErrorMessage(error, stage, requestId) {
        if (error?.name === 'AbortError') {
            return 'The upload was cancelled. Your listing was not published, and your details are still on this page.';
        }
        const details = [
            error?.message,
            error?.details,
            error?.hint,
            error?.code,
            error?.statusCode
        ].filter(Boolean).join(' ').toLowerCase();
        const statusCode = Number(error?.statusCode ?? error?.status);
        const safeStatus = Number.isFinite(statusCode) && statusCode > 0 ? `HTTP ${statusCode}` : '';
        const safeCode = typeof error?.code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(error.code)
            ? `code ${error.code}`
            : '';
        const diagnosticSuffix = [safeStatus, safeCode].filter(Boolean).join(', ');
        const statusSuffix = diagnosticSuffix ? ` (${diagnosticSuffix})` : '';
        const requestSuffix = requestId ? ` Reference: ${requestId}.` : '';

        if (statusCode === 402 || /\b402\b|service restriction/.test(details)) {
            return `Supabase restricted this media request. Check the project's organization usage and billing status.${statusSuffix}${requestSuffix}`;
        }
        if (/bucket.*not found|bucket.*does not exist|storage bucket/.test(details)) {
            return `The media storage bucket was not found or is unavailable.${statusSuffix}${requestSuffix}`;
        }
        if (/payload too large|entity too large|file size|maximum.*size/.test(details)) {
            return `A photo or video exceeds the current storage file limit. Choose a smaller file and retry.${statusSuffix}${requestSuffix}`;
        }
        if (/secure file naming|https and try again|cannot convert photos|cannot process|remains larger than/.test(details)) {
            return error.message;
        }
        if (stage === 'media preparation' && error?.message) return error.message;
        if (stage === 'media upload') {
            if (/row-level security|42501|permission denied|not authorized|unauthorized|access denied/.test(details)) {
                return `Supabase denied the photo upload to product storage. Check the signed-in seller's upload permissions.${statusSuffix}${requestSuffix}`;
            }
            return `The photo failed during its Supabase Storage upload. Check the project's usage, bucket limits, and connection.${statusSuffix}${requestSuffix}`;
        }
        if (stage === 'media metadata') {
            if (/row-level security|42501|permission denied|not authorized|unauthorized|access denied/.test(details)) {
                return `The photo upload reached the listing-record step, but Supabase denied saving its product image record. Check product image permissions and triggers.${statusSuffix}${requestSuffix}`;
            }
            return `The photo upload reached the listing-record step, but saving the product image record failed.${statusSuffix}${requestSuffix}`;
        }
        if (/row-level security|42501|permission denied|not authorized|unauthorized|access denied/.test(details)) {
            return `Supabase denied the ${stage || 'listing'} request.${statusSuffix}${requestSuffix}`;
        }
        return `Your listing could not be published. Check the details and try again.${statusSuffix}${requestSuffix}`;
    }

    async function removeUploadedMedia(supabase, uploaded) {
        const byBucket = new Map();
        let failed = false;
        let errorCode = null;
        for (const item of uploaded) {
            if (!byBucket.has(item.bucket)) byBucket.set(item.bucket, []);
            byBucket.get(item.bucket).push(item.path);
        }
        for (const [bucket, paths] of byBucket) {
            try {
                const { error } = await supabase.storage.from(bucket).remove(paths);
                if (error) {
                    failed = true;
                    errorCode = errorCode || error.code || null;
                    window.AsyncFeedback?.log('student-listing-media-cleanup', window.AsyncFeedback?.createRequestId('student-listing-media-cleanup'), error);
                }
            } catch (error) {
                failed = true;
                errorCode = errorCode || error?.code || null;
                window.AsyncFeedback?.log('student-listing-media-cleanup', window.AsyncFeedback?.createRequestId('student-listing-media-cleanup'), error);
            }
        }
        return { failed, errorCode };
    }

    function profileName(profile, user) {
        const name = [profile?.first_name || profile?.firstName, profile?.last_name || profile?.lastName].filter(Boolean).join(' ');
        return name || profile?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student seller';
    }

    async function init() {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        if (window.AuthService) await window.AuthService.init();
        const user = window.AuthService?.getUser();
        gate.hidden = Boolean(user);
        formWrap.hidden = !user;
        if (!user) return;

        stateSelect.innerHTML = '<option value="">Choose a state</option>' +
            (window.RegionService?.getNigerianStates() || []).map((state) => `<option value="${state}">${state === 'FCT (Abuja)' ? 'Abuja (FCT)' : state}</option>`).join('');
        window.CustomSelect?.refresh(stateSelect);
        const savedSchool = window.RegionService?.school;
        if (savedSchool) {
            stateSelect.value = savedSchool.state;
            window.CustomSelect?.refresh(stateSelect);
            populateSchools(savedSchool.state);
            schoolSelect.value = savedSchool.slug;
            window.CustomSelect?.refresh(schoolSelect);
        }
        window.CampusService?.ready?.then(() => {
            if (stateSelect.value) populateSchools(stateSelect.value);
        });
        stateSelect.addEventListener('change', () => populateSchools(stateSelect.value));
        boostInput?.addEventListener('change', async () => {
            const enabled = boostInput.checked;
            if (adReferenceWrap) adReferenceWrap.hidden = !enabled;
            if (adReference) adReference.required = enabled;
            if (!enabled) {
                if (boostPayment) boostPayment.hidden = true;
                return;
            }
            try {
                const supabase = window.SupabaseClient?.get();
                if (!supabase || !window.SupabaseClient.isConfigured()) {
                    throw new Error('Marketplace payment details are unavailable.');
                }
                const { data: settings, error } = await supabase
                    .from('advertisement_settings')
                    .select('amount_ngn, bank_name, account_name, account_number, instructions')
                    .limit(1)
                    .maybeSingle();
                if (error) throw error;
                if (!settings || !Number.isFinite(Number(settings.amount_ngn)) ||
                    !settings.bank_name || !settings.account_name || !settings.account_number) {
                    throw new Error('The administrator has not configured complete boost payment details yet.');
                }
                if (boostPayment) {
                    const amount = document.createElement('strong');
                    amount.textContent = `Pay ₦${Number(settings.amount_ngn).toLocaleString('en-NG')} to the admin account`;
                    const details = document.createElement('span');
                    details.textContent = `${settings.bank_name} · ${settings.account_name} · ${settings.account_number}`;
                    const instructions = document.createElement('small');
                    instructions.textContent = settings.instructions || 'Complete the transfer before submitting your reference.';
                    boostPayment.replaceChildren(amount, details, instructions);
                    boostPayment.hidden = false;
                }
            } catch (error) {
                window.AsyncFeedback?.log('student-listing-payment-settings', window.AsyncFeedback?.createRequestId('student-listing-payment-settings'), error);
                if (boostPayment) {
                    boostPayment.textContent = 'Payment details could not be loaded. Please try again before submitting.';
                    boostPayment.hidden = false;
                }
            }
        });
        imageInput.addEventListener('change', async () => {
            const files = Array.from(imageInput.files || []);
            if (!files.length) {
                renderMediaProgress([]);
                setStatus('');
                return;
            }
            setStatus('Checking current upload limits…');
            try {
                const limits = await loadMarketplaceMediaLimits(window.SupabaseClient?.get());
                const mediaHelp = $('listingMediaLimitHelp');
                if (mediaHelp) {
                    mediaHelp.textContent = `Current limit: ${limits.student_listing_media_limit} files per listing; compressed photos up to ${Math.floor(limits.product_image_max_bytes / 1048576)} MiB; videos up to ${Math.floor(limits.product_video_max_bytes / 1048576)} MiB. Original photos may be up to 40 MiB.`;
                }
                const validationError = mediaSelectionError(files, limits);
                if (validationError) {
                    preview.hidden = true;
                    preview.replaceChildren();
                    mediaProgressRows = [];
                    setStatus(validationError, 'error');
                    imageInput.value = '';
                    return;
                }
            } catch (error) {
                preview.hidden = true;
                preview.replaceChildren();
                mediaProgressRows = [];
                setStatus(window.AsyncFeedback?.errorMessage(
                    error,
                    'Marketplace upload settings could not be loaded. Refresh and try again.',
                    'student-listing-media-settings'
                ) || 'Marketplace upload settings could not be loaded. Refresh and try again.', 'error');
                imageInput.value = '';
                return;
            }
            setStatus('');
            renderMediaProgress(files);
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            setStatus('');
            if (!form.reportValidity()) return;
            const selectedSchool = window.CampusService?.find(schoolSelect.value);
            const listingType = new FormData(form).get('listingType');
            const supabase = window.SupabaseClient?.get();
            if (!supabase || !window.SupabaseClient.isConfigured()) {
                const error = new Error('Marketplace database client is not configured.');
                window.AsyncFeedback?.log('student-listing-config', window.AsyncFeedback?.createRequestId('student-listing-config'), error);
                return setStatus('Listing submission is temporarily unavailable. Please try again later.', 'error');
            }

            const submit = $('publishListingBtn');
            submit.disabled = true;
            submit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing…';
            let productId = null;
            let failureStage = 'listing details';
            let failureMediaType = '';
            let failureMediaCount = 0;
            let cancelledUploadCleanupFailed = false;
            const uploadedMedia = [];
            activeMediaUploadTasks = [];
            try {
                failureStage = 'media settings';
                const mediaLimits = await loadMarketplaceMediaLimits(supabase);
                const profile = window.AuthService?.getProfile() || {};
                const data = new FormData(form);
                const price = Number(data.get('price'));
                const stock = Number(data.get('stock'));
                if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 1) throw new Error('Enter a valid price and available quantity.');
                const selectedFiles = Array.from(imageInput.files || []);
                failureMediaCount = selectedFiles.length;
                const selectionError = mediaSelectionError(selectedFiles, mediaLimits);
                if (selectionError) throw new Error(selectionError);
                const preparedMedia = [];
                failureStage = 'media preparation';
                for (const file of selectedFiles) {
                    if (IMAGE_TYPES.has(file.type)) {
                        failureMediaType = 'image';
                        preparedMedia.push({ blob: await compressImage(file, mediaLimits), mediaType: 'image' });
                    } else {
                        failureMediaType = 'video';
                        preparedMedia.push({ blob: readVideo(file, mediaLimits), mediaType: 'video' });
                    }
                }
                failureMediaType = [...new Set(preparedMedia.map((item) => item.mediaType))].join(',') || failureMediaType;
                const product = {
                    shop_id: null,
                    seller_id: user.id,
                    seller_display_name: profileName(profile, user),
                    seller_avatar_url: profile.avatar_url || user.user_metadata?.avatar_url || null,
                    listing_type: listingType,
                    title: String(data.get('title')).trim(),
                    category: data.get('category'),
                    condition: data.get('condition'),
                    // Products are stored in the app's base unit and rendered
                    // through RegionService (NGN uses its conversion factor).
                    price: window.RegionService?.region === 'ng'
                        ? price / (window.RegionService.conversionFactor || 1)
                        : price,
                    stock,
                    location: data.get('location'),
                     school_slug: selectedSchool?.slug || null,
                     school_name: selectedSchool?.name || null,
                     school_city: selectedSchool?.city || null,
                    campus_area: String(data.get('campus_area') || '').trim() || null,
                    description: String(data.get('description')).trim(),
                    short_description: String(data.get('description')).trim().slice(0, 150),
                     specifications: {
                         contact: String(data.get('contact') || '').trim() || null,
                         policy_acknowledged_at: new Date().toISOString()
                     },
                    // Availability status is separate from listing moderation:
                    // the item stays hidden from buyers until an admin approves it.
                    status: 'draft',
                    moderation_status: 'pending'
                };
                failureStage = 'listing creation';
                const inserted = await supabase.from('products').insert(product).select('id').single();
                if (inserted.error) throw inserted.error;
                productId = inserted.data.id;
                failureStage = 'media upload';
                setMediaUploadActive(true);
                for (let index = 0; index < preparedMedia.length; index += 1) {
                    const item = preparedMedia[index];
                    failureMediaType = item.mediaType;
                    updateMediaProgress(index, 0, 'Starting upload');
                    const task = uploadMedia(
                        supabase,
                        item.blob,
                        productId,
                        item.mediaType,
                        failureMediaCount,
                        mediaLimits,
                        (percent) => updateMediaProgress(index, percent, `Uploading ${percent}%`),
                        (cleanupError) => {
                            cancelledUploadCleanupFailed = true;
                            window.AsyncFeedback?.log(
                                'student-listing-media-cancel',
                                window.AsyncFeedback?.createRequestId('student-listing-media-cancel'),
                                cleanupError,
                                {
                                    source: 'storage-upload',
                                    action: 'cancel',
                                    bucket: item.mediaType === 'video' ? 'product-videos' : 'product-images',
                                    mediaType: item.mediaType,
                                    stage: 'cancel-cleanup'
                                }
                            );
                        }
                    );
                    activeMediaUploadTasks.push(task);
                    try {
                        uploadedMedia.push(await task.promise);
                        updateMediaProgress(index, 100, 'Uploaded');
                    } finally {
                        activeMediaUploadTasks = activeMediaUploadTasks.filter((activeTask) => activeTask !== task);
                    }
                }
                setMediaUploadActive(false);
                if (uploadedMedia.length) {
                    failureStage = 'media metadata';
                    failureMediaType = [...new Set(uploadedMedia.map((item) => item.mediaType))].join(',') || failureMediaType;
                    const imageResult = await supabase.from('product_images').insert(uploadedMedia.map((item, index) => ({
                        product_id: productId,
                        url: item.url,
                        alt_text: item.mediaType,
                        is_primary: item.mediaType === 'image' && !uploadedMedia.slice(0, index).some((previous) => previous.mediaType === 'image'),
                        display_order: index
                    })));
                    if (imageResult.error) throw imageResult.error;
                }
                failureStage = 'listing publication';
                const published = await supabase.from('products')
                        .update({ status: 'active', moderation_status: 'pending' })
                    .eq('id', productId)
                    .eq('seller_id', user.id)
                    .eq('status', 'draft')
                    .select('id')
                    .single();
                if (published.error) throw published.error;
                if (!published.data?.id) throw new Error('The listing could not be made live. Please try again.');

                let adMessage = '';
                let adNeedsAttention = false;
                if (boostInput?.checked) {
                    try {
                        const { error: adError } = await supabase.rpc('seller_submit_advertisement', {
                            p_product_id: productId,
                            p_payment_reference: String(data.get('ad_reference') || '').trim()
                        });
                        if (adError) throw adError;
                        adMessage = ' Your boost request is pending admin payment approval.';
                    } catch (error) {
                        window.AsyncFeedback?.log('student-listing-boost', window.AsyncFeedback?.createRequestId('student-listing-boost'), error);
                        adNeedsAttention = true;
                        adMessage = ' The listing is awaiting review, but the boost request could not be submitted. You can review it from your account.';
                    }
                }
                setStatus(`Your listing was submitted for review. Buyers will see it after it is approved.${adMessage}`, adNeedsAttention ? 'warning' : 'success');
                if (!adNeedsAttention) {
                    window.setTimeout(() => {
                        window.location.assign('/pages/seller.html?view=notifications');
                    }, 1400);
                }
                form.reset();
                preview.hidden = true;
                preview.replaceChildren();
                mediaProgressRows = [];
                if (adReferenceWrap) adReferenceWrap.hidden = true;
                if (boostPayment) boostPayment.hidden = true;
                schoolSelect.innerHTML = '<option value="">Choose a state first</option>';
                schoolSelect.disabled = true;
                window.CustomSelect?.refresh(stateSelect);
                window.CustomSelect?.refresh(schoolSelect);
            } catch (error) {
                window.Observability?.track('seller_publish_error', { action: 'student_listing' });
                const requestId = window.AsyncFeedback?.createRequestId('student-listing-submit') || 'student-listing-submit';
                window.AsyncFeedback?.log('student-listing-submit', requestId, error, {
                    source: 'listing-submit',
                    action: 'student-listing',
                    stage: failureStage,
                    mediaType: failureMediaType,
                    mediaCount: failureMediaCount
                });
                if (failureStage === 'media metadata') {
                    const statusCode = Number(error?.statusCode ?? error?.status);
                    console.error('[VelveraHub] Listing media metadata insert failed', {
                        requestId,
                        stage: failureStage,
                        mediaType: failureMediaType || null,
                        mediaCount: failureMediaCount,
                        httpStatus: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : null,
                        diagnostic: window.Observability?.formatErrorDiagnostic?.(error) ||
                            'The product_images insert failed; diagnostic formatter is unavailable.'
                    });
                }
                let cleanupMediaFailed = false;
                let cleanupErrorCode = null;
                if (uploadedMedia.length) {
                    const cleanup = await removeUploadedMedia(supabase, uploadedMedia);
                    cleanupMediaFailed = cleanup.failed;
                    cleanupErrorCode = cleanup.errorCode;
                }
                let cleanupProductFailed = false;
                if (productId) {
                    try {
                        const cleanup = await supabase.from('products')
                            .delete()
                            .eq('id', productId)
                            .eq('seller_id', user.id)
                            .eq('status', 'draft');
                        cleanupProductFailed = Boolean(cleanup.error);
                    } catch (_) {
                        cleanupProductFailed = true;
                    }
                }
                const cleanupFailed = cleanupMediaFailed || cleanupProductFailed ||
                    cancelledUploadCleanupFailed || cleanupErrorCode === '42702';
                setStatus(cleanupFailed
                    ? `Your listing was not published, and some temporary files could not be removed. Please contact support before retrying. Reference: ${requestId}.`
                    : submissionErrorMessage(error, failureStage, requestId), 'error');
            } finally {
                activeMediaUploadTasks.forEach((task) => task.cancel());
                activeMediaUploadTasks = [];
                setMediaUploadActive(false);
                submit.disabled = false;
                submit.innerHTML = '<i class="fas fa-paper-plane"></i> Publish listing';
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();