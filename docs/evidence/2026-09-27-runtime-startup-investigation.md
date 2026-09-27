# Runtime startup investigation

The remote build succeeds, but run 36298637793 exits before readiness. Its fixed diagnostic markers prove that private filesystem preparation and keystore provisioning succeeded, Elasticsearch was launched, and readiness on 9200 was not reached. Kibana and TomEE were not started. This is not a Cloudflare account or local disk failure.

Run 36299107918 adds a CI-only second reproduction in a fresh, network-disabled container. It captures bounded child output, redacts the generated credentials and destroys the reproduction container. No uploaded input or existing session is inspected.

## Candidate, not yet live-verified

Elasticsearch 9.4.7's upstream `elasticsearch-env` changes the process working directory to ES_HOME, while `jvm.options` uses a relative `gc.log` output. The combined image copies ES_HOME as root and runs as UID10001. The runtime therefore needs explicit writable paths for JVM outputs, in addition to Elasticsearch's `path.logs`.

The candidate adds `jvm.options.d/visulia.options`, disables inherited GC logging, and redirects GC, JVM fatal-error and heap-dump files into `/work/elasticsearch-logs`. Unit verification checks the generated bootstrap configuration; it does not prove JVM acceptance or successful ES startup. The pre-change bootstrap test failed because no override was written. With the candidate, all 95 local tests pass.

Wait for the actual child error from the diagnostic run before describing this hypothesis as the confirmed cause. The running diagnostic job does not contain this candidate fix.

Sources inspected:
- https://raw.githubusercontent.com/elastic/elasticsearch/v9.4.7/distribution/src/bin/elasticsearch-env
- https://raw.githubusercontent.com/elastic/elasticsearch/v9.4.7/distribution/src/config/jvm.options
