# VISULIA Cloudflare deployment

2026-09-27: user approved Workers + Containers and requested implementation through completion without local production infrastructure.

## Production placement

- Worker: public HTTPS API, CLI entry, browser access and authenticated routing.
- Registry Durable Object: account-wide bounded admission, one-minute creation cooldown per salted client hash, active-session reservations. Capacity is released only after cleanup.
- Session Durable Object: existing session lifecycle, credential hashes, deadlines and alarms. Workers does not open a node:sqlite file. Existing SQLite implementation remains a separately tested self-host building block, not the Cloudflare production database.
- Dedicated Container per session: Elasticsearch, Kibana, Vector, TomEE and internal management agent. They share a VM only within the same session; another session gets another VM.
- Session files are ephemeral container disk, not R2. No backups or log-body telemetry. Session metadata is Durable Object storage and purged after successful cleanup; a minimal tombstone prevents deleted-session restart.

## Implementation sequence / ongoing goal

- [x] Implement Worker API and Durable Object session/capacity lifecycle with workerd integration tests.
- [x] Implement Container adapter with start/close race fencing and expiry cleanup (SDK simulator verified; real VM verification remains below).
- [ ] Build linux/amd64 image with actual services, editable templates, upload and demo generator. Runtime config, bootstrap ordering, process supervision, private filesystem preparation and demo request generator are implemented as building blocks; see `../evidence/2026-09-27-runtime-bootstrap.md`.
- [ ] Implement ES|QL/Kibana application and browser handoff.
- [ ] Implement npm CLI, package-install test, remote setup diagnostics.
- [ ] Build image in remote CI; validate hosted session isolation, data cleanup and rendered dashboard.
- [ ] Prepare GitHub/npm release artifacts and verified deployment instructions.

Public demo authentication and deployment authorization are not present yet. No deployment or paid resource is created just by this document. Need an authenticated Cloudflare account, repository/remote CI for image build, and concrete release targets for final live verification/publication.

## Runtime decisions

Use standard-3 (8 GiB) initially, max three live sessions. Benchmark before public release; never call this capacity proven. Worker HTTP requests do not run JVM processes; they route to the dedicated Container. Cloudflare Containers requires Workers Paid.

Container startup can be slow: POST returns provisioning and CLI polls. Creation/cleanup persist intent before awaiting a remote operation. Recheck state after boot. Destruction tombstones block auto-start and late boot traffic. Container stop loses data: treat it as session termination, not transparent restoration. Alarm cleanup is retried until destruction succeeds.

Browser tickets are one-time and short-lived; bearer tokens never appear in a URL. Local user files upload only on explicit CLI selection. Disable outbound Internet for the runtime container; image dependencies are installed at build time.

## Sources checked

- https://developers.cloudflare.com/containers/concepts/architecture/ (VM isolation, amd64, ephemeral disk)
- https://developers.cloudflare.com/containers/reference/container-class/ (start, destroy, per-instance environment)
- https://developers.cloudflare.com/containers/platform/limits/ (instance size)
- https://developers.cloudflare.com/durable-objects/api/alarms/ (durable scheduled cleanup)

## Control-layer verification boundary

See `../evidence/2026-09-27-cloudflare-control.md`. The checked-in example deployment config still references the future stack image; it is deliberately named `wrangler.containers.example.jsonc` so ordinary `wrangler deploy` cannot deploy it accidentally. `wrangler.types.jsonc` is a generation-only configuration, not a runnable server deployment. Runtime types were generated using the pinned Wrangler and compatibility flags.

The Worker TypeScript project uses `skipLibCheck` only to reconcile duplicate global declarations from the Node compatibility types and generated Workers runtime types. Application code remains strict; the Node/self-host project checks declarations without this setting.
