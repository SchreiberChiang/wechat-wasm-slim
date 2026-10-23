# 首次失败 TYPE 原始返回观察

这是自构建诊断候选，**不是黑屏修复**。依据见[对象生命周期核对](../../docs/GLX_OBJECT_LIFECYCLE_20261024.md)。封存的 `shader-failure` 实现、正常/失败包和日志保持不变；此目录只增补现有类型查询的原始 JS 返回类别，不能认证平台 shader 对象或实际编译输入。

## 唯一运行差异

在首次 shader 编译失败后的既有 `glGetShaderiv(shader, GL_SHADER_TYPE, ...)` 前精确调用一次 `wxslim_shader_failure_arm_type()`。现有同步 Int import 取得 token，调用原 `batchRender(view)` 一次，旁路观察返回值，再原样返回该值。旧错误、类型整数、源码、清理与异常路径继续保留。

新增 `GLX_TYPE_RAW_RETURN` 字段只有：`typeof`、是否 null、primitive number 是否有限及有限数值、调用参数 `ptr/byteLength`、arm/take/capture 次数。指针只是此次已有 import 的参数，不解引用、不读 heap 或解析 batch。字符串不保存内容；对象不读取属性、不枚举、不转换、不保存引用。原平台异常继续抛出，观察器自身异常隔离。只有旧失败状态有效时才 arm；普通 WebGL、成功编译和后续失败不产生新观察记录。

**相对已验失败诊断包，新增 GPU 查询为零。** 旧诊断本身仍会在首次失败时查询类型和源码长度，保留其读取次数、文本上限及无法限制平台内部字符串获取长度的边界。没有新增 flush、swap、延时、context 重建、源码改写、库替换、云采集或加载页改动。

## 构建与回退

使用既有完整配方中的固定 Godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb`、Emscripten `4.0.10`、GLX 库 SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。不要改旧构建目录或把新 JS 配旧 WASM。

1. 在新目录创建上述 pin 的干净源码克隆；可读取既有 SDK/库，SDK cache 必须已冻结。
2. 运行下列 preparer。它先核验旧诊断 5 个输入的固定 SHA，生成并验证旧补丁，再加入两行 header 变更、新 JS library 及 Int 后处理。旧补丁 SHA 为 `fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b`，新完整补丁 SHA 为 `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6`。共 8 个引擎源码文件；输出存在即拒绝。
3. 新建 toolchain JSON，保留既有版本、库哈希与构建参数，`engineSource` 指向新克隆，`patches` 只含新完整补丁；完整 profile 保持 46 modules、无禁用类/模块。

```powershell
node engine/shader-type-return/prepare-source-patch.mjs --source '<新干净源码>' --out '<新目录>/diagnostic.patch'
node trim/trim.mjs check --toolchain '<新目录>/toolchain.private.json'
node engine/shader-type-return/check-native.mjs --source '<已准备源码>' --toolchain '<新目录>/toolchain.private.json' --out '<新原生测试目录>'
node trim/trim.mjs build --toolchain '<新目录>/toolchain.private.json' --profile '<新目录>/full.gdbuild' --work '<新目录>/build' --lto thin --jobs 4 --lto-jobs 2 --retries 1 --max-minutes 120
node engine/audit-pair.mjs --build-dir '<新目录>/build' --out '<新目录>/pair-audit.json'
node engine/shader-type-return/audit-abi.cjs --build-dir '<新目录>/build' --sdk '<固定的 4.0.10 SDK>' --out '<新 ABI 审计目录>'
node --test tests/shader-type-return-tests.mjs tests/shader-type-return-stage-tests.mjs
node tests/run.mjs
```

`check-native.mjs` 只编译自有 GL stub fixture，不链接 GLX 或运行 Godot；分别检查 native arm/异常边界和 JS 观察行为，不代替完整配套产物与真实画面验收。原 native checker 10 项、新边界 checker 13 项均需通过。新 JS/组包合同测试为 12+10 项。

完成构建后使用本目录的独立 stager；它固定新补丁和原父包封存记录，核对所有新增文件（包括 `.cjs`）、完整 profile、实际库路径、配套 JS/WASM/Brotli 和两个唯一观察 marker。旧 stager 的准入规则没有放宽。

`audit-abi.cjs` 只解析字节和 JS AST，不执行目标引擎。它核对实际 WASM import 与最终 JS 映射、header 中 7 个诊断入口（含 guard）的签名，以及新增 arm 的零参数 void 和真实 Int import 的 `(i32, i32) -> i32`。两个 marker 必须位于对应的实际 import 定义中；单独包含同名字符串不能通过。符号文件另存哈希，不把它们误说成三文件配对身份的一部分。

```powershell
node engine/shader-type-return/stage-candidate.mjs --parent '<封存 engine-first 父包>' --seal '<外部 PHONE_TREE_MANIFEST.json>' --build-dir '<新目录>/build' --patch-manifest '<新目录>/diagnostic.patch.json' --out '<新的 WebGL 目录>'
# 另一个不存在的输出目录，显式 --mode glx；默认仍是 webgl。
```

两个模式均关闭 relay。保留原中文场景/PCK/adapter/加载页，替换完整引擎对和包身份；不把新包覆盖到旧目录。回退电脑测试可重新打开封存包，手机回退换包仍需用户另行批准。默认转换器及原裁剪/分包代码没有变更，本候选只验证完整引擎。

## 手机方案与判读边界

只有完整配对审计、实际 WebGL 画面回归完成后，才报出具体新 GLX 包标识并申请新预览。拟测试范围为同一 iPhone 首开一次；正常后上滑结束微信再重开一次。首次若黑屏则停在该处，不继续强退；任何失败保留日志和现场，不清缓存、不反复重试。手机截图、进程和 vConsole 采集范围随新包一起申请，本轮没有授权执行。relay 保持关闭，不新增云采集。

- 原始有限 number 35632，WASM 结果也为 35632：排除该次数字跨边界转换造成 35633→35632；仍不能区分平台对象错配、getter 缓存、context 状态或整批返回约定。
- 原始有限 number 35633，WASM 结果却为 35632：优先查 import/ABI/结果关联，不再声称平台已返回片元数值。
- 原始 string/object 等：先核实同步返回合同；不通过手动 Number 或取数组项“修正”响应。
- 未出现 shader 失败或未捕获有效 token：本轮没有回答类型异常的来源，不宣称根因解决，也不靠加大重试量制造答案。

返回源码相同、公共 context 句柄相同、shader 错误消失都不等于 GLX 稳定。问题总表中的画面、强退重开、前后台、场景、触摸、音频、裁剪及分包仍各自待验。
