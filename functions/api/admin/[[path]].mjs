import {
    callRpc,
    errorResponse,
    getPath,
    handleOptions,
    json,
    readSupabaseJson,
    requireRole,
    supabaseRequest
} from '../../_lib/supabase.mjs';

async function branding(context, method) {
    if (method === 'GET') {
        const response = await supabaseRequest(context, '/rest/v1/site_settings?id=eq.branding&select=logo_url,logo_version&limit=1');
        const rows = await readSupabaseJson(response);
        const row = Array.isArray(rows) ? rows[0] : null;
        return json(context.request, { logoUrl: row?.logo_url || null });
    }

    if (method === 'DELETE') {
        const response = await supabaseRequest(context, '/rest/v1/site_settings?id=eq.branding', {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ logo_url: null, logo_version: Date.now() })
        });
        if (!response.ok) throw Object.assign(new Error('Branding could not be removed.'), { status: response.status });
        return json(context.request, { ok: true, logoUrl: null });
    }

    if (method !== 'PUT') return json(context.request, { error: 'Method not allowed' }, 405);
    const body = await context.request.json();
    const match = String(body.dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw Object.assign(new Error('Only PNG logos are supported.'), { status: 400 });
    const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    if (bytes.byteLength > 1.5 * 1024 * 1024) throw Object.assign(new Error('Logo must be 1.5 MB or smaller.'), { status: 400 });
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (pngSignature.some((value, index) => bytes[index] !== value)) {
        throw Object.assign(new Error('The uploaded file is not a valid PNG.'), { status: 400 });
    }

    const path = `site/logo-${Date.now()}.png`;
    const upload = await supabaseRequest(context, `/storage/v1/object/branding/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
        body: bytes
    });
    if (!upload.ok) throw Object.assign(new Error('Logo upload failed.'), { status: upload.status });

    const { url } = getPublicStorageUrl(context, path);
    const save = await supabaseRequest(context, '/rest/v1/site_settings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: 'branding', logo_url: url, logo_version: Date.now() })
    });
    if (!save.ok) throw Object.assign(new Error('Logo metadata could not be saved.'), { status: save.status });
    return json(context.request, { ok: true, logoUrl: url });
}

function getPublicStorageUrl(context, path) {
    const base = String(context.env.SUPABASE_URL || '').replace(/\/+$/, '');
    return { url: `${base}/storage/v1/object/public/branding/${path}` };
}

export async function onRequest(context) {
    const options = handleOptions(context.request);
    if (options) return options;

    try {
        await requireRole(context, 'admin');
        const path = getPath(context);
        const resource = path[0];
        const identifier = path[1];
        const action = path[2];
        if (resource === 'branding') return await branding(context, context.request.method);
        const methods = {
            stats: () => callRpc(context, 'admin_stats'),
            shops: () => callRpc(context, 'admin_list_shops', { p_status: null, p_rental_status: null, p_limit: 100, p_offset: 0 }),
            users: () => callRpc(context, 'admin_list_users'),
            'rental-contracts': () => callRpc(context, 'admin_list_rental_contracts'),
            advertisements: () => callRpc(context, 'admin_list_advertisements'),
            'advertisement-settings': async () => {
                if (context.request.method === 'GET') return callRpc(context, 'admin_get_advertisement_settings');
                const body = await context.request.json();
                return callRpc(context, 'admin_save_advertisement_settings', {
                    p_bank_name: body.bankName,
                    p_account_name: body.accountName,
                    p_account_number: body.accountNumber,
                    p_instructions: body.instructions || ''
                });
            }
        };

        if (resource === 'shops' && identifier && action === 'assign' && context.request.method === 'POST') {
            const body = await context.request.json();
            return json(context.request, await callRpc(context, 'admin_assign_shop', {
                p_shop_id: identifier,
                p_user_id: body.userId,
                p_start_date: body.startDate,
                p_end_date: body.endDate,
                p_monthly_rent: body.monthlyRent
            }));
        }

        if (resource === 'shops' && context.request.method === 'GET') {
            const url = new URL(context.request.url);
            return json(context.request, await callRpc(context, 'admin_list_shops', {
                p_status: url.searchParams.get('status'),
                p_rental_status: url.searchParams.get('rental_status'),
                p_limit: Math.min(Number(url.searchParams.get('limit') || 50), 100),
                p_offset: Number(url.searchParams.get('offset') || 0)
            }));
        }

        if (resource === 'shops' && identifier && action && context.request.method === 'POST') {
            if (action === 'revoke') return json(context.request, await callRpc(context, 'admin_revoke_shop', { p_shop_id: identifier }));
            if (action === 'renew') {
                const body = await context.request.json();
                return json(context.request, await callRpc(context, 'admin_renew_shop', {
                    p_shop_id: identifier,
                    p_new_end_date: body.newEndDate,
                    p_monthly_rent: body.monthlyRent
                }));
            }
        }

        if (resource === 'advertisements' && identifier && context.request.method === 'PUT') {
            const body = await context.request.json();
            return json(context.request, await callRpc(context, 'admin_review_advertisement', {
                p_request_id: identifier,
                p_status: body.status,
                p_review_note: body.reviewNote || ''
            }));
        }

        if (resource === 'branding') return await branding(context, context.request.method);
        if (resource === 'seo') {
            if (context.request.method === 'GET') {
                return json(context.request, await callRpc(context, 'admin_get_seo_settings'));
            }
            if (context.request.method === 'PUT') {
                const body = await context.request.json();
                return json(context.request, await callRpc(context, 'admin_save_seo_settings', {
                    p_site_name: body.siteName,
                    p_meta_title: body.title,
                    p_meta_description: body.description,
                    p_keywords: body.keywords,
                    p_canonical_base_url: body.canonicalBaseUrl,
                    p_og_title: body.ogTitle,
                    p_og_description: body.ogDescription,
                    p_og_image_url: body.ogImageUrl,
                    p_og_image_alt: body.ogImageAlt,
                    p_twitter_handle: body.twitterHandle,
                    p_locale: body.locale,
                    p_robots: body.robots,
                    p_social_profiles: body.socialProfiles
                }));
            }
            return json(context.request, { error: 'Method not allowed' }, 405);
        }
        if (methods[resource]) return json(context.request, await methods[resource]());
        return json(context.request, { error: 'Not found' }, 404);
    } catch (error) {
        return errorResponse(context.request, error);
    }
}