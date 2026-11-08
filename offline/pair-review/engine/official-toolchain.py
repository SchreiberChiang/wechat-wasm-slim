"""Prepare the fixed Windows toolchain without a community game template.

Default is a read-only plan. Execution needs --write and a separately approved
fresh directory. No resume, global install, engine checkout or engine build.
"""
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import time
import urllib.parse
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
GIB = 2 ** 30
LOCK = HERE / "official-toolchain-downloads.json"
POLICY = HERE / "fixed-toolchain-cache.json"
INPUTS = [Path(__file__).resolve(), LOCK, POLICY, HERE / "requirements-scons.lock",
          HERE / "official-cache-build.py",
          HERE / "fixed-dependency-audit.py", HERE / "official-build-preflight.mjs",
          HERE / "fixed-build.mjs", HERE / "alpha-preserve-lighting/delivery-resources.ps1"]


def require(ok, code):
    if not ok:
        raise ValueError(code)


def identity(file):
    file = Path(file)
    require(file.is_file() and not file.is_symlink() and not file.is_junction(), "REGULAR_FILE_REQUIRED")
    with file.open("rb") as stream:
        return {"bytes": file.stat().st_size, "sha256": hashlib.file_digest(stream, "sha256").hexdigest()}


def config_bytes():
    # Same portable bytes as the successful recipe, no developer drive path.
    return ("import os\n"
            "emsdk_path = os.path.dirname(os.getenv('EM_CONFIG')).replace('\\\\', '/')\n"
            "NODE_JS = emsdk_path + '/node/24.19.0_64bit/node.exe'\n"
            "PYTHON = emsdk_path + '/python/3.13.3_64bit/python.exe'\n"
            "LLVM_ROOT = emsdk_path + '/upstream/bin'\n"
            "BINARYEN_ROOT = emsdk_path + '/upstream'\n"
            "EMSCRIPTEN_ROOT = emsdk_path + '/upstream/emscripten'\n"
            "FROZEN_CACHE = True").encode("utf8")


def inputs():
    lock = json.loads(LOCK.read_text(encoding="utf8"))
    policy = json.loads(POLICY.read_text(encoding="utf8"))
    require(lock["schema"] == "wxslim-official-toolchain-downloads-v1", "LOCK_SCHEMA")
    require(len(lock["archives"]) == 4 and len(lock["metadata"]) == 2, "FIXED_DOWNLOAD_SET")
    for spec in lock["archives"] + lock["metadata"]:
        uri = urllib.parse.urlsplit(spec["url"])
        require(uri.scheme == "https" and uri.hostname in {"nodejs.org", "storage.googleapis.com", "raw.githubusercontent.com"}
                and not uri.username and not uri.password and not uri.query and not uri.fragment, "FIXED_DOWNLOAD_URL")
        require(re.fullmatch(r"[a-zA-Z0-9_.-]+", spec["name"]) and re.fullmatch(r"[a-f0-9]{64}", spec["sha256"]), "LOCK_IDENTITY")
    require({t + ".a" for t in lock["thinTargets"]} == set(policy["thinLtoLibraries"]), "CACHE_TARGET_SET")
    require(hashlib.sha256(config_bytes()).hexdigest() == policy["sdkFiles"][".emscripten"], "PORTABLE_CONFIG_IDENTITY")
    sdk = lock["archives"][1]
    require({k: sdk[k] for k in ("bytes", "sha256")} == policy["sdkArchive"], "SDK_ARCHIVE_IDENTITY")
    return lock, policy


def plan(root, base_python, jobs=6, budget_bytes=8 * GIB):
    require(Path(root).is_absolute() and Path(base_python).is_absolute(), "EXPLICIT_ABSOLUTE_PATHS")
    require(type(jobs) is int and 1 <= jobs <= 16, "JOBS_RANGE")
    require(type(budget_bytes) is int and 4 * GIB <= budget_bytes <= 20 * GIB, "BUDGET_RANGE")
    lock, policy = inputs()
    return {"schema": "wxslim-official-toolchain-plan-v1", "root": str(root), "basePython": str(base_python),
            "jobs": jobs, "budgetBytes": budget_bytes, "downloads": lock["archives"] + lock["metadata"],
            "knownArchiveBytes": sum(x["bytes"] for x in lock["archives"]),
            "scons": {"version": policy["sconsVersion"], "wheel": policy["sconsWheel"], "source": "https://pypi.org/simple"},
            "thinTargets": lock["thinTargets"], "cacheCommand": ["official-cache-build.py", "--lto=thin", "build", *lock["thinTargets"]],
            "cacheHashes": policy["thinLtoLibraries"], "writes": False, "executionAuthorized": False,
            "remainingExternalInputs": ["Matching installed Python 3.14.0 base", "Explicit Git executable", "Exact authorized 026e library",
                                        "Pinned upstream storage single source and license", "Matching legal editor", "Fixed official converter"],
            "limitations": ["No new-machine execution yet; archive availability and extraction not proven by this plan.",
                            "Logical budget is not a measured peak; in-flight processes are not force-killed.",
                            "No global PATH, shared SDK, game template, engine or device operation."]}


def archive_members(archive, prefix):
    # Reuse the existing read-only audit's zip validation, then enforce Windows
    # names/case and file-parent conflicts before any extraction writes occur.
    spec = importlib.util.spec_from_file_location("wxslim_dependency_zip", HERE / "fixed-dependency-audit.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    entries = module.checked_zip(archive)
    result, seen, files = [], set(), set()
    for name, item in entries.items():
        require(name.startswith(prefix), "ZIP_PREFIX")
        tail = name[len(prefix):].rstrip("/")
        if not tail:
            require(item.is_dir(), "ZIP_PREFIX_FILE")
            continue
        parts = PurePosixPath(tail).parts
        for part in parts:
            require(not any(c in part for c in '<>:"\\|?*') and not any(ord(c) < 32 for c in part)
                    and not part.endswith((".", " ")), "ZIP_WINDOWS_NAME")
            require(part.split(".")[0].upper() not in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]}, "ZIP_WINDOWS_DEVICE")
        key = tail.casefold()
        require(key not in seen, "ZIP_CASE_COLLISION")
        seen.add(key)
        if not item.is_dir():
            files.add(key)
        result.append((tail, item))
    for key in seen:
        require(not any("/".join(key.split("/")[:i]) in files for i in range(1, len(key.split("/")))), "ZIP_FILE_PARENT")
    return result


def child_environment(root, python, jobs):
    env = {k: v for k, v in os.environ.items() if not re.match(r"^(EM_|EMCC_|EMSDK|EMMAKEN_|BINARYEN_|PIP_)|^(PYTHONHOME|PYTHONPATH|NODE_OPTIONS|NODE_PATH)$", k, re.I)}
    sdk = root / "tools/emsdk"
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
               TEMP=str(root / "temp"), TMP=str(root / "temp"), PIP_CACHE_DIR=str(root / "pip-cache"),
               PIP_CONFIG_FILE=os.devnull, EM_CONFIG=str(sdk / ".emscripten"), EM_CACHE=str(sdk / "upstream/emscripten/cache"),
               EMSDK=str(sdk), EMSDK_PYTHON=str(python), EM_FROZEN_CACHE="1", EMCC_CORES=str(jobs), BINARYEN_CORES=str(jobs))
    return env


def reject_build_overrides(environment):
    keys = {"SCONSFLAGS", "SCONS_LIB_DIR", "PYTHONOPTIMIZE", "PYTHONINSPECT", "CC", "CXX", "AR", "LD", "AS", "NM", "RANLIB",
            "OBJCOPY", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH",
            "OBJC_INCLUDE_PATH", "LIBRARY_PATH", "LIB", "INCLUDE", "CL", "_CL_", "CCC_OVERRIDE_OPTIONS"}
    for key, value in environment.items():
        require(not (key.upper() in keys and value), "UNREVIEWED_BUILD_OVERRIDE:" + key)


class ExactHttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        old, new = urllib.parse.urlsplit(request.full_url), urllib.parse.urlsplit(newurl)
        require(new.scheme == "https" and old.netloc == new.netloc and not new.username, "DOWNLOAD_REDIRECT_REFUSED")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def execute(root, base_python, jobs=6, budget_bytes=8 * GIB, *, write=False):
    require(write is True, "EXPLICIT_WRITE_REQUIRED")
    require(os.name == "nt", "FIXED_WINDOWS_TOOLCHAIN")
    root, base_python = Path(root), Path(base_python)
    request = plan(root, base_python, jobs, budget_bytes)
    lock, policy = inputs()
    require(not root.exists() and not root.is_symlink() and not root.is_junction(), "FRESH_ROOT_REQUIRED")
    require(root.parent.is_dir() and root.parent.resolve() == root.parent, "ORDINARY_PARENT_REQUIRED")
    require(base_python.resolve() == base_python, "ORDINARY_BASE_PYTHON_PATH")
    require(not base_python.is_relative_to(root) and not root.is_relative_to(base_python.parent)
            and not REPO.is_relative_to(root) and not root.is_relative_to(REPO), "PROTECTED_OVERLAP")
    reject_build_overrides(os.environ)
    require(identity(base_python)["sha256"] == policy["pythonBaseExeSha256"], "FIXED_BASE_PYTHON")
    require(shutil.disk_usage(root.parent).free >= budget_bytes + 2 * GIB, "DISK_HEADROOM")
    pins = {str(file): identity(file) for file in [*INPUTS, base_python]}
    root.mkdir()  # exclusive ownership: never create/resume into an existing root
    for name in ("downloads", "logs", "temp", "inputs"):
        (root / name).mkdir()
    for file in (LOCK, POLICY, HERE / "requirements-scons.lock"):
        (root / "inputs" / file.name).write_bytes(file.read_bytes())
    record = {"schema": "wxslim-official-toolchain-result-v1", "status": "RUNNING", "request": request, "inputs": pins,
              "phases": [], "resources": [], "engineBuilt": False, "converted": False, "runtime": "NOT_RUN"}
    started = time.monotonic()
    node = root / "tools/driver-node/node.exe"
    python = root / "tools/venv/Scripts/python.exe"
    sdk = root / "tools/emsdk"
    env = child_environment(root, python, jobs)
    cancelled = False

    def request_stop(signum, frame):
        nonlocal cancelled
        cancelled = True
        record["cancellation"] = "REQUESTED_WAIT_CURRENT_PROCESS"

    old_sigint = signal.signal(signal.SIGINT, request_stop)

    def save():
        record["seconds"] = time.monotonic() - started
        (root / "TOOLCHAIN_RESULT.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")

    def size():
        total = 0
        for parent, dirs, names in os.walk(root, followlinks=False):
            for name in dirs + names:
                file = Path(parent) / name
                require(not file.is_symlink() and not file.is_junction(), "LINKED_OUTPUT_REFUSED")
            total += sum((Path(parent) / name).stat().st_size for name in names)
        return total

    def guard():
        require(not cancelled, "CANCEL_REQUESTED")
        for file, expected in pins.items():
            require(identity(file) == expected, "PREPARATION_INPUT_CHANGED")
        used = size()
        require(used < budget_bytes - min(GIB, budget_bytes // 10), "BUDGET_RESERVE")
        require(shutil.disk_usage(root).free >= 2 * GIB, "DISK_RESERVE")
        return used

    def resource_guard(initial=False):
        # Reuse the actual build's CPU, RAM and commit-headroom policy.
        require(identity(node)["sha256"] == lock["driverExecutableSha256"], "RESOURCE_NODE_IDENTITY")
        code = ("import {officialRawResourceSnapshot as snapshot} from " + json.dumps((HERE / "official-build-preflight.mjs").as_uri()) + ";"
                "import {checkResourceHeadroom as check} from " + json.dumps((HERE / "fixed-build.mjs").as_uri()) + ";"
                "const s=snapshot(" + json.dumps(str(root)) + ");process.stdout.write(JSON.stringify(s));"
                "check(s," + json.dumps({"jobs": jobs, "budgetBytes": budget_bytes, "initial": initial, "logicalBytes": guard()}) + ");")
        result = subprocess.run([str(node), "--input-type=module", "-e", code], cwd=root, env=env,
                                capture_output=True, text=True, encoding="utf8", creationflags=subprocess.CREATE_NO_WINDOW)
        if result.stdout:
            record["resources"].append(json.loads(result.stdout))
        require(result.returncode == 0, "RESOURCE_GATE_FAILED")

    def run(name, arguments, command_env=None, monitor=False):
        guard()
        with (root / "logs" / (name + ".log")).open("xb") as log:
            child = subprocess.Popen(list(map(str, arguments)), cwd=root, env=command_env or env,
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
            record["activePid"] = child.pid
            save()
            pressure = None
            while child.poll() is None:
                try:
                    child.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    try:
                        guard()
                        if monitor:
                            resource_guard()
                    except Exception as error:
                        pressure = str(error)
                        record["pressure"] = {"error": pressure, "action": "WAIT_CURRENT_PROCESS_THEN_STOP"}
                    save()
            record.pop("activePid", None)
            require(child.returncode == 0, "CHILD_FAILED:" + name)
            require(pressure is None, "RESOURCE_PRESSURE_DURING_CHILD")
        guard()

    def phase(name, operation):
        row = {"name": name, "status": "RUNNING", "beforeBytes": guard()}
        record["phases"].append(row)
        begin = time.monotonic()
        save()
        try:
            operation()
            row["status"] = "PASS"
        except Exception as error:
            row.update(status="FAIL", error=str(error))
            raise
        finally:
            row.update(seconds=time.monotonic() - begin, afterBytes=size())
            save()

    def download(spec):
        output = root / "downloads" / spec["name"]
        limit = spec.get("bytes", 2 * 1024 ** 2)
        begin, count = time.monotonic(), 0
        opener = urllib.request.build_opener(ExactHttpsRedirect())
        with opener.open(spec["url"], timeout=60) as response, output.open("xb") as sink:
            while chunk := response.read(1024 ** 2):
                require(not cancelled, "CANCEL_REQUESTED")
                count += len(chunk)
                require(count <= limit and time.monotonic() - begin < 1200, "DOWNLOAD_LIMIT")
                sink.write(chunk)
        actual = identity(output)
        require(actual["sha256"] == spec["sha256"] and ("bytes" not in spec or actual["bytes"] == spec["bytes"]), "DOWNLOAD_IDENTITY")
        return output

    def acquire(spec):
        archive = download(spec)
        target = root / spec["target"]
        require(target.is_relative_to(root) and not target.exists(), "FRESH_ARCHIVE_TARGET")
        with zipfile.ZipFile(archive) as source:
            members = archive_members(source, spec["prefix"])
            require(sum(item.file_size for _, item in members) + size() < budget_bytes - min(GIB, budget_bytes // 10), "ARCHIVE_EXPANSION_BUDGET")
            for relative, item in members:
                output = target / relative
                if item.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(item) as src, output.open("xb") as dest:
                        shutil.copyfileobj(src, dest, length=1024 ** 2)

    def configure():
        for spec in lock["metadata"]:
            download(spec)
        tags = json.loads((root / "downloads/emsdk-4.0.10-tags.json").read_text(encoding="utf8"))
        require(tags["releases"][lock["emscriptenVersion"]] == lock["release"], "RELEASE_MAPPING")
        version = sdk / "upstream/emscripten/emscripten-version.txt"
        require(identity(version)["sha256"] == "0155f2fbb8025df1ab9e00649e6e1b1cf521c2b5861b74a94b6f6703098e750e", "ARCHIVE_VERSION_IDENTITY")
        # The authenticated official emsdk install() performs this exact mapping.
        version.write_bytes(b'"4.0.10"\r\n')
        with (sdk / ".emscripten").open("xb") as output:
            output.write(config_bytes())
        for name, expected in policy["sdkFiles"].items():
            require(identity(sdk / name)["sha256"] == expected, "INSTALLED_SDK_IDENTITY:" + name)

    def prepare_python():
        run("create-venv", [base_python, "-B", "-m", "venv", root / "tools/venv"])
        require(identity(python)["sha256"] == policy["pythonExeSha256"], "VENV_EXECUTABLE_IDENTITY")
        requirements = root / "inputs/requirements-scons.lock"
        run("scons-download", [python, "-B", "-m", "pip", "--isolated", "--no-cache-dir", "download", "--index-url", "https://pypi.org/simple",
                               "--only-binary=:all:", "--no-deps", "--require-hashes", "--retries", "0", "-r", requirements, "-d", root / "downloads"])
        wheels = list((root / "downloads").glob("*.whl"))
        require(len(wheels) == 1 and identity(wheels[0]) == policy["sconsWheel"], "SCONS_WHEEL_IDENTITY")
        run("scons-install", [python, "-B", "-m", "pip", "--isolated", "install", "--no-index", "--no-deps", "--require-hashes",
                              "--find-links", root / "downloads", "-r", requirements])

    def build_cache():
        resource_guard(initial=True)
        run("thinlto-system-libraries", [python, "-B", HERE / "official-cache-build.py", "--lto=thin", "build", *lock["thinTargets"]],
            {**env, "EM_FROZEN_CACHE": "0"}, monitor=True)
        folder = sdk / "upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/thinlto"
        require({p.name for p in folder.iterdir()} == set(policy["thinLtoLibraries"]), "THINLTO_EXACT_SET")
        for name, expected in policy["thinLtoLibraries"].items():
            require(identity(folder / name)["sha256"] == expected, "THINLTO_IDENTITY:" + name)

    def final_audit():
        wheels = list((root / "downloads").glob("*.whl"))
        run("dependency-audit", [python, "-B", HERE / "fixed-dependency-audit.py", "--sdk", sdk, "--scons-wheel", wheels[0],
                                 "--sdk-archive", root / "downloads" / lock["archives"][1]["name"]])
        audit = json.loads((root / "logs/dependency-audit.log").read_text(encoding="utf8"))
        require(audit["status"] == "PASS_DEPENDENCIES_ONLY", "FINAL_AUDIT_REJECTED")
        record["dependencyAudit"] = identity(root / "logs/dependency-audit.log")
        record["buildInputPaths"] = {"sdk": str(sdk), "python": str(python), "sconsWheel": str(wheels[0]),
                                     "sdkArchive": str(root / "downloads" / lock["archives"][1]["name"]), "driverNode": str(node)}

    save()
    try:
        for spec in lock["archives"]:
            phase("acquire:" + spec["name"], lambda spec=spec: acquire(spec))
        phase("configure-fixed-sdk", configure)
        phase("prepare-python-scons", prepare_python)
        phase("prepare-thinlto-cache", build_cache)
        phase("audit-frozen-dependencies", final_audit)
        record["status"] = "PASS_DEPENDENCIES_ONLY"
    except Exception as error:
        record.update(status="CANCELLED" if cancelled else "FAILED", error=str(error), retry="NOT_AUTOMATIC")
    finally:
        record["logicalBytes"] = size()
        save()
        signal.signal(signal.SIGINT, old_sigint)
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--base-python", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=6)
    parser.add_argument("--budget-bytes", type=int, default=8 * GIB)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        if args.write:
            result = execute(args.root, args.base_python, args.jobs, args.budget_bytes, write=True)
            print(json.dumps({"status": result["status"], "seconds": result["seconds"], "root": str(args.root), "runtime": "NOT_RUN"}))
            sys.exit(0 if result["status"] == "PASS_DEPENDENCIES_ONLY" else (2 if result["status"] == "CANCELLED" else 1))
        print(json.dumps(plan(args.root, args.base_python, args.jobs, args.budget_bytes), indent=2))
    except Exception as error:
        print(json.dumps({"status": "FAILED", "error": str(error), "retry": "NOT_AUTOMATIC"}), file=sys.stderr)
        sys.exit(1)
