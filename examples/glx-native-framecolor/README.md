# 整数帧红绿蓝：纯 GLX 三角形

候选 `native-glx-validation-bee48002c945db68649a`，父包为两帧计时诊断 `native-glx-validation-089a47b231e870cec5f5`。旧包和原始计时证据原样保留。本目录没有 Godot、裁剪、WASM 分包或云上报。

## 唯一渲染行为改动

```cpp
const unsigned phase_index = ((color_frame - 1u) / 60u) % 3u;
const GLfloat colors[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
```

第1–60回调红、第61–120绿、第121–180蓝，然后重复。颜色计算不读取时钟、没有 sin 或绝对大数转 float；纯 RGB 参数以 float 传入既有 glClearColor。橙色三角形、shader、上下文创建和原提交调用顺序不变，未添加 flush、swap、延迟或重新建 context。文件顶部 V1 继承注释只描述原 shader 观察，新增颜色及日志差异明确标在 COLOR 块。

只在换色回调的 draw 之后输出 `[GLX_TRIANGLE_COLOR]`：frame、sampleOrdinal、phaseIndex、颜色名、计算 RGBA、公共 context 句柄。每个 JS 会话最多180条，终条 budgetExhausted=true；达到预算停止本轮采集，不重置日志预算，不取消绘制。日志没有像素读取，不能证明颜色可见。帧号不是实际时长、FPS 或全部呈现帧数。

固定 Emscripten4.0.10、`libemscriptenglx_4.0.10.a`（GLX0.1.11，SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`），配套见 PINNED_PAIR.json。host、observer、adapter、game入口与V3相同；沿用V3版本/context门禁，print前缀从CLOCK改成COLOR。observer的会话标记仍可使用Date.now，但不驱动动画。未改公共adapter和默认WebGL。

## 本地构建与检查

沿用 `../glx-native-triangle/build.ps1`，将 `-SourceFile` 设为本目录main.cpp，输出到不存在的新目录。固定库、SDK和context补丁路径由已有本地构建记录恢复，不重新下载或升级。随后：

```powershell
node examples/glx-native-framecolor/audit.mjs --build-dir <配对构建目录> --out <新审计JSON>
node examples/glx-native-framecolor/prepare-host.mjs --build-dir <配对构建目录> --adapter <固定adapter> --project-dir <父包配置目录> --out <新候选目录>
node examples/glx-native-framecolor/verify-host.mjs <候选目录>
node --test examples/glx-native-framecolor/color-tests.mjs examples/glx-native-framecolor/read-log-tests.mjs
node examples/glx-native-framecolor/stager-tests.mjs --build-dir <构建目录> --adapter <固定adapter> --project-dir <父包配置目录> --old-wasm <父包WASM> --out <新测试目录>
node tests/run.mjs
```

参数使用绝对路径，既有输出拒绝覆盖。audit剥除新增COLOR块、还原旧颜色公式后要求整个C++与V1一致；main/shader/GL调用顺序另有测试。生成JS/WASM在电脑未执行或实例化，测试只使用自有fake宿主和静态/整数模型。

## 手机门禁与顺序

本轮只批准这一个候选、一次预览；实际SDK非3.17.5在host创建前拒绝，不下发基础库。COLOR输出前检查实际GLX元数据和canvas，不静默回退。用户先确认三角形可见，背景持续出现红→绿→蓝→红→绿→蓝→红至少两轮；完整日志确认包/单会话/实际3.17.5/GLX/两shader类型及回调序列，之后才普通退出重进一次、上滑结束微信重开一次、切后台恢复一次。每步仍要确认画面回来后继续变色。异常、缺样本或预算耗尽立即停当步，记录实际画面和最后可取得的帧，不能用回调日志覆盖用户看到的失败。

```powershell
node examples/glx-native-framecolor/read-log.mjs --log <完整日志> --candidate <CANDIDATE.json> --out <新分析JSON>
# 同一会话的后续累计日志，可加 --previous <前一分析JSON> 检查新增帧；新会话的独立导出不加此项。
```

日志读取器支持完整累计多会话或每阶段单独日志；版本/身份/原始错误/顺序/预算门禁失败返回STOP。日志“两轮回调”与用户“两轮可见”分别记录。回退位置、每轮结果与后续最小Godot方案见[本轮记录](../../docs/GLX_NATIVE_FRAMECOLOR_20261025.md)；不自动换回手机包，不清缓存，不补发版本。
