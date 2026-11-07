import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from emscripten_helpers import (
    add_js_externs,
    add_js_libraries,
    add_js_post,
    add_js_pre,
    create_engine_file,
    create_template_zip,
    get_template_zip_path,
    run_closure_compiler,
)
from SCons.Util import WhereIs

from methods import get_compiler_version, print_error, print_info, print_warning
from platform_methods import validate_arch

if TYPE_CHECKING:
    from SCons.Script.SConscript import SConsEnvironment


def get_name():
    return "Web"


def can_build():
    return WhereIs("emcc") is not None


def get_tools(env: "SConsEnvironment"):
    # Use generic POSIX build toolchain for Emscripten.
    return ["cc", "c++", "ar", "link", "textfile", "zip"]


def get_opts():
    from SCons.Variables import BoolVariable, EnumVariable

    return [
        ("initial_memory", "Initial WASM memory (in MiB)", 32),
        # Matches default values from before Emscripten 3.1.27. New defaults are too low for Godot.
        ("stack_size", "WASM stack size (in KiB)", 5120),
        ("default_pthread_stack_size", "WASM pthread default stack size (in KiB)", 2048),
        EnumVariable(
            "use_assertions", "Use Emscripten runtime assertions", "auto", ["auto", "no", "yes", "extra"], ignorecase=2
        ),
        BoolVariable("use_ubsan", "Use Emscripten undefined behavior sanitizer (UBSAN)", False),
        BoolVariable("use_asan", "Use Emscripten address sanitizer (ASAN)", False),
        BoolVariable("use_lsan", "Use Emscripten leak sanitizer (LSAN)", False),
        BoolVariable("use_safe_heap", "Use Emscripten SAFE_HEAP sanitizer", False),
        # eval() can be a security concern, so it can be disabled.
        BoolVariable("javascript_eval", "Enable JavaScript eval interface", True),
        BoolVariable(
            "dlink_enabled", "Enable WebAssembly dynamic linking (GDExtension support). Produces bigger binaries", False
        ),
        BoolVariable("use_closure_compiler", "Use closure compiler to minimize JavaScript code", False),
        BoolVariable(
            "proxy_to_pthread",
            "Use Emscripten PROXY_TO_PTHREAD option to run the main application code to a separate thread",
            False,
        ),
        ("wx_glx_lib", "Explicit path to the pinned 4.0.10 WeChat GLX archive", ""),
        BoolVariable("use_wx_glx", "Enable the pinned WeChat GLX development configuration", False),
        BoolVariable("wasm_simd", "Use WebAssembly SIMD to improve CPU performance", True),
    ]


def get_doc_classes():
    return [
        "EditorExportPlatformWeb",
    ]


def get_doc_path():
    return "doc_classes"


def get_flags():
    return {
        "arch": "wasm32",
        "target": "template_debug",
        "builtin_pcre2_with_jit": False,
        "vulkan": False,
        # Embree is heavy and requires too much memory (GH-70621).
        "module_raycast_enabled": False,
        # Use -Os to prioritize optimizing for reduced file size. This is
        # particularly valuable for the web platform because it directly
        # decreases download time.
        # -Os reduces file size by around 5 MiB over -O3. -Oz only saves about
        # 100 KiB over -Os, which does not justify the negative impact on
        # run-time performance.
        # Note that this overrides the "auto" behavior for target/dev_build.
        "optimize": "size",
    }


def library_emitter(target, source, env):
    # Make every source file dependent on the compiler version.
    # This makes sure that when emscripten is updated, that the cached files
    # aren't used and are recompiled instead.
    env.Depends(source, env.Value(get_compiler_version(env)))
    return target, source


def _wxslim_configure_glx(env: "SConsEnvironment", cc_semver):
    # Source-only migration candidate: this branch intentionally retains the
    # successful development recipe's relaxed link/null-write settings.
    if not env["use_wx_glx"]:
        return
    if cc_semver != (4, 0, 10):
        raise ValueError("WXGLX_REQUIRES_EMSCRIPTEN_4_0_10")
    if env["arch"] != "wasm32" or env["threads"] or env["wasm_simd"] or env["dlink_enabled"] or env["proxy_to_pthread"] or not env["opengl3"]:
        raise ValueError("WXGLX_REQUIRES_WASM32_SINGLE_THREAD_NO_SIMD_NO_DLINK_OPENGL3")
    requested_library = str(env["wx_glx_lib"]).strip()
    if not requested_library:
        raise ValueError("WXGLX_EXPLICIT_LIBRARY_REQUIRED")
    wx_glx_lib = os.path.abspath(requested_library)
    if not os.path.isfile(wx_glx_lib) or os.path.getsize(wx_glx_lib) != 3866614:
        raise ValueError("WXGLX_LIBRARY_SIZE_OR_FILE")
    import hashlib

    with open(wx_glx_lib, "rb") as library_file:
        library_bytes = library_file.read(3866615)
    if len(library_bytes) != 3866614 or hashlib.sha256(library_bytes).hexdigest() != "026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8":
        raise ValueError("WXGLX_LIBRARY_SHA256")
    # configure() precedes SConstruct's disable_exceptions handling.
    env["disable_exceptions"] = False
    env.Append(CXXFLAGS=["-fexceptions"])
    env.Append(LINKFLAGS=["-fexceptions"])
    env.Append(CPPDEFINES=["WECHAT_GLX_EXPERIMENTAL"])
    env["EXPORTED_FUNCTIONS"] += ["_godot_wechat_random_buffer"]
    # LEGACY_COMPATIBILITY: these are inherited success-recipe settings,
    # not evidence that unresolved symbols or null writes are safe.
    env.Append(LINKFLAGS=["-sCHECK_NULL_WRITES=0"])
    env["EXPORTED_RUNTIME_METHODS"] += ["ccall", "cwrap", "stringToUTF8", "lengthBytesUTF8"]
    env.Append(LINKFLAGS=["-sERROR_ON_UNDEFINED_SYMBOLS=0", wx_glx_lib])


def configure(env: "SConsEnvironment"):
    env["CC"] = "emcc"
    env["CXX"] = "em++"

    env["AR"] = "emar"
    env["RANLIB"] = "emranlib"

    # Get version info for checks below.
    cc_version = get_compiler_version(env)
    cc_semver = (cc_version["major"], cc_version["minor"], cc_version["patch"])

    # Minimum emscripten requirements.
    if cc_semver < (4, 0, 0):
        print_error("The minimum Emscripten version to build Godot is 4.0.0, detected: %s.%s.%s" % cc_semver)
        sys.exit(255)

    env.Append(LIBEMITTER=[library_emitter])

    env["EXPORTED_FUNCTIONS"] = ["_main"]
    env["EXPORTED_RUNTIME_METHODS"] = []

    # Validate arch.
    supported_arches = ["wasm32", "wasm64"]
    validate_arch(env["arch"], get_name(), supported_arches)

    try:
        env["initial_memory"] = int(env["initial_memory"])
    except Exception:
        print_error("Initial memory must be a valid integer")
        sys.exit(255)

    # Add Emscripten to the included paths (for compile_commands.json completion)
    emcc_path = Path(str(WhereIs("emcc")))
    while emcc_path.is_symlink():
        # For some reason, mypy trips on `Path.readlink` not being defined, somehow.
        emcc_path = emcc_path.readlink()  # type: ignore[attr-defined]
    emscripten_include_path = emcc_path.parent.joinpath("cache", "sysroot", "include")
    env.Append(CPPPATH=[emscripten_include_path])

    ## Configure assertions.
    if env["use_assertions"] == "auto":
        env["use_assertions"] = "yes" if env.debug_features else "no"
    if env["use_assertions"] == "yes":
        print_info("Building with runtime assertions.")
        env.Append(LINKFLAGS=["-sASSERTIONS=1"])
    elif env["use_assertions"] == "extra":
        print_info("Building with runtime assertions with extra tests.")
        env.Append(LINKFLAGS=["-sASSERTIONS=2"])

    if env["debug_symbols"]:
        # Retain function names for backtraces at the cost of file size.
        env.Append(LINKFLAGS=["--profiling-funcs"])

    _wxslim_configure_glx(env, cc_semver)

    if env.editor_build and env["initial_memory"] < 64:
        print_info("Forcing `initial_memory=64` as it is required for the web editor.")
        env["initial_memory"] = 64

    env.Append(LINKFLAGS=["-sINITIAL_MEMORY=%sMB" % env["initial_memory"]])

    ## Copy env variables.
    env["ENV"] = os.environ

    # This makes `wasm-ld` treat all warnings as errors.
    if env["werror"]:
        env.Append(LINKFLAGS=["-Wl,--fatal-warnings"])

    # LTO
    if env["lto"] == "auto":  # Enable LTO for production.
        env["lto"] = "thin"

    if env["lto"] == "thin" and cc_semver < (4, 0, 9):
        print_warning(
            '"lto=thin" support requires Emscripten 4.0.9 (detected %s.%s.%s), using "lto=full" instead.' % cc_semver
        )
        env["lto"] = "full"

    if env["lto"] != "none":
        if env["lto"] == "thin":
            env.Append(CCFLAGS=["-flto=thin"])
            env.Append(LINKFLAGS=["-flto=thin"])
        else:
            env.Append(CCFLAGS=["-flto"])
            env.Append(LINKFLAGS=["-flto"])

    # Sanitizers
    if env["use_ubsan"]:
        env.Append(CPPDEFINES=["UBSAN_ENABLED"])
        env.Append(CCFLAGS=["-fsanitize=undefined"])
        env.Append(LINKFLAGS=["-fsanitize=undefined"])
    if env["use_asan"]:
        env.Append(CPPDEFINES=["ASAN_ENABLED"])
        env.Append(CCFLAGS=["-fsanitize=address"])
        env.Append(LINKFLAGS=["-fsanitize=address"])
    if env["use_lsan"]:
        env.Append(CPPDEFINES=["LSAN_ENABLED"])
        env.Append(CCFLAGS=["-fsanitize=leak"])
        env.Append(LINKFLAGS=["-fsanitize=leak"])
    if env["use_safe_heap"]:
        env.Append(LINKFLAGS=["-sSAFE_HEAP=1"])

    # Closure compiler
    if env["use_closure_compiler"] and cc_semver < (4, 0, 11):
        print_warning(
            '"use_closure_compiler=yes" support requires Emscripten 4.0.11 (detected %s.%s.%s), using "use_closure_compiler=no" instead.'
            % cc_semver
        )
        env["use_closure_compiler"] = False

    if env["use_closure_compiler"]:
        # For emscripten support code.
        env.Append(LINKFLAGS=["--closure", "1"])
        # Register builder for our Engine files
        jscc = env.Builder(generator=run_closure_compiler, suffix=".cc.js", src_suffix=".js")
        env.Append(BUILDERS={"BuildJS": jscc})

    # Add helper method for adding libraries, externs, pre-js, post-js.
    env["JS_LIBS"] = []
    env["JS_PRE"] = []
    env["JS_POST"] = []
    env["JS_EXTERNS"] = []
    env.AddMethod(add_js_libraries, "AddJSLibraries")
    env.AddMethod(add_js_pre, "AddJSPre")
    env.AddMethod(add_js_post, "AddJSPost")
    env.AddMethod(add_js_externs, "AddJSExterns")

    # Add method that joins/compiles our Engine files.
    env.AddMethod(create_engine_file, "CreateEngineFile")

    # Add method for getting the final zip path
    env.AddMethod(get_template_zip_path, "GetTemplateZipPath")

    # Add method for creating the final zip file
    env.AddMethod(create_template_zip, "CreateTemplateZip")

    # Use TempFileMunge since some AR invocations are too long for cmd.exe.
    # Use POSIX-style paths, required with TempFileMunge.
    env["ARCOM_POSIX"] = env["ARCOM"].replace("$TARGET", "$TARGET.posix").replace("$SOURCES", "$SOURCES.posix")
    env["ARCOM"] = "${TEMPFILE('$ARCOM_POSIX','$ARCOMSTR')}"

    # Keep the separately reviewed Windows response-file adapter only in GLX builds.
    if env["use_wx_glx"] and os.name == "nt":
        # ENGINE_LAB_WINDOWS_LINK_RESPONSE_V2
        import shlex
        from SCons.Platform import TempFileMunge

        class LinkTempFileMungeV2(TempFileMunge):
            def __call__(self, target, source, env, for_signature):
                if for_signature:
                    return self.cmd
                link_env = env.Clone()
                link_env["TEMPFILEARGESCFUNC"] = lambda arg: shlex.quote(str(arg))
                link_env["TEMPFILEENCODING"] = "utf-8"
                return super().__call__(target, source, link_env, for_signature)

        env["LINKCOM_POSIX_V2"] = env["LINKCOM"].replace("$TARGET", "$TARGET.posix").replace("$SOURCES", "$SOURCES.posix")
        env["LINK_TEMPFILE_V2"] = LinkTempFileMungeV2
        env["LINKCOM"] = "${LINK_TEMPFILE_V2('$LINKCOM_POSIX_V2','$LINKCOMSTR')}"

    # All intermediate files are just object files.
    env["OBJPREFIX"] = ""
    env["OBJSUFFIX"] = ".o"
    env["PROGPREFIX"] = ""
    # Program() output consists of multiple files, so specify suffixes manually at builder.
    env["PROGSUFFIX"] = ""
    env["LIBPREFIX"] = "lib"
    env["LIBSUFFIX"] = ".a"
    env["LIBPREFIXES"] = ["$LIBPREFIX"]
    env["LIBSUFFIXES"] = ["$LIBSUFFIX"]

    env.Prepend(CPPPATH=["#platform/web"])
    env.Append(CPPDEFINES=["WEB_ENABLED", "UNIX_ENABLED", "UNIX_SOCKET_UNAVAILABLE"])

    if env["opengl3"]:
        env.AppendUnique(CPPDEFINES=["GLES3_ENABLED"])
        # This setting just makes WebGL 2 APIs available, it does NOT disable WebGL 1.
        env.Append(LINKFLAGS=["-sMAX_WEBGL_VERSION=2"])
        # Allow use to take control of swapping WebGL buffers.
        if not env["use_wx_glx"]:
            env.Append(LINKFLAGS=["-sOFFSCREEN_FRAMEBUFFER=1"])
        # Disables the use of *glGetProcAddress() which is inefficient.
        # See https://emscripten.org/docs/tools_reference/settings_reference.html#gl-enable-get-proc-address
        env.Append(LINKFLAGS=["-sGL_ENABLE_GET_PROC_ADDRESS=0"])

    if env["javascript_eval"]:
        env.Append(CPPDEFINES=["JAVASCRIPT_EVAL_ENABLED"])

    env.Append(LINKFLAGS=["-s%s=%sKB" % ("STACK_SIZE", env["stack_size"])])

    if env["threads"]:
        # Thread support (via SharedArrayBuffer).
        env.Append(CPPDEFINES=["PTHREAD_NO_RENAME"])
        env.Append(CCFLAGS=["-sUSE_PTHREADS=1"])
        env.Append(LINKFLAGS=["-sUSE_PTHREADS=1"])
        env.Append(LINKFLAGS=["-sDEFAULT_PTHREAD_STACK_SIZE=%sKB" % env["default_pthread_stack_size"]])
        env.Append(LINKFLAGS=["-sPTHREAD_POOL_SIZE=\"Module['emscriptenPoolSize']||8\""])
        env.Append(LINKFLAGS=["-sWASM_MEM_MAX=2048MB"])
        if not env["dlink_enabled"]:
            # Workaround https://github.com/emscripten-core/emscripten/issues/21844#issuecomment-2116936414.
            # Not needed (and potentially dangerous) when dlink_enabled=yes, since we set EXPORT_ALL=1 in that case.
            env["EXPORTED_FUNCTIONS"] += ["__emscripten_thread_crashed"]

    elif env["proxy_to_pthread"]:
        print_warning('"threads=no" support requires "proxy_to_pthread=no", disabling proxy to pthread.')
        env["proxy_to_pthread"] = False

    if env["lto"] != "none":
        # Workaround https://github.com/emscripten-core/emscripten/issues/16836.
        env.Append(LINKFLAGS=["-Wl,-u,_emscripten_run_callback_on_thread"])

    if env["dlink_enabled"]:
        if env["proxy_to_pthread"]:
            print_warning("GDExtension support requires proxy_to_pthread=no, disabling proxy to pthread.")
            env["proxy_to_pthread"] = False

        env.Append(CPPDEFINES=["WEB_DLINK_ENABLED"])
        env.Append(CCFLAGS=["-sSIDE_MODULE=2"])
        env.Append(LINKFLAGS=["-sSIDE_MODULE=2"])
        env.Append(CCFLAGS=["-fvisibility=hidden"])
        env.Append(LINKFLAGS=["-fvisibility=hidden"])
        env.extra_suffix = ".dlink" + env.extra_suffix

    # Preserve the official browser setting; GLX retains the successful recipe's
    # omission of this flag. Emscripten 4.0.10 still defaults WASM_BIGINT to true.
    if not env["use_wx_glx"] or env["arch"] == "wasm64":
        env.Append(LINKFLAGS=["-sWASM_BIGINT"])
    env.Append(CCFLAGS=[f"-sMEMORY64={0 if env['arch'] == 'wasm32' else 1}"])
    env.Append(LINKFLAGS=[f"-sMEMORY64={0 if env['arch'] == 'wasm32' else 1}"])

    # Run the main application in a web worker
    if env["proxy_to_pthread"]:
        env.Append(LINKFLAGS=["-sPROXY_TO_PTHREAD=1"])
        env.Append(CPPDEFINES=["PROXY_TO_PTHREAD_ENABLED"])

    # Enable WebAssembly SIMD
    if env["wasm_simd"]:
        env.Append(CCFLAGS=["-msimd128"])

    # Reduce code size by generating less support code (e.g. skip NodeJS support).
    env.Append(LINKFLAGS=["-sENVIRONMENT=web,worker"])

    # Wrap the JavaScript support code around a closure named Godot.
    env.Append(LINKFLAGS=["-sMODULARIZE=1", "-sEXPORT_NAME='Godot'"])

    # Preserve official browser longjmp; the pinned GLX exception runtime uses emscripten.
    longjmp_mode = "emscripten" if env["use_wx_glx"] else "wasm"
    env.Append(CCFLAGS=["-sSUPPORT_LONGJMP='%s'" % longjmp_mode])
    env.Append(LINKFLAGS=["-sSUPPORT_LONGJMP='%s'" % longjmp_mode])

    # Allow increasing memory buffer size during runtime. This is efficient
    # when using WebAssembly (in comparison to asm.js) and works well for
    # us since we don't know requirements at compile-time.
    env.Append(LINKFLAGS=["-sALLOW_MEMORY_GROWTH=1"])

    # Do not call main immediately when the support code is ready.
    env.Append(LINKFLAGS=["-sINVOKE_RUN=0"])

    # callMain for manual start, cwrap for the mono version.
    # Make sure also to have those memory-related functions available.
    heap_arrays = [f"HEAP{heap_type}{heap_size}" for heap_size in [8, 16, 32, 64] for heap_type in ["", "U"]] + [
        "HEAPF32",
        "HEAPF64",
    ]
    env["EXPORTED_RUNTIME_METHODS"] += ["callMain", "cwrap"] + heap_arrays
    env["EXPORTED_FUNCTIONS"] += ["_malloc", "_free"]

    # Add code that allow exiting runtime.
    env.Append(LINKFLAGS=["-sEXIT_RUNTIME=1"])

    # This workaround creates a closure that prevents the garbage collector from freeing the WebGL context.
    # We also only use WebGL2, and changing context version is not widely supported anyway.
    env.Append(LINKFLAGS=["-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0"])

    # Disable GDScript LSP (as the Web platform is not compatible with TCP).
    env.Append(CPPDEFINES=["GDSCRIPT_NO_LSP"])
