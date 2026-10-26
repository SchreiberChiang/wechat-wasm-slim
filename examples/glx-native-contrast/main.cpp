// Derived from ../glx-native-triangle/main.cpp at 28c4f2e.
// Only bounded shader-type observations are added. Synchronous queries change
// batch boundaries; absence of a failure in this candidate is not a repair.
#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <climits>

static GLuint program;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context;
static unsigned type_reads = 0;
static bool failed_shader_observed = false;

static void observe_shader_type(const char *stage, GLuint object, GLenum expected) {
    if (type_reads >= 3) return;
    GLint returned = INT_MIN;
    glGetShaderiv(object, GL_SHADER_TYPE, &returned);
    ++type_reads;
    std::printf("[GLX_TRIANGLE_SHADER] {\"schema\":\"triangle-shader-type-v1\","
                "\"stage\":\"%s\",\"shaderId\":%u,\"expectedType\":%u,"
                "\"returnedType\":%d,\"publicContextHandle\":%d,\"readOrdinal\":%u}\n",
                stage, unsigned(object), unsigned(expected), int(returned), int(context), type_reads);
}

static GLuint shader(GLenum kind, const char *source) {
    GLuint result = glCreateShader(kind);
    if (result) observe_shader_type("created-before-source", result, kind);
    glShaderSource(result, 1, &source, nullptr);
    glCompileShader(result);
    GLint ok = 0;
    glGetShaderiv(result, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[2048] = {};
        glGetShaderInfoLog(result, sizeof(log), nullptr, log);
        std::fprintf(stderr, "shader compile failed: %s\n", log);
        // Preserve the original failure before a new synchronous query can throw.
        if (result && !failed_shader_observed) {
            failed_shader_observed = true;
            observe_shader_type("first-compile-failure", result, kind);
        }
        std::exit(2);
    }
    return result;
}

static void frame() {
    int width = 0, height = 0;
    if (emscripten_webgl_get_drawing_buffer_size(context, &width, &height) != EMSCRIPTEN_RESULT_SUCCESS) {
        std::fprintf(stderr, "drawing buffer size failed\n");
        emscripten_cancel_main_loop();
        return;
    }
    const float wave = 0.5f + 0.5f * std::sin(float(emscripten_get_now() / 1000.0));
    glViewport(0, 0, width, height);
    glClearColor(0.05f, 0.10f + wave * 0.65f, 0.80f - wave * 0.70f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glUseProgram(program);
    // A clear-only workload does not exercise this library's drawcall>0 swap path.
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

int main() {
    EmscriptenWebGLContextAttributes attributes;
    emscripten_webgl_init_context_attributes(&attributes);
    attributes.majorVersion = 2;
    attributes.minorVersion = 0;
    attributes.explicitSwapControl = false;
    attributes.depth = false;
    attributes.stencil = false;
    attributes.antialias = false;
    context = emscripten_webgl_create_context("#canvas", &attributes);
    if (context <= 0 || emscripten_webgl_make_context_current(context) != EMSCRIPTEN_RESULT_SUCCESS) {
        std::fprintf(stderr, "WebGL2 context creation/current failed\n");
        return 1;
    }
    const char *vertex = R"(#version 300 es
layout(location=0) in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
)";
    const char *fragment = R"(#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(1.0, 0.35, 0.08, 1.0); }
)";
    const GLuint vs = shader(GL_VERTEX_SHADER, vertex);
    const GLuint fs = shader(GL_FRAGMENT_SHADER, fragment);
    program = glCreateProgram();
    glAttachShader(program, vs);
    glAttachShader(program, fs);
    glLinkProgram(program);
    GLint linked = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (!linked) {
        char log[2048] = {};
        glGetProgramInfoLog(program, sizeof(log), nullptr, log);
        std::fprintf(stderr, "program link failed: %s\n", log);
        return 3;
    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    const GLfloat vertices[] = {-0.7f, -0.6f, 0.7f, -0.6f, 0.0f, 0.7f};
    GLuint vao = 0, buffer = 0;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(1, &buffer);
    glBindBuffer(GL_ARRAY_BUFFER, buffer);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glEnableVertexAttribArray(0);
    std::puts("native-triangle: WebGL2 initialized; host must independently prove actual GLX mode and display");
    emscripten_set_main_loop(frame, 0, true);
}
