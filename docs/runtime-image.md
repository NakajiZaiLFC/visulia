# Runtime image and remote verification

The session runtime is built for Linux/amd64. Build and execute it on the remote CI runner; the user's workstation does not host the production services.

## Composition

`containers/stack/Dockerfile` combines digest-pinned Elasticsearch 9.4.7, Kibana 9.4.7, TomEE 10.2.0/JRE21 and Node24 with the separately built patched Vector image. The runtime uses UID/GID10001, a private `/work`, and `tini` to reap descendants. Only the management agent binds an external container interface, on8081; ES9200, Kibana5601 and TomEE8080 bind loopback.

`VISULIA_SESSION_ID` and a fresh64-hex `VISULIA_AGENT_TOKEN` are required at startup. The Stack Durable Object generates/passes the latter, replaces forwarded authorization, and deletes its copy at shutdown. It is distinct from the public session-owner token.

The agent port is opened after ES security setup and all three health checks succeed. Startup is bounded by210seconds; an independent30-minute runtime deadline stops the process if control-plane cleanup is unavailable. Unexpected child exits also close the agent and stop sibling process groups.

Current internal routes: authenticated health, session-user credentials, `/elasticsearch/*`, and the session's Kibana base path. Service forwarding uses only the session user. Input is limited to10MiB per request; responses stream. Public Worker routing, browser handoff, editable run/upload APIs and the CLI still require integration.

## Manual remote-runner sequence

```sh
npm ci --ignore-scripts
npm test
npm run test:worker
npm run check:worker
docker build -t visulia-vector:build -f containers/vector/Dockerfile .
docker build -t visulia-stack:build -f containers/stack/Dockerfile .
node scripts/test-stack.mjs
```

`.github/workflows/runtime-build.yml` performs these checks on a manually triggered GitHub runner, plus actual patched-Vector parser/delivery tests and ten delivery repetitions. It does not deploy Cloudflare, publish npm, or publish an image registry package.

The smoke container has networking disabled and6GiB memory. Requests are made by `docker exec` within the VM. The test generates four actual TomEE requests, reads their access log with Vector, checks four documents and HTTP-status ES|QL results in real Elasticsearch, then creates/reads a Kibana Data View. It removes the named container even when `docker run` rejects, and verifies absence through the daemon. It does not yet create a rendered Dashboard or prove Cloudflare isolation/deletion.

## Evidence boundary

Local tests exercise HTTP transport, auth, process supervision, filesystem permissions, request limits and a simulated Container SDK. The Dockerfiles and smoke harness are candidates until the remote job succeeds. Image startup and patched-Vector delivery must not be inferred from local green tests. Runtime logs are currently suppressed; failed-start diagnostics need further operator-facing work.

Upstream TomEE image layout was checked against the official-images source revision3695dcec008bf611b2dbd06eb2123a7b159efc27: `/usr/local/tomee`, Temurin21 JRE on Ubuntu Noble. Vendor licenses remain in the copied distributions; Vector's license and modified-source patch are also copied.
