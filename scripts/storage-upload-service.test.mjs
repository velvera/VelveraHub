import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/services/storage-uploads.js', import.meta.url), 'utf8');
const progress = [];
const xhrInstances = [];
const tusInstances = [];

class MockXhr {
    static DONE = 4;

    constructor() {
        this.headers = {};
        this.uploadListeners = {};
        this.upload = {
            addEventListener: (name, callback) => { this.uploadListeners[name] = callback; }
        };
        xhrInstances.push(this);
    }

    open(method, url) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader(name, value) {
        this.headers[name] = value;
    }

    send(file) {
        this.file = file;
        this.status = 200;
        this.responseText = '{}';
        this.uploadListeners.progress?.({ lengthComputable: true, loaded: file.size, total: file.size });
        this.onload();
    }

    abort() {
        this.readyState = MockXhr.DONE;
        this.onabort?.();
    }
}

class MockTusUpload {
    constructor(file, options) {
        this.file = file;
        this.options = options;
        tusInstances.push(this);
    }

    findPreviousUploads() {
        return Promise.resolve([{
            metadata: { bucketName: 'product-videos', objectName: 'another-product/other-video.mp4' }
        }]);
    }

    resumeFromPreviousUpload() {
        this.resumedFromWrongObject = true;
    }

    start() {
        this.url = 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/session';
        this.options.onProgress(this.file.size, this.file.size);
        this.options.onSuccess();
    }

    abort() {
        return Promise.resolve();
    }
}

const window = {
    VELVERAHUB_CONFIG: {
        SUPABASE_URL: 'https://project-ref.supabase.co',
        SUPABASE_ANON_KEY: 'public-test-key'
    },
    tus: null
};
const document = {
    createElement: () => ({}),
    head: {
        appendChild(script) {
            window.tus = { Upload: MockTusUpload };
            script.onload();
        }
    }
};
const context = { window, document, URL, XMLHttpRequest: MockXhr, console, Promise, Error, encodeURIComponent };
vm.runInNewContext(source, context);

const supabase = {
    auth: {
        getSession: async () => ({
            data: { session: { access_token: 'signed-in-user-token' } },
            error: null
        })
    }
};
const smallFile = { size: 1024, type: 'image/webp', name: 'small.webp' };
const standardTask = window.StorageUploadService.upload(
    supabase,
    'product-images',
    'product-id/image-id.webp',
    smallFile,
    { contentType: smallFile.type, onProgress: (value) => progress.push(value) }
);
const standardResult = await standardTask.promise;
assert.equal(standardResult.data.path, 'product-id/image-id.webp');
assert.equal(xhrInstances[0].method, 'POST');
assert.match(xhrInstances[0].url, /\/storage\/v1\/object\/product-images\/product-id\/image-id\.webp$/);
assert.equal(xhrInstances[0].headers.Authorization, 'Bearer signed-in-user-token');
assert.deepEqual(progress, [99, 100]);

const sixMiBFile = { size: 6 * 1024 * 1024, type: 'image/webp', name: 'six-mib.webp' };
const sixMiBTask = window.StorageUploadService.upload(
    supabase,
    'product-images',
    'product-id/six-mib.webp',
    sixMiBFile,
    { contentType: sixMiBFile.type }
);
await sixMiBTask.promise;
assert.equal(xhrInstances.length, 2, 'a file exactly 6 MiB stays on standard upload');

const largeFile = { size: (6 * 1024 * 1024) + 1, type: 'video/mp4', name: 'large.mp4' };
const tusTask = window.StorageUploadService.upload(
    supabase,
    'product-videos',
    'product-id/video-id.mp4',
    largeFile,
    { contentType: largeFile.type, onProgress: (value) => progress.push(value) }
);
const tusResult = await tusTask.promise;
assert.equal(tusResult.data.path, 'product-id/video-id.mp4');
assert.equal(tusInstances.length, 1);
assert.equal(tusInstances[0].options.endpoint, 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable');
assert.equal(tusInstances[0].options.chunkSize, 6 * 1024 * 1024);
assert.deepEqual(Array.from(tusInstances[0].options.retryDelays), [0, 3000, 5000, 10000, 20000]);
assert.equal(tusInstances[0].options.metadata.bucketName, 'product-videos');
assert.equal(tusInstances[0].options.metadata.objectName, 'product-id/video-id.mp4');
assert.equal(tusInstances[0].resumedFromWrongObject, undefined, 'a previous upload for another object must never be resumed');
assert.equal(progress.at(-1), 100);
assert.equal(tusInstances[0].file.size, (6 * 1024 * 1024) + 1, 'the first byte above 6 MiB uses TUS');
assert.equal(window.StorageUploadService.standardUploadLimitBytes, 6 * 1024 * 1024);

console.log('PASS 6 MiB upload boundary, TUS routing, direct hostname, retries, and progress callbacks');
