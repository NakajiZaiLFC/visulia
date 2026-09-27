# Runtime bootstrap building blocks — 2026-09-27

This increment prepares the session-container runtime. It does not yet provide a runnable combined image or public agent API.

## Implemented

- Fresh random per-session Elastic bootstrap, Kibana system, demo user and encryption secrets; private ES/Kibana listeners; session-specific Kibana base path.
- Bootstrap ordering: write configurations, pass bootstrap secret to the keystore through stdin, start ES, wait for readiness, set Kibana system password, create restricted demo data role/user, start Kibana and TomEE, wait for both. Security setup failure invokes shutdown before a dashboard is launched.
- Demo user combines `kibana_admin` with index privileges for `visulia-*` and selected cluster capabilities; it does not receive `manage_security` or the bootstrap password.
- Fresh private runtime filesystem from installed config assets; exclusive startup marker refuses reuse. Source installation directories are trusted image contents, not user upload paths.
- Service process-group shutdown, TERM-to-KILL escalation, unexpected-exit cancellation, sanitized failure codes. Child stdout/stderr are discarded; useful bounded diagnostics still need design before public operations.
- Bounded fixed-origin TomEE demo requests with unique request IDs, actual status recording and cancellation.
- TomEE JSP/config assets for normal, slow, missing and intentional-error requests; access logs use explicit timestamp timezone, request ID and `%D` microseconds. Health requests are excluded from access logging.

## Verification

`npm test`: 44 passed on Node.js 25.8.2. This includes previous session/store/pipeline tests.

New checks exercise real child processes (exit, spawn failure, ignored TERM, descendant termination), real temporary filesystem preparation and permissions, and a transient local HTTP health fixture (unavailable, malformed JSON, incomplete readiness, redirects, cancellation and timeout). Demo tests inject an HTTP client; bootstrap orchestration uses an explicit IO fixture because ES/Kibana/TomEE are not installed on this machine.

Independent review reproduced a shutdown defect: a launcher could exit before a TERM-ignoring descendant, prematurely cancelling escalation. A new regression failed before the fix; final shutdown now sends KILL to retained groups even after direct-child completion. The reviewer reran five focused lifecycle/filesystem tests and found no additional important issue in that scope.

## Not yet proven

- Production BootstrapIO adapter, agent HTTP gateway and combined image entrypoint are not implemented in this increment.
- Actual Elastic configuration acceptance, password setup, role privileges and readiness are unverified against running Elastic 9.4.7.
- Actual TomEE JSP routing and access-log format are unverified against the pinned TomEE image.
- No Cloudflare deployment, real service image build, npm installation, browser dashboard, or end-to-end deletion evidence was produced.
- The previously recorded unpatched Vector disk-buffer stall remains an open acceptance gate.

## Implementation references

- Elastic built-in user bootstrap and Kibana system separation: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/built-in-users
- Elastic role API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-role
- Tomcat 10.1 access log valve: https://tomcat.apache.org/tomcat-10.1-doc/config/valve.html
