#pragma once

// First-failure diagnostic candidate, not a shader or GLX compatibility fix.
// Included only by shader_gles3.cpp; installed as wxslim_shader_failure.h.
#if defined(WEB_ENABLED) && defined(WECHAT_GLX_EXPERIMENTAL)

#include <emscripten.h>
#include <emscripten/html5_webgl.h>
#include <limits.h>
#include <stdint.h>

extern "C" {
int wxslim_shader_failure_begin(unsigned int program, unsigned int shader, unsigned int expected_type, unsigned int variant, uint32_t specialization_lo, uint32_t specialization_hi, const char *source, int source_bytes, int public_context);
void wxslim_shader_failure_arm_source();
void wxslim_shader_failure_observe(int type, int length, int public_context);
void wxslim_shader_failure_error(const char *error, int bytes, int public_context);
void wxslim_shader_failure_end();
}

// Only the two ADDED queries run through this boundary. The original compiler
// log calls and reporting retain their original exception/control-flow behavior.
// Restore the WASM stack when a JS exception escapes the callback, as SDK invoke
// wrappers do. Observer imports below have a separately tested no-throw contract.
EM_JS_DEPS(wxslim_shader_failure_guard_deps, "$stackSave,$stackRestore,$dynCall");
EM_JS(int, wxslim_shader_failure_guard, (uintptr_t query, uintptr_t cleanup, void *state), {
    var savedStack = stackSave();
    try {
        dynCall('vi', query, [state]);
        return 1;
    } catch (error) {
        stackRestore(savedStack);
        dynCall('vi', cleanup, [state]);
        // Numeric C++ exceptions and emscripten longjmp (Infinity) must retain
        // their ABI semantics. This guard is not a replacement invoke handler.
        if (typeof error === 'number') throw error;
        return 0;
    }
});

class WxslimShaderFailure {
    bool active = false;
    unsigned int shader = 0;
    int observed_type = INT_MIN;
    int observed_length = INT_MIN;

    static int context() {
        return static_cast<int>(emscripten_webgl_get_current_context());
    }

    static void read_queries(void *state) {
        WxslimShaderFailure *self = static_cast<WxslimShaderFailure *>(state);
        GLint returned_type = INT_MIN;
        glGetShaderiv(self->shader, GL_SHADER_TYPE, &returned_type);
        self->observed_type = returned_type;
        wxslim_shader_failure_arm_source();
        // The pinned GLX implementation obtains the batch string internally,
        // with bufSize=0. Never add a positive-buffer glGetShaderSource here.
        GLint returned_length = INT_MIN;
        glGetShaderiv(self->shader, GL_SHADER_SOURCE_LENGTH, &returned_length);
        self->observed_length = returned_length;
    }

    static void failed_queries(void *state) {
        WxslimShaderFailure *self = static_cast<WxslimShaderFailure *>(state);
        // INT_MIN remains unavailable for any query that did not return. The
        // observer also disarms a token left by an exceptional length query.
        wxslim_shader_failure_observe(self->observed_type, self->observed_length, context());
        wxslim_shader_failure_end();
        self->active = false;
    }

public:
    WxslimShaderFailure(unsigned int program, unsigned int p_shader, unsigned int expected_type, unsigned int variant, uint64_t specialization, const char *source, int source_bytes) : shader(p_shader) {
        // JS accepts only the actual pinned GLX path and the first failure.
        // The JS import bounds its original-source copy to 16 KiB.
        active = wxslim_shader_failure_begin(program, shader, expected_type, variant, static_cast<uint32_t>(specialization), static_cast<uint32_t>(specialization >> 32), source, source_bytes, context()) != 0;
    }

    ~WxslimShaderFailure() {
        if (active) {
            wxslim_shader_failure_end();
        }
    }

    WxslimShaderFailure(const WxslimShaderFailure &) = delete;
    WxslimShaderFailure &operator=(const WxslimShaderFailure &) = delete;

    void compiler_log(const char *log, int returned_bytes, int allocation_bytes) {
        if (!active) {
            return;
        }
        if (!log || returned_bytes < 0 || allocation_bytes < 0) {
            wxslim_shader_failure_error(nullptr, 0, context());
            return;
        }
        int bytes = returned_bytes < allocation_bytes ? returned_bytes : allocation_bytes;
        // JS records this bounded-to-allocation count, then copies at most 4 KiB
        // and marks truncation. Passing the count preserves that distinction.
        wxslim_shader_failure_error(log, bytes, context());
    }

    void queries_after_error_display() {
        if (active && wxslim_shader_failure_guard(reinterpret_cast<uintptr_t>(read_queries), reinterpret_cast<uintptr_t>(failed_queries), this)) {
            wxslim_shader_failure_observe(observed_type, observed_length, context());
        }
    }
};

#endif // WEB_ENABLED && WECHAT_GLX_EXPERIMENTAL
