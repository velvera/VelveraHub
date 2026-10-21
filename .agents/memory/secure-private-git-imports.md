---
name: Secure private Git imports
description: Safe authentication and workspace Git handling for private repository imports.
---

For private repository imports, request the token through Replit Secrets and use a temporary askpass helper. Keep the remote URL credential-free so the token is not persisted in `.git/config`.

**Why:** A private repository import exposed the need to avoid putting credentials in clone URLs; the workspace Git guard also blocked changing `.git/config` until the import was explicitly authorized.

**How to apply:** Check that the workspace is clean and empty before import, use a short-lived askpass helper, and only set `DANGEROUSLY_ALLOW_GIT=1` for Git metadata changes that the user has explicitly requested.
