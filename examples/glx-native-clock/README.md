# 第 1 / 61 帧时钟观察

父包为 `native-glx-validation-f19e9c52adbca5eeb674`。本候选 `native-glx-validation-089a47b231e870cec5f5` 只增加有限观察与实际版本/上下文门禁，不修正时钟或动画；背景仍可能不变。

`main.cpp` 每帧仍只调用一次 `emscripten_get_now()`，保留原来的 `/1000`、float 转换、sin 和蓝绿颜色公式。仅第 1、61 次 frame 回调的 draw 之后，各输出一条 `[GLX_TRIANGLE_CLOCK]` JSON：原始 double、除以 1000 后的 double、实际 float 相位、wave、计算的 RGBA、公共 context 句柄。另读取一次 `emscripten_date_now()`（固定 SDK 映射到 Date.now 毫秒）作为参考，不参与颜色计算。最多两条，无定时器、GPU 查询、flush、swap 或提交方式修改。

第 61 条帧号证明 frame 回调达到该处，不能证明每一帧已经呈现。原始时钟变化但 float 相位不变可识别量化；原始/参考时钟的增量比可识别单位风险。返回值不能证明平台内部实现。缺第 61 帧只记采集失败，不能直接断言 RAF 停止。

实际 `SDKVersion` 非 3.17.5 则在创建 host/实例化前拒绝；CLOCK 转发前要求已有 GLX 元数据与当前 canvas 匹配，不能静默回退。配置的 libVersion 本身不是手机版本证据。

固定 Emscripten 4.0.10、GLX 0.1.11 的 `libemscriptenglx_4.0.10.a` SHA256 仍是 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。JS/WASM 配对见 `PINNED_PAIR.json`；host、adapter、observer、shader 和帧提交沿用父包。本目录没有 Godot 或云采集。

## 电脑侧复现

所有参数使用绝对路径，输出必须是不存在的新目录或文件。原构建器用 `-SourceFile` 指向本目录 main.cpp，再运行：

```powershell
node examples/glx-native-clock/audit.mjs --build-dir <配对构建目录> --out <新审计JSON>
node examples/glx-native-clock/prepare-host.mjs --build-dir <配对构建目录> --adapter <固定adapter> --project-dir <父包配置目录> --out <新候选目录>
node examples/glx-native-clock/verify-host.mjs <新候选目录>
node --test examples/glx-native-clock/clock-tests.mjs examples/glx-native-clock/read-log-tests.mjs
node examples/glx-native-clock/stager-tests.mjs --build-dir <配对构建目录> --adapter <固定adapter> --project-dir <父包配置目录> --old-wasm <父包WASM> --out <新测试目录>
node tests/run.mjs
```

这些检查只运行自有 fake host/prelude、数值模型和结构审计；不执行生成的 JS、真实 adapter 或 WASM。

## 本轮手机范围

获准的唯一候选仅首开一次，不做重进、强退或后台测试。扫码后保持前台约 20 秒，先核对 vConsole 的 Wechat Lib/entry SDKVersion 为 3.17.5，以及 host 的 actualMode=glx、metadata/canvas match=true，再读取两条 CLOCK。错误、版本不符或缺第 61 帧即停，不清缓存，不再上传候选。

保存完整 vConsole 后运行：

```powershell
node examples/glx-native-clock/read-log.mjs --log <原始日志> --candidate <候选CANDIDATE.json> --out <新分析JSON>
```

读取器核对包身份、单会话、顺序、版本、实际 GLX、错误及两帧字段。原始日志/私有配置/二维码/二进制保留本机忽略目录，不提交 Git。原高对比失败包和更早正常三角形包原样保留；换回手机包需要另行确认。状态见[观察记录](../../docs/GLX_NATIVE_CLOCK_20261025.md)。
