/*
 * Shared form validation and action feedback.
 *
 * Native browser validation is useful, but its presentation differs by browser
 * and it is easy to miss inside custom forms. This layer keeps the feedback
 * consistent across storefront, seller, and admin surfaces.
 */
(function () {
    'use strict';

    if (window.VelveraInteractionFeedback) return;

    const CONTROL_SELECTOR = 'input, select, textarea';
    const SKIP_BUTTON_SELECTOR = [
        '[data-no-processing]',
        '[aria-expanded]',
        '.cs-mobile-back',
        '.cs-location-inline-back',
        '.modal-close',
        '.close-modal',
        '.dialog-close',
        '.toast-close',
        '.header-icon-btn',
        '.user-dropdown',
        '.sidebar-toggle',
        '.mobile-toggle',
        '.mobile-menu-toggle',
        '.mobile-menu-btn',
        '.mobile-menu-close',
        '.cart-close',
        '.search-btn',
        '.hero-prev',
        '.hero-next',
        '.region-badge',
        '.region-option',
        '.auth-tab',
        '.auth-page-tab',
        '.page-btn',
        '.filter-chip',
        '.nav-icon-item',
        '.bottom-nav-item',
        '.cart-qty-btn',
        '.cart-item-remove',
        '.password-visibility-toggle',
        '.toggle-password',
        '.toggle-password-btn',
        '.toggle-key-btn',
        '.copy-action',
        '.copy-button',
        '.copy-btn',
        '.copy-to-clipboard',
        '[data-copy]',
        '#copyShopKey',
        '#toggleKeyVisibility',
        'button[type="submit"]',
        '.cs-trigger',
        '[role="tab"]',
        '[role="radio"]'
    ].join(',');
    const NAVIGATION_CONTROL_SELECTOR = '.cs-mobile-back, .cs-location-inline-back, [aria-label^="Back"]';

    function fieldLabel(field) {
        const label = field.id
            ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`)
            : field.closest('.form-group, .field, .full-width')?.querySelector('label');
        const text = label?.textContent?.replace(/\s+/g, ' ').trim()
            .replace(/\(optional\)/ig, '')
            .replace(/[*:]+$/, '')
            .trim();
        return text || field.getAttribute('aria-label') || field.name || 'This field';
    }

    function fieldContainer(field) {
        return field.closest('.form-group, .field, .full-width, .campus-form-grid > div') || field.parentElement;
    }

    function errorText(field) {
        if (field.dataset.requiredMessage && !field.value.trim()) return field.dataset.requiredMessage;
        if (field.validity.valueMissing) return `${fieldLabel(field)} is required.`;
        if (field.validity.typeMismatch) return `Enter a valid ${fieldLabel(field).toLowerCase()}.`;
        if (field.validity.tooShort) return `${fieldLabel(field)} must be at least ${field.minLength} characters.`;
        if (field.validity.rangeUnderflow) return `${fieldLabel(field)} must be at least ${field.min}.`;
        if (field.validity.rangeOverflow) return `${fieldLabel(field)} must be no more than ${field.max}.`;
        if (field.validity.stepMismatch) return `Enter a valid ${fieldLabel(field).toLowerCase()}.`;
        if (field.validity.badInput) return `Enter a valid ${fieldLabel(field).toLowerCase()}.`;
        return 'Check this field.';
    }

    function getErrorNode(field) {
        const container = fieldContainer(field);
        if (!container) return null;
        let node = container.querySelector(':scope > .field-error');
        if (!node) {
            node = document.createElement('p');
            node.className = 'field-error';
            node.setAttribute('role', 'alert');
            container.appendChild(node);
        }
        return node;
    }

    function clearFieldError(field) {
        const container = fieldContainer(field);
        const error = container?.querySelector(':scope > .field-error');
        if (error) error.remove();
        field.removeAttribute('aria-invalid');
        container?.classList.remove('has-validation-error');
    }

    function showFieldError(field, message) {
        const node = getErrorNode(field);
        if (!node) return;
        node.textContent = message;
        field.setAttribute('aria-invalid', 'true');
        fieldContainer(field)?.classList.add('has-validation-error');
    }

    function getSummary(form) {
        let summary = form.querySelector(':scope > .form-validation-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.className = 'form-validation-summary';
            summary.setAttribute('role', 'alert');
            summary.setAttribute('aria-live', 'assertive');
            form.prepend(summary);
        }
        return summary;
    }

    function validateForm(form) {
        const invalid = Array.from(form.querySelectorAll(`${CONTROL_SELECTOR}[required]`))
            .filter((field) => !field.disabled && !field.closest('[hidden]') && !field.checkValidity());

        form.querySelectorAll(CONTROL_SELECTOR).forEach((field) => {
            if (!invalid.includes(field)) clearFieldError(field);
        });
        invalid.forEach((field) => showFieldError(field, errorText(field)));

        const summary = form.querySelector(':scope > .form-validation-summary');
        if (!invalid.length) {
            summary?.remove();
            return true;
        }

        const message = invalid.length === 1
            ? errorText(invalid[0])
            : `Complete the ${invalid.length} required fields highlighted below.`;
        getSummary(form).textContent = message;
        invalid[0].focus({ preventScroll: true });
        invalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }

    function clearProcessing(button) {
        if (!button) return;
        button.classList.remove('is-processing');
        button.removeAttribute('aria-busy');
        button.removeAttribute('data-processing-started');
        if (button.dataset.processingDisabled === 'true') {
            button.disabled = false;
            delete button.dataset.processingDisabled;
        }
    }

    function showProcessing(button, duration = 900) {
        if (!button || button.matches(SKIP_BUTTON_SELECTOR) ||
            button.matches(NAVIGATION_CONTROL_SELECTOR) || button.disabled) return;
        button.classList.add('is-processing');
        button.setAttribute('aria-busy', 'true');
        button.dataset.processingStarted = 'true';
        if (button.matches('button:not([type="button"])') || button.type === 'submit') {
            button.disabled = true;
            button.dataset.processingDisabled = 'true';
        }
        window.setTimeout(() => clearProcessing(button), duration);
    }

    function onFormSubmit(event) {
        const form = event.currentTarget;
        if (!validateForm(form)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const submit = form.querySelector('button[type="submit"], input[type="submit"]');
            clearProcessing(submit);
        }
    }

    function onFieldChange(event) {
        const field = event.target;
        if (!field.matches(CONTROL_SELECTOR)) return;
        if (field.checkValidity()) clearFieldError(field);
    }

    function onButtonClick(event) {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        const navigationControl = target?.closest(NAVIGATION_CONTROL_SELECTOR);
        if (navigationControl) {
            // Back controls only change the open selector panel. Clear any
            // stale state left by older or page-specific feedback handlers.
            clearProcessing(navigationControl);
            return;
        }
        const button = target?.closest('button, a.btn, [data-processing]');
        if (!button || button.disabled || button.matches(SKIP_BUTTON_SELECTOR)) return;
        showProcessing(button, button.matches('a') ? 650 : 900);
    }

    function init() {
        document.querySelectorAll('form').forEach((form) => {
            if (form.dataset.interactionFeedbackReady === 'true') return;
            form.dataset.interactionFeedbackReady = 'true';
            form.addEventListener('submit', onFormSubmit, true);
            form.addEventListener('input', onFieldChange);
            form.addEventListener('change', onFieldChange);
        });
        document.addEventListener('click', onButtonClick, true);
    }

    window.VelveraInteractionFeedback = {
        validateForm,
        clearFieldError,
        showProcessing,
        clearProcessing,
        init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();