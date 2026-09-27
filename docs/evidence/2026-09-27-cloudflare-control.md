# Cloudflare control layer — 2026-09-27

## Implemented

- Worker routes: health; session create/status/heartbeat/delete. Unknown paths and unsupported methods rejected; no generic internal-method forwarding.
- Registry Durable Object: serialized admission, salted client cooldown, bounded capacity, durable reservation recovery, no capacity release until successful destruction.
- Session Durable Object: existing token/lifecycle core, storage-backed lease, deadline alarms, repeated cleanup, revoked access during cleanup, session hash/metadata removed after cleanup. Minimal `closed` tombstone remains.
- Stack Container adapter: dedicated VM identity, Internet disabled, slow boot versus deletion fencing, no auto-start via public fetch, spontaneous stop notification plus heartbeat/status fallback.
- Registry sweep preserves earlier alarms under new admissions.

## Validation

Node unit tests: 25 passing, including real SQLite reopen and negative transaction/auth cases.
Workers tests: 10 passing in Miniflare/workerd. Cases include two-session authorization, parallel capacity, cooldown, unknown routes, cleanup failure retaining capacity, idle expiry, tombstone rejecting initialization, boot failure, orphan cleanup, crash detection, production Stack adapter late boot fencing and spontaneous-stop notification using an SDK simulator.
Type checks: Node and Workers application projects pass.
Independent read-only reviewer found two issues (stop not propagated and alarm postponement). Both were corrected and rechecked; no further concrete defects were reported.

## Tooling observations

Pinned Miniflare 5 uses a new configuration format. The harness uses its exported `convertV4MiniflareOptions` adapter. Supplying an in-memory bundled script works; the converted `scriptPath` option produced a workerd startup error. Direct rejected RPC calls through the Node proxy produced a Miniflare assertion instead of transporting the error, so the test subclass captures the error inside workerd and returns its text for verification. Neither workaround changes production code behavior.

Generated runtime definitions match Wrangler's compatibility date/flags. Workers type-checking skips dependency declaration checks due to duplicate Workers/Node global definitions; application checking stays strict. Node project does not skip these checks.

## Not proven / remaining

- Real Cloudflare Container/image build, Linux/amd64 startup, actual ES/Kibana/Vector/TomEE, dashboard rendering and physical data destruction.
- Durable Object eviction/restart during long-running boot or destruction; registry release failure after physical destruction.
- Live account deployment, published npm CLI, GitHub repository, billing/capacity measurement.

No live infrastructure was created, stopped or deleted in this verification. The Container adapter test is not proof of actual Cloudflare Container behavior. The overall implementation goal remains active.
