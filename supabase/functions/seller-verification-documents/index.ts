import { createClient } from 'npm:@supabase/supabase-js@2';
import { createSellerVerificationUploadHandler } from './core.mjs';

Deno.serve(createSellerVerificationUploadHandler({
    env: Deno.env.toObject(),
    createClient
}));
