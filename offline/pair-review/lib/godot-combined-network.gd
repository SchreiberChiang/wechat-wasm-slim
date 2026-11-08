extends "res://godot-network-observation.gd"
## Combined-page presentation only. The inherited HTTP/WebSocket algorithm,
## manual port, once-only run and request budgets remain unchanged.
## Desktop eligibility comes from the combined scope's one initialization read
## of wx.getSystemInfoSync().platform, never from backend or SDK inference.

const COMBINED_ID_KEYS := ["schema", "ref", "packageId", "session", "requestedMode", "actualMode", "sdkVersion", "sceneReadyObserved", "source", "nativeStateProof", "visual"]
const COMBINED_SCOPE_KEYS := ["schema", "ref", "packageId", "session", "platform", "desktopLoopbackEligible", "reason", "source", "nativeStateProof", "visual"]
const COMBINED_SCOPE_REASONS := ["DEVTOOLS_PLATFORM", "PLATFORM_NOT_DEVTOOLS", "PLATFORM_UNKNOWN", "SYSTEM_INFO_API_UNAVAILABLE", "SYSTEM_INFO_FAILED", "IDENTITY_UNAVAILABLE", "IDENTITY_CHANGED"]
var _combined_page_active: bool = false
var _combined_reference: String = ""
var _combined_last_identity: Dictionary = {}
var _combined_last_scope: Dictionary = {}
var _combined_stop_scheduled: bool = false

func _ready() -> void:
	super._ready()
	var box: VBoxContainer = _port.get_parent()
	var title: Label = box.get_child(0)
	title.text = "Network: developer tools desktop only; manual run"
	_port.placeholder_text = "Owned temporary desktop service port (1024-65535)"
	_button.text = "Run once: 5 HTTP cases + 2 WebSocket connections"
	_button.disabled = true
	_port.editable = false
	_output.text = "Select this page to check the existing package identity and captured platform scope.\nNo connection starts automatically. A phone's 127.0.0.1 is not the desktop server.\nMatching HTTP and WebSocket server receipts remain required.\n"

func is_observation_busy() -> bool:
	return _active or _http_pending or _ws != null or is_instance_valid(_http)

func is_page_busy() -> bool:
	return is_observation_busy()

func set_page_active(active: bool) -> bool:
	# Hiding never cancels or reconnects. The navigator must refuse a busy exit.
	if not active and is_observation_busy():
		return false
	_combined_page_active = active
	visible = active
	if active and not _used:
		_combined_refresh_availability()
	return true

func _combined_matches(value: Variant, pattern: String) -> bool:
	if typeof(value) != TYPE_STRING:
		return false
	var expression := RegEx.new()
	if expression.compile(pattern) != OK:
		return false
	return expression.search(value) != null

func _combined_read_identity() -> Dictionary:
	if not OS.has_feature("web"):
		return {}
	# Object bridge only: eval is intentionally unavailable in this engine.
	# Read the existing API; do not register interfaces or query platform APIs.
	var observer: JavaScriptObject = JavaScriptBridge.get_interface("SimpleGlxDelivery")
	if observer == null:
		return {}
	var raw: Variant = observer.getObservationIdentity()
	if typeof(raw) != TYPE_STRING or raw.to_utf8_buffer().size() > 4096:
		return {}
	var value: Variant = JSON.parse_string(raw)
	if typeof(value) != TYPE_DICTIONARY:
		return {}
	var identity: Dictionary = value
	if identity.size() != COMBINED_ID_KEYS.size():
		return {}
	for key: Variant in COMBINED_ID_KEYS:
		if not identity.has(key):
			return {}
	if identity.get("schema") != "wxslim-simple-observation-identity-v1":
		return {}
	if not _combined_matches(identity.get("packageId"), "^wxslim-[a-f0-9]{20}$"):
		return {}
	if not _combined_matches(identity.get("session"), "^[a-z0-9]{1,24}-[a-z0-9]{1,16}$"):
		return {}
	if typeof(identity.get("ref")) != TYPE_STRING or identity.get("ref") != identity.get("packageId") + "#" + identity.get("session"):
		return {}
	if not ["glx", "webgl"].has(identity.get("requestedMode")) or not ["glx", "webgl", "unknown"].has(identity.get("actualMode")):
		return {}
	var sdk: Variant = identity.get("sdkVersion")
	if sdk != null and not _combined_matches(sdk, "^[A-Za-z0-9._-]{1,64}$"):
		return {}
	if typeof(identity.get("sceneReadyObserved")) != TYPE_BOOL or typeof(identity.get("nativeStateProof")) != TYPE_BOOL:
		return {}
	if identity.get("nativeStateProof") != false or identity.get("visual") != "NOT_VERIFIED":
		return {}
	if identity.get("source") != "existing SIMPLE_ID and last sceneReady snapshot":
		return {}
	return {"ref": identity["ref"], "packageId": identity["packageId"], "session": identity["session"],
		"requestedMode": identity["requestedMode"], "actualMode": "UNKNOWN" if identity["actualMode"] == "unknown" else identity["actualMode"],
		"sdkVersion": "UNKNOWN" if sdk == null else sdk, "sceneReadyObserved": identity["sceneReadyObserved"],
		"nativeStateProof": false, "visual": "NOT_VERIFIED"}

func _combined_read_scope(identity: Dictionary) -> Dictionary:
	if not OS.has_feature("web") or identity.is_empty():
		return {}
	var observer: JavaScriptObject = JavaScriptBridge.get_interface("WxslimCombinedCapabilityScope")
	if observer == null:
		return {}
	var raw: Variant = observer.getSnapshot()
	if typeof(raw) != TYPE_STRING or raw.to_utf8_buffer().size() > 4096:
		return {}
	var value: Variant = JSON.parse_string(raw)
	if typeof(value) != TYPE_DICTIONARY:
		return {}
	var scope: Dictionary = value
	if scope.size() != COMBINED_SCOPE_KEYS.size():
		return {}
	for field: Variant in COMBINED_SCOPE_KEYS:
		if not scope.has(field):
			return {}
	if scope.get("schema") != "wxslim-combined-capability-runtime-scope-v1":
		return {}
	for field: String in ["ref", "packageId", "session"]:
		if typeof(scope.get(field)) != TYPE_STRING or scope.get(field) != identity.get(field):
			return {}
	var platform: Variant = scope.get("platform")
	if platform != null and not _combined_matches(platform, "^[A-Za-z0-9_-]{1,32}$"):
		return {}
	if typeof(scope.get("desktopLoopbackEligible")) != TYPE_BOOL or typeof(scope.get("nativeStateProof")) != TYPE_BOOL:
		return {}
	if not COMBINED_SCOPE_REASONS.has(scope.get("reason")) or scope.get("nativeStateProof") != false or scope.get("visual") != "NOT_VERIFIED":
		return {}
	if scope.get("source") != "wx.getSystemInfoSync().platform; one initialization read":
		return {}
	var eligible: bool = scope["desktopLoopbackEligible"]
	if eligible and (platform != "devtools" or scope.get("reason") != "DEVTOOLS_PLATFORM"):
		return {}
	return {"ref": scope["ref"], "platform": "UNKNOWN" if platform == null else platform,
		"desktopLoopbackEligible": eligible, "reason": scope["reason"], "nativeStateProof": false}

func _combined_refresh_availability() -> void:
	var identity := _combined_read_identity()
	var scope := _combined_read_scope(identity)
	var eligible: bool = not scope.is_empty() and scope.get("desktopLoopbackEligible") == true
	_button.disabled = _used or not eligible
	_port.editable = not _used and eligible
	if _records == 0:
		_output.text = "Desktop scope confirmed. Enter the owned local server port, then run once.\n" if eligible else "BLOCKED: mobile or unknown desktop authorization. No connection starts.\n"
		_output.text += "HTTP and WebSocket server receipts must match this package/session separately.\n"

func _combined_stop() -> void:
	_active = false
	set_process(false)
	if not _combined_stop_scheduled:
		_combined_stop_scheduled = true
		call_deferred("_finish")

func _combined_request_guard(step: String) -> bool:
	if not _active:
		return false
	var current := _combined_read_identity()
	var scope := _combined_read_scope(current)
	if not current.is_empty() and current.get("ref") == _combined_reference and not scope.is_empty() and scope.get("desktopLoopbackEligible") == true:
		return true
	_combined_stop()
	_record(step, "unchanged package/session and captured devtools scope", {"requestStarted": false}, "STOPPED_IDENTITY_OR_SCOPE_UNAVAILABLE")
	return false

func _next_http() -> void:
	if _combined_request_guard("httpRequestBlocked"):
		super._next_http()

func _start_ws(phase: String) -> void:
	if _combined_request_guard("wsRequestBlocked:" + phase):
		super._start_ws(phase)

func _start() -> void:
	if _used or not _combined_page_active:
		return
	var current := _combined_read_identity()
	if current.is_empty():
		_record("configuration", "bounded current package/session identity", {"accepted": false, "reason": "IDENTITY_UNAVAILABLE"}, "REJECTED")
		return
	var scope := _combined_read_scope(current)
	if scope.is_empty() or scope.get("desktopLoopbackEligible") != true:
		_record("configuration", "captured devtools platform bound to current identity", {"accepted": false, "reason": "DESKTOP_AUTHORIZATION_UNAVAILABLE"}, "REJECTED")
		_combined_refresh_availability()
		return
	_combined_last_identity = current
	_combined_reference = current["ref"]
	_combined_last_scope = scope
	super._start()

func _record(step: String, expected: Variant, actual: Dictionary, outcome: String = "OBSERVED") -> void:
	if _log_stopped:
		return
	# Preserve the parent's 63 observations + one complete terminal record, and
	# deferred disposal so callers do not continue using a destroyed peer object.
	if _records >= 63:
		_log_stopped = true
		_used = true
		_combined_stop()
		_records += 1
		var terminal := "[NETWORK_PROBE] " + JSON.stringify({"step": "LOG_BUDGET_STOP", "omittedStep": step, "outcome": "STOPPED", "automaticPass": false, "phone": "NOT_RUN", "observationIdentity": _combined_last_identity if not _combined_last_identity.is_empty() else "UNKNOWN", "runtimeScope": _combined_last_scope if not _combined_last_scope.is_empty() else "UNKNOWN", "serverReceipts": "MATCHING_HTTP_AND_WEBSOCKET_RECEIPTS_REQUIRED"})
		_output.text += terminal + "\n"
		print(terminal)
		return
	var current := _combined_read_identity()
	var identity_valid: bool = not current.is_empty() and (_combined_reference.is_empty() or current.get("ref") == _combined_reference)
	var scope := _combined_read_scope(current) if identity_valid else {}
	var authorized: bool = identity_valid and not scope.is_empty() and scope.get("desktopLoopbackEligible") == true
	if identity_valid:
		_combined_last_identity = current
	if not scope.is_empty():
		_combined_last_scope = scope
	if not authorized and is_observation_busy():
		_combined_stop()
		outcome = "STOPPED_IDENTITY_OR_SCOPE_UNAVAILABLE"
	_records += 1
	var line := "[NETWORK_PROBE] " + JSON.stringify({"step": step, "expected": expected, "actual": actual, "outcome": outcome,
		"observationIdentity": current if identity_valid else "UNKNOWN", "identityBound": identity_valid,
		"runtimeScope": scope if not scope.is_empty() else "UNKNOWN", "desktopAuthorization": "DEVTOOLS_SNAPSHOT" if authorized else "NOT_AUTHORIZED", "automaticPass": false, "phone": "NOT_RUN",
		"serverReceipts": "MATCHING_HTTP_AND_WEBSOCKET_RECEIPTS_REQUIRED", "acceptance": "MANUAL_REVIEW_REQUIRED"})
	_output.text += line + "\n"
	print(line)
