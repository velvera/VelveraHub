import { createPhoneVerificationHandler } from './core.mjs';

const handler = createPhoneVerificationHandler({
    env: Deno.env.toObject(),
    makeTicket: () => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    }
});

Deno.serve(handler);
