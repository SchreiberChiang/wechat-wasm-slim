"""Build the pinned Emscripten libraries with reproducible Clang metadata on Windows."""
import json
import os
from pathlib import Path, PureWindowsPath
import runpy
import shlex
import subprocess
import sys
import tempfile


# This is the spelling embedded in the fixed reference archives. The VFS reads
# actual sources and headers from the new SDK. The reference drive can be absent.
REFERENCE_UPSTREAM = PureWindowsPath(r"F:\GLX-OpenSource\clean-20261104\tools\emsdk\upstream")


def install_metadata_rules(sdk, scratch):
    upstream = sdk / "upstream"
    emscripten = upstream / "emscripten"
    sys.path.insert(0, str(emscripten))
    from tools import system_libs

    original_flags = system_libs.get_base_cflags
    original_run = system_libs.run_build_commands

    def flags(*args, **kwargs):
        headers = Path("lib/clang/21")
        return [*original_flags(*args, **kwargs),
                f"-fdebug-prefix-map={upstream / headers}={REFERENCE_UPSTREAM / headers}"]

    def run(commands, num_inputs, build_dir=None):
        commands = list(commands)
        for index, cmd in enumerate(commands):
            # musl _exit.c and _Exit.c collide on Windows. The Emscripten
            # batch builder compiles the second one with an absolute filename.
            if "-o" not in cmd or Path(cmd[cmd.index("-o") + 1]).name != "_exit__1.o":
                continue
            source = emscripten / "system/lib/libc/musl/src/exit/_Exit.c"
            if str(source) not in cmd or Path(cmd[0]).stem != "emcc":
                raise ValueError("Unexpected fixed musl _Exit compile command")
            trace = subprocess.run([sys.executable, str(emscripten / "emcc.py"), *cmd[1:], "-###"],
                                   cwd=build_dir, env=system_libs.clean_env(), capture_output=True, check=True)
            rows = [shlex.split(row) for row in trace.stderr.decode("utf-8").splitlines() if ' "-cc1" ' in row]
            if len(rows) != 1 or rows[0][-1] != str(source) or Path(rows[0][0]).resolve() != (upstream / "bin/clang.exe").resolve():
                raise ValueError("Unexpected fixed Clang frontend trace")
            cc1 = rows[0]
            virtual = REFERENCE_UPSTREAM / source.relative_to(upstream)
            overlay = scratch / "musl-exit-vfs.json"
            overlay.write_text(json.dumps({"version": 0, "use-external-names": False, "roots": [
                {"type": "directory-remap", "name": str(virtual.parent), "external-contents": str(source.parent)}
            ]}), encoding="utf-8")
            maps = [flag.replace(str(emscripten), str(REFERENCE_UPSTREAM / "emscripten"), 1) for flag in cc1
                    if flag.startswith(("-fdebug-prefix-map=", "-fmacro-prefix-map=", "-fcoverage-prefix-map="))
                    and str(emscripten) in flag]
            commands[index] = [*cc1[:2], "-ivfsoverlay", str(overlay), *maps, *cc1[2:-1], str(virtual)]
        return original_run(commands, num_inputs, build_dir)

    system_libs.get_base_cflags = flags
    system_libs.run_build_commands = run
    return system_libs


if __name__ == "__main__":
    sdk = Path(os.environ["EM_CONFIG"]).resolve().parent
    script = sdk / "upstream/emscripten/embuilder.py"
    with tempfile.TemporaryDirectory(dir=os.environ["TEMP"]) as scratch:
        install_metadata_rules(sdk, Path(scratch))
        sys.argv[0] = str(script)
        runpy.run_path(str(script), run_name="__main__")
