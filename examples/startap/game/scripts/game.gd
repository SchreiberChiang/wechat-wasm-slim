extends Node
## 全局（autoload "Game"）：网络、登录状态、音乐音效、震动、场景切换、掉线回标题。
## 场景：title（改名、点击登录、选模式）→ play2d / play3d。3D 场景只在点击时 load()，方便以后按场景分包。
## 自动测试参数（放在 `--` 之后）：--qa-play=2d|3d（自动登录并自动玩一局）  --qa-quit（结算后退出）  --qa-shot=路径
## 小游戏里没有命令行：测试包在 JS 里设置 DemoWx.qa = "2d" 或 "3d"。

const SAVE_PATH := "user://demo.cfg"
const TITLE := "res://scenes/title.tscn"
const PLAY_2D := "res://scenes/play2d.tscn"
const PLAY_3D := "res://scenes/play3d.tscn"

var net := Net.new()
var music := AudioStreamPlayer.new()
var sfx: Array[AudioStreamPlayer] = []
var snd := {}
var qa := {}

var logged_in := false
var login_mode := ""
var best := {"2d": 0, "3d": 0}
var online := 0
var feed := ""
## 回到标题时要显示的原因（掉线、登录过期等）
var title_message := ""


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		qa[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if OS.has_feature("web"):
		var d: JavaScriptObject = JavaScriptBridge.get_interface("DemoWx")
		if d != null and str(d.qa) in ["2d", "3d", "true"]:
			qa["qa-play"] = "2d" if str(d.qa) == "true" else str(d.qa)
	if qa.get("qa-play", "") == "1":
		qa["qa-play"] = "2d"
	add_child(net)
	net.ws_message.connect(_on_ws_message)
	net.ws_state.connect(_on_ws_state)
	music.stream = load("res://audio/music.wav")
	music.volume_db = -6.0
	music.finished.connect(music.play)
	add_child(music)
	for n in ["pop", "click", "miss", "start"]:
		snd[n] = load("res://audio/%s.wav" % n)
	for i in 6:
		var p := AudioStreamPlayer.new()
		add_child(p)
		sfx.append(p)
	music.play()
	print("[DEMO] READY server=%s" % net.server)


# ---------- 音频、震动 ----------
func play_sfx(n: String, pitch := 1.0) -> void:
	for p in sfx:
		if not p.playing:
			p.stream = snd[n]
			p.pitch_scale = pitch
			p.play()
			return


## 手机网页/小游戏里走 navigator.vibrate（小游戏由兼容层转到 wx.vibrateShort/Long）；电脑上无效果
func vibrate(ms: int) -> void:
	Input.vibrate_handheld(ms)


# ---------- 存档 ----------
func saved_name() -> String:
	var cfg := ConfigFile.new()
	cfg.load(SAVE_PATH)
	return str(cfg.get_value("player", "name", ""))


func save_name(n: String) -> void:
	var cfg := ConfigFile.new()
	cfg.load(SAVE_PATH)
	cfg.set_value("player", "name", n)
	cfg.save(SAVE_PATH)


# ---------- 登录 ----------
## 点击登录：微信登录（服务器没配置时回退游客），名字和服务器不一致就改名，然后连 WebSocket。
func login(wanted_name: String) -> Dictionary:
	var r := await net.auto_login()
	if not r.ok:
		print("[DEMO] LOGIN_FAIL code=%d" % r.code)
		return r
	login_mode = r.mode
	best = {"2d": int(r.data.best), "3d": int(r.data.get("best3d", 0))}
	print("[DEMO] LOGIN_OK mode=%s created=%s" % [login_mode, r.data.created])
	wanted_name = wanted_name.strip_edges()
	if wanted_name != "" and wanted_name != net.username:
		var rn := await net.rename(wanted_name)
		print("[DEMO] RENAME code=%d" % rn.code)
		if not rn.ok:
			r["rename_error"] = str(rn.data.get("error", "rename failed"))
	save_name(net.username)
	logged_in = true
	title_message = ""
	net.connect_ws()
	return r


func rename(new_name: String) -> Dictionary:
	var r := await net.rename(new_name.strip_edges())
	if r.ok:
		save_name(net.username)
	elif r.code == 401:
		back_to_title("session expired, please log in again")
	return r


func logout() -> void:
	net.disconnect_ws()
	logged_in = false
	online = 0
	feed = ""


## 掉线、登录过期：断开、清登录状态、回标题并显示原因
func back_to_title(reason: String) -> void:
	print("[DEMO] BACK_TO_TITLE reason=%s" % reason)
	logout()
	title_message = reason
	play_sfx("miss")
	vibrate(120)
	get_tree().change_scene_to_file(TITLE)


func submit_score(score: int, mode: String) -> Dictionary:
	var r := await net.submit_score(score, mode)
	if r.ok:
		best[mode] = int(r.data.best)
		print("[DEMO] SCORE_OK mode=%s best=%d record=%s top=%d" % [mode, r.data.best, r.data.record, r.data.top.size()])
	else:
		print("[DEMO] SCORE_FAIL code=%d" % r.code)
		if r.code == 401:
			back_to_title("session expired, please log in again")
	return r


func _on_ws_state(ok: bool) -> void:
	if ok:
		feed = "online"
	elif logged_in:
		back_to_title("connection lost (code %d)" % net.close_code)


func _on_ws_message(msg: Dictionary) -> void:
	match msg.get("type", ""):
		"welcome":
			print("[DEMO] WS_WELCOME")
		"online":
			online = int(msg.count)
		"feed":
			feed = str(msg.text)


# ---------- 进入玩法场景 ----------
## 分包版（wasmsplit onclick 模式）运行时会暴露点击门 __WXSLIM_CLICK_GATE__：request() 后轮询到 READY
## （余包下载、编译完）才能用余包里的类和函数；没有分包时这个接口不存在，直接进。
## 哪些场景要先过点击门由 JS 接口 DemoWx.gate2d 决定：
##   方案一（标题+2D 首包，3D 余包）：gate2d=false，只有 3D 过门；
##   方案二（标题首包，2D+3D 余包）：gate2d=true，2D、3D 都过门。
## 分包采集包（训练等待门）里，过门之后就停，不加载场景，避免场景代码被采进首包。
## 场景都用 load() 在这里才加载，不在标题里 preload。
func enter_2d() -> String:
	var gated := false
	if OS.has_feature("web"):
		var d: JavaScriptObject = JavaScriptBridge.get_interface("DemoWx")
		gated = d != null and bool(d.gate2d)
	return await _enter_scene("2d", PLAY_2D, gated)


func enter_3d() -> String:
	return await _enter_scene("3d", PLAY_3D, true)


func _enter_scene(tag: String, path: String, gated: bool) -> String:
	print("[STARTUP_3D_FLOW] {\"event\":\"click\",\"scene\":\"%s\"}" % tag)
	if gated and OS.has_feature("web"):
		var d: JavaScriptObject = JavaScriptBridge.get_interface("DemoWx")
		var gate: JavaScriptObject = null
		if d != null and bool(d.hasClickGate()):
			gate = JavaScriptBridge.get_interface(str(d.clickGateName()))
		if gate != null:
			var status := str(gate.request())
			while status == "PENDING":
				await get_tree().process_frame
				status = str(gate.status())
			if status != "READY":
				print("[STARTUP_3D_FLOW] {\"event\":\"transition_failed\",\"scene\":\"%s\",\"status\":\"%s\"}" % [tag, status])
				return status
			if d != null and bool(d.isTraining()):
				print("[STARTUP_3D_FLOW] {\"event\":\"collection_gate_complete_3d_blocked\",\"scene\":\"%s\"}" % tag)
				return "TRAINING_DONE"
	var scene: PackedScene = load(path)
	if scene == null or get_tree().change_scene_to_packed(scene) != OK:
		print("[STARTUP_3D_FLOW] {\"event\":\"transition_failed\",\"scene\":\"%s\",\"status\":\"LOAD_FAILED\"}" % tag)
		return "LOAD_FAILED"
	return "READY"
