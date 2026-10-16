import { readSupabaseJson, supabaseRequest } from './supabase.mjs';
import { getSurface, publicOrigin } from './domains.mjs';

export const DEFAULT_SEO = {
    siteName: 'VelveraHub',
    title: 'VelveraHub — Smart marketplace for everyday shopping',
    description: 'VelveraHub is a trusted marketplace for discovering products from verified shops across Nigeria and the United Kingdom.',
    keywords: 'VelveraHub, online marketplace, Nigeria shopping, UK shopping, verified shops',
    canonicalBaseUrl: '',
    ogTitle: 'VelveraHub — Smart marketplace for everyday shopping',
    ogDescription: 'Discover products from verified shops across Nigeria and the United Kingdom.',
    ogImageUrl: '/img/velverahub.png',
    ogImageAlt: 'VelveraHub marketplace',
    twitterHandle: '',
    locale: 'en_GB',
    robots: 'index,follow',
    socialProfiles: []
};

function text(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizeRow(row, context) {
    const requestUrl = new URL(context.request.url);
    const surface = getSurface(context.request);
    const canonicalBaseUrl = (surface === 'ng' || surface === 'uk')
        ? publicOrigin(context.request)
        : text(row?.canonical_base_url, context.env.PUBLIC_SITE_URL || requestUrl.origin)
            .replace(/\/+$/, '');
    const siteName = text(row?.site_name, DEFAULT_SEO.siteName);
    const title = text(row?.meta_title, DEFAULT_SEO.title);
    const description = text(row?.meta_description, DEFAULT_SEO.description);
    const ogImageUrl = text(row?.og_image_url, DEFAULT_SEO.ogImageUrl);
    const socialProfiles = text(row?.social_profiles)
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => /^https?:\/\//i.test(value));

    return {
        siteName,
        title,
        description,
        keywords: text(row?.keywords, DEFAULT_SEO.keywords),
        canonicalBaseUrl,
        ogTitle: text(row?.og_title, title),
        ogDescription: text(row?.og_description, description),
        ogImageUrl: /^https?:\/\//i.test(ogImageUrl)
            ? ogImageUrl
            : `${canonicalBaseUrl}/${ogImageUrl.replace(/^\/+/, '')}`,
        ogImageAlt: text(row?.og_image_alt, DEFAULT_SEO.ogImageAlt),
        twitterHandle: text(row?.twitter_handle),
        locale: text(row?.locale, DEFAULT_SEO.locale),
        robots: surface === 'seller' || surface === 'admin'
            ? 'noindex,nofollow'
            : text(row?.robots, DEFAULT_SEO.robots),
        socialProfiles
    };
}

export async function getSeoSettings(context) {
    try {
        const response = await supabaseRequest(
            context,
            '/rest/v1/site_settings?id=eq.seo&select=site_name,meta_title,meta_description,keywords,canonical_base_url,og_title,og_description,og_image_url,og_image_alt,twitter_handle,locale,robots,social_profiles&limit=1'
        );
        if (response.ok) {
            const rows = await readSupabaseJson(response);
            return normalizeRow(Array.isArray(rows) ? rows[0] : null, context);
        }
    } catch (_) {
        // The default metadata must still make the page shareable if Supabase
        // is temporarily unavailable.
    }
    return normalizeRow(null, context);
}

export function canonicalUrl(settings, requestUrl) {
    const url = new URL(requestUrl);
    return `${settings.canonicalBaseUrl}${url.pathname || '/'}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderSeoTags(settings, requestUrl) {
    const url = canonicalUrl(settings, requestUrl);
    const image = settings.ogImageUrl;
    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization',
                name: settings.siteName,
                url: settings.canonicalBaseUrl,
                logo: image,
                sameAs: settings.socialProfiles
            },
            {
                '@type': 'WebSite',
                name: settings.siteName,
                url: settings.canonicalBaseUrl,
                potentialAction: {
                    '@type': 'SearchAction',
                    target: `${settings.canonicalBaseUrl}/veeve/products.html?q={search_term_string}`,
                    'query-input': 'required name=search_term_string'
                }
            }
        ]
    };

    const meta = [
        `<meta name="description" content="${escapeHtml(settings.description)}">`,
        `<meta name="keywords" content="${escapeHtml(settings.keywords)}">`,
        `<meta name="robots" content="${escapeHtml(settings.robots)}">`,
        `<meta name="googlebot" content="${escapeHtml(settings.robots)}">`,
        `<meta name="author" content="${escapeHtml(settings.siteName)}">`,
        `<meta name="theme-color" content="#1a0533">`,
        `<link rel="canonical" href="${escapeHtml(url)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="${escapeHtml(settings.siteName)}">`,
        `<meta property="og:locale" content="${escapeHtml(settings.locale)}">`,
        `<meta property="og:title" content="${escapeHtml(settings.ogTitle)}">`,
        `<meta property="og:description" content="${escapeHtml(settings.ogDescription)}">`,
        `<meta property="og:url" content="${escapeHtml(url)}">`,
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        `<meta property="og:image:secure_url" content="${escapeHtml(image)}">`,
        `<meta property="og:image:type" content="image/png">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta property="og:image:alt" content="${escapeHtml(settings.ogImageAlt)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${escapeHtml(settings.ogTitle)}">`,
        `<meta name="twitter:description" content="${escapeHtml(settings.ogDescription)}">`,
        `<meta name="twitter:image" content="${escapeHtml(image)}">`,
        `<meta name="twitter:image:alt" content="${escapeHtml(settings.ogImageAlt)}">`,
        settings.twitterHandle
            ? `<meta name="twitter:site" content="${escapeHtml(settings.twitterHandle)}"><meta name="twitter:creator" content="${escapeHtml(settings.twitterHandle)}">`
            : '',
        `<script type="application/ld+json" data-velvera-seo>${escapeJson(jsonLd)}</script>`
    ].filter(Boolean).join('\n        ');

    return `<title>${escapeHtml(settings.title)}</title>\n        ${meta}`;
}