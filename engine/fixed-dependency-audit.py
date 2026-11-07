"""Read-only fixed local dependencies. JSON stdout; never installs or warms caches."""
import sys
sys.dont_write_bytecode = True  # Prevent writes; existing pyc reads are NOT disabled.
import argparse
import ast
import base64
import csv
import hashlib
import importlib.util
import io
import json
import marshal
import os
from pathlib import Path, PurePosixPath
import stat
import struct
import sysconfig
import types
import zipfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(file):
    file = Path(file)
    require(not file.is_symlink() and not file.is_junction() and file.is_file(), "regular nonlinked file required: " + str(file))
    return file


def file_identity(file):
    file = regular(file)
    with file.open("rb") as handle:
        result = {"bytes": file.stat().st_size, "sha256": hashlib.file_digest(handle, "sha256").hexdigest()}
    return result


def collection(entries):
    entries = sorted(entries, key=lambda item: item["path"])
    require(len({item["path"] for item in entries}) == len(entries), "duplicate collection path")
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return {"count": len(entries), "bytes": sum(item["bytes"] for item in entries), "sha256": digest(encoded)}


def tree_entries(root):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink() and not root.is_junction(), "nonlinked directory required")
    entries = []
    def walk(directory):
        for file in sorted(directory.iterdir()):
            require(not file.is_symlink() and not file.is_junction(), "linked tree content refused")
            if file.is_dir():
                walk(file)
            else:
                entries.append({"path": file.relative_to(root).as_posix(), **file_identity(file)})
    walk(root)
    return entries


def checked_zip(archive):
    """Validate all names, even members this audit does not otherwise consume."""
    entries = {}
    for item in archive.infolist():
        name = item.filename
        require(item.orig_filename == name, "unsafe archive path normalization")
        clean = name[:-1] if name.endswith("/") else name
        parts = clean.split("/")
        require(clean and "\\" not in name and ":" not in name and not PurePosixPath(clean).is_absolute()
                and all(part not in ("", ".", "..") for part in parts), "unsafe archive path")
        require(not stat.S_ISLNK(item.external_attr >> 16), "archive symlink refused")
        require(name not in entries and not item.flag_bits & 1, "duplicate/encrypted archive member")
        entries[name] = item
    return entries


def verify_identity(file, expected):
    actual = file_identity(file)
    require(actual == expected, "fixed file identity mismatch: " + str(file))
    return actual


def audit_venv_cfg(file, base_executable, expected_version="3.14.0"):
    raw = regular(file).read_bytes()
    fields = {}
    for line in raw.decode("utf8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        require("=" in line, "invalid venv configuration line")
        key, value = (part.strip() for part in line.split("=", 1))
        require(key and key not in fields, "duplicate venv configuration field")
        fields[key] = value
    require(fields.get("include-system-site-packages", "").lower() == "false", "venv system site packages must be false")
    require(fields.get("version") == expected_version, "venv version differs from fixed Python")
    require(fields.get("executable") and fields.get("home"), "venv base executable/home required")
    base = Path(base_executable).resolve()
    require(Path(fields["executable"]).resolve() == base, "venv executable differs from actual base interpreter")
    require(Path(fields["home"]).resolve() == base.parent, "venv home differs from actual base directory")
    command = fields.get("command")
    return {"bytes": len(raw), "sha256": digest(raw),
            "semantics": {"version": expected_version, "includeSystemSitePackages": False,
                          "executableMatchesActualBase": True, "homeMatchesActualBaseDirectory": True},
            "command": None if command is None else {"bytes": len(command.encode("utf8")), "sha256": digest(command.encode("utf8"))},
            "commandScope": "Historical creation text fingerprint only; never executed or treated as build arguments."}


def verify_records(rows, read_bytes):
    names = []
    for name, algorithm_hash, size in rows:
        names.append(name)
        if not algorithm_hash:
            continue
        data = read_bytes(name)
        encoded = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
        require(algorithm_hash == "sha256=" + encoded and size.isdigit() and len(data) == int(size), "RECORD mismatch: " + name)
    require(len(set(names)) == len(names), "duplicate RECORD entry")
    return names


def audit_wheel(wheel, site, expected, version="4.11.1"):
    site = Path(site)
    wheel_id = verify_identity(wheel, expected)
    with zipfile.ZipFile(wheel) as archive:
        members = checked_zip(archive)
        names = sorted(name for name in members if not name.endswith("/"))
        record = "scons-" + version + ".dist-info/RECORD"
        require(record in members, "wheel RECORD missing")
        rows = list(csv.reader(io.StringIO(archive.read(record).decode("utf8"))))
        require(sorted(verify_records(rows, archive.read)) == names, "wheel members differ from RECORD")
        require(all(hash_value or name == record for name, hash_value, _ in rows), "unhashed wheel payload")
        compared = []
        for name in names:
            if name == record:
                continue  # pip rewrites this installed record.
            data = regular(site / name).read_bytes()
            require(data == archive.read(name), "installed SCons differs from wheel: " + name)
            compared.append({"path": name, "bytes": len(data), "sha256": digest(data)})
        actual_modules = tree_entries(site / "SCons")
        non_pyc = {"SCons/" + item["path"] for item in actual_modules if not item["path"].endswith(".pyc")}
        require(non_pyc == {name for name in names if name.startswith("SCons/")}, "extra/missing installed non-pyc SCons files")
    # Verify pip-generated launchers/metadata too, while rejecting RECORD path escapes.
    installed_rows = list(csv.reader(io.StringIO(regular(site / record).read_text(encoding="utf8"))))
    venv = site.parents[1].resolve()
    def installed_read(name):
        file = (site / name).resolve()
        require(file.is_relative_to(venv), "installed RECORD path escapes venv")
        return regular(file).read_bytes()
    for name, _, _ in installed_rows:
        require((site / name).resolve().is_relative_to(venv), "installed RECORD path escapes venv")
    verify_records(installed_rows, installed_read)
    unhashed = sorted(name for name, value, _ in installed_rows if not value)
    require(all(name.endswith(".pyc") or name == record for name in unhashed), "unexpected unhashed installed RECORD file")
    return {"wheel": wheel_id, "wheelComparedFiles": collection(compared), "packageTree": collection(actual_modules),
            "installedRecord": file_identity(site / record), "installedRecordHashedCount": sum(bool(value) for _, value, _ in installed_rows),
            "unhashedPycCount": sum(name.endswith(".pyc") for name in unhashed), "recordSelfHashProvided": False}


CODE_FIELDS = ("co_argcount", "co_posonlyargcount", "co_kwonlyargcount", "co_nlocals", "co_stacksize", "co_flags",
               "co_code", "co_consts", "co_names", "co_varnames", "co_filename", "co_name", "co_qualname",
               "co_firstlineno", "co_linetable", "co_exceptiontable", "co_freevars", "co_cellvars")


def code_equal(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, types.CodeType):
        return all(code_equal(getattr(actual, field), getattr(expected, field)) for field in CODE_FIELDS)
    if isinstance(actual, tuple):
        return len(actual) == len(expected) and all(code_equal(a, b) for a, b in zip(actual, expected))
    if isinstance(actual, float):
        return struct.pack("!d", actual) == struct.pack("!d", expected)
    if isinstance(actual, complex):
        return struct.pack("!dd", actual.real, actual.imag) == struct.pack("!dd", expected.real, expected.imag)
    return actual == expected


def audit_pyc(package):
    verified, missing, stale = [], [], []
    for source in sorted(Path(package).rglob("*.py")):
        pyc = Path(importlib.util.cache_from_source(str(source)))
        name = source.relative_to(package).as_posix()
        if not pyc.exists():
            missing.append(name)
            continue  # CPython loads verified source, without writing bytecode here.
        data = regular(pyc).read_bytes()
        require(len(data) >= 16 and data[:4] == importlib.util.MAGIC_NUMBER, "invalid current SCons pyc")
        flags = struct.unpack("<I", data[4:8])[0]
        require(flags & ~3 == 0, "invalid pyc flags")
        raw_source = regular(source).read_bytes()
        if flags & 1:
            fresh = data[8:16] == importlib.util.source_hash(raw_source)
        else:
            timestamp, size = struct.unpack("<II", data[8:16])
            fresh = timestamp == int(source.stat().st_mtime) & 0xffffffff and size == len(raw_source) & 0xffffffff
        if not fresh:
            stale.append(name)
            # Unchecked hash pyc can still be loaded despite a stale source hash.
            # Compare its code too; never use stale metadata as an audit bypass.
        actual = marshal.loads(data[16:])  # Deserialize code only; never exec/eval it.
        require(isinstance(actual, types.CodeType), "pyc payload is not code")
        require(os.path.normcase(os.path.normpath(actual.co_filename)) == os.path.normcase(os.path.normpath(str(source))), "pyc filename does not identify installed source")
        expected = compile(raw_source, actual.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
        require(code_equal(actual, expected), "SCons pyc differs from verified source: " + name)
        verified.append({"path": pyc.relative_to(package).as_posix(), "bytes": len(data), "sha256": digest(data)})
    return {"status": "PASS_CODE_DATA_ONLY", "currentOptimization": sys.flags.optimize, "verified": collection(verified),
            "sourceFallbackMissing": missing, "sourceFallbackStale": stale,
            "method": "Current cache_from_source pyc; header validity plus recursively compared code fields after compile, no bytecode execution.",
            "unknown": ["Non-current Python/optimization pyc variants are only included in packageTree fingerprints, not code-equivalence checked."]}


def audit_sdk_headers(sdk_archive, include, expected_archive):
    archive_id = verify_identity(sdk_archive, expected_archive)
    actual = tree_entries(include)
    prefix = "install/emscripten/cache/sysroot/include/"
    with zipfile.ZipFile(sdk_archive) as archive:
        members = checked_zip(archive)
        expected = {name[len(prefix):]: item for name, item in members.items() if name.startswith(prefix) and not name.endswith("/")}
        require(expected, "official archive has no sysroot headers")
        require({item["path"] for item in actual} == set(expected), "sysroot header set differs from archive")
        for item in actual:
            data = archive.read(expected[item["path"]])
            require(item["bytes"] == len(data) and item["sha256"] == digest(data), "sysroot header bytes differ: " + item["path"])
    return {"archive": archive_id, "headers": collection(actual)}


def audit_thin(directory, expected):
    entries = tree_entries(directory)
    require({item["path"] for item in entries} == set(expected), "ThinLTO library exact set mismatch")
    for item in entries:
        require(item["sha256"] == expected[item["path"]], "ThinLTO library hash mismatch: " + item["path"])
    return {"libraries": entries, "fingerprint": collection(entries)}


def audit_dependencies(sdk, scons_wheel, sdk_archive):
    policy_file = Path(__file__).with_name("fixed-toolchain-cache.json")
    policy = json.loads(policy_file.read_text(encoding="utf8"))
    for value in (sdk, scons_wheel, sdk_archive):
        require(Path(value).is_absolute(), "all explicit dependency paths must be absolute")
    sdk = Path(sdk)
    require(sys.version.split()[0] == policy["pythonVersion"], "fixed Python 3.14.0 required")
    python = file_identity(sys.executable)
    base = file_identity(sys._base_executable)
    require(python["sha256"] == policy["pythonExeSha256"] and base["sha256"] == policy["pythonBaseExeSha256"], "Python executable identity mismatch")
    cfg = audit_venv_cfg(Path(sys.prefix) / "pyvenv.cfg", sys._base_executable, policy["pythonVersion"])
    site = Path(sysconfig.get_path("purelib"))
    scons = audit_wheel(scons_wheel, site, policy["sconsWheel"], policy["sconsVersion"])
    spec = importlib.util.find_spec("SCons")
    require(spec and Path(spec.origin).resolve() == (site / "SCons/__init__.py").resolve(), "effective SCons import path differs")
    tree = ast.parse((site / "SCons/__init__.py").read_text(encoding="utf8"))
    versions = [node.value.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets) and isinstance(node.value, ast.Constant)]
    require(versions == [policy["sconsVersion"]], "fixed SCons version required")
    scons["version"] = policy["sconsVersion"]
    scons["pyc"] = audit_pyc(site / "SCons")
    sdk_files = []
    for name, expected in policy["sdkFiles"].items():
        item = file_identity(sdk / name)
        require(item["sha256"] == expected, "SDK selected input hash mismatch: " + name)
        sdk_files.append({"path": name, **item})
    cache = sdk / "upstream/emscripten/cache"
    headers = audit_sdk_headers(sdk_archive, cache / "sysroot/include", policy["sdkArchive"])
    thin = audit_thin(cache / "sysroot/lib/wasm32-emscripten/thinlto", policy["thinLtoLibraries"])
    all_cache = tree_entries(cache)
    non_lto = [item for item in all_cache if item["path"].startswith("sysroot/lib/") and "/thinlto/" not in item["path"]]
    return {"schema": "wxslim-fixed-dependencies-v1", "status": "PASS_DEPENDENCIES_ONLY", "policy": file_identity(policy_file),
            "referenceBuildSha256": policy["referenceBuildSha256"], "sourceCommitReference": policy["sourceCommit"],
            "paths": {"python": str(Path(sys.executable)), "pythonBase": str(Path(sys._base_executable)), "scons": str(site / "SCons"), "sdk": str(sdk), "sconsWheel": str(Path(scons_wheel)), "sdkArchive": str(Path(sdk_archive))},
            "python": {"version": sys.version.split()[0], "executable": python, "baseExecutable": base, "venvConfig": cfg},
            "scons": scons, "sdkFiles": sdk_files, "sdkFileFingerprint": collection(sdk_files),
            "sysrootHeaders": headers, "thinLto": thin, "wholeCacheFingerprint": collection(all_cache),
            "nonLtoFingerprint": collection(non_lto), "cacheCoverage": "All regular files below cache including sysroot headers, ThinLTO, non-LTO, build, sanity and stamps; links refused. Aggregate fingerprints are snapshots, not provenance approval.",
            "limitations": policy["limitations"] + ["Entire Python stdlib/DLL set, pip itself and SDK files outside selected sdkFiles/cache are not fully pinned.", "Cache snapshot cannot prove every linker input was consumed; no build or subprocess execution occurs.", "Compile/marshal comparison checks code data only and is not execution of SCons or engine code."]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", required=True)
    parser.add_argument("--scons-wheel", required=True)
    parser.add_argument("--sdk-archive", required=True)
    args = parser.parse_args()
    try:
        result = audit_dependencies(args.sdk, args.scons_wheel, args.sdk_archive)
    except Exception as error:
        print(json.dumps({"status": "FAILED_DEPENDENCY_AUDIT", "error": str(error)}, ensure_ascii=True))
        return 1
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
