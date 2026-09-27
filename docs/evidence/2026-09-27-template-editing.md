# CLI configuration editing — 2026-09-27

`init` prompts for pipe/common format, duration unit and service/environment/server
metadata while retaining the current parser and mapping. Common access format uses
`duration_unit: none`. Changes still pass through server validation and invalidate
previous preflight checks.

`template` explicitly exports only metadata, parser and mapping to a user-selected
new JSON file with private permissions. It never overwrites an existing file and does
not export session tokens or run state. The server's configuration remains authoritative.
The user can edit the file and load it with `config`, then check or reparse.

Known structured server errors now produce actionable Japanese hints (stop active
work, check first, reparse changed input/configuration, wait for capacity). Arbitrary
error response text is not printed, and error-body reading is bounded to 4 KiB.

The full local application suite passed 87 tests. New regressions cover export content,
private file permissions, overwrite refusal, known error codes and suppression of
unknown upstream error text. This is not evidence of a deployed/public demo. Remote
runtime verification remains in progress in run 36297592703, on an earlier revision.
Dashboard template export/import and selfhost setup are still outstanding.
