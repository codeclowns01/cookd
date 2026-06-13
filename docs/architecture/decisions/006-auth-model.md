# ADR-006: Bearer Token Auth, HMAC Signing Removed

**Date:** 2026-06-12
**Status:** Accepted

## Context

An earlier sync implementation (`src/sync/client.ts`) used HMAC-SHA256 request signing
via a `signing.ts` module. The signature was sent in an `X-Cookd-Signature` header.

When the deployed `usage-ingest` edge function was examined, it used a different auth model:
`Authorization: Bearer <deviceToken>`. The HMAC signing module was never consumed by any
deployed backend endpoint.

## Decision

Remove `signing.ts` entirely. Auth for all companion→backend calls uses
`Authorization: Bearer <deviceToken>`, where `deviceToken` is stored in `~/.cookd/credentials.json`
after the device-link flow.

The backend hashes the received token with SHA-256 and looks it up in the `devices` table.
The companion sends the raw token; the server handles hashing. This is standard Bearer token
practice and avoids the complexity of canonical payload construction for HMAC.

## Consequences

- `src/sync/signing.ts` is deleted.
- `src/sync/client.ts` sends only `Authorization: Bearer` — no nonce, timestamp, or sequence.
- All other endpoints (`device-link-start`, `device-link-status`) use no auth (called before
  a device token exists).
- If request integrity verification is needed in future, it should be implemented as a new ADR
  rather than reviving HMAC.

## Files affected

- `src/sync/signing.ts` — **deleted**
- `src/sync/client.ts` — rewritten without signing dependency
