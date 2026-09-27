# Access-log pipeline contract

The runtime pipeline targets Vector 0.58.0 with a pending disk-buffer fix; see `patches/README.md`. The unmodified release has shown intermittent stalls, so continuous-delivery acceptance is still open. Both built-in formats produce the common schema in `templates/mappings/access.json`. The parser is an editable VRL template, not JavaScript or a shell program. Mapping edits generate a corresponding VRL guard before ingestion; unknown fields and invalid types go to the dropped-event path instead of the Elasticsearch sink.

## Formats and metadata

`pipe-v1` has exactly six fields:

```
RFC3339 timestamp|HTTP method|URL path|status|elapsed time|request ID
2026-09-27T12:00:00.123+09:00|GET|/demo/ok|200|1234|request-001
```

An AccessLogValve pattern for the planned demo is:

```
%{yyyy-MM-dd'T'HH:mm:ss.SSSXXX}t|%m|%U|%s|%D|%{X-Visulia-Request-Id}i
```

`common-v1` accepts the explicit common pattern `%h %l %u %t "%r" %s %b`. It has no duration or request ID. `-` usernames are omitted, rather than treated as users. Query strings are excluded from `url.path` and remain in `event.original`.

Required metadata: `format`, `duration_unit`, `service_name`, `service_version`, `environment`, `host_name`. The manager supplies `run_id` and the file source supplies `file_path`. Optional `scenario` is a label. Metadata is supplied context; it is not extracted from or evidence about the log text.

Set `duration_unit` explicitly to `ns`, `us`, `ms` or `s` for `pipe-v1`, and `none` for `common-v1`. Current Tomcat 10.1 documentation specifies microseconds for `%D`; do not assume that value for an unspecified historical product/version. See [Tomcat AccessLogValve reference](https://tomcat.apache.org/tomcat-10.1-doc/config/valve.html).

Timestamps require an explicit offset and normalize to UTC. Durations normalize to integer nanoseconds using decimal-string conversion. Sub-nanosecond precision and values above JavaScript's maximum safe integer (9,007,199,254,740,991 ns) are rejected. No float-rounding conversion is used.

## Mapping edits

The current editable subset supports nested objects and leaves of type `keyword`, `text`, `integer`, `long`, `float`, `double`, `boolean` and `date`. Root mapping must be `dynamic: strict`; nested objects cannot opt out. Coercion cannot be enabled. Field names are constrained, with at most 128 fields and eight nesting levels. Unsupported Elasticsearch mapping options fail explicitly rather than being ignored.

Common required fields and their types cannot be removed or changed. Additional declared fields are allowed and are validated before the sink. This is a defined subset, not a validator for every Elasticsearch mapping feature. New mapping creation and actual Elasticsearch compatibility still require service-side validation before collection starts.

## Delivery and recovery

- File identity is `device_and_inode`, supporting distinct files with equal content and rename rotation. Copytruncate and inode reuse after deleting/recreating files are not guaranteed.
- The generated config reads only the manager-selected run input directory. Callers must supply a private run directory; this function is not a filesystem authorization boundary.
- A 256 MiB disk buffer applies backpressure when full. Delivery is at least once, not exactly once.
- Demo request IDs combine with the run ID for Elasticsearch document IDs. Anonymous requests get independent UUIDs; equal content does not collapse separate requests. Anonymous-event deduplication after rereading source data is not guaranteed.
- Parse/schema failures retain the original input and Vector's failure annotation in the private run quarantine directory. They are not sent to the normal index.
- The parser rejects lines over 64 KiB. The file source ceiling is 10 MiB; the upload manager must reject inputs above its limits before writing files. Source-size rejection does not create a quarantine event, so this ceiling is not a substitute for upload validation.
- Permanent Elasticsearch bulk errors retry the batch under backpressure; the pipeline does not claim those errors are parser quarantine events. Raw input must remain available for diagnosis and reparse.
- A new reparse run must use a new run ID/index and state directory. The pipeline does not overwrite a previous run's index by default.

## Reproduce parser and transport tests

Install Vector 0.58.0 as a test dependency, then run:

```sh
npm ci
VECTOR_BIN=/absolute/path/to/vector npm run test:vector
```

`VECTOR_BIN` can be omitted if Vector is already on PATH. Nothing automatically downloads or installs Vector. The tests use actual Vector processing and a temporary loopback HTTP test server for the Elasticsearch bulk protocol. They do not start Elasticsearch, Kibana or TomEE and do not prove those services' behavior.
