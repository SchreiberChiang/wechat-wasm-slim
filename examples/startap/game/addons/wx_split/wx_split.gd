extends Node
## wechat-wasm-slim 的 Godot 接入（autoload "WxSplit"，启用插件时自动注册）。
## 点击门、采集包判断、加载计时事件、自动测试开关都在这里，游戏只调这几个函数：
##   await WxSplit.enter_scene(path, scene_tag, gated)  进玩法场景（分包版先过点击门）→ "READY" / "TRAINING_DONE" / 错误码
##   WxSplit.mark_title_ready()                         第一个可交互画面（标题）出现时调一次
##   WxSplit.mark_first_frame(scene_tag)                玩法场景第一帧（_ready 里）调
##   WxSplit.is_wechat() / is_collect_build()
##   WxSplit.qa_mode() / qa_arg(name)                   自动测试开关：只负责读出来，玩法由游戏自己实现
## 加载计时模块（convert / split 产物自带的 godot-data/wxslim-timing.js）读的就是这里打印的 [STARTUP_3D_FLOW] 事件。
## JS 侧是同目录的 wx_split.js（convert 默认装成 godot-data/wx-split.js）。

const FLOW_TAG := "[STARTUP_3D_FLOW]"
const JS_API := "WxSplit"
const READY := "READY"
const PENDING := "PENDING"
const TRAINING_DONE := "TRAINING_DONE"
const LOAD_FAILED := "LOAD_FAILED"
const BUSY := "BUSY"

var _api: JavaScriptObject = null
var _probed := false
var _args := {}
var _entering := false


func _init() -> void:
	# 命令行参数放在 `--` 之后：--qa-play=2d → {"qa-play": "2d"}；只写 --qa-quit → {"qa-quit": "1"}
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"


## 插件 JS 接口；只在 Web 导出里取一次。没装 wx-split.js 的旧工程会在这里打一条 Godot 错误日志（见插件 README）。
func _js() -> JavaScriptObject:
	if not _probed:
		_probed = true
		if OS.has_feature("web"):
			_api = JavaScriptBridge.get_interface(JS_API)
	return _api


func is_wechat() -> bool:
	var api := _js()
	return api != null and bool(api.isWechat())


## 分包采集包（split collect-pack）：训练等待门会发布 __WXSLIM_COLLECT_GATE__（旧名 __WX15_TRAINING12_GATE_DIAGNOSTIC__）
func is_collect_build() -> bool:
	var api := _js()
	return api != null and bool(api.isCollect())


## 自动测试模式：电脑上 `-- --qa-play=2d|3d`（只写 --qa-play 等于 2d）；小游戏里由 JS 的 WxSplitConfig.qa 给出。没有返回 ""
func qa_mode() -> String:
	var m := str(_args.get("qa-play", ""))
	if m == "":
		var api := _js()
		if api != null:
			m = str(api.qaMode())
	return "2d" if m == "1" else m


## 其他命令行开关（例如 qa-quit、qa-shot、server）；没有返回 fallback
func qa_arg(name: String, fallback := "") -> String:
	return str(_args.get(name, fallback))


func has_qa_arg(name: String) -> bool:
	return _args.has(name)


func mark_title_ready(scene_tag := "title") -> void:
	_flow({"event": "two_d_first_frame", "scene": scene_tag})


func mark_first_frame(scene_tag: String) -> void:
	_flow({"event": "scene_first_frame", "scene": scene_tag})


## 进入玩法场景。必须 await。
## gated：这个场景的代码是否在余包里（分包后要先过点击门）。JS 的 WxSplitConfig.gate[scene_tag] 可以覆盖它（按分包方案切换，不用改 PCK）。
## 分包版：点击门 request() 后轮询到 READY 再 load()；采集包里过门就停，返回 "TRAINING_DONE"，不加载场景。
## 没分包（没有点击门）或电脑上：直接 load() 并切场景。场景在这里才 load()，不要在标题里 preload。
## 返回 "READY"、"TRAINING_DONE"、"BUSY"（上一次还没结束）、"LOAD_FAILED" 或点击门的错误码（以 _REQUIRED / _RETRYABLE 结尾）。
func enter_scene(path: String, scene_tag: String, gated := true) -> String:
	if _entering:
		return BUSY
	_entering = true
	var status := await _enter(path, scene_tag, gated)
	_entering = false
	return status


func _enter(path: String, scene_tag: String, gated: bool) -> String:
	_flow({"event": "click", "scene": scene_tag})
	var api := _js()
	if api != null:
		var o := str(api.gateFor(scene_tag))
		if o == "on":
			gated = true
		elif o == "off":
			gated = false
	if gated and api != null:
		var gate_name := str(api.clickGateName())
		if gate_name != "":
			var gate: JavaScriptObject = JavaScriptBridge.get_interface(gate_name)
			if gate != null:
				var status := str(gate.request())
				while status == PENDING:
					await get_tree().process_frame
					status = str(gate.status())
				if status != READY:
					_flow({"event": "transition_failed", "scene": scene_tag, "status": status})
					return status
				if bool(api.isCollect()):
					_flow({"event": "collection_gate_complete_3d_blocked", "scene": scene_tag})
					return TRAINING_DONE
	var scene := load(path) as PackedScene
	if scene == null or get_tree().change_scene_to_packed(scene) != OK:
		_flow({"event": "transition_failed", "scene": scene_tag, "status": LOAD_FAILED})
		return LOAD_FAILED
	return READY


## 计时模块按整行解析：`[STARTUP_3D_FLOW] {"event":...}`（Godot print 在小游戏里走 console.log）
func _flow(event: Dictionary) -> void:
	print(FLOW_TAG + " " + JSON.stringify(event))
