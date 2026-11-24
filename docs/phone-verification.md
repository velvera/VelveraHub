# Nigerian phone verification

Phone verification is optional, server-enforced, and **disabled by default**.
While disabled, the buyer and seller flows keep their existing email/password,
email-confirmation, publishing, and moderation behavior. No OTP is sent. Admins
can enable or disable it in the VelveraHub admin panel without redeploying any
website or Edge Function. While disabled, the panel checks whether Termii
secrets are present but makes no Termii requests; it validates the API key and
approved Sender ID only when an administrator attempts activation.

## Install

1. Apply `database/phone-verification.sql` after migrations 1–18 in
   `database/run-schema.txt`. It is migration 19 and initializes the feature
   flag to `false`.
2. In the Supabase project, open **Edge Functions → Secrets** and set:
   - `TERMII_API_KEY` — the private Termii API key.
   - `TERMII_SENDER_ID` — the approved Termii sender ID.
3. Deploy the existing function from the repository root:

   ```sh
   supabase functions deploy phone-verification
   ```

   `supabase/config.toml` sets `verify_jwt = false` because signup verification
   begins before an account has a session. The function itself authenticates
   account changes and administrator actions. Signup registration requires a
   server-issued, short-lived, single-use ticket after Termii confirms the OTP.
4. The function also needs its Supabase project URL, public/anon key, and
   service-role key in its runtime environment. Supabase normally provides
   these built-in values to hosted Edge Functions. If using a different
   deployment, configure them as server-side Function secrets; never put the
   service-role key in browser configuration.
5. Sign in to the VelveraHub admin panel and open **Phone verification**.
   Confirm that Termii and product-media readiness are reported correctly.
   Enabling validates the API key and approved sender ID before saving. Do not
   set the database flag manually: the admin action also coordinates private
   product-media buckets.

The feature remains off until an authorized administrator enables it. Turning
it off preserves phone records and verification status and stops new OTP
requests before restoring each product-media bucket to the exact public/private
state it had before activation. If enabling fails, the previous bucket state is
restored where possible. If turning off succeeds but Storage cannot restore the
saved state, the admin panel reports the repair needed while the feature remains
disabled. Saving the disabled setting before the first activation does not
change either bucket.

## Behavior and security

- Signup asks for a Nigerian mobile number only after the database setting is
  enabled. Both buyer and seller accounts keep Supabase email/password
  authentication and email confirmation.
- Numbers are normalized to `+234…`. Termii OTPs are six digits, expire after
  five minutes, cannot be resent for 60 seconds, and allow at most five
  verification attempts.
- The challenge table is inaccessible to browser roles. The function stores
  provider references and attempt state, not OTP values. Termii credentials
  never enter browser code or responses.
- Signup tickets are bound to the normalized phone and email and are consumed
  by the Auth-user database trigger. A separate server-owned profile state and
  unique index enforce verified-number ownership. Browser profile updates
  cannot set or change verified phone fields.
- Existing unverified sellers are prompted before publishing when enabled.
  Changing a number requires a new verified challenge. Disabling verification
  removes those prompts and database publishing checks without clearing phone
  records or KYC/listing states.
- Eligible active listings from email-confirmed, phone-verified independent
  sellers can be publicly read with their media. Existing approved listings
  and active KYC-verified shop listings remain public. Inactive, rejected, and
  ineligible listings remain private.
- The admin control requires an authenticated account whose server-side
  profile role is `admin`. Direct browser writes to the global setting and
  verification state are revoked.
- Before the first activation, both Storage buckets remain untouched. On
  activation their prior public/private modes are saved and restored exactly
  when the feature is disabled.

## Verification

Run the offline handler and source-policy tests:

```sh
npm run test:phone-verification
node scripts/supabase-readiness.test.mjs
node scripts/storage-policy-safety.test.mjs
```

The OTP/provider doubles are confined to automated tests. Before enabling the
feature for real users, repeat the enabled and disabled cases in a dedicated
staging Supabase project with a real Termii account and real SMS delivery:

1. With the feature disabled, confirm signup, sign-in, publishing, existing
   visibility, and image/video reads match current behavior, and no OTP UI or
   SMS requests appear.
2. Enable it in the admin panel without redeployment. Verify both registration
   roles, E.164 normalization, duplicate-number rejection, correct, wrong, and
   expired OTPs, the resend cooldown, five-attempt lockout, a legacy seller
   prompt, and re-verification after a phone change.
3. As an anonymous visitor, open an eligible listing and its images. Confirm
   inactive, rejected, unverified, and unconfirmed-email listings remain
   private.
4. Disable it in the panel without redeployment. Confirm prompts and new OTP
   requests stop, original publishing/visibility behavior returns, and existing
   account, KYC, moderation, and phone records remain intact.

Do not run live SMS tests against production accounts or customer phone
numbers.
