# Browser gateway verification — 2026-09-27

The CLI `kibana` action asks the owner-authenticated control API for a browser link.
A random one-use ticket is carried in the URL fragment, not its query string. The
landing page immediately removes the fragment from browser history and posts the
ticket to the same origin. The server stores only its hash and a maximum 60-second
expiry; atomic exchange creates an HttpOnly, Secure, SameSite=Strict cookie scoped
to `/s/<session>/`.

Only `/s/<session>/kibana` routes accept that cookie. The cookie cannot authenticate
CLI API requests. Each browser request rechecks the session state, lease and container
state. Mutations and ticket exchange require a same-origin Origin header. CLI
heartbeats retain the session; browser browsing does not extend its lease. Closing a
session purges both pending ticket and browser hashes, even when destruction needs
retrying. Opening a new browser link invalidates the previous browser credential.

## Verified

- 81 local application tests passed, including CLI rejection of an off-origin browser link.
- 13 workerd tests passed; worker type checking passed.
- Browser-specific workerd cases cover wrong owner, wrong session cookie, external
  mutation origin, one-use/concurrent exchange, expired ticket, revocation, auth-state
  deletion and landing-page security headers.
- Independent read-only review found no additional concrete issue in this change.

## Not yet verified

These tests manually submit Cookie headers. They do not prove browser cookie behavior,
Kibana asset loading, rendered panels or editing against a deployed runtime. Actual
browser validation and Cloudflare deployment remain outstanding. The current remote
runtime build uses the earlier CLI revision and does not include this gateway change.

## Dashboard API research for the next implementation

Use the official version-specific schema, not the latest API shape:
https://github.com/elastic/dashboards-api-spec/blob/main/openapi/archive/kibana-openapi-9.4-experimental.yaml

The current docs explicitly identify breaking changes between 9.4 and 9.5:
https://dashboardsapispec.kibana.dev/introduction-openapi.yaml

The 9.4 archive documents POST `/api/dashboards` with inline `vis` panels and ES|QL
`data_source`. Runtime acceptance and browser rendering must still be established
before saving any generated dashboard as a verified reusable template.
