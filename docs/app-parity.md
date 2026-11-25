# Generated app parity

`npm run apps:check` verifies that shared assets in the regional, shop, and
admin apps match their source files. App-specific settings and page routes are
checked separately rather than being copied wholesale.

The shop and admin shells intentionally do not load the public seller dashboard
or independent-listing pages. Their otherwise-shared copies of
`seller-dashboard.js` and `student-listing.js` omit only the Nigerian
phone-verification publishing checks. The parity checker allows exactly those
four omissions and still compares every other byte in those files. If either
shell later adds a public seller/listing route, revisit the phone-verification
requirement and remove the corresponding exception.

The shop-owner product dashboard is an active publishing flow, so
`velverahub-shop/shop.js` must retain the phone-verification check from
`shop-owner/dashboard.js`.
