extends Node
## 全局（autoload "Game"）：网络、登录状态、音乐音效、震动、场景切换、掉线回标题。
## 场景：title（改名、点击登录、选模式）→ play2d / play3d。3D 场景只在点击时 load()，方便以后按场景分包。
## 自动测试参数（放在 `--` 之后）：--qa-play=2d|3d（自动登录并自动玩一局）  --qa-quit（结算后退出）  --qa-shot=路径
## 小游戏里没有命令行：测试包在接口文件里设置 WxSplitConfig.qa = "2d" 或 "3d"（见 wx/demowx-qa3d.js）。
## 点击门、采集包判断、计时事件、自动测试开关都用插件 addons/wx_split（autoload "WxSplit"）。

const SAVE_PATH := "user://demo.cfg"
const TITLE := "res://scenes/title.tscn"
const PLAY_2D := "res://scenes/play2d.tscn"
const PLAY_3D := "res://scenes/play3d.tscn"

var net := Net.new()
var music := AudioStreamPlayer.new()
var sfx: Array[AudioStreamPlayer] = []
var snd := {}

var logged_in := false
var login_mode := ""
var best := {"2d": 0, "3d": 0}
var online := 0
var feed := ""
## 回到标题时要显示的原因（掉线、登录过期等）
var title_message := ""


func _ready() -> void:
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
## 交给插件：分包版先过点击门，采集包过门就停（返回 TRAINING_DONE），然后才 load() 场景。
## 3D 的代码总在余包，所以过门；2D 默认不过门（方案一：标题+2D 首包）。
## 方案二（2D 也在余包）由接口文件里 WxSplitConfig.gate["2d"] = true 打开（wx/demowx-gate2d.js），正式包和采集包共用一个 PCK。
func enter_2d() -> String:
	return await WxSplit.enter_scene(PLAY_2D, "2d", false)


func enter_3d() -> String:
	return await WxSplit.enter_scene(PLAY_3D, "3d", true)
