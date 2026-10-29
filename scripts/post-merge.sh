#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Install the locked Node dependencies without prompting.
npm ci --no-audit --no-fund

# Keep the four static Pages roots synchronized and fail on drift.
npm run apps:sync
npm run apps:check

# Run the local regression suite most relevant to shared storefront/admin code.
npm run test:cookie-consent
npm run test:manual-payments
npm run test:product-meta
npm run test:messages-moderation
npm run test:storage-policy-safety
npm run test:domain-routing
npm run test:category-images

# Supabase is external production infrastructure. Do not apply SQL migrations
# automatically during task merges.
