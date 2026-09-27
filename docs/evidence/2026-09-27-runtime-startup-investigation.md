# Runtime startup investigation

Remote run 36298637793 proved that private filesystem preparation and keystore provisioning succeeded, Elasticsearch was launched, and readiness on 9200 was not reached. Kibana and TomEE were not started.

Run 36299107918 reproduced startup in a second fresh network-disabled container. Its bounded, credential-redacted child output identifies the immediate cause: `UnknownHostException` for the container hostname, followed by `status logger logged an error before logging was configured`. Elasticsearch exited with code 1. Log4j attempts local-host resolution and logs an error when a network-none VM has neither a resolvable hostname nor another non-loopback interface.

The earlier hypothesis about JVM GC-log write permissions was not supported by this trace. That candidate change was removed, including its generated JVM option overrides.

## Fix pending live verification

The runtime writes a private `/work/config/java-hosts` mapping localhost and the actual OS hostname to loopback. Elasticsearch CLI/server JVMs and TomEE receive `-Djdk.net.hosts.file=/work/config/java-hosts`. The bundled JVMs can resolve their own host without depending on external DNS, writable `/etc/hosts`, root privileges or Docker-only hostname flags. All service endpoints remain loopback; the file-based resolver deliberately does not provide external hostname resolution in the dedicated demo runtime.

Tests first failed for missing JVM resolver configuration, then passed with the fix. The hostname is validated before writing to prevent injected resolver entries. Real acceptance still requires the remote network-disabled smoke test to pass; this document does not claim successful Elasticsearch startup yet.

Sources:
- https://raw.githubusercontent.com/apache/logging-log4j2/rel/2.26.1/log4j-core/src/main/java/org/apache/logging/log4j/core/util/NetUtils.java
- https://raw.githubusercontent.com/openjdk/jdk25u/master/src/java.base/share/classes/java/net/InetAddress.java
