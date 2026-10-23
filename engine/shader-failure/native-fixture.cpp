// Owned SDK fixture only: no target engine, GLX archive, GPU or network.
#include <GLES3/gl3.h>
#include <emscripten/html5_webgl.h>
#include "native-header.h"
#include <setjmp.h>
static jmp_buf fixture_jump;
static int fixture_mode;
EM_JS(void, fixture_init, (int mode), {
    globalThis.__godotMinigameWXGLXEnabled = mode !== 1;
    Module.fixtureMode = mode; Module.fixtureEvents = [];
});
EM_JS(void, fixture_display, (), { Module.fixtureEvents.push('original-display'); });
EM_JS(int, fixture_query, (int type), {
    Module.fixtureEvents.push(type === 35663 ? 'TYPE' : 'LENGTH');
    var mode = Module.fixtureMode;
    if (mode === 2 && type === 35663) throw new Error('owned TYPE failure');
    if (mode === 3 && type === 35720) throw new Error('owned LENGTH failure');
    if (mode === 4 && type === 35720) throw 71;
    if (mode === 5 && type === 35720) throw Infinity;
    return type === 35663 ? 35633 : 12;
});
extern "C" void glGetShaderiv(GLuint shader, GLenum type, GLint *value) {
    if (fixture_mode == 6 && type == GL_SHADER_SOURCE_LENGTH) longjmp(fixture_jump, 1);
    if (fixture_mode == 8 && type == GL_SHADER_SOURCE_LENGTH) throw 43;
    *value = fixture_query(type);
}
extern "C" EMSCRIPTEN_WEBGL_CONTEXT_HANDLE emscripten_webgl_get_current_context(void) { return 1; }
static WxslimShaderFailure *owned_fixture = nullptr;
extern "C" __attribute__((noinline)) int run_fixture(int mode) {
    fixture_mode = mode;
    fixture_init(mode);
    // Heap ownership lets the JS test inspect numeric control-transfer behavior
    // without interpreting a test number as a real C++ exception pointer.
    owned_fixture = new WxslimShaderFailure(11, 17, GL_VERTEX_SHADER, 3, UINT64_C(0x123456789abcdef0), "void main(){}", 13);
    if (mode == 7) { owned_fixture->compiler_log(nullptr, 0, 0); return 29; }
    owned_fixture->compiler_log("compile error", 13, 13);
    fixture_display();
    owned_fixture->queries_after_error_display();
    return 29;
}
extern "C" void destroy_fixture() { delete owned_fixture; owned_fixture = nullptr; }

extern "C" int run_raii_fixture() {
    fixture_init(0);
    try {
        WxslimShaderFailure failure(11, 17, GL_VERTEX_SHADER, 3, 0, "s", 1);
        wxslim_shader_failure_arm_source();
        throw 41;
    } catch (int value) { return value; }
}

extern "C" int run_longjmp_fixture() { if (setjmp(fixture_jump)) return 39; return run_fixture(6); }

extern "C" int run_cpp_query_fixture() { try { return run_fixture(8); } catch (int value) { return value; } }
