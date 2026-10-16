/*
 * Cart is an intermediate destination. Checkout is only entered from an
 * intentional "Proceed to Checkout" action.
 */
(function () {
    'use strict';

    function goToCart(event) {
        const sidebar = document.getElementById('cartSidebar');
        if (sidebar) return;
        event.preventDefault();
        window.location.assign('/pages/cart.html');
    }

    document.addEventListener('click', function (event) {
        const cartTarget = event.target.closest('#cartBtn, #bottomCartBtn');
        if (cartTarget && !document.getElementById('cartSidebar')) goToCart(event);

        const checkoutTarget = event.target.closest('#checkoutBtn');
        if (checkoutTarget) {
            const cart = JSON.parse(localStorage.getItem('velverahub_cart') || '[]');
            if (!cart.length) {
                event.preventDefault();
                window.location.assign('/pages/cart.html');
                return;
            }
            event.preventDefault();
            window.location.assign('/pages/checkout.html');
        }
    });
})();