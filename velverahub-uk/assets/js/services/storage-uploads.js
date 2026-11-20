/*
 * Supabase Storage uploads shared by the independent-listing and seller flows.
 * Files larger than 6 MB (6,000,000 bytes) use TUS with 6 MiB chunks.
 * The tus-js-client dependency is loaded on demand and pinned to a fixed version.
 */
(function (global) {
    'use strict';

    const STANDARD_UPLOAD_LIMIT_BYTES = 6_000_000;
    const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
    const TUS_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
    let tusClientPromise = null;

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

    function resumableUpload(projectUrl, anonKey, token, bucket, path, file, options, setTusUpload, onProgress, isCancelled) {
        return loadTusClient().then((tus) => new Promise((resolve, reject) => {
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
                onError: (error) => reject(isCancelled() ? abortError() : error),
                onProgress: (uploaded, total) => {
                    if (typeof onProgress === 'function' && total > 0) {
                        onProgress(Math.min(99, Math.round((uploaded / total) * 100)));
                    }
                },
                onSuccess: () => {
                    if (typeof onProgress === 'function') onProgress(100);
                    resolve({ data: { path, uploadUrl: upload.url }, error: null });
                }
            });
            setTusUpload(upload);
            upload.findPreviousUploads().then((previous) => {
                if (isCancelled()) {
                    upload.abort(true).catch(() => {});
                    reject(abortError());
                    return;
                }
                const match = previous.find((item) =>
                    item.metadata?.bucketName === bucket && item.metadata?.objectName === path
                );
                if (match) upload.resumeFromPreviousUpload(match);
                upload.start();
            }).catch(reject);
        }));
    }

    function upload(supabase, bucket, path, file, options = {}) {
        let xhr = null;
        let tusUpload = null;
        let cancelled = false;

        const promise = (async () => {
            if (!supabase?.auth?.getSession || !file || !Number.isFinite(file.size) || file.size < 1) {
                throw new Error('A signed-in user and a non-empty file are required.');
            }
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
                    (activeUpload) => { tusUpload = activeUpload; },
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
                if (cancelled) return;
                cancelled = true;
                if (tusUpload) tusUpload.abort(true).catch(() => {});
                if (xhr && xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
            }
        };
    }

    global.StorageUploadService = Object.freeze({
        upload,
        standardUploadLimitBytes: STANDARD_UPLOAD_LIMIT_BYTES,
        resumableChunkBytes: TUS_CHUNK_BYTES
    });
})(window);
