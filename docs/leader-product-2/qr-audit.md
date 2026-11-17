# QR dev audit / migration boundary

Source inspected at APIfa02b0c / APP256a73d, not inherited main findings. QR is management/generation/analytics, not merely a camera scanner.

- Backend accepts PHONE/LINK/EMAIL/TEXT/WHATSAPP/TELEGRAM/CONTACT; Prisma statuses ACTIVE/PAUSED/DELETED. Client union also advertises WIFI/SMS/GEO/BITCOIN, but form disables them (and EMAIL); do not claim unsupported flows work. Client status type INACTIVE/EXPIRED disagrees with actual backend.
- Actual endpoints: POST /qr, PUT /qr/:id partial update, GET list/detail/analytics/scans/stats/export, DELETE /qr/:id, PUT restore, unauthenticated GET /qr/:id/scan. Legacy APP update/delete sugar sends PATCH, with no method rewrite/alias found; editing/status delete is mismatched.
- Form CONTACT sends firstName/lastName/contactAddress; normalizer's VCard helper reads name/address, dropping those values. Correct this in the typed contract rather than declaring a stub equivalent.
- Generated PNG encodes the configured public scan URL (not raw QR data). Public scan performs analytics then PHONE/mobile tel vs desktop WhatsApp, EMAIL/mailto, WHATSAPP, TELEGRAM, LINK redirect, CONTACT vCard/iOS and TEXT display. Replacing this with a static direct QR loses analytics/status behavior. No production scan/redirect was called.
- List/detail/create/edit/delete, owner vs legacy ADMIN, image options, PNG gallery/download, analytics TZ/buckets/zoom/calendar/filters/scans/CSV/stats/restore are migration inventory. Device/export/public-path acceptance still pending.
- Analytics presets live only in component state; callbacks log delete, not durable saved-preset functionality. QR AsyncStorage cache reads/writes are commented out; global cache keys are invalidation leftovers, not proof of offline QR support.

## Fixed before migration
Detail cache was read before DB ownership check and keyed without actor. A warm Alice detail returned200 to Carol. Every read now rechecks current object ownership before touching cache; representation keys include actor/role and a new cache format segment. Existing mutation qr:<id> invalidation still covers all variants. Public TEXT interpolated stored HTML; it now escapes literal content and sets script-free CSP/nosniff while retaining heading display.

These are legacy fork route fixes, not completed tenant authorization: the source still has no company model, JWT ADMIN trust/global legacy roles and other inherited auth design debt. Target Company handlers require Central introspection and server-side tenant/object/action permissions. Do not directly expose or reuse the legacy router as the new SaaS module service.

Next slices: enforce bounded image parameters before PNG allocation; fix verified update/contact mismatches; introduce typed QR domain/API/storage contracts and real fixture Company persistence; port UI/media/analytics behind lifecycle/adapters with parity evidence. Original implementation/data/recovery remains until replacement acceptance.

## Bounded image options implemented
PNG renderer receives only validated width50–1000, optional margin0–32, six-digit RGB colors and L/M/Q/H correction. HTTP query defaults remain300px/margin1; generic service default remains200px. Duplicate/array/fractional/oversized query values are rejected, not forwarded to allocator. Cache variants use canonical validated values. The old unused validateOptions function was replaced with the hot-path validator, with no recovery/data removal.

## Contact/update compatibility corrections
Shared QR-owned VCard generator now accepts current form firstName/lastName/contactAddress as well as legacy name/address; emits structured N/ADR and escapes text delimiters/backslash/newlines. Both normalization and public legacy-JSON contact fallback use it, replacing two identical generators. Already stored BEGIN:VCARD strings pass through byte-for-byte; no DB migration or old data deletion. Text escaping/structured fields follow [RFC2426](https://www.rfc-editor.org/rfc/inline-errata/rfc2426.html); complete business contact editor/unknown-field preservation still needs target parity, not claimed here.
PUT description=null now actually clears the field; update DTO includes qrType needed by the client. APP4a70a07 uses this pre-existing PUT endpoint and parses both old flat and new structured VCard. The client is compatible before/after the server correction. Public deployment/API compatibility windows remain a separate stage1 requirement; these fork changes are not deployed.
