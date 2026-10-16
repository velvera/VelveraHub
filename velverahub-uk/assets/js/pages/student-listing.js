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
    const MAX_MEDIA_FILES = 6;
    const MAX_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
    const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
    const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

    function mediaSelectionError(files) {
        if (files.length > MAX_MEDIA_FILES) return 'Choose no more than six photos or videos for one listing.';
        for (const file of files) {
            if (IMAGE_TYPES.has(file.type)) {
                if (!file.size) return 'Selected images cannot be empty files.';
                if (file.size > MAX_IMAGE_INPUT_BYTES) return 'Each photo must be 8 MB or smaller before compression.';
            } else if (VIDEO_TYPES.has(file.type)) {
                if (!file.size) return 'Selected videos cannot be empty files.';
                if (file.size > MAX_VIDEO_BYTES) return 'Each video must be 50 MB or smaller.';
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

    function populateSchools(state) {
        const schools = window.CampusService?.getByState(state) || [];
        schoolSelect.innerHTML = '<option value="">Choose an institution</option>' +
            schools.map((school) => `<option value="${school.slug}">${school.name} · ${school.city}</option>`).join('');
        schoolSelect.disabled = !schools.length;
        window.CustomSelect?.refresh(schoolSelect);
    }

    function compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_INPUT_BYTES) {
                reject(new Error('Choose a JPEG, PNG, or WebP photo up to 8 MB.'));
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read an image.'));
            reader.onload = () => {
                const image = new Image();
                image.onerror = () => reject(new Error('Could not process an image.'));
                image.onload = () => {
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
                                    file.type === 'image/webp' && file.size <= MAX_IMAGE_UPLOAD_BYTES) {
                                    resolve(file);
                                    return;
                                }
                                if (!blob || blob.type !== 'image/webp') {
                                    reject(new Error('This browser cannot convert photos to WebP. Update your browser and try again.'));
                                    return;
                                }
                                if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) {
                                    resolve(blob);
                                    return;
                                }
                            }
                            maxDimension = Math.max(320, Math.floor(maxDimension * 0.8));
                        }
                        reject(new Error('This photo remains larger than the 5 MB upload limit after compression.'));
                    })().catch(reject);
                };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function readVideo(file) {
        if (!VIDEO_TYPES.has(file.type) || !file.size || file.size > MAX_VIDEO_BYTES) {
            throw new Error('Choose an MP4, WebM, or QuickTime video between 1 byte and 50 MB.');
        }
        // Upload the File directly instead of expanding large videos into base64
        // strings, which uses substantially more memory on mobile devices.
        return file;
    }

    async function uploadMedia(supabase, blob, productId, mediaType) {
        const allowedTypes = mediaType === 'video' ? VIDEO_TYPES : new Set(['image/webp']);
        const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_UPLOAD_BYTES;
        if (!allowedTypes.has(blob.type) || !blob.size || blob.size > maxBytes) {
            throw new Error('This file does not meet the marketplace upload limits.');
        }
        if (!window.crypto?.randomUUID) {
            throw new Error('Secure file naming is unavailable in this browser. Open the site over HTTPS and try again.');
        }
        const extension = mediaType === 'video'
            ? (blob.type === 'video/webm' ? 'webm' : blob.type === 'video/quicktime' ? 'mov' : 'mp4')
            : 'webp';
        const path = `${productId}/${window.crypto.randomUUID()}.${extension}`;
        const bucket = mediaType === 'video' ? 'product-videos' : 'product-images';
        try {
            const result = await supabase.storage.from(bucket).upload(path, blob, {
                contentType: blob.type,
                cacheControl: '3600',
                upsert: false
            });
            if (result.error) throw result.error;
        } catch (error) {
            const requestId = window.AsyncFeedback?.createRequestId('student-listing-media-upload') || 'media-upload';
            const diagnostic = window.Observability?.formatErrorDiagnostic?.(error) ||
                'Storage request failed; diagnostic formatter is unavailable.';
            const status = Number(error?.statusCode ?? error?.status);
            console.error('[VelveraHub] Product media upload failed', {
                requestId,
                bucket,
                mediaType,
                httpStatus: Number.isFinite(status) && status > 0 ? status : null,
                diagnostic
            });
            window.AsyncFeedback?.log('student-listing-media-upload', requestId, error, {
                source: 'storage-upload',
                action: 'student-listing-media-upload',
                bucket,
                mediaType,
                stage: 'upload'
            });
            throw error;
        }
        const publicUrl = supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl;
        if (!publicUrl) {
            try {
                const cleanup = await supabase.storage.from(bucket).remove([path]);
                if (cleanup.error) window.AsyncFeedback?.log('student-listing-media-cleanup', window.AsyncFeedback?.createRequestId('student-listing-media-cleanup'), cleanup.error);
            } catch (error) {
                window.AsyncFeedback?.log('student-listing-media-cleanup', window.AsyncFeedback?.createRequestId('student-listing-media-cleanup'), error);
            }
            throw new Error('The uploaded media could not be prepared for this listing.');
        }
        return { bucket, path, url: publicUrl, mediaType };
    }

    function submissionErrorMessage(error, stage) {
        const details = [
            error?.message,
            error?.details,
            error?.hint,
            error?.code,
            error?.statusCode
        ].filter(Boolean).join(' ').toLowerCase();

        if (/row-level security|42501|permission denied|not authorized|unauthorized|access denied/.test(details)) {
            const target = stage === 'media metadata'
                ? 'listing image records'
                : 'Supabase Storage';
            return `The listing was blocked while saving ${target} permissions. Apply database/supabase-rls.sql to the live Supabase project, then retry.`;
        }
        if (/bucket.*not found|bucket.*does not exist|storage bucket/.test(details)) {
            return 'The listing image/video storage bucket is missing or misconfigured. Apply database/supabase-rls.sql to the live Supabase project.';
        }
        if (/payload too large|entity too large|file size|maximum.*size/.test(details)) {
            return 'A photo or video exceeds the live storage limit. Choose smaller media and try again.';
        }
        if (/secure file naming|https and try again|cannot convert photos|cannot process|remains larger than/.test(details)) {
            return error.message;
        }
        if (stage === 'media preparation' && error?.message) return error.message;
        if (stage === 'media upload' || stage === 'media metadata') {
            return 'Your media could not be saved. Check your connection and the live Supabase Storage policies, then try again.';
        }
        return 'Your listing could not be published. Please check the details and try again.';
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
        imageInput.addEventListener('change', () => {
            const files = Array.from(imageInput.files || []);
            const validationError = mediaSelectionError(files);
            if (validationError) {
                preview.hidden = true;
                preview.innerHTML = '';
                setStatus(validationError, 'error');
                imageInput.value = '';
                return;
            }
            setStatus('');
            preview.hidden = !files.length;
            preview.innerHTML = files.length ? `<i class="fas fa-photo-film"></i><span>${files.length} photo${files.length === 1 ? '' : 's'} or video${files.length === 1 ? '' : 's'} selected</span>` : '';
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
            const uploadedMedia = [];
            try {
                const profile = window.AuthService?.getProfile() || {};
                const data = new FormData(form);
                const price = Number(data.get('price'));
                const stock = Number(data.get('stock'));
                if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 1) throw new Error('Enter a valid price and available quantity.');
                const selectedFiles = Array.from(imageInput.files || []);
                const selectionError = mediaSelectionError(selectedFiles);
                if (selectionError) throw new Error(selectionError);
                const preparedMedia = [];
                failureStage = 'media preparation';
                for (const file of selectedFiles) {
                    if (IMAGE_TYPES.has(file.type)) {
                        preparedMedia.push({ blob: await compressImage(file), mediaType: 'image' });
                    } else {
                        preparedMedia.push({ blob: readVideo(file), mediaType: 'video' });
                    }
                }
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
                for (const item of preparedMedia) uploadedMedia.push(await uploadMedia(supabase, item.blob, productId, item.mediaType));
                if (uploadedMedia.length) {
                    failureStage = 'media metadata';
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
                preview.innerHTML = '';
                if (adReferenceWrap) adReferenceWrap.hidden = true;
                if (boostPayment) boostPayment.hidden = true;
                schoolSelect.innerHTML = '<option value="">Choose a state first</option>';
                schoolSelect.disabled = true;
                window.CustomSelect?.refresh(stateSelect);
                window.CustomSelect?.refresh(schoolSelect);
            } catch (error) {
                window.Observability?.track('seller_publish_error', { action: 'student_listing' });
                window.AsyncFeedback?.log('student-listing-submit', window.AsyncFeedback?.createRequestId('student-listing-submit'), error, {
                    source: 'listing-submit',
                    action: 'student-listing'
                });
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
                const cleanupFailed = cleanupMediaFailed || cleanupProductFailed || cleanupErrorCode === '42702';
                setStatus(cleanupFailed
                    ? 'Your listing was not published, and some temporary files could not be removed. Please contact support before retrying.'
                    : submissionErrorMessage(error, failureStage), 'error');
            } finally {
                submit.disabled = false;
                submit.innerHTML = '<i class="fas fa-paper-plane"></i> Publish listing';
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();