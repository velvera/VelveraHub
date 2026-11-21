/*
 * Supabase Storage uploads shared by the independent-listing and seller flows.
 * Files larger than 6 MiB (6,291,456 bytes) use TUS with 6 MiB chunks.
 * The tus-js-client dependency is loaded on demand and pinned to a fixed version.
 */
(function (global) {
    'use strict';

    const STANDARD_UPLOAD_LIMIT_BYTES = 6 * 1024 * 1024;
    const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
    const TUS_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
    const PRODUCT_MEDIA_TYPES = Object.freeze({
        'product-images': Object.freeze({ 'image/webp': 'webp' }),
        'product-videos': Object.freeze({
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/quicktime': 'mov'
        })
    });
    let tusClientPromise = null;

    async function validateProductMediaContent(bucket, path, file, options) {
        const allowedTypes = PRODUCT_MEDIA_TYPES[bucket];
        if (!allowedTypes) return;

        const contentType = String(options.contentType || file.type || '').toLowerCase();
        const expectedExtension = allowedTypes[contentType];
        const actualExtension = String(path).split('.').pop()?.toLowerCase();
        if (!expectedExtension || actualExtension !== expectedExtension ||
            (file.type && String(file.type).toLowerCase() !== contentType)) {
            throw new Error('Choose a supported media format and try again.');
        }

        let bytes;
        try {
            if (typeof file.slice !== 'function') throw new Error('File bytes cannot be inspected.');
            bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        } catch (_) {
            throw new Error('This file could not be checked. Choose it again and retry.');
        }

        const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
        const isWebp = bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
        const isIsoBmff = bytes.length >= 12 && ascii(4, 4) === 'ftyp';
        const isWebm = bytes.length >= 4 &&
            bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
        const contentMatches = contentType === 'image/webp'
            ? isWebp
            : contentType === 'video/webm'
                ? isWebm
                : contentType === 'video/quicktime'
                    ? isIsoBmff && ascii(8, 4) === 'qt  '
                    : isIsoBmff;
        if (!contentMatches) {
            throw new Error('The file content does not match its selected media format.');
        }
    }

    function abortError() {
        const error = new Error('Upload cancelled.');
        error.name = 'AbortError';
        return error;
    }

    function publicConfig() {
        const config = global.VELVERAHUB_CONFIG || {};
        const url = String(config.SUPABASE_URL || '').replace(/\/+$/, '');
        const anonKey = String(config.SUPABASE_ANON_KEY || '');
        if (!url || !anonKey) throw new Error('Storage configuration is unavailable.');
        return { url, anonKey };
    }

    function tusEndpoint(projectUrl) {
        const parsed = new URL(projectUrl);
        const project = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
        const host = project
            ? `https://${project[1]}.storage.supabase.co`
            : parsed.origin;
        return `${host}/storage/v1/upload/resumable`;
    }

    function loadTusClient() {
        if (global.tus?.Upload) return Promise.resolve(global.tus);
        if (tusClientPromise) return tusClientPromise;

        tusClientPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = TUS_CLIENT_URL;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                if (global.tus?.Upload) resolve(global.tus);
                else reject(new Error('Resumable uploads could not be initialized.'));
            };
            script.onerror = () => reject(new Error('Resumable uploads are temporarily unavailable.'));
            document.head.appendChild(script);
        }).catch((error) => {
            tusClientPromise = null;
            throw error;
        });

        return tusClientPromise;
    }

    async function getAccessToken(supabase) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const token = data?.session?.access_token;
        if (!token) throw new Error('Sign in again before uploading files.');
        return token;
    }

    function objectEndpoint(projectUrl, bucket, path) {
        const encodedBucket = encodeURIComponent(bucket);
        const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
        return `${projectUrl}/storage/v1/object/${encodedBucket}/${encodedPath}`;
    }

    function standardUpload(projectUrl, anonKey, token, bucket, path, file, options, setXhr, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            setXhr(xhr);
            xhr.open('POST', objectEndpoint(projectUrl, bucket, path), true);
            xhr.setRequestHeader('apikey', anonKey);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', options.contentType || file.type || 'application/octet-stream');
            xhr.setRequestHeader('Cache-Control', options.cacheControl || '3600');
            if (options.upsert === true) xhr.setRequestHeader('x-upsert', 'true');
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable && typeof onProgress === 'function') {
                    onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
                }
            });
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (typeof onProgress === 'function') onProgress(100);
                    resolve({ data: { path }, error: null });
                    return;
                }
                let detail = '';
                try {
                    const body = JSON.parse(xhr.responseText || '{}');
                    detail = body.message || body.error || body.error_description || '';
                } catch (_) {
                    // Keep the message generic if Storage does not return JSON.
                }
                const error = new Error(detail || 'The file could not be uploaded.');
                error.status = xhr.status;
                error.statusCode = xhr.status;
                reject(error);
            };
            xhr.onerror = () => reject(new Error('The upload connection was interrupted. Try again.'));
            xhr.onabort = () => reject(abortError());
            xhr.send(file);
        });
    }

    function resumableUpload(projectUrl, anonKey, token, bucket, path, file, options, setCancelUpload, onProgress, isCancelled) {
        return loadTusClient().then((tus) => new Promise((resolve, reject) => {
            let settled = false;
            let cancellation = null;
            const rejectOnce = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const resolveOnce = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            const upload = new tus.Upload(file, {
                endpoint: tusEndpoint(projectUrl),
                retryDelays: [0, 3000, 5000, 10000, 20000],
                headers: {
                    apikey: anonKey,
                    authorization: `Bearer ${token}`
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                chunkSize: TUS_CHUNK_BYTES,
                metadata: {
                    bucketName: bucket,
                    objectName: path,
                    contentType: options.contentType || file.type || 'application/octet-stream',
                    cacheControl: options.cacheControl || '3600'
                },
                onError: (error) => {
                    if (isCancelled()) {
                        cancelUpload();
                        return;
                    }
                    rejectOnce(error);
                },
                onProgress: (uploaded, total) => {
                    if (typeof onProgress === 'function' && total > 0) {
                        onProgress(Math.min(99, Math.round((uploaded / total) * 100)));
                    }
                },
                onSuccess: () => {
                    if (isCancelled()) {
                        cancelUpload();
                        return;
                    }
                    if (typeof onProgress === 'function') onProgress(100);
                    resolveOnce({ data: { path, uploadUrl: upload.url }, error: null });
                }
            });
            function cancelUpload() {
                if (cancellation) return cancellation;
                cancellation = Promise.resolve()
                    .then(() => upload.abort(true))
                    .catch((error) => {
                        try {
                            options.onCancelCleanupError?.(error);
                        } catch (_) {
                            // A cleanup-reporting callback must not block cancellation.
                        }
                    })
                    .then(() => rejectOnce(abortError()));
                return cancellation;
            }
            setCancelUpload(cancelUpload);
            upload.findPreviousUploads().then((previous) => {
                if (isCancelled()) {
                    cancelUpload();
                    return;
                }
                const match = previous.find((item) =>
                    item.metadata?.bucketName === bucket && item.metadata?.objectName === path
                );
                if (match) upload.resumeFromPreviousUpload(match);
                upload.start();
            }).catch(rejectOnce);
        }));
    }

    function upload(supabase, bucket, path, file, options = {}) {
        let xhr = null;
        let cancelTusUpload = null;
        let cancelled = false;

        const promise = (async () => {
            if (!supabase?.auth?.getSession || !file || !Number.isFinite(file.size) || file.size < 1) {
                throw new Error('A signed-in user and a non-empty file are required.');
            }
            await validateProductMediaContent(bucket, path, file, options);
            const { url, anonKey } = publicConfig();
            const token = await getAccessToken(supabase);
            if (cancelled) throw abortError();
            const onProgress = options.onProgress;
            if (file.size > STANDARD_UPLOAD_LIMIT_BYTES) {
                return resumableUpload(
                    url,
                    anonKey,
                    token,
                    bucket,
                    path,
                    file,
                    options,
                    (cancelUpload) => { cancelTusUpload = cancelUpload; },
                    onProgress,
                    () => cancelled
                );
            }
            return standardUpload(
                url,
                anonKey,
                token,
                bucket,
                path,
                file,
                options,
                (activeXhr) => { xhr = activeXhr; },
                onProgress
            );
        })();

        return {
            promise,
            cancel() {
                if (cancelled) return cancelTusUpload?.() || Promise.resolve();
                cancelled = true;
                if (cancelTusUpload) return cancelTusUpload();
                if (xhr && xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
                return Promise.resolve();
            }
        };
    }

    global.StorageUploadService = Object.freeze({
        upload,
        standardUploadLimitBytes: STANDARD_UPLOAD_LIMIT_BYTES,
        resumableChunkBytes: TUS_CHUNK_BYTES
    });
})(window);
