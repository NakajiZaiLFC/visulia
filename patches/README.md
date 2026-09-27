# Vector disk-buffer write-completion backport

The unmodified Vector 0.58.0 arm64 macOS release intermittently stalls the VISULIA quiet-input integration tests (no more records reach the test sink until process shutdown). Passing a single run is not acceptance evidence.

An upstream proposed fix for the matching writer/reader race is [vectordotdev/vector PR 26410](https://github.com/vectordotdev/vector/pull/26410), inspected at commit `41e9abc6e1c3862b27065cfc35aa892eab4295fa`. It awaits the underlying asynchronous file flush before publishing write completion to the reader. It does not add per-record fsync or change the disk format. The PR is still open at the time of inspection; this is not an upstream released fix.

`vector-0.58.0-flush.patch` contains the writer change and four deterministic regression tests from that PR. Attribution: mzd00 and Vector contributors. The upstream project is MPL-2.0 licensed; retain the upstream license and provide the modified source and patch with any distributed binary. The source base is the official release commit `2bcad9bbb84e201dcfd58c22b1f779290101b728`.

Verified here: `git apply --check` against the exact 0.58.0 writer source passes. Not yet verified here: compiling or running the patched binary. Do not describe the runtime stall as fixed for VISULIA until the patched build and quiet-input/recovery tests pass.

`containers/vector/Dockerfile` is the build candidate. It runs the buffer regression tests and builds the Vector components used by VISULIA. The Rust/Debian base images are pinned to inspected linux/amd64 digests. The image must still be built and tested remotely; no Docker daemon or Rust toolchain is available in this development environment. The build itself requires network access; the resulting runtime must not.

Use from the repository root on a build host:

```sh
docker build --platform linux/amd64 -f containers/vector/Dockerfile -t visulia-vector:0.58.0-flush .
```

Remove this backport when a verified upstream release contains the fix, then rerun parser, quiet-input, outage, process-restart and rotation tests before changing the runtime pin.
