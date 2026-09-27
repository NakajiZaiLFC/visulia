# Build from the audited release commit, not a moving PR branch.
FROM rust:1.95-bookworm@sha256:4c2fd73ef19c5ef9d54bee03b06b2839a392604fbfcd578ed948b71b37c1d7fb AS build
RUN apt-get update && apt-get install -y --no-install-recommends clang cmake pkg-config libssl-dev protobuf-compiler git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src/vector
RUN git init && git remote add origin https://github.com/vectordotdev/vector.git && git fetch --depth=1 origin 2bcad9bbb84e201dcfd58c22b1f779290101b728 && git checkout --detach FETCH_HEAD
COPY patches/vector-0.58.0-flush.patch /tmp/flush.patch
RUN git apply --check /tmp/flush.patch && git apply /tmp/flush.patch
RUN cargo test --locked -p vector-buffers write_completion_tests
RUN cargo build --locked --release --no-default-features --features sources-file,sources-stdin,sources-internal_metrics,transforms-remap,sinks-elasticsearch,sinks-file,sinks-console,sinks-blackhole

FROM debian:bookworm-slim@sha256:f3034a6ec3c1205360777c4aae76234998866ad18806ae62b63a3f84ccad782b
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/vector/target/release/vector /usr/local/bin/vector
COPY --from=build /src/vector/LICENSE /usr/share/doc/vector/LICENSE
COPY --from=build /src/vector/lib/vector-buffers/src/variants/disk_v2/writer.rs /usr/share/doc/vector/modified-writer.rs
COPY patches/vector-0.58.0-flush.patch /usr/share/doc/vector/flush.patch
ENTRYPOINT ["/usr/local/bin/vector"]
