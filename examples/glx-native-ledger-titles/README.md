# 两条检查点使用独立标题

独立候选 `native-glx-validation-e3bff4670c2ecebbbe0c`。用途仅为报告可区分性，不是日志丢失或游戏冻结修复。旧源码 `../glx-native-ledger/` 与 df49 封存包不修改，仍可用原verify审计。

运行时代码相对旧版仅删除固定PREFIX常量，将输出标题改为 `[GLX_CP1]` / `[GLX_CP2]`。JSON序列化表达式、4/9秒timer、最多两次输出、快照读取和全部游戏执行路径保持。新包身份自然变化，正文中的packageId应使用新身份；在相同identity输入下，正文逐字一致的回归已通过。

新reader接受新旧格式，检查标题编号与正文一致、包和启动标识；缺少两条独立正文时显式停止，不依据UI徽标补造第二条。已有原始错误判定和门禁保留。reader不随游戏包上传。

## 本地命令

在仓库根运行；所有输出路径必须是全新绝对路径。

```powershell
node examples/glx-native-ledger-titles/ledger-tests.cjs
node --test examples/glx-native-ledger-titles/read-log-tests.mjs examples/glx-native-ledger/read-log-tests.mjs examples/glx-native-boundary/read-log-tests.mjs
node examples/glx-native-ledger-titles/stager-tests.mjs --parent-dir <9b31封存目录> --out <全新测试目录>
node examples/glx-native-ledger-titles/prepare-host.mjs --parent-dir <9b31封存目录> --out <全新候选目录>
node examples/glx-native-ledger-titles/verify-host.mjs <候选目录>
node examples/glx-native-ledger-titles/read-log.mjs --log <原始日志> --candidate <候选CANDIDATE.json> --out <全新报告>
```

生成仍沿用原9b31来源链，在本次报告中与df49逐字比较，只有execution-ledger.js、identity.js及manifest变化。未重编WASM或重链库；未执行第三方adapter/编译JS/WASM。没有新手机结果、预览或云采集。详细证据见 docs/GLX_CHECKPOINT_TITLES_20261025.md。
