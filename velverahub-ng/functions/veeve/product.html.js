const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG_ASSET_PATH = '/assets/js/services/publicSupabaseConfig.js';
const PRODUCT_DESCRIPTION_LIMIT = 280;

function parseJavaScriptString(source, name) {
    const match = source.match(new RegExp(
        `(?:const|let|var)\\s+${name}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')\\s*;`
    ));
    if (!match) return '';
    if (match[1].startsWith('"')) {
        try {
            return JSON.parse(match[1]);
        } catch (_) {
            return '';
        }
    }
    return match[1].slice(1, -1).replace(/\\(['\\])/g, '$1');
}

async function readPublicSupabaseConfig(context) {
    const configUrl = new URL(CONFIG_ASSET_PATH, context.request.url);
    const response = await context.env.ASSETS.fetch(configUrl);
    if (!response.ok) throw new Error('Public catalog configuration is unavailable');
    const source = await response.text();
    const url = parseJavaScriptString(source, 'SUPABASE_URL');
    const anonKey = parseJavaScriptString(source, 'SUPABASE_ANON_KEY');
    if (!url || !anonKey) throw new Error('Public catalog configuration is incomplete');
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') throw new Error('Catalog API must use HTTPS');
    return { url: parsedUrl, anonKey };
}

async function fetchProduct(context, id) {
    const config = await readPublicSupabaseConfig(context);
    const headers = {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        accept: 'application/json'
    };
    const productUrl = new URL('/rest/v1/products', config.url);
    productUrl.searchParams.set('select', 'id,title,description,price,category,location,stock,status');
    productUrl.searchParams.set('id', `eq.${id}`);
    productUrl.searchParams.set('status', 'eq.active');
    productUrl.searchParams.set('stock', 'gt.0');
    productUrl.searchParams.set('limit', '1');

    const productResponse = await fetch(productUrl, { headers });
    if (!productResponse.ok) throw new Error('Public product lookup failed');
    const [product] = await productResponse.json();
    if (!product) return null;

    const featureResponse = await fetch(new URL('/rest/v1/rpc/get_phone_verification_enabled', config.url), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}'
    });
    let phoneVerificationEnabled = false;
    if (featureResponse.ok) {
        try {
            phoneVerificationEnabled = (await featureResponse.json()) === true;
        } catch (_) {}
    }

    const imageUrl = new URL('/rest/v1/product_images', config.url);
    imageUrl.searchParams.set('select', 'url,alt_text,is_primary,display_order');
    imageUrl.searchParams.set('product_id', `eq.${id}`);
    imageUrl.searchParams.set('order', 'is_primary.desc,display_order.asc');
    imageUrl.searchParams.set('limit', '12');
    const imagesResponse = await fetch(imageUrl, { headers });
    const images = imagesResponse.ok ? await imagesResponse.json() : [];
    return {
        product: { ...product, product_images: Array.isArray(images) ? images : [] },
        config,
        phoneVerificationEnabled
    };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertMeta(html, attribute, key, value) {
    const escapedKey = escapeRegExp(key);
    const pattern = new RegExp(
        `<meta\\b(?=[^>]*\\b${attribute}\\s*=\\s*["']${escapedKey}["'])[^>]*>`,
        'i'
    );
    const content = escapeHtml(value);
    const match = html.match(pattern);
    if (match) {
        const contentPattern = /\bcontent\s*=\s*(["'])[\s\S]*?\1/i;
        const updated = contentPattern.test(match[0])
            ? match[0].replace(contentPattern, `content="${content}"`)
            : match[0].replace(/\s*\/?>$/, ` content="${content}">`);
        return html.replace(match[0], updated);
    }
    const tag = `    <meta ${attribute}="${escapeHtml(key)}" content="${content}">`;
    return html.includes('</head>') ? html.replace('</head>', `${tag}\n</head>`) : html;
}

function upsertCanonical(html, url) {
    const pattern = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i;
    const match = html.match(pattern);
    if (match) {
        const updated = match[0].replace(/\bhref\s*=\s*(["'])[\s\S]*?\1/i, `href="${escapeHtml(url)}"`);
        return html.replace(match[0], updated);
    }
    const tag = `    <link rel="canonical" href="${escapeHtml(url)}">`;
    return html.includes('</head>') ? html.replace('</head>', `${tag}\n</head>`) : html;
}

function productImage(product, origin, override = '') {
    if (override) return override;
    const candidate = (product.product_images || [])
        .filter((image) => image?.url && image.alt_text !== 'video' && !/\.(mp4|webm|mov)(?:\?|$)/i.test(image.url))
        .sort((a, b) =>
            Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
            || Number(a.display_order || 0) - Number(b.display_order || 0)
        )[0]?.url;
    try {
        const url = new URL(candidate || '/img/logo.png', origin);
        if (url.protocol === 'https:' || url.origin === origin) return url.href;
    } catch (_) {}
    return new URL('/img/logo.png', origin).href;
}

async function signProductImage(config, product, origin) {
    const candidate = productImage(product, origin);
    if (!candidate || candidate === new URL('/img/logo.png', origin).href) return '';
    try {
        const image = new URL(candidate, origin);
        if (image.origin !== config.url.origin) return candidate;
        const match = image.pathname.match(
            /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(product-images|product-videos)\/(.+)$/
        );
        if (!match) return candidate;

        const objectPath = decodeURIComponent(match[2]);
        const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
        const signEndpoint = new URL(
            `/storage/v1/object/sign/${match[1]}/${encodedPath}`,
            config.url
        );
        const response = await fetch(signEndpoint, {
            method: 'POST',
            headers: {
                apikey: config.anonKey,
                authorization: `Bearer ${config.anonKey}`,
                'content-type': 'application/json',
                accept: 'application/json'
            },
            body: JSON.stringify({ expiresIn: 3600 })
        });
        if (!response.ok) return candidate;
        const payload = await response.json();
        const signed = payload?.signedURL || payload?.signedUrl;
        if (typeof signed === 'string' && signed) {
            const signedUrl = /^https?:\/\//i.test(signed)
                ? new URL(signed)
                : new URL(
                    signed.startsWith('/storage/v1/')
                        ? signed
                        : `/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`,
                    config.url
                );
            return signedUrl.origin === config.url.origin ? signedUrl.href : candidate;
        }
        if (typeof payload?.token === 'string' && payload.token) {
            signEndpoint.searchParams.set('token', payload.token);
            return signEndpoint.href;
        }
    } catch (_) {}
    return candidate;
}

function regionPricing(product, hostname) {
    const isUk = hostname === 'velverahub.co.uk' || hostname.endsWith('.velverahub.co.uk');
    const rawAmount = Number(product.price);
    if (!Number.isFinite(rawAmount) || rawAmount < 0) return { currency: isUk ? 'GBP' : 'NGN', amount: '', formatted: '' };
    if (isUk) {
        const amount = rawAmount * 0.79;
        return {
            currency: 'GBP',
            amount: amount.toFixed(2),
            formatted: `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        };
    }
    const amount = Math.round(rawAmount * 900);
    return {
        currency: 'NGN',
        amount: String(amount),
        formatted: `₦${amount.toLocaleString('en-NG')}`
    };
}

function buildProductDescription(product, formattedPrice) {
    const detail = String(product.description || product.category || 'View this marketplace listing.')
        .replace(/\s+/g, ' ')
        .trim();
    const location = String(product.location || '').trim();
    return [
        product.title || 'Marketplace listing',
        formattedPrice ? `Price: ${formattedPrice}.` : '',
        location ? `Location: ${location}.` : '',
        detail
    ].filter(Boolean).join(' ').slice(0, PRODUCT_DESCRIPTION_LIMIT);
}

function renderProductMetadata(html, product, requestUrl, imageOverride = '') {
    const canonical = new URL(requestUrl.pathname, requestUrl.origin);
    canonical.searchParams.set('id', product.id);
    const pricing = regionPricing(product, requestUrl.hostname);
    const description = buildProductDescription(product, pricing.formatted);
    const image = productImage(product, requestUrl.origin, imageOverride);
    const title = `${product.title || 'Marketplace listing'} - VelveraHub`;
    const values = [
        ['name', 'description', description],
        ['property', 'og:type', 'product'],
        ['property', 'og:site_name', 'VelveraHub'],
        ['property', 'og:title', title],
        ['property', 'og:description', description],
        ['property', 'og:url', canonical.href],
        ['property', 'og:image', image],
        ['property', 'og:image:alt', product.title || 'VelveraHub product'],
        ['property', 'product:price:amount', pricing.amount],
        ['property', 'product:price:currency', pricing.currency],
        ['name', 'twitter:card', 'summary_large_image'],
        ['name', 'twitter:title', title],
        ['name', 'twitter:description', description],
        ['name', 'twitter:image', image],
        ['name', 'twitter:url', canonical.href]
    ];

    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    for (const [attribute, key, value] of values) html = upsertMeta(html, attribute, key, value);
    return upsertCanonical(html, canonical.href);
}

export async function onRequest(context) {
    const { request } = context;
    const staticResponse = await context.next();
    if (request.method !== 'GET' ||
        !staticResponse.ok ||
        !staticResponse.headers.get('content-type')?.toLowerCase().includes('text/html')) {
        return staticResponse;
    }

    const id = new URL(request.url).searchParams.get('id') || '';
    if (!UUID_PATTERN.test(id)) return staticResponse;

    let product;
    try {
        const result = await fetchProduct(context, id);
        if (result) {
            product = result.product;
            if (result.phoneVerificationEnabled) {
                product.metadataImage = await signProductImage(
                    result.config,
                    product,
                    new URL(request.url).origin
                );
            }
        }
    } catch (_) {
        return staticResponse;
    }
    if (!product) return staticResponse;

    const html = renderProductMetadata(
        await staticResponse.text(),
        product,
        new URL(request.url),
        product.metadataImage || ''
    );
    const headers = new Headers(staticResponse.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
    return new Response(html, {
        status: staticResponse.status,
        statusText: staticResponse.statusText,
        headers
    });
}
