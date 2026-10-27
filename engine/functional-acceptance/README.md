# 完整引擎的内容验收派生

这里的自有脚本只替换场景内容和身份记录，不裁剪/分包WASM，不重写引擎、库或宿主。默认WebGL、显式GLX门禁和原始配套哈希继续保留。

`stage.mjs` 的 `PARENTS` 是本机历史证据入口，固定到已接受的完整自编译GLX引擎及其WebGL内容对照。**它们不是随Git分发的依赖，也不是干净仓库即可运行的引擎。** 用户需自行准备获准使用的配套JS/WASM、原SDK/宿主和精确manifest；不得用作者预编译文件冒充该父身份。调用 `verifyParent` / `derive` 时可显式传入同身份的本地rule；不能放宽固定引擎指纹以接收其他文件。

测试命令：

```powershell
node --test engine/functional-acceptance/stage.test.mjs
```

两份精确私有父包齐备时执行全部8项。缺少父包时，6项配套集成测试明确skip，仍执行2项独立内容/输出保护测试；skip不等于集成通过。存在但损坏的配套文件仍应失败。本机本轮为8项执行通过，没有用skip掩盖漂移。

`examples/glx-ios-functional`、`glx-ios-functional-v2`、`glx-compat-round3`、`glx-case4-alpha-mix`保留各自当时的自有源码和继承文件副本。字体二进制/导入缓存不上传；使用对应 `build_font.py` 的固定来源和哈希检查生成Acceptance CJK，保留OFL/NOTICE，导出前核对字体确已导入。原PCK、私有FONT.json及精确导出工具在本机冻结清单，不以缺少字体的源目录冒充可直接运行交付包。

历史宿主生成、准确工具链获取和干净PCK导出的三个复现缺口仍按检查点单列。保存源码与脱敏结果不消除这些缺口；已有成功包和原始证据继续私有保存。
