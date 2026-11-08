extends Node
## Explicit future bridge receiver; not an autoload. No constructor I/O.
## Native test entry only permits BEGIN/VERIFY/SUMMARY/ENTRY; never stage/mount/scene.
## Real JS/WASM transport, staging, mounting and scenes remain unverified.
const Session = preload("res://godot-resource-pack-session.gd")
const SceneLoader = preload("res://godot-resource-scene-loader.gd")
const LIMIT: int = 256 * 1024
const PACK_LIMIT: int = 32 * 1024 * 1024
var _interface: JavaScriptObject
var _callback: JavaScriptObject
var _session: RefCounted = Session.new()
var _config: Dictionary = {}
var _active: bool = false
var _configured: bool = false
var _native_test: bool = false
var _pending: bool = false
var _begun: bool = false
var _last_request: String = "0"
var _generation: int = 0
var _last_native_report: Dictionary = {}
var _error: String = ""
var _dispatch_state: String = "NOT_DISPATCHED"
var _scene_loader: Node
var _last_scene_result: Dictionary = {}

func connect_interface(interface_name: String) -> Dictionary:
	if _configured or not OS.has_feature("web"):
		return _fail("CONNECT_UNAVAILABLE")
	if not is_inside_tree() or get_parent() != get_tree().root or get_tree().current_scene == self:
		return _fail("RECEIVER_REQUIRES_PERSISTENT_ROOT_CHILD")
	if interface_name != "__WXSLIM_RESOURCE_BRIDGE__":
		return _fail("INTERFACE_NAME_INVALID")
	_interface = JavaScriptBridge.get_interface(interface_name)
	if _interface == null:
		return _fail("INTERFACE_UNAVAILABLE")
	var raw: Variant = _interface.configuration()
	var configured: Dictionary = _configure(raw)
	if not configured["ok"]:
		invalidate()
		return configured
	_callback = JavaScriptBridge.create_callback(_receive_callback)
	if _callback == null:
		invalidate()
		return _fail("CALLBACK_UNAVAILABLE")
	_active = true
	var hello: Dictionary = {"schema": "wxslim-resource-command-hello-v1", "identity": _config["identity"], "boot": _config["boot"]}
	var attached: Variant = _interface.attach(JSON.stringify(hello), _callback)
	if typeof(attached) != TYPE_BOOL or not attached:
		return _protocol_failure("ATTACH_NOT_ACCEPTED")
	# Transport acceptance only. BEGIN must arrive and execute through callback.
	return {"ok": true, "code": "ATTACH_ACCEPTED"}

func invalidate() -> void:
	if _pending:
		_dispatch_state = "INVALIDATED_BEFORE_DISPATCH" if _dispatch_state == "QUEUED" else "RESULT_UNACKNOWLEDGED"
	_active = false
	_generation += 1
	if is_instance_valid(_scene_loader):
		_scene_loader.invalidate()
		_last_scene_result = _scene_loader.snapshot()
	_interface = null
	_callback = null
	# Do not erase helper state, release mounted files, or claim pending work undone.

func receiver_summary() -> Dictionary:
	return {"active": _active, "pending": _pending, "begun": _begun, "lastRequestId": _last_request,
		"error": _error, "dispatchState": _dispatch_state, "scene": _last_scene_result.duplicate(true), "summary": _session.state_summary()}

func _exit_tree() -> void:
	invalidate()

func _configure(raw: Variant) -> Dictionary:
	if _configured:
		return _fail("CONFIG_ALREADY_ATTEMPTED")
	_configured = true
	var parsed: Variant = _parse(raw)
	if typeof(parsed) != TYPE_DICTIONARY or not _keys(parsed, ["schema", "identity", "boot", "manifest"]):
		return _fail("CONFIG_INVALID")
	var value: Dictionary = parsed
	if value["schema"] != "wxslim-resource-command-config-v1" or not _valid_identity(value["identity"]):
		return _fail("CONFIG_IDENTITY_INVALID")
	if typeof(value["boot"]) != TYPE_DICTIONARY or not _keys(value["boot"], ["packageId", "pckSha256", "wasmSha256"]):
		return _fail("CONFIG_BOOT_INVALID")
	var boot: Dictionary = value["boot"]
	if not _token(boot["packageId"]) or not _hash(boot["pckSha256"]) or not _hash(boot["wasmSha256"]):
		return _fail("CONFIG_BOOT_INVALID")
	if typeof(value["manifest"]) != TYPE_DICTIONARY:
		return _fail("CONFIG_MANIFEST_INVALID")
	# Memory-only validation with the same real helper; the live helper begins on BEGIN.
	var validator: RefCounted = Session.new()
	var validated: Dictionary = validator.begin_manifest(value["manifest"], value["identity"]["engineSession"])
	if not validated["ok"]:
		return _fail("CONFIG_MANIFEST_INVALID")
	_config = value.duplicate(true)
	return {"ok": true, "code": "CONFIG_ACCEPTED"}

func _receive_callback(args: Array) -> void:
	if args.size() < 1 or args.size() > 2:
		_protocol_failure("CALLBACK_ARGUMENTS_INVALID")
		return
	_accept(args[0], args[1] if args.size() == 2 else null, args.size() == 2)

func _accept(raw: Variant, payload: Variant, has_payload: bool) -> Dictionary:
	if not _active or _pending:
		return _fail("RECEIVER_INACTIVE_OR_BUSY")
	var parsed: Variant = _parse(raw)
	if typeof(parsed) != TYPE_DICTIONARY or not _keys(parsed, ["schema", "identity", "requestId", "op", "packId"]):
		return _protocol_failure("COMMAND_INVALID")
	var header: Dictionary = parsed
	if header["schema"] != "wxslim-resource-command-v1" or not _valid_identity(header["identity"]) or header["identity"] != _config["identity"]:
		return _fail("COMMAND_IDENTITY_INVALID")
	if not _decimal(header["requestId"]) or not _greater(header["requestId"], _last_request):
		return _fail("COMMAND_REQUEST_ID_INVALID")
	if typeof(header["op"]) != TYPE_STRING or not header["op"] in ["BEGIN", "VERIFY", "STAGE", "MOUNT", "ENTRY", "LOAD_SCENE", "SUMMARY"] or typeof(header["packId"]) != TYPE_STRING:
		return _protocol_failure("COMMAND_OPERATION_INVALID")
	var op: String = header["op"]
	if (op in ["BEGIN", "SUMMARY"] and header["packId"] != "") or (not op in ["BEGIN", "SUMMARY"] and not _known_pack(header["packId"])):
		return _protocol_failure("COMMAND_PACK_INVALID")
	if (not _begun and op != "BEGIN") or (_begun and op == "BEGIN"):
		return _protocol_failure("COMMAND_BEGIN_REQUIRED_OR_REPEATED")
	if has_payload != (op == "VERIFY"):
		return _protocol_failure("COMMAND_PAYLOAD_INVALID")
	if _native_test and op in ["STAGE", "MOUNT", "LOAD_SCENE"]:
		return _fail("NATIVE_TEST_SIDE_EFFECT_FORBIDDEN")
	if op == "VERIFY":
		if _native_test:
			if typeof(payload) != TYPE_PACKED_BYTE_ARRAY or payload.size() > PACK_LIMIT:
				return _protocol_failure("COMMAND_BUFFER_INVALID")
		else:
			if not payload is JavaScriptObject or _interface == null:
				return _protocol_failure("COMMAND_BUFFER_INVALID")
			var accepted: Variant = _interface.isAcceptedBuffer(payload)
			if typeof(accepted) != TYPE_BOOL or not accepted or not JavaScriptBridge.is_js_buffer(payload):
				return _protocol_failure("COMMAND_BUFFER_INVALID")
	_last_request = header["requestId"]
	_pending = true
	_dispatch_state = "QUEUED"
	_run_deferred.call_deferred(header.duplicate(true), payload, _generation)
	return {"ok": true, "code": "COMMAND_QUEUED"}

func _run_deferred(header: Dictionary, payload: Variant, generation: int) -> void:
	if not _active or generation != _generation:
		return
	if not _native_test:
		var live: Variant = _interface.isActive(JSON.stringify(_config["identity"]))
		if typeof(live) != TYPE_BOOL or not live:
			_protocol_failure("CONTROLLER_INACTIVE_BEFORE_DISPATCH")
			return
	_dispatch_state = "DISPATCHED"
	var result: Dictionary
	var op: String = header["op"]
	var id: String = header["packId"]
	if op == "LOAD_SCENE":
		_begin_scene_load(header, generation)
		return
	match op:
		"BEGIN":
			result = _session.begin_manifest(_config["manifest"], _config["identity"]["engineSession"])
			_begun = result["ok"]
		"VERIFY":
			var bytes: PackedByteArray
			if _native_test:
				bytes = payload
				result = _session.verify_bytes(id, bytes)
			else:
				# Recheck the actual live view immediately before conversion: callback-time
				# validation cannot pin detached/resizable buffers across deferred dispatch.
				var accepted_now: Variant = _interface.isAcceptedBuffer(payload)
				if typeof(accepted_now) != TYPE_BOOL or not accepted_now or not JavaScriptBridge.is_js_buffer(payload):
					result = {"ok": false, "code": "COMMAND_BUFFER_CHANGED_BEFORE_VERIFY"}
				else:
					bytes = JavaScriptBridge.js_buffer_to_packed_byte_array(payload)
					result = _session.verify_bytes(id, bytes)
		"STAGE": result = _session.stage_verified(id)
		"MOUNT": result = _session.mount_verified(id)
		"ENTRY": result = _session.allowed_entry(id)
		"SUMMARY": result = {"ok": true, "code": "SUMMARY_OBSERVED"}
	_complete_report(header, result)

func _scene_request_active(header: Dictionary, generation: int) -> bool:
	if not _active or not _pending or generation != _generation or _last_request != header["requestId"] or _native_test or _interface == null:
		return false
	if not is_inside_tree() or get_parent() != get_tree().root or get_tree().current_scene == self or is_queued_for_deletion():
		return false
	# This query does not call an external JS guard. It reads a request-specific
	# cancellation latch; a physical click not processed by JS yet is not observed.
	var live: Variant = _interface.isRequestActive(JSON.stringify(header))
	return typeof(live) == TYPE_BOOL and live

func _begin_scene_load(header: Dictionary, generation: int) -> void:
	if not _scene_request_active(header, generation):
		_complete_report(header, _fail("SCENE_REQUEST_INACTIVE"))
		return
	var allowed: Dictionary = _session.allowed_entry(header["packId"])
	if not allowed["ok"]:
		_complete_report(header, allowed)
		return
	if is_instance_valid(_scene_loader):
		_complete_report(header, _fail("SCENE_LOADER_STILL_PRESENT"))
		return
	_scene_loader = SceneLoader.new()
	add_child(_scene_loader)
	var connected: Error = _scene_loader.completed.connect(_scene_completed.bind(header.duplicate(true), generation))
	if connected != OK:
		_scene_loader.queue_free()
		_scene_loader = null
		_complete_report(header, {"ok": false, "code": "SCENE_COMPLETION_CONNECT_FAILED", "engineError": connected})
		return
	# Signal is connected first: a synchronous preparation failure is a result too.
	_scene_loader.start(allowed["entryScene"], _scene_request_active.bind(header.duplicate(true), generation))

func _scene_completed(result: Dictionary, header: Dictionary, generation: int) -> void:
	_last_scene_result = result.duplicate(true)
	if is_instance_valid(_scene_loader):
		_scene_loader.queue_free()
		_scene_loader = null
	if not _active or generation != _generation or not _pending or _last_request != header["requestId"]:
		return # Keep evidence; do not acknowledge a stale command or invent rollback.
	_complete_report(header, result)

func _complete_report(header: Dictionary, result: Dictionary) -> void:
	var report: Dictionary = {"schema": "wxslim-resource-command-result-v1", "identity": _config["identity"].duplicate(true),
		"requestId": header["requestId"], "op": header["op"], "packId": header["packId"], "result": result, "summary": _session.state_summary()}
	var report_json: String = JSON.stringify(report)
	_dispatch_state = "RESULT_UNACKNOWLEDGED"
	if report_json.to_utf8_buffer().size() > LIMIT:
		_protocol_failure("REPORT_PROTOCOL_LIMIT")
		return
	if _native_test:
		_last_native_report = report.duplicate(true)
		_dispatch_state = "NATIVE_TEST_REPORT_CAPTURED"
	else:
		var accepted_report: Variant = _interface.report(report_json)
		if typeof(accepted_report) != TYPE_BOOL or not accepted_report:
			_protocol_failure("REPORT_NOT_ACCEPTED")
			return
		# This acknowledges transport only, not mount/scene/visual success.
		_dispatch_state = "TRANSPORT_ACCEPTED"
	_pending = false

func initialize_native_test(configuration_json: String) -> Dictionary:
	if OS.has_feature("web") or _configured:
		return _fail("NATIVE_TEST_UNAVAILABLE")
	_native_test = true
	var result: Dictionary = _configure(configuration_json)
	_active = result["ok"]
	return result

func submit_native_test(header_json: String, bytes: Variant = null) -> Dictionary:
	if OS.has_feature("web") or not _native_test:
		return _fail("NATIVE_TEST_UNAVAILABLE")
	return _accept(header_json, bytes, bytes != null)

func native_test_report() -> Dictionary:
	return _last_native_report.duplicate(true) if _native_test and not OS.has_feature("web") else {}

func _protocol_failure(code: String) -> Dictionary:
	_error = code
	invalidate()
	return _fail(code)

func _parse(raw: Variant) -> Variant:
	if typeof(raw) != TYPE_STRING or raw.to_utf8_buffer().size() > LIMIT:
		return null
	var parser: JSON = JSON.new()
	if parser.parse(raw) != OK:
		return null
	return parser.data

func _keys(value: Dictionary, expected: Array) -> bool:
	return value.size() == expected.size() and expected.all(func(key: Variant) -> bool: return value.has(key))

func _token(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 128:
		return false
	for index: int in value.length():
		if value.unicode_at(index) < 32 or value.unicode_at(index) == 127:
			return false
	return true

func _valid_identity(value: Variant) -> bool:
	return typeof(value) == TYPE_DICTIONARY and _keys(value, ["taskId", "attemptId", "engineSession"]) and _token(value["taskId"]) and _token(value["attemptId"]) and _token(value["engineSession"])

func _hash(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.length() != 64:
		return false
	for character: String in value:
		if not character in "0123456789abcdef":
			return false
	return true

func _decimal(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 32 or value[0] == "0":
		return false
	for character: String in value:
		if not character in "0123456789":
			return false
	return true

func _greater(value: String, previous: String) -> bool:
	return value.length() > previous.length() or (value.length() == previous.length() and value > previous)

func _known_pack(id: String) -> bool:
	for pack: Dictionary in _config["manifest"]["packs"]:
		if pack["id"] == id:
			return true
	return false

func _fail(code: String) -> Dictionary:
	return {"ok": false, "code": code}
