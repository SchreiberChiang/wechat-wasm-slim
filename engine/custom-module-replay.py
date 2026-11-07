"""Read-only fixed-source module model, not SCons or a build.

Executes only authenticated c050 can_build/is_enabled and dependency functions.
No config.configure or whole module/SConstruct execution. Invoke with -B.
"""
import ast
import hashlib
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
MODULE_META_SHA = "c46b6788a52c04c71fb8c6d101055e9c1ad46dc854094308621720b6a6dae893"
BUILD_META_SHA = "53cf9b93bf79d5b9c8e68c6aaf1af82dda964e5043c9e586d5377f078be2611d"


def checked(file, expected):
    assert file.is_file() and not file.is_symlink(), "SOURCE_REGULAR_FILE"
    data = file.read_bytes()
    assert hashlib.sha256(data).hexdigest() == expected["sha256"], "SOURCE_PIN " + file.name
    if "bytes" in expected:
        assert len(data) == expected["bytes"], "SOURCE_SIZE"
    return data


def functions(tree, names, namespace):
    selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in selected} == set(names), "FUNCTION_SET"
    assert len(selected) == len(names), "DUPLICATE_FUNCTION"
    exec(compile(ast.Module(body=selected, type_ignores=[]), "<authenticated-fixed-function>", "exec"), namespace)
    return selected


class Environment(dict):
    def Append(self, **kwargs):
        assert set(kwargs) == {"CPPDEFINES"}, "MODEL_UNSUPPORTED_APPEND"
        self.macros.extend(kwargs["CPPDEFINES"])


def run(source, cases):
    assert source.is_dir() and not source.is_symlink(), "SOURCE_DIRECTORY"
    meta = json.loads(checked(REPO / "engine/official-module-audit.json", {"sha256": MODULE_META_SHA}))
    build = json.loads(checked(REPO / "engine/official-build-plan.json", {"sha256": BUILD_META_SHA}))
    evidence_pin = next(p for p in build["dependencies"] if p["path"] == build["evidence"])
    evidence = json.loads(checked(REPO / build["evidence"], evidence_pin))
    detect_pin = next(p for p in evidence["finalOutputs"] if p["path"] == "platform/web/detect.py")
    pins = meta["sources"] + [detect_pin]
    contents = {p["path"]: checked(source / p["path"], p) for p in pins}
    trees = {name: ast.parse(data.decode("utf-8")) for name, data in contents.items() if name.endswith(".py") or name == "SConstruct"}
    names = sorted(d["name"] for d in meta["moduleDirectories"])
    assert sorted(p.name for p in (source / "modules").iterdir() if p.is_dir()) == names, "MODULE_DIRECTORY_SET"
    defaults = {}
    # SConstruct also registers each module's get_opts before selection. Include
    # their literal BoolVariable defaults (e.g. betsy/cvtt export templates).
    for tree in [trees["SConstruct"], trees["platform/web/detect.py"], *[trees["modules/" + n + "/config.py"] for n in names]]:
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "BoolVariable" and len(node.args) >= 3:
                try:
                    key, value = ast.literal_eval(node.args[0]), ast.literal_eval(node.args[2])
                except (ValueError, TypeError):
                    continue  # dynamic module option names are handled below
                if isinstance(key, str) and type(value) is bool:
                    assert key not in defaults or defaults[key] == value, "CONFLICTING_OPTION_DEFAULT " + key
                    defaults[key] = value
    get_flags = [n for n in trees["platform/web/detect.py"].body if isinstance(n, ast.FunctionDef) and n.name == "get_flags"]
    assert len(get_flags) == 1 and len(get_flags[0].body) == 1 and isinstance(get_flags[0].body[0], ast.Return)
    flags = ast.literal_eval(get_flags[0].body[0].value)
    assert flags["module_raycast_enabled"] is False and flags["vulkan"] is False
    disabled_3d = [n for n in trees["SConstruct"].body if isinstance(n, ast.If) and ast.dump(n.test) == ast.dump(ast.parse('env["disable_3d"]', mode="eval").body)]
    assert len(disabled_3d) == 1, "DIMENSION_BLOCK"
    configs = {}
    for name in names:
        tree = trees["modules/" + name + "/config.py"]
        namespace = {}
        functions(tree, ["can_build"], namespace)
        optional = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "is_enabled"]
        if optional:
            functions(tree, ["is_enabled"], namespace)
        configure = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "configure"]
        assert len(configure) == 1
        configs[name] = (namespace, configure[0])
    results = []
    assert isinstance(cases, list) and 1 <= len(cases) <= 512, "CASE_COUNT"
    for request in cases:
        assert set(request) == {"dimensions", "disabledModules"}
        assert request["dimensions"] in ("2d", "3d")
        disabled = request["disabledModules"]
        assert isinstance(disabled, list) and len(disabled) == len(set(disabled)) and all(n in names for n in disabled)
        assert "gdscript" not in disabled and "mbedtls" not in disabled
        warnings = []
        namespace = {"print_warning": warnings.append}
        functions(trees["methods.py"], ["module_add_dependencies", "module_check_dependencies"], namespace)
        Environment.module_add_dependencies = namespace["module_add_dependencies"]
        Environment.module_check_dependencies = namespace["module_check_dependencies"]
        env = Environment(defaults)
        for name, (config, _) in configs.items():
            env["module_" + name + "_enabled"] = config["is_enabled"]() if "is_enabled" in config else True
        env.update(flags)
        env.update(platform="web", target="template_release", arch="wasm32", threads=False, wasm_simd=False, dlink_enabled=False, proxy_to_pthread=False, opengl3=True, use_wx_glx=True, javascript_eval=True)
        env.editor_build = False
        env.debug_features = False
        env.msvc = False
        env.module_dependencies = {}
        env.disabled_modules = set()
        env.macros = []
        env["disable_3d"] = request["dimensions"] == "2d"
        for name in disabled:
            env["module_" + name + "_enabled"] = False
        exec(compile(ast.Module(body=disabled_3d, type_ignores=[]), "<authenticated-dimension-block>", "exec"), {"env": env})
        enabled, decisions = [], []
        for name in names:
            if not env["module_" + name + "_enabled"]:
                decisions.append({"module": name, "reason": "OPTION_DISABLED"})
                continue
            env.current_module = name
            config, configure = configs[name]
            can_build = config["can_build"](env, "web")
            if not can_build:
                decisions.append({"module": name, "reason": "CAN_BUILD_FALSE"})
                continue
            if not env.module_check_dependencies(name):
                decisions.append({"module": name, "reason": "REQUIRED_DEPENDENCY_DISABLED"})
                continue
            assert len(configure.body) == 1 and isinstance(configure.body[0], ast.Pass), "ACTIVE_CONFIGURE_NOT_MODELED " + name
            enabled.append(name)
        results.append({"request": request, "enabledModules": enabled, "excluded": decisions, "dependencies": env.module_dependencies,
                        "dimensionMacrosInModel": env.macros, "warningCount": len(warnings)})
    for pin in pins:
        assert checked(source / pin["path"], pin) == contents[pin["path"]], "SOURCE_CHANGED"
    return {"schema": "wxslim-custom-module-source-replay-v1", "status": "PASS_FIXED_SOURCE_MODEL_ONLY", "commit": meta["commit"],
            "checkedSourceFiles": len(pins), "cases": results, "sconsExecuted": False, "configureExecuted": False,
            "compilerExecuted": False, "runtime": "NOT_RUN", "wholeTreeAuthenticated": False,
            "limits": ["Fixed release flags in a small Environment model; not actual SCons or compiler state.",
                       "Separate whole-tree, generated-source, macro, object and final-pair audits remain required."]}


if __name__ == "__main__":
    try:
        assert len(sys.argv) == 2, "usage: python -B custom-module-replay.py PREPARED_SOURCE"
        data = sys.stdin.buffer.read(256 * 1024 + 1)
        assert len(data) <= 256 * 1024, "REQUEST_SIZE"
        print(json.dumps(run(pathlib.Path(sys.argv[1]).resolve(), json.loads(data)), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"status": "FAILED_SOURCE_MODEL", "error": str(error), "compilerExecuted": False}), file=sys.stderr)
        sys.exit(1)
