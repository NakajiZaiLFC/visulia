# Offline validation

Implemented `visulia check --offline --config <JSON> --logs <UTF-8 file> [--vector <executable>]`. This branch never creates SessionClient or asks an interactive question. It reuses the upload decoder and the actual preflight Vector parser/mapping guard. The generated Vector config has no Elasticsearch sink. It writes only a private temporary validation config, removes it afterwards, and does not modify the user's input.

Input is bounded to 1 MiB of configuration, 10 MiB of logs, 20,000 lines and 64 KiB per line. The reader checks regular-file type and bounds actual reads, not only an initial stat. FIFO input does not block on open. UTF-8 decoding is strict; BOM and CRLF normalization match server uploads. Missing/duplicate/unknown options fail without prompting.

Verification: all 95 unit tests passed before the final nonblocking-open change; the affected 14 run/CLI tests and two real Vector CLI tests passed afterwards. Vector 0.58.0 was run on macOS/arm64. Tests cover accepted and rejected logs, BOM/CRLF, preservation of original input, invalid UTF-8, missing arguments, JSON result and exit codes. A deliberately unusable VISULIA_SERVER did not affect the offline branch. Read-only independent review reran both actual Vector tests and found no concrete important issue.

No packet-capture claim is made. This is local parser/schema validation, not proof of ES connectivity, index privileges, installed mapping compatibility, or the remote runtime's startup. The user must run the server-side check again before ingesting. Public-demo clients do not need Vector; this optional local operation does require a Vector executable.

Package check: `npm pack` was installed into a fresh temporary consumer with install scripts disabled. The installed CLI passed five real-process tests: normal/start session lifecycle and EOF cleanup against a local HTTP fixture, plus the two offline checks with actual Vector. This verifies package contents and executable imports, not a real remote session. No npm publication occurred.
