import { getSeoSettings, renderSeoTags } from '../_lib/seo.mjs';
import { handleOptions, json } from '../_lib/supabase.mjs';

export async function onRequest(context) {
    const options = handleOptions(context.request);
    if (options) return options;
    if (context.request.method !== 'GET') {
        return json(context.request, { error: 'Method not allowed' }, 405);
    }

    const settings = await getSeoSettings(context);
    return json(context.request, {
        ...settings,
        tags: renderSeoTags(settings, context.request.url)
    });
}