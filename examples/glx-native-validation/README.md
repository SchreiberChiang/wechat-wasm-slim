# 纯 GLX 三角形：有限类型诊断与生命周期候选

本例从 `28c4f2e` 的 `examples/glx-native-triangle` 派生。它直接构建 C++/GLES3 三角形，没有 Godot 引擎、PCK、加载页、赛车、裁剪或 WASM 分包。复用固定 upstream context patch 和原字节社区 adapter，并不声称 GLX 库是本仓库自行实现的。

2026-10-25 仅完成电脑侧准备；未执行生成 JS、WASM 或 adapter，未上传预览、操作手机、下发基础库或发送云日志。当前候选 `native-glx-validation-57ccb8dd415854427515`，详见 [本轮记录](../../docs/GLX_NATIVE_MINIMAL_20261025.md)。第一次显示不能代替生命周期验收。

上述为电脑准备时的状态。随后精确候选已获手机首轮授权、只上传一次，iPhone 实际 3.17.5 的首开/普通重进/强退重开/后台恢复各一次可见；三次初始化 TYPE 查询吻合，后台无新查询。背景持续变化仍未确认，未完成重复稳定性验收。最新状态见[真机记录](../../docs/GLX_NATIVE_PHONE_20261025.md)，不扩大为 Godot 修复或稳定通过。

## 修改范围

- 两个 shader 创建成功后、传源前各读取一次 `GL_SHADER_TYPE`。首次编译失败时，先保留原 InfoLog/stderr，再额外读取一次类型，随后保持原退出路径；单会话最多 3 次。
- 记录 shader 编号、请求类型、GLX 查询返回类型、公共 context handle 和读取序号。返回类型不匹配只记录，继续原传源/编译，不修改 shader 或重建对象。
- 不调用 `glGetShaderSource`、私有 heap/编号表、不新增 `glGetError` 轮询、延时、flush、swap 或手工提交。帧函数、上下文参数、GLSL、创建顺序和主循环与基线一致。
- 新增同步查询会改变 batch 边界；不再出现故障也不能单凭此称为修复。返回类型不是独立观测到的平台对象类型，公共 context handle 不是底层上下文唯一身份，输入 GLSL 不等于平台实际编译输入。
- 本地 observer 记录包/会话、实际基础库与设备元数据、scene、初始化快照、show/hide 及错误。只读取 scene，不记录 query；最多 24 个摘要事件、show/hide 各 4、错误合计 3、shader 摘要 3，摘要字符串最多 2048 字符。原 stdout/stderr 始终完整转发，不按该预算截断。
- 没有云 relay、网络、存储写入、帧循环包装或 GPU 查询轮询。会话标记仅代表 JS observer 生命周期，不能独立证明微信进程重建。

## 复现电脑侧准备

需要已准备且核对的 Emscripten 4.0.10 SDK、GLX 0.1.11 静态库和 context patch。路径由调用方提供；不下载、不自动换库。旧 `build.ps1` 只增加可选 `-SourceFile` 和构建脚本哈希，默认仍编译旧例 `main.cpp`，其参数不变。

```powershell
./examples/glx-native-triangle/build.ps1 `
  -Emsdk <固定SDK绝对路径> `
  -GlxLibrary <固定libemscriptenglx_4.0.10.a绝对路径> `
  -ContextPatch <固定patch_em_gl.js绝对路径> `
  -SourceFile <本目录main.cpp绝对路径> `
  -OutputDirectory <不存在的构建目录> -Build

node examples/glx-native-validation/audit.mjs --build-dir <构建目录> --out <不存在的审计JSON>
node examples/glx-native-validation/prepare-host.mjs --build-dir <构建目录> --adapter <固定adapter文件> --project-dir <已有私有小游戏配置目录> --out <不存在的候选目录>
node examples/glx-native-validation/verify-host.mjs <候选目录>
```

所有路径参数使用绝对路径。独立复制约 37 MB 的现有 SDK cache 并冻结，编译并发 1，缺依赖即停止，不隐式重编系统库。当前仅需这个小型 native 构建，不调用 Godot 编译器、convert 或 Actions。

`PINNED_PAIR.json` 只接纳本次已审查的配套产物；新环境若产生不同哈希，先保留并审查，不通过放宽哈希门禁自动接受。BUILD 保留实际原字节输入哈希；脚本/strict-post 的额外 canonical 哈希仅归一化 CRLF/LF。源文件由 `.gitattributes` 固定 LF。`audit.mjs` 编译/解码 WASM 以检查结构和 native exports，但不创建实例、不调用任何导入或导出。

准备器只在新目录写文件，原生成 JS 后缀与 WASM、adapter 保持原字节，实时 `Module.HEAPU8` getter 不缓存旧 buffer。复用已有 AppID/编译设置，只修改独立项目显示名并把含本机来源路径的 `CANDIDATE.json` 排除在预览包外；私有配置不进 Git。项目 `libVersion` 不代表手机实际基础库。

## 本地验证

```powershell
node --test examples/glx-native-validation/observer-tests.cjs
node examples/glx-native-triangle/host-contract-tests.cjs
node examples/glx-native-validation/stager-tests.mjs --build-dir <构建目录> --adapter <固定adapter文件> --project-dir <已有配置目录> --old-wasm <旧三角形WASM文件> --out <不存在的测试证据目录>
node tests/run.mjs
```

fake-wx 测试只执行本地 observer/host，以及切分出的宿主 prelude，不执行后缀编译 JS、真实 adapter 或 WASM。它们覆盖配对拒绝、既有文件保护、身份、原始错误输出、实时 HEAP 和预算，不代替微信或手机结果。真机操作另行逐项批准。
