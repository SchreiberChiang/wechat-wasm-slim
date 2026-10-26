# 蓝绿高对比背景：纯 GLX 三角形候选

从已保存的 `4e2474d`、父包 `native-glx-validation-57ccb8dd415854427515` 派生。新候选为 `native-glx-validation-f19e9c52adbca5eeb674`。只在独立目录准备，旧源码、配套 JS/WASM、手机包与原始证据均保留。未上传或运行本候选。

后续状态：用户已批准并执行一次预览/首开，实际 3.17.5 / GLX、shader 类型吻合，三角形可见但背景不变；已停止其余三项手机步骤。静态核查发现 adapter 秒时钟与 get_now 毫秒合同可能不一致，加上绝对值转 float 的量化风险；真机时钟尚未采样，不能先认定主循环或 GLX 呈现故障。完整边界见[本轮记录](../../docs/GLX_NATIVE_CONTRAST_20261025.md)。下述 6.283 秒只是毫秒输入合同下的名义周期，未在真机确认。

## 具体改变

原生源码只有一行差异：

```cpp
glClearColor(0.05f, 0.10f + wave * 0.65f, 0.80f - wave * 0.70f, 1.0f);
```

背景在蓝色 `(0.05, 0.10, 0.80)` 与绿色 `(0.05, 0.75, 0.10)` 之间平滑变化。原 `wave`、主循环、着色器、三角形、上下文属性、类型查询及提交顺序不变，周期仍为约 6.283 秒。观察约 20 秒，预期应看到多个完整颜色往返，而非仅静止三角形。数学测试与编译不能证明手机真的持续绘制。

沿用固定 `libemscriptenglx_4.0.10.a`：GLX 0.1.11，SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`；Emscripten 4.0.10、context patch、库/运行时导出不变。固定 adapter、host、observer、入口与完整 hosted JS 均与父包逐字相同。

除 WASM 外，包身份文件及项目显示名会变化；公共和私有配置的 `libVersion` 目标统一为 3.17.5。AppID/编译选项/GLX 模式不变。该字段不保证手机实际版本；新预览获准后必须重新读取实际 Wechat Lib/SDKVersion，不符即停，不自动下发或清缓存。

## 电脑侧复现

先使用同一构建器，显式选择本目录 `main.cpp`，只编译这个约 344 KB 的 native WASM，不构建 Godot：

```powershell
./examples/glx-native-triangle/build.ps1 `
  -Emsdk <固定SDK绝对路径> -GlxLibrary <固定库绝对路径> `
  -ContextPatch <固定context补丁绝对路径> `
  -SourceFile <本目录main.cpp绝对路径> `
  -OutputDirectory <不存在的新构建目录> -Build

node examples/glx-native-contrast/audit.mjs --build-dir <构建目录> --out <不存在的审计JSON>
node examples/glx-native-contrast/prepare-host.mjs --build-dir <构建目录> --adapter <固定adapter文件> --project-dir <父包配置目录> --out <不存在的新候选目录>
node examples/glx-native-contrast/verify-host.mjs <候选目录>
```

所有路径参数为绝对路径。新 `PINNED_PAIR.json` 只接受审查过的配套文件；新 `audit.mjs` 要求将唯一颜色表达式换回旧表达式后，整个 C++ 与父例相同。未知产物拒绝，既有输出目录拒绝覆盖。V1 的 main/pin/audit/prepare/verify 保持原样，旧候选仍能核验。

准备器复用 V1 observer 原字节；为保持旧候选的固定身份，V2 采用独立的配套准入/准备/核验脚本，没有修改 V1 的生成器。两个变体共用宿主合同测试，runner 的可选 `--variant-dir` 只允许这两个已知目录；默认仍测试 V1，不导入任意外部目录。

```powershell
node --test examples/glx-native-contrast/contrast-tests.mjs
node examples/glx-native-contrast/stager-tests.mjs --build-dir <新构建目录> --adapter <固定adapter文件> --project-dir <父包配置目录> --old-wasm <父包WASM文件> --out <不存在的新测试目录>
node tests/run.mjs
```

测试仅执行自己编写的 host/observer/prelude 与假 API、静态结构校验和颜色数学。没有实例化 WASM 或运行生成 JS、真实 adapter、微信或手机。

新预览方案及与父包的证据边界见[候选记录](../../docs/GLX_NATIVE_CONTRAST_20261025.md)。父包的四项各一次可见不能移作新包验收，也不能把两包次数混算。
