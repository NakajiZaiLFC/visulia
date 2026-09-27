# Runtime HTTP and image integration — 2026-09-27

## Local evidence

- Node.js test suite:54 passing on macOS Node25.8.2, including actual transient HTTP listener tests,10MiB input rejection, configuration file permissions, startup validation, fixed-origin proxying and sanitized errors.
- workerd:11 passing, plus Worker TypeScript check. Covers the ready-owner API path, query/body preservation, provisioning denial, redirect routing, internal agent-token overwrite/cookie removal, and stopped-container refusal using a simulated TCP port.
- Entrypoint now wires private filesystem preparation, production bootstrap IO, per-service JSON health predicates, authenticated agent and process supervision. Port8081 opens only after bootstrap. Real service startup is not inferred from these unit checks.
- Linux/amd64 combined Dockerfile and a remote smoke harness are present. The harness uses a network-disabled disposable container, actual TomEE requests and Vector ingestion, ES|QL and Kibana Data View APIs. No Dashboard UI claim is made.

## Review fixes

- Remote smoke cleanup originally depended on successful `docker run`. A fixture reproduced a container being created before the command failed; cleanup now always removes the unique name and queries the daemon to verify absence.
- Root-relative Kibana redirects initially left the public API prefix. Gateway response translation now keeps them under the owner's session API path; a workerd test follows the redirect.

## Remote state

A private staging repository was created at https://github.com/NakajiZaiLFC/visulia. Nothing has been made public or published to npm.

GitHub run https://github.com/NakajiZaiLFC/visulia/actions/runs/36296359970 started from f77954a. Its Node24/Linux unit suite and original10 workerd tests passed; the patched-Vector build was still running at the last observation. This is a live pending job, not a successful image-build result. The later gateway-route tests are local evidence and are not retroactively attributed to that run.

Cloudflare OAuth login was reverified after the user's renewal. Containers-related scopes are present. There has been no Cloudflare deployment, paid-plan verification, or real Container execution yet.

## Next integration

Observe the existing remote run without restarting it merely because it is slow. Resolve actual build/runtime failures, then integrate the editable run/upload/check/ingest workflow, browser-ticket route, Dashboard definitions and npm CLI. Patched-Vector delivery and complete Cloudflare lifecycle remain open acceptance gates until actual evidence exists.
