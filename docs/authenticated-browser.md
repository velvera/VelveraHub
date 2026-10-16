# Authenticated browser checks

`npm run auth:browser` runs a Playwright check against the Supabase-backed
shopper, seller, and admin flows. It starts a local server on port `5051` when
`AUTH_BROWSER_BASE_URL` is not provided.

The test accounts are supplied only through environment variables:

```sh
export SUPABASE_SHOPPER_EMAIL="shopper@example.test"
export SUPABASE_SHOPPER_PASSWORD="..."
export SUPABASE_SELLER_EMAIL="seller@example.test"
export SUPABASE_SELLER_PASSWORD="..."
export SUPABASE_ADMIN_EMAIL="admin@example.test"
export SUPABASE_ADMIN_PASSWORD="..."
npm run auth:browser
```

The check signs in through the real storefront modal, verifies the active
Supabase session and matching `profiles.role`, confirms that the seller owns a
shop, and then visits the relevant product or dashboard route. Credentials are
never written to the repository, command output, screenshots, or trace files.

For an already-running preview:

```sh
AUTH_BROWSER_BASE_URL="https://preview.example" npm run auth:browser
```

The command exits with a clear missing-configuration error when any of the
three test accounts is not configured, rather than silently falling back to
demo data.