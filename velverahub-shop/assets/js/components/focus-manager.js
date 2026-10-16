/*
 * Shared focus and status management for storefront overlays.
 *
 * Overlay code can call open/close explicitly, while the observer below also
 * covers dynamically injected and legacy surfaces that only toggle an active
 * class. This keeps focus restoration consistent across the separate HTML
 * entry points.
 */
(function () {
    'use strict';

    if (window.VelveraFocusManager) return;

    const FOCUSABLE = [
        'a[href]', 'area[href]', 'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])', 'textarea:not([disabled])',
        'iframe', 'object', 'embed', '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const OVERLAY_SELECTOR = [
        '.modal.active',
        '.region-modal.active',
        '.cart-sidebar.active',
        '.mobile-menu.active',
        '.cs-panel.is-open'
    ].join(',');
    const STATUS_SELECTOR = [
        '[role="status"]',
        '[aria-live]',
        '.location-empty-state',
        '.empty-state',
        '.empty-page',
        '.page-loading',
        '.table-empty',
        '.shops-directory-status'
    ].join(',');
    const records = new WeakMap();
    const managedOverlays = new Set();
    let activeTrap = null;
    let liveRegion = null;
    let announceTimer = null;
    let lastAnnouncement = '';

    function isVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getAttribute('aria-hidden') !== 'true';
    }

    function focusableWithin(container) {
        return Array.from(container.querySelectorAll(FOCUSABLE))
            .filter((element) => isVisible(element));
    }

    function ensureLiveRegion() {
        if (liveRegion?.isConnected) return liveRegion;
        liveRegion = document.createElement('div');
        liveRegion.className = 'a11y-live-region';
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.setAttribute('data-focus-manager-live', 'true');
        document.body?.appendChild(liveRegion);
        return liveRegion;
    }

    function announce(message) {
        const text = String(message || '').replace(/\s+/g, ' ').trim();
        if (!text || text === lastAnnouncement) return;
        lastAnnouncement = text;
        window.clearTimeout(announceTimer);
        announceTimer = window.setTimeout(() => {
            const region = ensureLiveRegion();
            if (!region) return;
            region.textContent = '';
            window.requestAnimationFrame(() => {
                region.textContent = text;
            });
        }, 80);
    }

    function shouldTrap(container, requested) {
        if (requested === false) return false;
        if (container.matches('.cs-location-panel')) {
            return window.matchMedia('(max-width: 768px)').matches;
        }
        return requested === true || container.matches(
            '.modal, .region-modal, .cart-sidebar, .mobile-menu'
        );
    }

    function focusInitial(container, initialFocus) {
        const target = typeof initialFocus === 'function'
            ? initialFocus(container)
            : initialFocus;
        const first = target && isVisible(target)
            ? target
            : focusableWithin(container)[0];
        if (first) first.focus({ preventScroll: true });
        else if (container.getAttribute('tabindex') === '-1') {
            container.focus({ preventScroll: true });
        }
    }

    function open(container, options = {}) {
        if (!container) return;
        let record = records.get(container);
        if (!record) {
            const trigger = options.trigger || (
                document.activeElement && !container.contains(document.activeElement)
                    ? document.activeElement
                    : null
            );
            record = { trigger, trap: shouldTrap(container, options.trap) };
            records.set(container, record);
        } else {
            // An explicit lifecycle hook is authoritative. The observer may
            // have noticed the class toggle first, before the component can
            // provide the exact button that opened the overlay.
            if (options.trigger) record.trigger = options.trigger;
            if (options.trap !== undefined) record.trap = shouldTrap(container, options.trap);
        }
        managedOverlays.add(container);
        if (record.trap) activeTrap = container;
        if (options.initialFocus) {
            window.setTimeout(() => focusInitial(container, options.initialFocus), 0);
        }
    }

    function restoreTrigger(record) {
        const trigger = record?.trigger;
        const fallback = document.querySelector(
            'main, [role="main"], h1, [data-focus-fallback]'
        ) || document.body;
        const target = trigger
            && trigger.isConnected
            && !trigger.disabled
            && trigger.matches?.(FOCUSABLE)
            ? trigger
            : fallback;
        if (!target) return;
        if (target !== document.body && !target.matches(FOCUSABLE)) {
            target.setAttribute('tabindex', '-1');
        }
        window.setTimeout(() => target.focus({ preventScroll: true }), 0);
    }

    function close(container, trigger, options = {}) {
        if (!container) return;
        const record = records.get(container);
        if (trigger) {
            if (record) record.trigger = trigger;
            else records.set(container, { trigger, trap: false });
        }
        records.delete(container);
        managedOverlays.delete(container);
        if (activeTrap === container) {
            activeTrap = Array.from(managedOverlays).reverse()
                .find((item) => records.get(item)?.trap && isVisible(item)) || null;
        }
        if (options.restoreFocus !== false) {
            restoreTrigger(record || (trigger ? { trigger } : null));
        }
    }

    function syncOverlays() {
        const visible = Array.from(document.querySelectorAll(OVERLAY_SELECTOR))
            .filter(isVisible);
        visible.forEach((overlay) => {
            if (!managedOverlays.has(overlay)) {
                open(overlay, {
                    trigger: document.activeElement,
                    trap: overlay.matches('.cs-location-panel')
                        ? window.matchMedia('(max-width: 768px)').matches
                        : undefined
                });
            }
        });
        Array.from(managedOverlays).forEach((overlay) => {
            if (!overlay.isConnected || !overlay.matches(OVERLAY_SELECTOR)) close(overlay);
        });
    }

    function currentTrap() {
        if (activeTrap && isVisible(activeTrap)) return activeTrap;
        const fallback = Array.from(managedOverlays).reverse()
            .find((overlay) => records.get(overlay)?.trap && isVisible(overlay));
        if (fallback) {
            activeTrap = fallback;
            return fallback;
        }
        const locationPanel = document.querySelector('.cs-location-panel.is-open');
        if (locationPanel && window.matchMedia('(max-width: 768px)').matches) {
            open(locationPanel, { trap: true });
            return locationPanel;
        }
        return null;
    }

    function announceChangedStatus(node) {
        const status = node.nodeType === Node.ELEMENT_NODE
            ? node.closest(STATUS_SELECTOR)
            : node.parentElement?.closest(STATUS_SELECTOR);
        if (!status || status.hasAttribute('data-focus-manager-live') || !isVisible(status)) return;
        const text = status.textContent;
        if (text) announce(text);
    }

    function onKeydown(event) {
        if (event.key !== 'Tab') return;
        const trap = currentTrap();
        if (!trap) return;
        const focusable = focusableWithin(trap);
        if (!focusable.length) {
            event.preventDefault();
            trap.focus?.({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        } else if (!trap.contains(document.activeElement)) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    function init() {
        if (!document.body) return;
        ensureLiveRegion();
        document.addEventListener('keydown', onKeydown, true);
        const observer = new MutationObserver((mutations) => {
            syncOverlays();
            mutations.forEach((mutation) => {
                if (mutation.target?.nodeType === Node.ELEMENT_NODE) {
                    announceChangedStatus(mutation.target);
                }
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) announceChangedStatus(node);
                });
            });
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'aria-hidden', 'hidden'],
            childList: true,
            characterData: true,
            subtree: true
        });
        syncOverlays();
    }

    window.VelveraFocusManager = Object.freeze({
        open,
        close,
        announce,
        sync: syncOverlays,
        focusInitial
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();