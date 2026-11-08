# Olive Tree community

Mission Control member database at `/community/`. Static UI; durable data in Supabase, not localStorage or committed JSON. The dashboard site shelf links here.

## Available

- Protected member directory; create/edit names, email, phone, experience, writing levels/types, notes and writing samples.
- Editable level/type vocabulary and future Luma registration form link.
- CSV/TSV, Luma JSON/MCP JSON, explicit From-header EML, and messages attached to selected members. File/paste imports are reviewed before saving. No email or SMS is sent. This is not a live email/SMS inbox integration.
- Email and exact digit-normalized phone matching; ambiguous matches blocked. Name-only rows never automatically match. Reimports retain reviewed levels, types, notes and samples; identical source records are deduplicated by SHA-256. All selected changes save in one database transaction.
- Search, level/type filters, source evidence history and JSON export.
- Luma official MCP OAuth via client-ID metadata document, PKCE, state verification and server-held tokens. Refresh is server-side. Read-only event/guest tools discovered after sign-in; tool inputs follow Luma's schema, including pagination. Importing Luma results still requires a preview/save. Changing the form URL alone does not turn on sync.

## Backend

Apply `migrations/20261107-olive-tree.sql` with a database owner connection. Provision `ot_access.key_hash` with the SHA-256 hex of a securely generated access key, independently of source control. The active deployment is provisioned; its key is provided separately to the owner. Never put it, Luma tokens or the database URL in Git. The public `config.js` contains only the existing Supabase anonymous/publishable key.

All four tables have RLS enabled and all direct anon/authenticated privileges revoked. Narrow SECURITY DEFINER RPCs require the community access key. Private helper execution is revoked. Updates use optimistic version checks; bulk import is atomic. Luma proxy destinations are fixed to `api.luma.com` and `mcp.luma.com`, never user-provided URLs, with only allowed read methods/tools. HTTP extension is used for server-side OAuth/MCP; timeout and payload limits apply. Access key is held in the browser session until Lock; Luma tokens never reach the browser.

Luma's official OAuth metadata: `https://api.luma.com/.well-known/oauth-authorization-server`. App public metadata: `oauth-client.json`; redirect URI is the production community URL. No API-key field or dynamic client registration is used. Disconnect here removes stored tokens; revoke remote authorization through Luma if needed.

## Verification

`node --test community/core.test.mjs`

Nov 7: production rollback-only DB tests passed for CRUD, version conflicts, settings, atomic imports, bad-key/state rejection, PKCE shape, and Luma write-tool denial. REST verified that all four tables deny anonymous direct reads. Browser tests against real Supabase passed create/edit/reload, sample rendering, source merge/reimport deduplication, filters, settings save, mobile overflow, lock, and zero page errors. Synthetic records were removed afterwards.

Full Luma sign-in, real guest payloads/tool schemas and account-specific pagination need an authorized account trial. No live Luma connection or automatic background sync is claimed. Registration form and blog example are pending the owner's input.
