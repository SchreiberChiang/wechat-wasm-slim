# GLX 重进生命周期：实际调度代码离线对照

日期：2026-10-25。范围仅为用户批准的电脑侧离线对照、公开接口核查和问题报告草稿。没有修改既有候选、渲染逻辑、GLX库或WASM，没有上传、手机操作、Inspector枚举、清缓存、外发或公开附件。

## 输入与保全

输入为 `native-glx-validation-e3bff4670c2ecebbbe0c`：

- manifest SHA256：`7c2d8c5ed4534992ec40caa367cbece19cbede99a1cfc38290745079a683f3b4`
- 实际 hosted JS SHA256：`4fb5e7017c11e34ca31ac41fcef4ef2337efb274d8370373a42085fdf9e50524`
- WASM SHA256：`c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79`
- `libemscriptenglx_4.0.10.a` SHA256：`c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`

模型从该实际hosted JS逐字提取7段：ExitStatus、exitRuntime、keepalive/异常/callUserCallback、timing/runner/pause/cancel、main-loop入口、after-frame注册与batch桥、原探针安装。提取片段及字符/UTF-8偏移、SHA逐项保存。没有用手写runner替代实际代码，没有运行整个引擎JS、adapter或WASM。

证据根：`E:\AI\wechat-wasm-slim\.local\glx-scheduler-offline-20261025-01`。脚本 `scheduler-offline.mjs`；最终结果 `run-02/RESULT.json`。`run-01`保留：审阅发现其assumptions只列增量配置，随后补全默认假设并输出run-02，执行行为与比较结果未改。候选、两份手机对照和相关源码共30项SHA前后不变。

运行方式：`node <证据根>\scheduler-offline.mjs <全新绝对输出目录>`。已有输出拒绝覆盖。所有模型日志显式标为OFFLINE_ONLY，不能并入真机验收。

## 模型替代的部分

执行原始调度代码及封存的自有probe/ledger。平台RAF队列、timer交付、原生帧函数、GLX上下文、原生flush、GPU及退出清理副作用都是假接口。原生帧函数只计数，不绘制；假flush固定调用实际JS batch桥，drawcall设为1。因此一对一的after-frame/flush/batch/swap关系也是模型设定，不是对闭源GLX的验证。

为构造与失败快照相同的边界，模型**分别给定**：投递14次RAF、不再投递已排队的第15次RAF；仅投递前13次after-frame，不投递第14次。这两项独立假设不是由日志或代码证明的平台行为。模型验证的是在这些输入下，实际runner仍会提出第15次请求，且相关包装正常返回。

CP时钟手工推进至4000/9000ms，对照模型也如此。没有真实计时、帧率或宿主健康度测试。

## 8个场景与8项断言

| 场景（人为输入） | 实际调度代码产生的结果 | 与真机的关系 |
| --- | --- | --- |
| 连续投递对照 | CP1 frame14，CP2 frame74；generation0；两摘要完整 | 证明提取代码可继续调度，不等于真机性能/画面通过 |
| 请求返回，扣留后续RAF及第14次after-frame | 请求15、回调14、提交13，均返回，generation0；CP1/CP2均存在且计数不变 | 与真机CP1边界相容；没有复现真机缺CP2 |
| native第14次内部调用实际cancel | 请求14、回调14、generation1；本模型keepalive归零后退出 | 不符合真机CP1的请求15、generation0 |
| 第15次请求返回后、CP1前调用cancel | 请求15、回调14，但generation1、scheduler/func为空；running仍为true | 总数可相似，generation可区分；running不是活跃保证 |
| 取消后继续投递旧RAF | delivery增至15，native仍14；旧代检查阻止后续原生执行 | 回调交付不等于原生帧执行 |
| CP1之后才取消 | CP1与未取消情形相同，CP2 generation1 | 一个CP1不能排除之后发生的取消 |
| 扣留后续RAF且额外不投递CP2 timer | 只有CP1文本 | 缺失可由此模型产生，非平台原因证明 |
| 扣留后续RAF且额外丢弃CP2 console输出 | 同样只有CP1文本，但第二timer实际执行 | 仅凭保存的摘要文本与上一情形不可区分 |

8项断言全部通过。只扣留RAF不足以解释缺CP2：在timer交付、日志输出正常的模型中，两条摘要仍会产生。最后两个模型的内部trace可区分，导出的检查点正文不可区分。不能把这一点扩大成手机timer停止、线程阻塞或日志丢失的已确认结论。

样例唯一显式cancel路径是画布尺寸读取失败，代码先打印错误；当前真机CP1前未见该错误且generation0。因此样例通过此函数在CP1前主动取消，不受现有证据支持。它不排除CP1之后取消、平台直接撤销任务或其它未观测生命周期行为。

## 公开接口核查

优先访问：

- [原生EmscriptenGLX指南](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-emscriptenglx-native.html)
- [onShow](https://developers.weixin.qq.com/minigame/dev/api/base/app/life-cycle/wx.onShow.html)
- [Worker指南](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/worker.html)
- [requestAnimationFrame](https://developers.weixin.qq.com/minigame/dev/api/render/frame/requestAnimationFrame.html)
- [场景值列表](https://developers.weixin.qq.com/minigame/dev/reference/scene-list.html)

本轮访问工具均返回non-retryable error，未取得正文，无法固定对应文档版本。对官方域名/微信公开组织检索registerAfterDoFrame/afterDoFrame未取得合同正文。未绕过访问限制；Unity/团结实现没有作为原生GLX合同证据。

以下均为**未知**，不是“官方不支持”或“不存在”：

1. 同一context再次registerAfterDoFrame是替换还是累加，有无公开注销方式。
2. context/worker销毁是否自动清除回调，旧回调是否仍可能投递。
3. emscriptenGLX对象经Object.assign浅拷贝后，以复制对象作为this调用是否被支持。
4. 菜单重新进入时worker、WASM、context、after-frame和待处理RAF的销毁/重建顺序。
5. 是否存在受支持的实例generation/上下文identity查询，而不依赖可复用的数字handle。

## 保留结论与报告

当前最窄结论：第4秒观测到的真机边界与“后续宿主帧回调未进入当前包装”的模型相容，不支持CP1前经样例cancel主动停循环；这不是宿主故障或根因确认。上下文/旧注册生命周期假设仍缺官方合同及底层证据，不能擅自补注销、强制重建或加延时。

createWXLibWorker异常保留在此前独立会话；当前这组首开/失败日志未出现该异常。不将它归因于本次冻结。

待用户审核草稿：`docs/GLX_WECHAT_LIFECYCLE_QUESTIONS_DRAFT_20261025.md`。草稿没有AppID、账号、配对资料、原始日志、截图或二进制附件；未对外发送、提交工单或公开。手机测试和探针包继续停止。
