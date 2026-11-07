extends Control
## Source-only manual desktop probe. No startup connection or JS networking.
## Server contract: HTTP /echo /status /empty /reset /slow; WS /echo /reset.
## /echo echoes POST bytes, /status returns 503 + [0,128,255], /empty is 204,
## /reset drops TCP, /slow remains pending. WS echoes frames or drops on send.
const BYTES := [0, 128, 255]
const WAIT_MS: int = 5000
var _port: LineEdit
var _button: Button
var _output: TextEdit
var _used: bool = false
var _active: bool = false
var _records: int = 0
var _log_stopped: bool = false
var _http: HTTPRequest
var _http_index: int = -1
var _http_pending: bool = false
var _deadline: int = 0
var _cancel_at: int = 0
var _origin: String = ""
var _ws_origin: String = ""
var _ws: WebSocketPeer
var _ws_phase: String = ""
var _last_state: int = -1
var _sent: bool = false
var _messages: int = 0
var _text_seen: bool = false
var _binary_seen: bool = false
const HTTP_CASES := ["binary", "status503", "empty204", "transportFailure", "cancel"]
const HTTP_PATHS := ["/echo", "/status", "/empty", "/reset", "/slow"]

func _ready() -> void:
	var box := VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(box)
	var title := Label.new()
	title.text = "网络电脑观察：默认不联网，手机未验"
	box.add_child(title)
	_port = LineEdit.new()
	_port.placeholder_text = "显式输入本机临时服务端口（1024–65535）"
	box.add_child(_port)
	_button = Button.new()
	_button.text = "手动运行一次（HTTP + WebSocket）"
	_button.pressed.connect(_start)
	box.add_child(_button)
	_output = TextEdit.new()
	_output.editable = false
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_output)
	set_process(false)

func _record(step: String, expected: Variant, actual: Dictionary, outcome: String = "OBSERVED") -> void:
	if _log_stopped:
		return
	# Reserve record 64 for a complete stop marker. Do not destroy objects still
	# used by the caller's stack; stop scheduling now and release them deferred.
	if _records >= 63:
		_log_stopped = true
		_used = true
		_active = false
		set_process(false)
		_records += 1
		var terminal := "[NETWORK_PROBE] " + JSON.stringify({"step": "LOG_BUDGET_STOP", "omittedStep": step, "outcome": "STOPPED", "automaticPass": false, "phone": "NOT_RUN"})
		_output.text += terminal + "\n"
		print(terminal)
		call_deferred("_finish")
		return
	_records += 1
	var line := "[NETWORK_PROBE] " + JSON.stringify({"step": step, "expected": expected, "actual": actual, "outcome": outcome, "phone": "NOT_RUN", "packageIdentity": "EXTERNAL_RECEIPT_REQUIRED", "acceptance": "MANUAL_REVIEW_REQUIRED"})
	_output.text += line + "\n"
	print(line)

func _start() -> void:
	if _used:
		return
	var value: String = _port.text
	# Only canonical numeric port input. No host/URL/path/query injection.
	if not value.is_valid_int() or str(value.to_int()) != value or value.to_int() < 1024 or value.to_int() > 65535:
		_record("configuration", "explicit temporary local port", {"accepted": false}, "REJECTED")
		return
	_used = true
	_active = true
	_button.disabled = true
	_port.editable = false
	_origin = "http://127.0.0.1:" + value
	_ws_origin = "ws://127.0.0.1:" + value
	_record("start", "one manual desktop run", {"httpCases": 5, "wsConnections": 2, "backend": "UNKNOWN"})
	if not _active:
		return
	set_process(true)
	_next_http()

func _next_http() -> void:
	if not _active:
		return
	_dispose_http()
	_http_index += 1
	if _http_index >= HTTP_CASES.size():
		_start_ws("echo")
		return
	_http = HTTPRequest.new()
	# Fixed Godot defaults to 8 redirects; prohibit a local response from
	# following Location to another endpoint at the HTTPRequest layer.
	_http.max_redirects = 0
	_http.body_size_limit = 8192
	_http.timeout = 4.0
	add_child(_http)
	_http.request_completed.connect(_http_completed.bind(_http_index))
	_http_pending = true
	_deadline = Time.get_ticks_msec() + WAIT_MS
	_cancel_at = Time.get_ticks_msec() + 300 if HTTP_CASES[_http_index] == "cancel" else 0
	var method: HTTPClient.Method = HTTPClient.METHOD_POST if _http_index == 0 else HTTPClient.METHOD_GET
	var body := PackedByteArray(BYTES) if _http_index == 0 else PackedByteArray()
	var error: Error = _http.request_raw(_origin + HTTP_PATHS[_http_index], PackedStringArray(), method, body)
	_record("httpStart:" + HTTP_CASES[_http_index], OK, {"requestReturn": error})
	if error != OK:
		_http_pending = false
		call_deferred("_next_http")

func _http_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray, index: int) -> void:
	if not _active or not _http_pending or index != _http_index:
		return
	_http_pending = false
	var expected: Dictionary = {"result": HTTPRequest.RESULT_SUCCESS}
	if index == 0:
		expected.merge({"responseCode": 200, "body": BYTES})
	elif index == 1:
		expected.merge({"responseCode": 503, "body": BYTES})
	elif index == 2:
		expected.merge({"responseCode": 204, "bodyLength": 0})
	elif index == 4:
		expected = {"callback": "none required; slow response should remain pending until local cancel"}
	else:
		expected = {"result": "transport failure, not HTTP status; inspect actual"}
	var actual: Dictionary = {"result": result, "responseCode": response_code, "bodyLength": body.size()}
	if body.size() <= 32:
		actual["body"] = Array(body)
	else:
		actual["bodyOmitted"] = true
	_record("httpCallback:" + HTTP_CASES[index], expected, actual, "TIMEOUT_UNKNOWN" if result == HTTPRequest.RESULT_TIMEOUT else "OBSERVED")
	call_deferred("_next_http")

func _start_ws(phase: String) -> void:
	if not _active:
		return
	_ws_phase = phase
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 8192
	_ws.outbound_buffer_size = 8192
	_ws.max_queued_packets = 8
	_last_state = -1
	_sent = false
	_messages = 0
	_text_seen = false
	_binary_seen = false
	_deadline = Time.get_ticks_msec() + WAIT_MS
	var error: Error = _ws.connect_to_url(_ws_origin + ("/echo" if phase == "echo" else "/reset"))
	_record("wsConnect:" + phase, OK, {"connectReturn": error})
	if error != OK:
		_ws = null
		_advance_ws()

func _process(_delta: float) -> void:
	if not _active:
		return
	var now: int = Time.get_ticks_msec()
	if _http_pending:
		if _cancel_at > 0 and now >= _cancel_at:
			_http_pending = false
			_http.cancel_request()
			_record("httpCancel", "local cancel only; server receipt/rollback unknown", {"cancelCalled": true, "completionRequired": false}, "LOCAL_ACTION_ONLY")
			call_deferred("_next_http")
		elif now >= _deadline:
			_http_pending = false
			_record("httpDeadline:" + HTTP_CASES[_http_index], "completion callback", {"callbackObserved": false}, "TIMEOUT_UNKNOWN")
			call_deferred("_next_http")
		return
	if _ws == null:
		return
	_ws.poll()
	var state: int = _ws.get_ready_state()
	if state != _last_state:
		_record("wsState:" + _ws_phase, "actual peer states", {"state": state})
		if not _active:
			return
		_last_state = state
	if state == WebSocketPeer.STATE_OPEN:
		if not _sent:
			_sent = true
			var text_error: Error = _ws.send_text("回环✓")
			var binary_error: Error = _ws.put_packet(PackedByteArray(BYTES)) if _ws_phase == "echo" else OK
			_record("wsSend:" + _ws_phase, "OK only means locally accepted", {"textReturn": text_error, "binaryAttempted": _ws_phase == "echo", "binaryReturn": binary_error})
			if not _active:
				return
		while _ws.get_available_packet_count() > 0:
			var packet: PackedByteArray = _ws.get_packet()
			_messages += 1
			var is_text: bool = _ws.was_string_packet()
			_text_seen = _text_seen or (is_text and packet == "回环✓".to_utf8_buffer())
			_binary_seen = _binary_seen or (not is_text and packet == PackedByteArray(BYTES))
			_record("wsPacket:" + _ws_phase, "matching text or binary echo", {"packetError": _ws.get_packet_error(), "isText": is_text, "length": packet.size(), "textMatched": _text_seen, "binaryMatched": _binary_seen})
			if not _active:
				return
			if _messages >= 8:
				_record("wsPacketBudget", "at most 8 packets", {"count": _messages}, "STOPPED")
				_finish()
				return
		if _ws_phase == "echo" and _text_seen and _binary_seen:
			_ws_phase = "normalClose"
			_deadline = now + WAIT_MS
			_ws.close(1000, "done")
			_record("wsCloseCalled", "wait for actual CLOSED; call is not proof", {"codeRequested": 1000})
			if not _active:
				return
	if state == WebSocketPeer.STATE_CLOSED:
		var reason: String = _ws.get_close_reason()
		var actual: Dictionary = {"code": _ws.get_close_code(), "reasonBytes": reason.to_utf8_buffer().size(), "textMatched": _text_seen, "binaryMatched": _binary_seen}
		if reason.to_utf8_buffer().size() <= 128:
			actual["reason"] = reason
		var expected: Dictionary = {"code": 1000, "reason": "done", "textMatched": true, "binaryMatched": true}
		if _ws_phase == "reset":
			expected = {"abnormalClose": true, "code": "inspect actual; no clean-close claim"}
		_record("wsClosed:" + _ws_phase, expected, actual)
		if not _active:
			return
		if _ws_phase == "normalClose":
			var closed_send: Error = _ws.send_text("closed-state-check")
			_record("wsSendAfterClosed", "non-OK return; closed-state API check, no delivery claim", {"stateBeforeCall": state, "sendReturn": closed_send})
			if not _active:
				return
		_ws = null
		_advance_ws()
	elif now >= _deadline:
		_record("wsDeadline:" + _ws_phase, "echo or CLOSED", {"state": state}, "TIMEOUT_UNKNOWN")
		if not _active:
			return
		_ws.close()
		_ws = null
		_advance_ws()

func _advance_ws() -> void:
	if not _active:
		return
	if _ws_phase != "reset":
		_start_ws("reset")
	else:
		_record("finished", "manual interpretation of every observation", {"automaticPass": false})
		_finish()

func _dispose_http() -> void:
	if is_instance_valid(_http):
		_http.cancel_request()
		_http.queue_free()
	_http = null

func _finish() -> void:
	_active = false
	_http_pending = false
	set_process(false)
	_dispose_http()
	if _ws != null:
		_ws.close()
		_ws = null

func _exit_tree() -> void:
	_finish()
