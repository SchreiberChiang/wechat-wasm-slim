# 现有912c安卓日志：启动阶段证据与计时边界

2026-10-28。仅离线读取既有日志与固定引擎源码。没有新增运行日志/探针、手机/GUI操作、构建或改动运行源码。**当前不能把“约30秒”的体感全部认定为3D预热，也不能从已有记录拆出各启动阶段耗时。**

输入是912c / session 5a3b4f95 / Android 10 / 实际GLX observed / 基础库3.17.5的已有vConsole文件，139942bytes，SHA256 eded1c38eb49dff7d96d1dbe32ae5f8c158050625c1d472b45647b4f429b8148。作者可见截图没有配套完整启动日志，本审计不拿它补时间。

## 已能确认的阶段顺序

| 已有标记 | 可确认范围 | 是否有本次运行可靠时间字段 |
| --- | --- | --- |
| SELFBUILD_CANDIDATE_ENTRY | 入口身份已记录，actualMode初始unknown/pending | 无 |
| Worker初始化完成、fs util loaded、engine init | 已执行至相应输出点，按文件顺序出现 | 无 |
| Godot版本、GLX库版本/方案、registerAfterDoFrame、BufferData初始化、全局ID、OpenGL与构建配置 | 引擎/库进入相关初始化输出点 | 无；版本横幅中的日期是构建标记 |
| SELFBUILD_CANDIDATE_SCENE / MANUAL | 场景读取宿主身份；实际GLX observed，上下文匹配已知字段 | 无 |
| scene_ready（seq1） | 场景脚本UI/目录准备记录 | ticksUsec=3903000；unixTimeSeconds=1793113205.793 |
| 首项B01-image切换、准备回调、资源创建、首绘图回调、ready | 首项程序回调阶段 | 同一引擎单调时钟与系统墙钟字段 |
| Engine has started! | 该字符串位于资源创建与首绘图回调之间 | 无；不能据其文字认定用户已看到首帧 |

已有首项阶段计时：准备帧回调等待97ms，资源构造34ms，资源创建至绘图回调129ms，切换开始至该回调总268ms。局部阶段不完全相加等于总数，余下是事件/状态/布局等处理。

scene_ready到ready_for_observation为277ms。首绘图回调记录于引擎ticks 4.176s，ready记录于4.180s；前者是RenderingServer.frame_post_draw回调，不是物理屏幕呈现或首次输入响应证明。后续D15页的793ms准备是另一时间段，不能冒充整个应用启动耗时。

## ticks时钟到底覆盖哪里

固定源码链为：core/os/time.cpp:388–389的Time.get_ticks_usec委托OS单例；platform/web/os_web.h:42的OS_Web继承OS_Unix；os_web.cpp:55–56在initialize中调用OS_Unix::initialize_core；drivers/unix/os_unix.cpp:113–134、185在core初始化内设置_clock_start，391–403返回当前单调时钟微秒减_clock_start。core/os/os.cpp的get_ticks_msec只缩放该值，没有额外的宿主入口起点。

因此3.903s是**引擎OS core内部设定时钟起点以后，到scene_ready日志调用时**的间隔。它不是点击小游戏、入口JS、Engine.start调用、下载或WASM实例化开始到scene_ready的全程；设置起点前的工作不计入。起点后执行的引擎/场景工作计入，但本日志没有把它们再分解。这里只验证了固定源码时钟委托链，没有新增平台clock_gettime探针。

unixTimeSeconds是系统墙钟，可将seq1对应到北京时间22:00:05.793；同轮耗时优先用ticks差，不能把墙钟、横幅构建日期、文件导出名当同一计时起点。

## “约30秒”目前缺什么

现有文件没有用户点击/打开请求的时间，也没有ENTRY、下载/解压、WASM编译/实例化、Engine.start调用/完成、预热开始/结束的同一时钟记录。缺少这些边界，既不能确认完整30秒的准确时长，也不能算出其中多少属于预热。约3.9秒的引擎内时间不能反推剩余约26秒都在某一个阶段。

文件中没有逐shader或预热阶段耗时；作者截图也不能补齐此链。后续首个手动操作与ready之间的长空档属于等待/人工操作区间，不能计作启动。保留当前最小结论：阶段顺序可确认，首项局部回调时间可确认，全程与预热占比未知。

私有审计：E:/AI/wechat-wasm-slim/.local/glx-night-startup-evidence-20261028-01/AUDIT.json，包含原日志哈希、9条首期带时间事件、16条无运行时间标记、源码哈希/行段与未覆盖边界。未改变原日志。
