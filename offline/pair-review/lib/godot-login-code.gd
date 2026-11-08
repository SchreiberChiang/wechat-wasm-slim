# Optional client facade. Keep this object while observing one request.
# Do not print/persist/forward the returned code to logs; only send it to your
# authorized application backend. This does not implement business login.
extends RefCounted

const HOST_NAME := "WxslimLoginCode"
const STATUS_SCHEMA := "wxslim-login-code-v1"
var _request_id := 0

func _host() -> JavaScriptObject:
	return JavaScriptBridge.get_interface(HOST_NAME) if OS.has_feature("web") else null

func _decode(raw: Variant) -> Dictionary:
	if not raw is String or raw.length() > 8192:
		return {"ok": false, "reason": "HOST_RESULT_UNREADABLE"}
	var value = JSON.parse_string(raw)
	if not value is Dictionary:
		return {"ok": false, "reason": "HOST_RESULT_UNREADABLE"}
	return value

func request_code() -> Dictionary:
	var host := _host()
	if host == null:
		return {"ok": false, "reason": "INTERFACE_UNAVAILABLE"}
	var result := _decode(host.request())
	var state = result.get("state")
	if result.get("ok") == true and state is Dictionary and state.get("schema") == STATUS_SCHEMA:
		_request_id = int(state.get("requestId", 0))
	return result

func read_status() -> Dictionary:
	var host := _host()
	if host == null:
		return {"ok": false, "reason": "INTERFACE_UNAVAILABLE"}
	var result := _decode(host.getStatus())
	if result.get("schema") != STATUS_SCHEMA:
		return {"ok": false, "reason": "STATUS_SCHEMA_MISMATCH"}
	if _request_id > 0 and int(result.get("requestId", 0)) != _request_id:
		return {"ok": false, "reason": "REQUEST_REPLACED"}
	return result

func take_code_once() -> String:
	var host := _host()
	if host == null or _request_id <= 0:
		return ""
	var code = host.takeCode(_request_id)
	return code if code is String else ""

func abandon_request() -> Dictionary:
	var host := _host()
	if host == null or _request_id <= 0:
		return {"ok": false, "reason": "NO_LOCAL_REQUEST"}
	return _decode(host.abandon(_request_id))
