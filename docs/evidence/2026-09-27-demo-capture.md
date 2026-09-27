# Actual-log demo capture integration — 2026-09-27

`POST /runs/:id/demo` starts bounded background generation with `scenario`, `count`
(1–1800), and `rate` (1–5 requests/sec). Only one generator runs per session. Its
status and number of captured lines appear in `GET /runs/:id` as `demo`.
`POST /runs/:id/stop` cancels generation and stops ingestion.

The production generator sends requests only to the private TomEE service. A reader
opens the actual access-log cursor before the first request and then selects complete
lines by the request's random ID. It handles delayed writes, rejects unexpected file
replacement/truncation, and fails when no matching log arrives within five seconds.
It does not derive timestamps, durations, or log rows from client request measurements.

The workflow is: generate an initial sample, wait for completion, check, ingest,
then start more generation while Vector tails the same input. Configuration changes
and uploaded-file replacement are forbidden while a generator owns the run. Reparse
cancels generation and fences queued appends before checking retained records. Append
operations are serialized with other run mutations and bounded to 10 MiB per run.
The metadata contract for generated TomEE logs is pipe-v1 with microsecond durations.

## Evidence and limits

- Local application test suite: 75 passing, including delayed/partial writes, missing
  log timeout, cancellation, changed file detection, correlated byte capture, live
  ingest append, and both active and queued generation during reparse.
- Independent review found a stale generation-lock bug during reparse. A reproducing
  test failed before the fix and passed after it; a queued-append regression covers
  the deadlock/fencing case separately.
- The remote container smoke script now uses these APIs to generate 4 actual requests,
  check/ingest, append 4 more, verify ES|QL counts, reparse, and create a Kibana Data View.
  **This revised remote smoke has not run yet.** The currently running image workflow
  uses an earlier revision. Local file fixtures are not evidence of an actual TomEE
  instance or a completed public deployment.
