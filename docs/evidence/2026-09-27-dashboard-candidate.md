# ES|QL dashboard candidate — 2026-09-27

The CLI `dashboard` action inspects the run's actual mapping and time bounds, validates
each ES|QL query, creates a new Kibana dashboard and reads it back. It compares saved
panel queries with the submitted queries and then issues a one-use browser link to the
new dashboard. It never updates an existing dashboard.

The candidate contains request count, 5xx percentage, p95 duration in milliseconds,
a bounded time trend, host/path/status breakdown and the latest 100 original access
records. The default time range starts at the first event and ends at now (or the last
future event); refresh is five seconds. If the optional duration field is absent from
the actual mapping, a text panel explains its absence and the evidence query omits it.
No Data View is created for these ES|QL-only panels.

## Executed evidence

- Full local application suite: 85 passing. Focused dashboard tests cover validation
  before creation, rejected queries, saved-query mismatch, partial-result rejection,
  invalid run IDs, and valid mappings without duration.
- Independent review caught the fixed-minute trend's result-limit risk and the optional
  duration compatibility defect. The trend now uses approximately 75 buckets across the
  selected range. Missing duration has a separate failing-before/passing-after regression.
- The full-duration payload passed validation against the official 9.4 archive schema.
  Validation also caught missing `settings` on the duration-free markdown panel; this
  was corrected, and the duration-free payload then passed as well. These schema checks are not a substitute for actual Kibana acceptance.
- The remote smoke script now invokes the same dashboard creation function after actual
  TomEE generation/Vector ingestion. This updated script has not run yet.
- A pre-existing process-startup test hit its two-second test harness deadline under
  parallel load, but passed in isolation. The harness now allows ten seconds and checks
  process-spawn errors explicitly; its expected exit code and output remain unchanged.

## Sources and pending proof

API source: https://github.com/elastic/dashboards-api-spec/blob/main/openapi/archive/kibana-openapi-9.4-experimental.yaml

Programmatic dashboard overview: https://www.elastic.co/docs/explore-analyze/dashboards/create-dashboards-programmatically

The implementation is a candidate API definition, **not a runtime-accepted template**.
Actual ES|QL execution, Kibana API acceptance, visual rendering, interactive filtering,
continuous updates and navigation to original evidence all require live verification.
The public Cloudflare demo and npm publication remain incomplete.
