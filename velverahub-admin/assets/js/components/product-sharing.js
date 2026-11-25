(function () {
    'use strict';

    const PRODUCT_DESCRIPTION_LIMIT = 280;

    function canonicalUrl(productId) {
        const url = new URL(window.location.pathname, window.location.origin);
        url.searchParams.set('id', String(productId || ''));
        return url.href;
    }

    function setMeta(selector, attribute, key, value) {
        let element = document.head.querySelector(selector);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute(attribute, key);
            document.head.appendChild(element);
        }
        element.setAttribute('content', String(value || ''));
    }

    function setProductMetadata({ product, price, url, imageUrl, currency, amount }) {
        const title = `${product.title || 'Marketplace listing'} - VelveraHub`;
        const description = [
            product.title || 'Marketplace listing',
            price ? `Price: ${price}.` : '',
            String(product.description || '').replace(/\s+/g, ' ').trim()
        ].filter(Boolean).join(' ').slice(0, PRODUCT_DESCRIPTION_LIMIT);
        const canonical = url || canonicalUrl(product.id);
        const image = imageUrl || new URL('/img/logo.png', window.location.origin).href;

        document.title = title;
        setMeta('meta[name="description"]', 'name', 'description', description);
        setMeta('meta[property="og:type"]', 'property', 'og:type', 'product');
        setMeta('meta[property="og:title"]', 'property', 'og:title', title);
        setMeta('meta[property="og:description"]', 'property', 'og:description', description);
        setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
        setMeta('meta[property="og:image"]', 'property', 'og:image', image);
        setMeta('meta[property="og:image:alt"]', 'property', 'og:image:alt', product.title || 'VelveraHub product');
        setMeta('meta[property="product:price:amount"]', 'property', 'product:price:amount', amount);
        setMeta('meta[property="product:price:currency"]', 'property', 'product:price:currency', currency);
        setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
        setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
        setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
        setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', image);
        setMeta('meta[name="twitter:url"]', 'name', 'twitter:url', canonical);

        let canonicalLink = document.head.querySelector('link[rel="canonical"]');
        if (!canonicalLink) {
            canonicalLink = document.createElement('link');
            canonicalLink.rel = 'canonical';
            document.head.appendChild(canonicalLink);
        }
        canonicalLink.href = canonical;
    }

    async function copyText(text) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {
                // Continue to the copy-command fallback when the browser
                // exposes Clipboard API but denies this write.
            }
        }

        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.left = '-9999px';
        document.body.appendChild(field);
        field.select();
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } finally {
            field.remove();
        }
        return copied;
    }

    function bindShareButton(button, { url }) {
        if (!button || button.dataset.shareBound === 'true') return;
        button.dataset.noProcessing = 'true';
        button.classList.add('copy-action');
        const status = document.getElementById('productShareStatus');
        const announce = (message) => {
            if (status) status.textContent = message;
        };

        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const copied = await copyText(url);
                announce(
                    copied ? 'Product link copied to clipboard.' : 'Could not copy the link. Select and copy the address from your browser.'
                );
            } catch (_) {
                announce('Could not share this product. Please copy the address from your browser.');
            } finally {
                button.disabled = false;
            }
        });
        button.dataset.shareBound = 'true';
    }

    window.VelveraProductSharing = Object.freeze({
        canonicalUrl,
        setProductMetadata,
        bindShareButton
    });
})();
