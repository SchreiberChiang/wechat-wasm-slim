class_name Net
extends Node
## HTTP（登录、提交分数、排行榜）和 WebSocket（在线人数、动态）。
## 地址默认是公网服务器；电脑上测试可用命令行 `-- --server=http://127.0.0.1:8888` 覆盖。

signal ws_message(msg: Dictionary)
signal ws_state(connected: bool)

## 改成你的服务器地址。微信正式上线需要已备案域名 + HTTPS/WSS，并加入小游戏后台的合法域名；IP + HTTP 只能在开发者工具（不校验合法域名）或手机调试模式下用。
const DEFAULT_SERVER := "http://127.0.0.1:8888"
const SAVE_PATH := "user://demo.cfg"

var server := DEFAULT_SERVER
var token := ""
var username := ""
var _ws := WebSocketPeer.new()
var _ws_open := false
var _ws_wanted := false
var _ping_left := 0.0
var _ws_wait := 0.0
var close_code := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--server="):
			server = a.trim_prefix("--server=").trim_suffix("/")


## 返回 {ok, code, data}；data 是服务器返回的 JSON（或 {error}）。
func request(method: int, path: String, body: Variant = null) -> Dictionary:
	var http := HTTPRequest.new()
	http.timeout = 10.0
	http.accept_gzip = false
	add_child(http)
	var headers := PackedStringArray(["Content-Type: application/json"])
	if token != "":
		headers.append("Authorization: Bearer " + token)
	var text := "" if body == null else JSON.stringify(body)
	var err := http.request(server + path, headers, method, text)
	if err != OK:
		http.queue_free()
		return {"ok": false, "code": 0, "data": {"error": "request failed (%d)" % err}}
	var r: Array = await http.request_completed
	http.queue_free()
	var result: int = r[0]
	var code: int = r[1]
	var raw: PackedByteArray = r[3]
	var data: Variant = JSON.parse_string(raw.get_string_from_utf8()) if raw.size() > 0 else null
	if result != HTTPRequest.RESULT_SUCCESS:
		print("[NET] %s %s result=%d" % [_method_name(method), path, result])
		return {"ok": false, "code": code, "data": {"error": "network error (%d)" % result}}
	if typeof(data) != TYPE_DICTIONARY:
		print("[NET] %s %s code=%d bytes=%d bad json" % [_method_name(method), path, code, raw.size()])
		return {"ok": false, "code": code, "data": {"error": "bad response (%d)" % code}}
	print("[NET] %s %s code=%d" % [_method_name(method), path, code])
	return {"ok": code == 200, "code": code, "data": data}


## 自动登录：微信里用 wx.login（经 JS 接口 DemoWx）；没有微信或服务器没配置微信登录时，用本地设备号游客登录。
## 返回值多一个 mode："wechat" 或 "guest"。
func auto_login() -> Dictionary:
	var wxi: JavaScriptObject = JavaScriptBridge.get_interface("DemoWx") if OS.has_feature("web") else null
	if wxi != null and bool(wxi.available):
		wxi.startLogin()
		var waited := 0.0
		while str(wxi.state) == "pending" and waited < 12.0:
			await get_tree().process_frame
			waited += get_process_delta_time()
		print("[NET] wx.login state=%s" % str(wxi.state))
		if str(wxi.state) == "ok":
			var r := await request(HTTPClient.METHOD_POST, "/api/wxlogin", {"code": str(wxi.code)})
			if r.ok:
				return _logged_in(r, "wechat")
			if r.code != 503:
				return r
			print("[NET] server has no wechat config, fall back to guest")
		else:
			return {"ok": false, "code": 0, "data": {"error": "wx.login failed: %s" % str(wxi.error)}}
	var r := await request(HTTPClient.METHOD_POST, "/api/guest", {"deviceId": _device_id()})
	return _logged_in(r, "guest") if r.ok else r


func _logged_in(r: Dictionary, mode: String) -> Dictionary:
	token = r.data.token
	username = r.data.name
	r["mode"] = mode
	return r


## 游客设备号：随机 16 字节，存在 user://（小游戏里是 WXMEMFS 持久化存储）。
func _device_id() -> String:
	var cfg := ConfigFile.new()
	cfg.load(SAVE_PATH)
	var id := str(cfg.get_value("guest", "device_id", ""))
	if id.length() != 32:
		id = Crypto.new().generate_random_bytes(16).hex_encode()
		cfg.set_value("guest", "device_id", id)
		var err := cfg.save(SAVE_PATH)
		print("[NET] new device id saved err=%d" % err)
	return id


func submit_score(score: int, mode: String) -> Dictionary:
	return await request(HTTPClient.METHOD_POST, "/api/score", {"score": score, "mode": mode})


func rename(new_name: String) -> Dictionary:
	var r := await request(HTTPClient.METHOD_POST, "/api/name", {"name": new_name})
	if r.ok:
		username = r.data.name
	return r


func top(mode: String) -> Dictionary:
	return await request(HTTPClient.METHOD_GET, "/api/top?mode=" + mode)


func connect_ws() -> void:
	_ws = WebSocketPeer.new()
	_ws_wanted = true
	_ws_open = false
	_ws_wait = 0.0
	var url := server.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
	var err := _ws.connect_to_url(url)
	print("[NET] ws connect err=%d" % err)
	if err != OK:
		_ws_wanted = false
		ws_state.emit(false)


## 主动断开（登出、回标题）：不发 ws_state，避免被当成掉线。
func disconnect_ws() -> void:
	_ws_wanted = false
	_ws_open = false
	if _ws.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_ws.close(1000, "logout")
	token = ""


func _process(delta: float) -> void:
	if not _ws_wanted:
		return
	_ws.poll()
	var state := _ws.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _ws_open:
			_ws_open = true
			print("[NET] ws open")
			# token 放第一条消息，不放 URL
			_ws.send_text(JSON.stringify({"type": "auth", "token": token}))
			ws_state.emit(true)
		while _ws.get_available_packet_count() > 0:
			var msg: Variant = JSON.parse_string(_ws.get_packet().get_string_from_utf8())
			if typeof(msg) == TYPE_DICTIONARY:
				ws_message.emit(msg)
		_ping_left -= delta
		if _ping_left <= 0.0:
			_ping_left = 5.0
			_ws.send_text(JSON.stringify({"type": "ping", "t": Time.get_ticks_msec()}))
	elif state == WebSocketPeer.STATE_CLOSED:
		# 连上后断开，或 10 秒内一直没连上，都算掉线
		_ws_wait += delta
		if _ws_open or _ws_wait > 10.0:
			print("[NET] ws closed code=%d reason=%s open=%s" % [_ws.get_close_code(), _ws.get_close_reason(), _ws_open])
			close_code = _ws.get_close_code()
			_ws_open = false
			_ws_wanted = false
			ws_state.emit(false)


func _method_name(m: int) -> String:
	return "POST" if m == HTTPClient.METHOD_POST else "GET"
