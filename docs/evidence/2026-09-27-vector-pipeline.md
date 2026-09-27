# Vector pipeline evidence — 2026-09-27

Implemented the editable access parser, strict mapping-to-VRL guard, and file-to-Elasticsearch pipeline configuration. This is one part of the ongoing VISULIA goal; the public CLI/dashboard environment is not complete.

## Runtime used

- Host: macOS arm64, Node.js 25.8.2.
- Actual Vector: `vector 0.58.0 (aarch64-apple-darwin 2bcad9b 2026-08-26)`.
- Downloaded official GitHub release archive to a temporary tools directory; no Elasticsearch/Kibana services were installed locally.
- Archive SHA-256 matched the GitHub release API digest: `9182491597f1bdedb08d84a051616c62deea770a9d905b697712cc6526919449`.

## Checks

- Node tests: 29 passed, including mapping/config rejection tests and existing lifecycle/persistence tests.
- Actual VRL tests: 29 passing. They cover two formats, units, UTC conversion, explicit metadata, unknown fields, type failures, decimal precision and bounds, invalid dates, missing timezone, and declared mapping extensions.
- Actual Vector file/bulk integration tests cover ongoing append, invalid-line quarantine, same-content anonymous requests, two files with the same first line, 503 responses, process SIGKILL, buffered restart, and rename rotation.
- The receiving HTTP server is a protocol test double, not Elasticsearch. It records bulk requests and returns scripted responses; the request-ID assertions prove what Vector sends, not real Elasticsearch durability.

Independent review reproduced two defects in the initial draft: first-line file fingerprints lost distinct files, and float conversion changed/rejected valid durations. The implementation now uses device/inode identity and exact decimal-string shifting. Both fixes were rechecked; the reviewer independently passed eleven extra numeric-boundary cases.

Runtime integrations are **not accepted yet**: both cases have passed together, but unmodified Vector 0.58.0 intermittently stalls on quiet input. Additional failures occurred after the file-identity correction. Diagnostic runs also passed, so their timing does not establish a fix. Test cleanup now stops the child before removing files, with a bounded kill fallback.

Inspected upstream PR 26410, which fixes a matching disk writer/reader notification race. Its writer/test patch applies cleanly to the release source. `patches/README.md` records provenance and the candidate source build. No patched binary was built or tested here. Keep this acceptance gate open; do not present the passing sample runs as proof of stable delivery.

## Remaining end-to-end evidence

Actual TomEE-generated logs, real Elasticsearch Mapping/bulk acceptance, API credential setup, ES|QL results, visible Kibana panels, Linux/amd64 image startup, Cloudflare Container execution and deletion, CLI packaging and remote use remain unverified.

## Next service-image inputs inspected

Official linux/amd64 manifests were retrieved for Elastic 9.4.7:

- Elasticsearch: `docker.elastic.co/elasticsearch/elasticsearch@sha256:e083ef4f6b3d5d49115f2893e384d07b94c02c17093f6b7f05e9b2d2821a079c`
- Kibana: `docker.elastic.co/kibana/kibana@sha256:1ae77e774eaeaef348a223fd8f15b9a8a4b676d7919da58014c6dc5ebefaefba`

These are image-resolution evidence only; no image has yet been built or launched. The Docker official-images TomEE listing currently includes `10.2.0-jre21-Temurin-ubuntu-webprofile`; its linux/amd64 digest is now pinned in `containers/images.lock.json` (manifest lookup only; image execution remains unverified).
