# Fresh public Windows toolchain

This path provisions Emscripten and SCons from public sources, without an existing
SDK, copied virtual environment, or the engine author's machine. It does not
build Godot or establish an engine, simulator, phone, visual, or gameplay pass.

Run with PowerShell 7, Git, and an explicitly selected existing Python interpreter:

```powershell
pwsh -NoProfile -File ./engine/bootstrap-toolchain.ps1 `
  -Destination E:/AI/wechat-wasm-slim/.local/glx-public-deps-20261023-01 `
  -BootstrapPython C:/Users/赵江/AppData/Local/Python/pythoncore-3.14-64/python.exe
```

The destination must not exist for a normal run. Use a different new destination
for another attempt. Legacy `-ResumeFromActivation` and `-ResumeFromCache`
switches now reject without writing: the early recovery recipe did not capture
a pre-failure installed-file fingerprint, so those directories cannot establish
a safe resume baseline. The script retains downloads, logs, partially built caches, and failures;
it does not reset or delete existing evidence. Archive requests have a 1200-second
timeout and one retry. Git fetch has a 300-second process timeout; installation
and cache preparation each have a 1800-second process timeout. Child processes
run without a visible console and with `PYTHONUTF8=1` to avoid Windows code-page
failures when emsdk writes a Unicode inherited PATH. `EMSDK_PYTHON` and
`EMSDK_NODE` point explicitly to the owned runtimes, including nested emcc batch
wrappers used by embuilder. Only the child process environment is configured;
inherited `EM_*`, `EMCC_*`, `EMSDK*`, `EMMAKEN_*`, `BINARYEN_*`, `PYTHONHOME`,
`PYTHONPATH`, `NODE_OPTIONS`, and `NODE_PATH` overrides
are removed first, and `PYTHONDONTWRITEBYTECODE=1` avoids Python bytecode writes.
There is no global install, PATH update, system activation, or emsdk upgrade.

`-ValidateFrozenOnly` accepts a completed frozen baseline with matching recorded
SDK key-file/cache hashes, pinned archive hashes, clean tracked SDK Git files,
SCons wheel/version, and venv base interpreter. It snapshots the original probe
outputs and metadata in a new `attempts/validate-<timestamp>` directory, then
links only the probe and checks versions. It does not reprepare the cache or
rewrite SDK configuration. Outputs and per-attempt `STATUS.json` stay in that
new directory. Root `CURRENT-STATUS.json` identifies the latest attempt and its
metadata; consult that record before interpreting older success metadata.
SDK key-file and cache hashes are compared again after frozen validation.

Inputs are the official [emsdk repository](https://github.com/emscripten-core/emsdk)
at commit `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb` (4.0.10), its pinned release
mapping `8103ffedfb0c42d231c6af6859a5a1a832260b43`, SDK Python 3.13.3,
SDK Node 22.16.0, and SCons 4.11.1. SCons is downloaded from PyPI as a wheel
and installed offline with the SHA-256 required by `requirements-scons.lock`:
`454cef364348053422696e3d2ecb4fa593c96a624f955842eaaea64f95c8d11d`.
The SDK archives come only from the pinned manifest's Google storage location.
The recipe locks the SHA-256 of each SDK archive to the public acquisition
verified on 2026-10-23. `DOWNLOADS.lock.json` records their URLs, sizes, and
observed SHA-256 values; these acquisition hashes are evidence of downloaded
bytes, not an independent publisher signature. The source commit and release mapping are checked before
installation. `TOOLCHAIN.json` records SDK key-file and final cache hashes.

The script invokes `emsdk.py install 4.0.10` and local `activate 4.0.10` using
the explicit bootstrap Python. It deliberately bypasses `emsdk.bat` and its
runtime selection. A fresh venv is created **at its final location**, using its
own SDK Python. `venv/pyvenv.cfg` therefore references this provisioned SDK;
the environment is self-contained relative to that SDK installation, but it is
not promised relocatable or byte-identical across paths or machines.

Cache preparation uses `EMCC_CORES=2`, `embuilder.py --lto=thin build`, and targets
validated against this SDK's `--help`: `libal`, `libc`, `libc++`, `libc++abi`,
`libcompiler_rt`, `libdlmalloc`, `libGL-webgl2`, `libhtml5`, `libsockets`, and
`libstubs`. The cache is writable only during preparation and then frozen in
the SDK-local `.emscripten` file. A small owned C++ source probes a link with
ThinLTO, exceptions, WebGL 2, `GL_ENABLE_GET_PROC_ADDRESS=0`, 32 MiB initial
memory, 5242880-byte stack (Godot's `stack_size=5120` means 5120 KiB), and
`EXIT_RUNTIME=1` (matching Godot's web build).
Threads, SIMD, and offscreen framebuffer are not
enabled. The generated WASM is **not executed**. Successful frozen linking
establishes only that these probe requirements can link using the prepared
cache; a full engine build may need additional cache variants.

Review `logs/*`, `DOWNLOADS.lock.json`, and `TOOLCHAIN.json`. A final
`status: frozen-probe-link-pass` is written only after version checks and the
frozen link have completed. Failed attempts have a failed current status and do
not produce new success metadata; original successful metadata is retained.

`prepare-selfbuild.ps1` is a separate recipe: it **copies** an SDK and a venv.
Copying a Python venv preserves its `pyvenv.cfg` base-interpreter dependency;
the copied venv can still reference the original SDK. Such copying must not be
described as a portable, independent environment. This bootstrap recipe avoids
that dependency by creating the venv in the final directory. When passing these
provisioned directories to the copying recipe, inspect the resulting venv's
base-interpreter path before making an independence claim.

## Local verification on 2026-10-23

The new `E:/AI/wechat-wasm-slim/.local/glx-public-deps-20261023-01`
installation completed the frozen probe link with Emscripten 4.0.10,
Node 22.16.0, Python 3.13.3, and SCons 4.11.1. All ten SDK key-file hashes,
ten ThinLTO library hashes, the SCons wheel hash, and probe WASM hash were
independently reread and matched the attempt's `TOOLCHAIN.json`. After correcting
the stack unit to 5120 KiB, the current frozen probe WASM SHA-256 is:
`b1d9ee605f42ee810cb0e7fd400ab67de3690b953fd22199cac48cbfec8704b7`.
Its metadata and logs are under `attempts/validate-20261023-174305-753`.
The earlier 5120-byte-stack probe hash
`382dc83ce3c918107a62880685947a0ace0d943c421475dee33f2ed3bfdedf66`
and original metadata remain in place and in that attempt's
`prior-success-snapshot`; `PREVIOUS.json` records their identities.

This was verified through an initial fresh acquisition followed by explicit
resumes, not a second clean one-shot run. Retained failed logs show: activation
could not encode the inherited PATH until child UTF-8 mode was configured;
embuilder's emcc batch wrapper needed explicit child `EMSDK_PYTHON`; the
first probe omitted Godot's `EXIT_RUNTIME=1` and consequently requested missing
`libnoexit.a`. That historical recovery used an earlier revision of the resume
switches; current legacy resume is disabled. The stack-only revalidation passed
with the ten prepared libraries and unchanged recorded SDK/cache hashes. Two
earlier validation attempts stopped at the empty clean-Git-status output guard;
their logs remain in separate attempt folders. The corrected guard accepted
the empty status output and the final sanitized child environment and version
checks ran in `attempts/validate-20261023-174305-753/logs`.
The previously used `-02` SDK was only read during
recipe inspection. No full Godot build was performed with this fresh SDK, and
the probe WASM was not run.
