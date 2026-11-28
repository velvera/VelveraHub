(function () {
    'use strict';

    const MAX_MESSAGE_LENGTH = 2000;

    function authUrl() {
        const redirect = `${window.location.pathname}${window.location.search}`;
        const query = new URLSearchParams({ mode: 'login', redirect });
        return `/pages/auth.html?${query.toString()}`;
    }

    function setStatus(node, message, isError = false) {
        if (!node) return;
        node.textContent = message || '';
        node.classList.toggle('is-error', isError);
    }

    function renderMessages(thread, messages, userId) {
        thread.replaceChildren();
        for (const message of messages || []) {
            const bubble = document.createElement('article');
            bubble.className = `product-chat-message${message.sender_id === userId ? ' is-mine' : ''}`;
            const body = document.createElement('p');
            body.textContent = message.body || '';
            const time = document.createElement('time');
            const date = new Date(message.created_at);
            time.textContent = Number.isNaN(date.getTime())
                ? ''
                : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
            if (message.created_at) time.dateTime = message.created_at;
            bubble.append(body, time);
            thread.appendChild(bubble);
        }
        thread.hidden = !messages?.length;
        thread.scrollTop = thread.scrollHeight;
    }

    async function mount(panel, product) {
        if (!panel || !product?.id) return;
        const supabase = window.SupabaseClient?.get();
        const form = panel.querySelector('[data-chat-form]');
        const input = panel.querySelector('[data-chat-input]');
        const thread = panel.querySelector('[data-chat-thread]');
        const status = panel.querySelector('[data-chat-status]');
        const submit = panel.querySelector('[data-chat-submit]');
        if (!supabase || !form || !input || !thread) {
            setStatus(status, 'In-app messaging is not configured on this marketplace.', true);
            return;
        }

        let user = null;
        let conversationId = null;
        let refreshTimer = null;
        const productId = String(product.id);

        async function loadMessages() {
            if (!conversationId || !user) return;
            const { data, error } = await supabase
                .from('product_conversation_messages')
                .select('id,sender_id,body,created_at')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true })
                .limit(150);
            if (error) throw error;
            renderMessages(thread, data || [], user.id);
        }

        async function findConversation() {
            if (!user) return;
            const { data, error } = await supabase
                .from('product_conversations')
                .select('id')
                .eq('product_id', productId)
                .eq('buyer_id', user.id)
                .maybeSingle();
            if (error) throw error;
            conversationId = data?.id || null;
            if (conversationId) await loadMessages();
        }

        async function sendMessage(value) {
            const message = String(value || '').trim();
            if (!message || message.length > MAX_MESSAGE_LENGTH) return;
            if (!user) {
                window.location.assign(authUrl());
                return;
            }
            submit.disabled = true;
            setStatus(status, 'Sending…');
            try {
                if (conversationId) {
                    const { error } = await supabase.rpc('send_product_conversation_message', {
                        p_conversation_id: conversationId,
                        p_message: message
                    });
                    if (error) throw error;
                } else {
                    const { data, error } = await supabase.rpc('start_product_conversation', {
                        p_product_id: productId,
                        p_initial_message: message
                    });
                    if (error) throw error;
                    conversationId = data;
                }
                input.value = '';
                setStatus(status, 'Message sent. Replies will appear here.');
                await loadMessages();
            } catch (error) {
                setStatus(status, window.AsyncFeedback?.errorMessage(
                    error,
                    'Your message could not be sent. Please try again.',
                    'product-message-send'
                ) || 'Your message could not be sent. Please try again.', true);
            } finally {
                submit.disabled = false;
            }
        }

        panel.querySelectorAll('[data-chat-prompt]').forEach((button) => {
            button.addEventListener('click', () => {
                input.value = button.dataset.chatPrompt || '';
                input.focus();
            });
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            sendMessage(input.value);
        });
        input.addEventListener('input', () => {
            if (input.value.length > MAX_MESSAGE_LENGTH) {
                input.value = input.value.slice(0, MAX_MESSAGE_LENGTH);
            }
        });

        try {
            const { data, error } = await supabase.auth.getUser();
            if (error) throw error;
            user = data?.user || null;
            if (user) {
                await findConversation();
                refreshTimer = window.setInterval(() => {
                    if (!document.hidden) loadMessages().catch(() => {});
                }, 10000);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) loadMessages().catch(() => {});
                });
                setStatus(status, conversationId
                    ? 'This is a conversation about this listing.'
                    : 'Your message will be sent to the seller.');
            } else {
                setStatus(status, 'Sign in to message the seller. Contact options remain available below.');
            }
        } catch (error) {
            setStatus(status, window.AsyncFeedback?.errorMessage(
                error,
                'Your conversation could not be loaded. Please try again.',
                'product-message-load'
            ) || 'Your conversation could not be loaded. Please try again.', true);
        }

        window.addEventListener('pagehide', () => {
            if (refreshTimer) window.clearInterval(refreshTimer);
        }, { once: true });
    }

    window.ProductChat = Object.freeze({ mount });
})();
