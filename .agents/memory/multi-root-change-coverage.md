---
name: Multi-root change coverage
description: The user's project-wide requirement for changes that affect multiple deployed app roots.
---

The user requires every change to be implemented accurately and intelligently across the relevant pages in the parent project and `velverahub-uk/`, `velverahub-ng/`, `velverahub-shop/`, and `velverahub-admin/`. A broad app-sync command can overwrite per-root assets, so generated roots may also contain useful app-specific behavior that must be preserved.

**Why:** the user explicitly requires multi-root coverage. A prior broad sync overwrote unrelated generated-root files; restoring them and applying only relevant source deltas preserved existing behavior and revealed stale cancellation-cleanup handling in the generated seller apps.

**How to apply:** locate every applicable page and asset in each root, identify canonical sources and generated copies, inspect exact differences, and verify each applicable root. For targeted changes, update the canonical file and only affected copies, then run both app-parity checks. Do not force changes into an app that has no corresponding page or feature.
