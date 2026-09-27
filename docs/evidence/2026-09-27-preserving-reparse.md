# Reparse preserves previous analysis

The original implementation deleted the existing index and checkpoints. This contradicted the approved design's requirement to reparse into a new destination without implicitly overwriting previous results.

Reparse now stops the source run and demo, checks it, creates a fresh run ID, copies normalized and original uploaded bytes, checks again with the new ID, and starts ingestion into the new index. Source index, inputs, quarantine and checkpoints are retained until session cleanup. The existing three-run limit includes reparse runs; a capacity rejection happens before stopping the source. A failed new run remains visible for inspection/recovery and never causes the original index to be deleted. Ambiguous index creation remains fenced on the original run.

CLI commands `runs` and `use` list/select analyses. Successful reparse switches the active run/query target to the returned new ID. Existing dashboards keep referencing their original index; a new dashboard is an explicit action.

Verification: 99 unit/real-process CLI tests passed. Focused tests prove separate IDs, no index-delete call, copying original bytes, retained real checkpoint files, source queue fencing, invalid cloned-parser rejection before new index creation, capacity rejection without stopping source, and query target selection after reparse/use. Elasticsearch calls are fixtures in these tests; real index preservation is not yet proven. The remote smoke was extended to count both old and new indices after reparse. The active runtime job 36299582639 predates this change.

Independent read-only review reran the 17 affected run/CLI tests and found no concrete important issue. The review did not claim actual Elasticsearch index retention.
