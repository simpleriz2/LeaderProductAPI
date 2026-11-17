# Dev baseline — 2026-11-16

Environment/method: see README.md. Local logs for this run: /tmp/lp2-baseline (ephemeral, not a portable artifact). No application server, production resource, migration or external 1C operation was run.

| Check | APP | API |
| --- | --- | --- |
| npm ci from dev lockfile | exit 0, штатный postinstall patches | exit 0 |
| Prisma generate, fixture loopback DATABASE_URL | n/a | exit 0, Prisma 7.8.0; no DB connection/migration |
| TypeScript | npx tsc --noEmit, exit 0 | npm run type-check, exit 0 |
| Jest | npm run test:unit -- --runInBand: 292 suites, 2769 tests passed, 47.659s | 8 suites, 100 tests passed, 11.469s |
| Native release/device | NOT RUN: local Java/SDK unavailable; identity still legacy | n/a |

API Jest paths: clientOrderSubmissions, clientOrderSubmissionWorker, legacyOrderSubmission, orderIntegrity, clientOrdersExportIntegrity, trackingV2.ingest, auth.refresh-token-service, pushService (all __tests__/*.unit.test.ts).
APP full run includes both configured projects. Historical main responsive mock failures did not occur on this dev revision. Do not compare raw counts as coverage parity: dev differs substantially from main.

CI verification: both active workflow YAML files parsed with installed yaml library; exactly fork-checks.yml per repo, contents: read, only checkout/setup-node actions, no secrets, SSH, publishing, deployment, self-hosted runner, workflow_call/dispatch or scheduled trigger. Archived 7 APP + 6 API workflows compared byte-for-byte with base HEAD using git show. git diff --check clean. Hosted GitHub Actions execution is separate from these local checks.

Legacy Web: `EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL_DEV=http://127.0.0.1:3000 NODE_OPTIONS=--max-old-space-size=4096 npm run build:web -- --max-workers 2` — exit 0. Expo Router package-exports warnings use file-based resolution. This is the inherited Expo/Metro baseline, not the target Re.Pack acceptance.

## 2026-11-17 — retired publication CLI quarantine
Blocked 2 inherited APK/Expo OTA/symbol mutation entrypoints before config, dependencies, files or network. No environment bypass; includes dry-run invocations to avoid reviving original publication paths. Read-only metadata builders/validators and recovery source retained. Node CLI subprocess tests: 2/2 passed with empty environment and missing metadata; API OTA validation suite: 14/14 passed. CI checks refusal before npm installation. No upload, Docker inspection or database access performed.

## 2026-11-17 — complete compiled-package HTTP pilot
`npm run test:platform-pilot`: 7/7 real HTTP tests passed (~134ms before final cache header adjustment; rerun below). Cross-fork test in APP passed 1/1 in21.98s including three Re.Pack builds and actual authorized binary downloads/activation. No public listener, external resource, original DB, 1C request or publication. Remaining: production persistence, explicit versioned shared contract, key lifecycle/kill-switch, compatibility negotiation beyond short token window, native loader/cache and device acceptance.

## 2026-11-17 — module compatibility before download
Manifest format2 and mandatory per-module requirements now match both forks. Client verifies exact native revision sets, domain port versions and exported module contracts before even reading active storage/downloading/migrating. Host TypeScript passed;8 Jest suites/60 tests passed; persistent crash/recovery6/6 passed; cross-fork compiled HTTP delivery1/1 passed again (22.64s); API pilot8/8 passed. Includes missing/malformed requirements, unsupported native/semantic revisions, module contract mismatch, old format rejection and positive multi-version support. Two initially incorrect test fixtures accidentally declared capabilities as supported; corrected fixture names to missing microphone/stock ports, then all checks rerun. No native source or APK changed in this slice.

## 2026-11-17 — signed user-bound offline proof and same-company isolation
`npm run test:platform-pilot`9/9 passed (0.17s), adding real HTTP Alice/Carol Alpha users: verified distinct signed module rights, QR-only release projection, Carol's own record200/Alice's403, Help artifact404, immediate narrowed-rights enforcement on existing token, revision advancement and revoked discovery401. Existing two-company/per-request-introspection/outage/immutable artifact tests remain green. TypeScript passed. No legacy server, Prisma/Redis/1C, external notifications or production data used.
APP cross-fork `test:pilot-session` also passed1/1 using actual WebCrypto signature verification plus SessionCoordinator: saved Alice works offline, reconnect removes Help, Carol becomes last saved offline user, tampering fails and logout clears only proof. Browser/native storage acceptance lives in APP evidence; this protocol test uses memory proof storage and does not claim durable Central state.

## 2026-11-17 — explicit loopback browser pilot CORS
Pilot11/11 HTTP tests passed0.22s. New checks cover explicit allowed origin on Central/Company/artifacts, absence of credentials flag, untrusted-origin denial without CORS header, forbidden method/header preflight, real login response and rejection of external/0.0.0.0/path origins at startup. Default pilot permits no browser origins. Existing identity/rights/introspection/registry cases remain green; no external listener/resource or legacy server used.

## 2026-11-17 — QR cache authorization bypass and stored TEXT HTML
New isolated route regression reproduced3/3 failures before fix: warmed owner cache returned200 instead of403 to another actor, same-owner hit skipped authoritative object lookup, public TEXT emitted executable img/script markup. After fix3/3 passed4.68s. The test uses real loopback HTTP Express router, fixture-secret JWT validation, actual permission middleware and actual QR PNG generation; Prisma/cache/service grants and unused GeoIP are fixtures. No Redis/working DB/production endpoint or main server started. TypeScript passed; existing protocol pilot11/11 remained green. CI now includes the QR regressions.
Object/cache fix rechecks current existence/owner before reading subject/role-separated representation cache; ownership change/deletion denies even after warmup. TEXT uses escaped HTML plus default-src none/base-uri none/frame-ancestors none and nosniff. Legacy tenant/JWT-admin/source auth debt remains unexposed and is not claimed solved.

## 2026-11-17 — enforce QR PNG allocation bounds
TypeScript passed; QR security/image suites2/2,25/25 tests passed5.73s. Invalid direct renderer options use a mocked allocator to prove it is never called (no dangerous huge allocation attempted). Real HTTP route rejects huge/duplicate/invalid query before caching; valid simple PNG produced actual200px image, default route300px and canonical variants remain supported. Actual Node qrcode PNG signature/IHDR dimensions checked. No camera/native scan/gallery/device or production claim.

## 2026-11-17 — contact field preservation / partial-update DTO
Before correction3/3 contact tests failed (form names/address dropped, delimiters not escaped, malformed fields accepted) and the actual partial-PUT test failed to clear null description. After correction: TypeScript passed,3 QR suites/30 tests passed6.37s; public legacy JSON contact route used the actual shared generator; stored VCard remained byte-identical; PNG/cache/XSS/ownership cases stayed green. API protocol pilot11/11 passed. Client counterpart APP4a70a07: types,5/5 focused units and bounded-worker legacy Web export passed.
New real-source cross-fork contract2/2 passed0.18s: API normalize -> actual APP parser -> form field reconstruction -> API normalization preserved exact new card; older flat stored card stayed byte-identical/readable. Uses ts-node on pure helpers, no Prisma/Redis/server/production imports. CI pins public APP4a70a07 and sparse-checks out QR entity source only, no peer dependency install. No native contacts/gallery/device or complete QR parity claim.

## 2026-11-17 — action-scoped Central proofs and introspection
Protocol pilot13/13 passed0.19s. Added signed action grants independent of licensed modules; every Company request rechecks current action+owner. Existing token lost view_qr immediately (two actual requests, two introspections) while QR stayed licensed; a token issued without an action did not gain it after later grant, newly issued token did. Unknown fixture action escalation rejected. APP companion cross proof2/2 and real browser action-only revoke/offline persistence passed locally before this push. No production roles/DB or JWT fallback used by the pilot.
