import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/services/storage-uploads.js', import.meta.url), 'utf8');
const progress = [];
const xhrInstances = [];
const tusInstances = [];

function mediaFile(size, type, name, signature) {
    return {
        size,
        type,
        name,
        slice(start, end) {
            return new Blob([signature.slice(start, end)]);
        }
    };
}

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
        this.started = true;
        this.url = 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/session';
        if (MockTusUpload.holdNextStart) {
            MockTusUpload.holdNextStart = false;
            return;
        }
        this.options.onProgress(this.file.size, this.file.size);
        this.options.onSuccess();
    }

    abort(shouldTerminate) {
        this.abortArgument = shouldTerminate;
        return MockTusUpload.abortFailure
            ? Promise.reject(MockTusUpload.abortFailure)
            : Promise.resolve();
    }
}
MockTusUpload.holdNextStart = false;
MockTusUpload.abortFailure = null;

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
const webpSignature = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
]);
const mp4Signature = Uint8Array.from([
    0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d
]);
const webmSignature = Uint8Array.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);
const quicktimeSignature = Uint8Array.from([
    0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20
]);
const smallFile = mediaFile(1024, 'image/webp', 'small.webp', webpSignature);
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

const sixMiBFile = mediaFile(6 * 1024 * 1024, 'image/webp', 'six-mib.webp', webpSignature);
const sixMiBTask = window.StorageUploadService.upload(
    supabase,
    'product-images',
    'product-id/six-mib.webp',
    sixMiBFile,
    { contentType: sixMiBFile.type }
);
await sixMiBTask.promise;
assert.equal(xhrInstances.length, 2, 'a file exactly 6 MiB stays on standard upload');

const largeFile = mediaFile((6 * 1024 * 1024) + 1, 'video/mp4', 'large.mp4', mp4Signature);
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

const mismatchedFile = mediaFile(
    (6 * 1024 * 1024) + 1,
    'video/mp4',
    'fake.mp4',
    webmSignature
);
const mismatchedTask = window.StorageUploadService.upload(
    supabase,
    'product-videos',
    'product-id/fake.mp4',
    mismatchedFile,
    { contentType: mismatchedFile.type }
);
await assert.rejects(mismatchedTask.promise, /content does not match/);
assert.equal(tusInstances.length, 1, 'invalid media bytes must be rejected before creating a TUS upload');

for (const [type, extension, signature] of [
    ['video/webm', 'webm', webmSignature],
    ['video/quicktime', 'mov', quicktimeSignature]
]) {
    const file = mediaFile((6 * 1024 * 1024) + 1, type, `sample.${extension}`, signature);
    const task = window.StorageUploadService.upload(
        supabase,
        'product-videos',
        `product-id/sample.${extension}`,
        file,
        { contentType: type }
    );
    await task.promise;
}
assert.equal(tusInstances.length, 3, 'valid WebM and QuickTime signatures should use TUS');

MockTusUpload.holdNextStart = true;
MockTusUpload.abortFailure = new Error('simulated termination failure');
let cleanupFailure = null;
const cancellableFile = mediaFile(
    (6 * 1024 * 1024) + 1,
    'video/mp4',
    'cancel.mp4',
    mp4Signature
);
const cancellableTask = window.StorageUploadService.upload(
    supabase,
    'product-videos',
    'product-id/cancel.mp4',
    cancellableFile,
    {
        contentType: cancellableFile.type,
        onCancelCleanupError: (error) => { cleanupFailure = error; }
    }
);
await new Promise((resolve) => setTimeout(resolve, 0));
const activeTusUpload = tusInstances.at(-1);
assert.equal(activeTusUpload.started, true, 'the cancellable TUS test must reach an active upload');
await cancellableTask.cancel();
await assert.rejects(cancellableTask.promise, (error) => error.name === 'AbortError');
assert.equal(activeTusUpload.abortArgument, true, 'cancellation should request server-side TUS termination');
assert.match(cleanupFailure?.message || '', /termination failure/);
MockTusUpload.abortFailure = null;

console.log('PASS media signatures, 6 MiB upload boundary, TUS routing, retries, and progress callbacks');
