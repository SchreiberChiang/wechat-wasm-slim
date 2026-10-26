# 待审核草稿：iOS原生GLX三角形在菜单“重新进入”后停止变色

**状态：仅本地草稿，尚未发送。原始日志和包均未附加或公开。**

## 问题与环境

最小C++/WASM三角形，使用原生EmscriptenGLX。背景按整数帧号每60帧切换红/绿/蓝，不依赖时钟计算动画；没有Godot、赛车、裁剪或WASM分包。本轮同一预览包首次进入画面正常，随后从右上角三点菜单“重新进入”，用户反馈“刚开始就卡住了”。这是有限测试中观察到的结果，不宣称所有设备或每次运行都失败。

| 项目 | 值 |
| --- | --- |
| 设备 | iPhone 16 Pro / iPhone17,1 |
| 系统 | iOS 18.3.1 |
| 微信 | 8.0.75 |
| 实际基础库 | 3.17.5，由运行日志与SDKVersion核对 |
| 工具链 | Emscripten 4.0.10 |
| GLX库 | libemscriptenglx_4.0.10.a；标记0.1.11 / 2025.12.05 |
| 库SHA256 | c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a |
| 包标识 | native-glx-validation-e3bff4670c2ecebbbe0c |
| manifest SHA256 | 7c2d8c5ed4534992ec40caa367cbece19cbede99a1cfc38290745079a683f3b4 |
| 运行模式证据 | 现有上下文含emscriptenGLX，metadata及canvas匹配，非WebGL回退 |
| 配置声明 | iOSHighPerformance=true、iOSHighPerformance+=true；不据此单独认证实际后端/权限 |
| 日志中的宿主标记 | directGameWorker、isWorker=true、isWKGame=true；不将其等同于标准Web Worker合同 |

使用WebGL2 GLX上下文、explicitSwapControl=false、OFFSCREEN_FRAMEBUFFER=0。帧提交沿用库注册的afterDoFrame→glxCommandBufferFlush→batchRenderAsync→有drawcall时swapWindow。主循环采用emscripten_set_main_loop(frame,0,true)。

## 已执行的对照步骤

1. 核对实际基础库3.17.5，上传该固定候选一次，首次打开。方案要求观察至少15秒并导出完整vConsole；用户反馈正常，未独立计时确认观察时长。记录scene1101。
2. 首开画面及两条摘要核验通过后，仅做一次右上角三点菜单“重新进入”。按方案观察并导出；用户反馈刚开始就卡住。记录scene1089。精确冻结时刻和独立计时的导出覆盖长度未采集。
3. 停止测试；未清缓存、追加包或反复重试。此处记录历史步骤，不请求当前再次复现。

## 已确认记录

| 项目 | 首开正常 | 菜单重进失败 |
| --- | --- | --- |
| 启动标识 | triangle-mvnuuuff-xu8cu06d | triangle-mvnuxbdh-ttdn7dob |
| 两条摘要 | CP1=4001ms、CP2=9000ms | 仅取得CP1=4004ms；CP2正文未取得 |
| 摘要实际时钟值（日志原值） | CP1=1792934416179、CP2=1792934421178 | CP1=1792934531455 |
| RAF请求进入/返回 | 239→539，均返回 | 15/15 |
| RAF回调交付及native回调 | 238→538，均返回 | 各14/14 |
| afterDoFrame/flush/batch/swap | 各238→538，均返回 | 各13/13 |
| generation | 0→0 | 0 |
| open / throw | 0 / 0 | 0 / 0 |
| abort / runtimeExited | false / false | false / false |
| shader创建后类型 | 顶点35633、片元35632匹配 | 同样匹配 |

两轮是不同启动标识，均通过同包核对，启动时自有observer/host/adapter标记不存在。失败尾部顺序为：第13次提交链返回→第14次原生回调返回→第15次RAF请求返回→第14次RAF交付包装返回。第4秒timer仍能执行。请求返回不保证下一次回调交付；JS swap返回不保证GPU呈现；缺CP2不证明线程阻塞。公共context handle=1及metadata ctxid=2在两轮相同，不用来证明底层上下文同一。

诊断摘要是4/9秒两个单次timer，各一条完整JSON字符串，使用不同可见标题CP1/CP2。它们的存在可能扰动时序；报告没有把诊断条件下的表现认定为无诊断版本的全部行为。

## 已做的电脑排查与限制

从同包实际生成JS逐字提取调度/取消代码，隔离模拟宿主。给定“不投递第15次RAF”与“不投递第14次afterDoFrame”两个独立假设后，可得到14回调/15请求/13提交，均返回且generation0；这是模型相容性，不是平台行为证明。

经实际cancel函数在CP1前取消会使generation增加；在native第14次内部取消还会阻止第15次请求。CP1后的取消仍不能凭单个快照排除。只扣留RAF时，若timer及输出正常，CP2仍会产生；不投递timer和丢弃console输出都能只留下CP1，现有文本不能区分。

此前另一会话出现WeixinWorker.createWXLibWorker缺失、参数WAAccelerateWorker.js的异常，堆栈指向微信运行时。本组首开/失败导出未出现该异常，单独保留，不归因为本次冻结。

## 请微信确认的最小问题

1. 在上述客户端/基础库及GLX库组合下，三点菜单“重新进入”的worker、WASM、GLX context与待处理RAF具体何时销毁或重建？旧实例清理是否可能影响新实例帧调度？有没有受支持的生命周期状态或实例generation读取方式？
2. registerAfterDoFrame的作用域是context、worker还是更大范围？重复注册是替换还是追加？正式注销方式是什么？context销毁是否清除注册，旧回调是否可能在销毁后继续投递？它与RAF交付、swap之间有何保证的顺序？
3. emscriptenGLX是否要求保留原始对象作为方法接收者？当前适配使用Object.assign({}, context.emscriptenGLX)并以复制对象调用注册、batch、swap，这种方式是否受支持？仅更新native ctxid时是否需要重新绑定任何回调？
4. 对当前“第14次回调返回、第15次请求返回、后续未取得回调证据”的边界，官方建议用什么受支持的最小证据区分调度取消、上下文/worker销毁和日志未交付？是否有对应平台版本已知问题及兼容库要求？

上述约定本轮未能从官方原生GLX指南正文核实，故请求确认，不声称其不存在或平台违反合同。原始包、配套JS/WASM、源码/构建记录及原始日志已在本地封存，若需要提供，须先由持有人逐项审核授权；本草稿不附带任何附件或访问入口。
