# VelveraHub marketplace payment architecture

VelveraHub is a multi-vendor marketplace, not a single merchant store. The
customer pays VelveraHub, and the platform records commission and seller
settlement rather than sending a customer directly to an individual seller's
bank account.

## Regional providers

| Market | Provider | Marketplace capability | Settlement currency |
| --- | --- | --- | --- |
| Nigeria (`velverahub.com`) | Paystack Transaction Splits/subaccounts | Cards, bank-based methods, USSD/other supported local channels, platform commission, seller settlement | NGN |
| United Kingdom (`velverahub.co.uk`) | Stripe Connect | Platform payment collection, connected seller accounts, commission, payouts, refunds and disputes | GBP |

Shopify and Whop are not the core payment architecture for this product:
Shopify is designed around a merchant's own store, while Whop is aimed at
digital products, memberships, and communities. Ordinary Stripe Checkout is
also insufficient for the UK marketplace; the UK implementation needs Stripe
Connect.

## Provider-agnostic application boundary

Application code should select a provider from the market configuration rather
than hard-code Paystack or Stripe into checkout:

```text
PaymentProvider
├── createPaymentIntent(order)
├── verifyWebhook(request)
├── captureOrConfirm(payment)
├── refund(payment, amount)
└── createOrUpdateSellerAccount(seller)
```

The order record should retain the provider-neutral facts needed for
reconciliation:

- `payment_provider`
- provider payment/intent ID
- provider event ID with a uniqueness constraint for webhook idempotency
- platform commission and seller settlement amounts
- currency
- paid, refunded, and settled timestamps

The existing order fields (`payment_method`, `payment_status`, and
`payment_reference`) remain useful for the offline methods and migration
compatibility, but they are not enough for marketplace settlement on their own.

## Required payment flow

1. The server calculates the order total, delivery, tax, commission, and seller
   shares from database prices and stock.
2. The server creates a provider payment intent for the calculated amount.
3. The browser receives only a client-safe checkout reference or redirect.
   Card numbers and provider secret keys never enter VelveraHub storage.
4. A verified provider webhook is the source of truth for paid, failed,
   refunded, disputed, and settled transitions.
5. Webhook event IDs are idempotent; repeated deliveries cannot double-credit
   an order or seller.
6. Refunds reverse the appropriate platform and seller ledger entries.

## Payment on delivery

Payment on delivery can remain as an additional option where the seller,
location, order value, and delivery method are eligible. It must still record
the expected COD amount, delivery fee, seller amount, platform commission,
courier collection state, failed delivery, and return outcome.

## Current project state

The storefront currently supports only `cash_on_delivery` and `bank_transfer`
orders that remain `pending` until confirmed. No card or wallet UI should be
enabled until the Nigeria Paystack and UK Stripe Connect flows have secure
server-side credentials, verified webhooks, refund handling, and staging
reconciliation tests.

The repository now includes the regional payment-attempt, webhook-event,
refund, payout-account, and seller-ledger schema. This is data-model
preparation only: the project does not yet create provider transactions,
verify provider signatures, issue refunds, or transfer seller funds. Paystack
compliance approval is pending and the Stripe Connect platform application has
not yet been submitted. Do not mark payout accounts active or enable card
checkout based only on the presence of a secret or a database row.

Before enabling either region, implement and verify provider adapters against
the actual multi-seller settlement rules, configure the approved provider
accounts and server-only credentials, reconcile signed webhook retries,
exercise partial and full refunds, and run successful/failed/concurrent staging
orders. Keep the provider credentials and webhook secrets out of Cloudflare
static assets and the browser Supabase configuration.

## Provider verification gate

The provider choice is confirmed as Paystack Transaction Splits/subaccounts for
Nigeria and Stripe Connect for the UK. No live or test-mode provider adapter is
currently implemented. Keep card and wallet methods disabled in both the API
and `place_order_secure` until this gate is met.

The staging matrix is maintained in [`staging-acceptance.md`](staging-acceptance.md).
At minimum, exercise success, decline, timeout, duplicate/replayed callbacks,
invalid signatures, amount/currency/reference mismatches, partial failure,
partial and full refunds, and reconciliation. Verify that an order and seller
ledger transition only once, using provider-confirmed values and the server's
database-calculated amount. Checkout must not trust client totals or provider
redirect parameters as proof of payment.

Before building settlement logic, the operator must approve the commission,
multi-seller allocation, refund/chargeback, and payout rules, and complete
provider onboarding for both markets. The current schema is a server-only data
model; it does not execute these flows.