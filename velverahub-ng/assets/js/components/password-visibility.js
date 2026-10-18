(function () {
    'use strict';

    if (window.VelveraPasswordVisibility) return;

    let generatedId = 0;

    function fieldLabel(input) {
        const label = input.id
            ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            : input.closest('.form-group, .field')?.querySelector('label');
        return label?.textContent?.replace(/\s+/g, ' ').trim() || 'password';
    }

    function controlFor(input) {
        let wrapper = input.closest('.password-visibility-control, .password-input, .password-input-group');
        if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.className = 'password-visibility-control';
            input.parentNode.insertBefore(wrapper, input);
            wrapper.append(input);
        } else {
            wrapper.classList.add('password-visibility-control');
        }
        return wrapper;
    }

    function enhance(input) {
        if (!(input instanceof HTMLInputElement) || input.type !== 'password' ||
            input.dataset.passwordVisibilityReady === 'true') return;

        const wrapper = controlFor(input);
        if (!input.id) input.id = `password-visibility-${++generatedId}`;
        let button = wrapper.querySelector('button.toggle-password, button.toggle-password-btn, button[data-password-toggle]');
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'toggle-password-btn';
            const icon = document.createElement('i');
            icon.className = 'fas fa-eye';
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
            wrapper.append(button);
        }

        button.type = 'button';
        button.classList.add('password-visibility-toggle', 'toggle-password-btn');
        button.dataset.passwordToggle = 'true';
        button.dataset.noProcessing = 'true';
        button.setAttribute('aria-controls', input.id);
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', `Show ${fieldLabel(input)}`);
        button.title = `Show ${fieldLabel(input)}`;
        let icon = button.querySelector('i');
        if (!icon) {
            icon = document.createElement('i');
            button.append(icon);
        }
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fas', 'fa-eye');
        icon.setAttribute('aria-hidden', 'true');
        input.dataset.passwordVisibilityReady = 'true';
    }

    function onClick(event) {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        const button = target?.closest('[data-password-toggle="true"]');
        if (!button) return;
        const input = document.getElementById(button.getAttribute('aria-controls'));
        if (!input || input.type !== 'password' && input.type !== 'text') return;
        event.preventDefault();

        const reveal = input.type === 'password';
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.type = reveal ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(reveal));
        button.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${fieldLabel(input)}`);
        button.title = `${reveal ? 'Hide' : 'Show'} ${fieldLabel(input)}`;
        const icon = button.querySelector('i');
        icon?.classList.toggle('fa-eye', !reveal);
        icon?.classList.toggle('fa-eye-slash', reveal);
        input.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
            try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_) {}
        }
    }

    function scan(node) {
        if (!(node instanceof Element)) return;
        if (node.matches('input[type="password"]')) enhance(node);
        node.querySelectorAll('input[type="password"]').forEach(enhance);
    }

    function init() {
        document.querySelectorAll('input[type="password"]').forEach(enhance);
        document.addEventListener('click', onClick);
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach(scan);
                if (mutation.type === 'attributes') scan(mutation.target);
            });
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['type']
        });
    }

    const style = document.createElement('style');
    style.textContent = `
        .password-visibility-control {
            position: relative;
            display: block;
            width: 100%;
            min-width: 0;
        }
        .password-visibility-control > input {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            padding-right: 3.25rem;
        }
        .password-visibility-control > button.password-visibility-toggle {
            position: absolute;
            z-index: 2;
            top: calc(50% + 2px);
            right: .4rem;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            width: 2.5rem;
            height: 2.5rem;
            min-width: 2.5rem;
            min-height: 2.5rem;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: .5rem;
            background: transparent;
            box-shadow: none !important;
            color: #6b7280;
            cursor: pointer;
            line-height: 1;
            transform: translateY(-50%);
            transition: color .15s ease, background-color .15s ease;
        }
        .password-visibility-control > button.password-visibility-toggle > i {
            display: block;
            font-size: 1rem;
            line-height: 1;
        }
        .password-visibility-control > button.password-visibility-toggle:hover {
            background: rgb(109 40 217 / 7%);
            color: #6d28d9;
            transform: translateY(-50%);
        }
        .password-visibility-control > button.password-visibility-toggle:focus-visible {
            outline: 2px solid #7c3aed;
            outline-offset: 2px;
        }
        .password-visibility-toggle::after,
        .password-visibility-toggle.is-processing::after {
            display: none !important;
            content: none !important;
            animation: none !important;
        }
    `;
    document.head.append(style);
    window.VelveraPasswordVisibility = Object.freeze({ init });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
