# Dashboard template editing — 2026-09-27

`dashboard-pull` reads a selected Kibana dashboard and writes an explicitly selected new
local template file. The server remains the dashboard's authoritative store. The
portable definition replaces the current run's exact FROM source with
`{{VISULIA_INDEX}}` and removes panel IDs so a new dashboard receives fresh IDs.
`dashboard-apply` binds the current run, adapts the top-level time range to that run,
validates all ES|QL queries, creates a new dashboard and reads back its title, panel
count and queries. It does not PUT or overwrite the original dashboard.

The supported portable subset is inline ES|QL visualizations and markdown panels.
Library-backed panels, other panel kinds and pinned controls fail explicitly. A GET
response warning that Kibana omitted a panel also stops export; it must not become a
silently incomplete template. Custom per-panel time ranges remain explicit.

Reference replacement tokenizes source clauses so matching filter string literals and
comments are preserved. Exact quoted FROM sources are supported. An old run reference
outside FROM as an unquoted identifier is rejected rather than guessed.

The full local suite passed 93 tests. Independent review identified ignored omitted-panel
warnings and string-literal corruption; both were reproduced with failing regressions
and fixed. Additional tests cover source quoting, comments, identifier boundaries,
unsupported non-FROM references, new IDs and no updates to existing dashboards.

The remote smoke now includes export, edited-query application, distinct dashboard IDs,
and original-title preservation. That version has not run yet. Actual Kibana API
acceptance and rendered editing/reapplication remain unverified until the remote
runtime and browser checks complete.
