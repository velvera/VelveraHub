import { getSeoSettings, renderSeoTags } from './_lib/seo.mjs';
import { surfaceRedirect } from './_lib/domains.mjs';

const SEO_TAG_PATTERN = /<title>[\s\S]*?<\/title>|<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|keywords|robots|googlebot|author|theme-color|twitter:[^"']+|og:[^"']+)[\"'][^>]*>\s*|<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>\s*|<script\b[^>]*data-velvera-seo[^>]*>[\s\S]*?<\/script>\s*/gi;

function injectMetadata(html, tags) {
    const cleaned = html.replace(SEO_TAG_PATTERN, '');
    return cleaned.replace(/<\/head>/i, `        ${tags}\n    </head>`);
}

function injectDomainRouting(html) {
    if (!html.includes('</head>') || html.includes('/assets/js/services/domain-routing.js')) return html;
    return html.replace(
        /<\/head>/i,
        '<script src="/assets/js/services/domain-routing.js"></script></head>'
    );
}

export async function onRequest(context) {
    const pathname = new URL(context.request.url).pathname;
    if (pathname.startsWith('/api/') || pathname.startsWith('/assets/') || pathname.startsWith('/img/')) {
        return context.next();
    }

    if (pathname === '/pages' || pathname.startsWith('/pages/')) {
        const destination = new URL(context.request.url);
        destination.pathname = pathname.replace(/^\/pages(?=\/|$)/, '/veeve');
        return Response.redirect(destination.toString(), 301);
    }

    const redirect = surfaceRedirect(context.request, pathname);
    if (redirect) return redirect;

    const response = await context.next();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const settings = await getSeoSettings(context);
    const body = injectMetadata(
        injectDomainRouting(await response.text()),
        renderSeoTags(settings, context.request.url)
    );
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-VelveraHub-SEO', 'supabase-managed');
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}