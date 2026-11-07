extends Node
## Source-only no-UI facade for serial resource scenes in one engine session.
## Install as autoload WxResource. Receiver is a sibling directly under /root.
## Call load_pack(id) explicitly; never chain this through WxSplit.enter_scene.
## shutdown drains the local facade only, NOT the JS host or mounted resources.
## Godot parsing, exported boot wiring and Web/device behavior remain NOT_RUN.
signal connected(result: Dictionary)
signal completed(result: Dictionary)
signal shutdown_completed(result: Dictionary)

const Receiver = preload("res://godot-resource-command-receiver.gd")
const AUTOLOAD_NAME: String = "WxResource"
const RECEIVER_NAME: String = "WxResourceReceiver"
const JSON_LIMIT: int = 1024 * 1024
const HISTORY_LIMIT: int = 8
var _receiver: Node
var _app: JavaScriptObject
var _json: JavaScriptObject
var _resolve_callback: JavaScriptObject
var _reject_callback: JavaScriptObject
var _promise: JavaScriptObject
var _promise_chain: JavaScriptObject
var _identity: Dictionary = {}
var _boot: Dictionary = {}
var _manifest: Dictionary = {}
var _entries: Dictionary = {}
var _connect_attempted: bool = false
var _connected: bool = false
var _generation: int = 0
var _busy: bool = false
var _pending: bool = false
var _promise_settled: bool = false
var _protocol_failed: bool = false
var _active_load_id: String = ""
var _last_claimed_load_id: String = "0"
var _cancel_attempted: bool = false
var _cancel_observation: String = "NOT_REQUESTED"
var _closing: bool = false
var _closed: bool = false
var _close_attempted: bool = false
var _close_confirmed: bool = false
var _exited: bool = false
var _state: String = "NEW"
var _code: String = "NOT_CONNECTED"
var _target: String = ""
var _raw_result_json: String = ""
var _latest_raw_load_id: String = ""
var _latest_raw_observed_load_id: String = ""
var _raw_retention: String = "NO_RESULT"
var _completion: Dictionary = {}
var _history: Array[Dictionary] = []
var _history_dropped: int = 0
var _shutdown_observation: Dictionary = {}

func _ready() -> void:
	# Autoload addition/ready must finish before adding the resident receiver.
	_connect_deferred.call_deferred()

func _connect_deferred() -> void:
	if not _connect_attempted and not _closing and not _exited:
		connected.emit(connect_runtime())

func connect_runtime() -> Dictionary:
	if _connect_attempted or _closing or _exited:
		return _reply(false, "CONNECT_ONCE")
	_connect_attempted = true
	if not OS.has_feature("web"):
		_state = "UNSUPPORTED"
		return _reply(false, "RESOURCE_FACADE_WEB_UNSUPPORTED")
	if not _resident() or name != AUTOLOAD_NAME:
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_AUTOLOAD_REQUIRED")
	if get_tree().root.has_node(RECEIVER_NAME):
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_RECEIVER_COLLISION")
	_app = JavaScriptBridge.get_interface("__WXSLIM_RESOURCE_APP__")
	_json = JavaScriptBridge.get_interface("JSON")
	var bridge: JavaScriptObject = JavaScriptBridge.get_interface("__WXSLIM_RESOURCE_BRIDGE__")
	if _app == null or _json == null or bridge == null:
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_INTERFACES_MISSING")
	var app_status: Variant = _json_value(_app.status())
	var config: Variant = _parse(bridge.configuration())
	if not _initial_binding(app_status, config):
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_BINDING_INVALID")
	_identity = config["identity"].duplicate(true)
	_boot = config["boot"].duplicate(true)
	_manifest = config["manifest"].duplicate(true)
	for pack: Dictionary in _manifest["packs"]:
		_entries[pack["id"]] = pack["entryScene"]
	_receiver = Receiver.new()
	_receiver.name = RECEIVER_NAME
	get_tree().root.add_child(_receiver)
	var attached: Dictionary = _receiver.connect_interface("__WXSLIM_RESOURCE_BRIDGE__")
	if attached.get("ok") != true or attached.get("code") != "ATTACH_ACCEPTED":
		_receiver.invalidate()
		_receiver.queue_free()
		_receiver = null
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_ATTACH_FAILED")
	_connected = true
	_state = "READY"
	return _reply(true, "RESOURCE_FACADE_CONNECTED_NO_LOAD")

func can_load() -> bool:
	# A live admission observation, not a reservation. load_pack rechecks it.
	# Foreign JS status exceptions can propagate; never fabricate true on error.
	if not _connected or _busy or _pending or _closing or _closed or _exited or _protocol_failed or not _resident():
		return false
	return _session_ready(_live_session())

func load_pack(pack_id: String) -> Dictionary:
	# Busy includes Promise callbacks, completed handlers and deferred cleanup.
	if _busy or _pending:
		return _reply(false, "RESOURCE_FACADE_BUSY")
	if not _connected or _closing or _closed or _exited or _protocol_failed or not _resident():
		return _reply(false, "RESOURCE_FACADE_NOT_READY")
	if not _entries.has(pack_id) or typeof(_entries[pack_id]) != TYPE_STRING:
		return _reply(false, "RESOURCE_EXECUTOR_TARGET_ENTRY")
	var session: Variant = _live_session()
	if not _session_ready(session):
		return _reply(false, "RESOURCE_FACADE_SESSION_NOT_IDLE")
	if _generation >= 9007199254740991:
		return _reply(false, "RESOURCE_FACADE_GENERATION_LIMIT")
	_generation += 1
	_target = pack_id
	_active_load_id = ""
	_promise_settled = false
	_cancel_attempted = false
	_cancel_observation = "NOT_REQUESTED"
	_resolve_callback = JavaScriptBridge.create_callback(_on_resolved.bind(_generation))
	_reject_callback = JavaScriptBridge.create_callback(_on_rejected.bind(_generation))
	if _resolve_callback == null or _reject_callback == null:
		_protocol_failed = true
		_state = "FAILED"
		return _reply(false, "RESOURCE_FACADE_CALLBACK_UNAVAILABLE")
	# Set busy/pending BEFORE a foreign call. A thrown JS call or malformed
	# return cannot justify freeing callbacks or claiming nothing was dispatched.
	_busy = true
	_pending = true
	_state = "LOADING"
	var returned: Variant = _app.load(pack_id)
	if not returned is JavaScriptObject:
		_protocol_failed = true
		_state = "UNKNOWN"
		return _reply(false, "RESOURCE_FACADE_LOAD_PROMISE_UNCONFIRMED")
	_promise = returned
	var claimed: Variant = _live_session()
	var claim_ok: bool = _session_binding(claimed) and claimed.get("phase") == "RUNNING" and claimed.get("busy") == true and _decimal(claimed.get("activeLoadId")) and _greater(claimed["activeLoadId"], _last_claimed_load_id)
	if claim_ok:
		_active_load_id = claimed["activeLoadId"]
		_last_claimed_load_id = _active_load_id
	else:
		_protocol_failed = true
		_state = "UNKNOWN"
	# Observe the original Promise even if its synchronous claim is malformed.
	var chained: Variant = _promise.then(_resolve_callback, _reject_callback)
	if not chained is JavaScriptObject:
		_protocol_failed = true
		_state = "UNKNOWN"
		return _reply(false, "RESOURCE_FACADE_OBSERVER_UNCONFIRMED")
	_promise_chain = chained
	return _reply(claim_ok, "RESOURCE_FACADE_LOAD_REQUESTED" if claim_ok else "RESOURCE_FACADE_LOAD_ID_UNCONFIRMED")

func cancel() -> Dictionary:
	if not _connected or _closed or _exited or not _pending:
		return _reply(false, "RESOURCE_FACADE_NO_PENDING_LOAD")
	if _cancel_attempted:
		return _reply(false, "RESOURCE_FACADE_CANCEL_ALREADY_ATTEMPTED")
	_cancel_attempted = true
	_cancel_observation = "UNCONFIRMED"
	if not _decimal(_active_load_id):
		return _reply(false, "RESOURCE_FACADE_CANCEL_LOAD_ID_UNKNOWN")
	# A thrown cancel leaves pending/callbacks intact. GDScript does not catch
	# foreign JS exceptions; no success/abort result is fabricated on that path.
	var observed: Variant = _json_value(_app.cancel(_active_load_id))
	if not observed is Dictionary or observed.get("schema") != "wxslim-resource-executor-session-cancel-v1" or observed.get("loadId") != _active_load_id or observed.get("matched") != true or not _session_binding(observed.get("session")):
		return _reply(false, "RESOURCE_FACADE_CANCEL_UNCONFIRMED")
	_cancel_observation = "CANCEL_REQUESTED"
	_state = "SHUTDOWN_PENDING" if _closing else "CANCEL_REQUESTED"
	return _reply(true, "RESOURCE_FACADE_CANCEL_OBSERVED")

func shutdown() -> Dictionary:
	if _closed:
		return _shutdown_observation.duplicate(true)
	_closing = true
	_state = "SHUTDOWN_PENDING" if _busy or _pending else "SHUTDOWN_REQUESTED"
	if _connected and not _close_attempted:
		_close_attempted = true
		# close locks new session loads but never invalidates the bridge or invents
		# pending completion. A foreign exception leaves all observer refs intact.
		var observed: Variant = _json_value(_app.close())
		_close_confirmed = _session_binding(observed) and observed.get("closed") == true
	elif not _connected:
		_close_confirmed = true
	if not _close_confirmed:
		return _reply(false, "RESOURCE_FACADE_CLOSE_UNCONFIRMED")
	if _busy or _pending:
		return _reply(false, "RESOURCE_FACADE_DRAIN_PENDING")
	_finish_shutdown.call_deferred()
	return _reply(true, "RESOURCE_FACADE_SHUTDOWN_QUEUED")

func snapshot() -> Dictionary:
	return {"schema": "wxslim-resource-game-facade-v2", "state": _state, "code": _code,
		"connected": _connected, "busy": _busy, "generation": _generation, "activeLoadId": _active_load_id if _busy else null,
		"lastLoadId": _last_claimed_load_id, "pending": _pending,
		"promiseSettled": _promise_settled, "cancelObservation": _cancel_observation,
		"closing": _closing, "closed": _closed, "sessionCloseConfirmed": _close_confirmed, "targetPackId": _target,
		"identity": _identity.duplicate(true), "boot": _boot.duplicate(true),
		"completion": _completion.duplicate(true), "shutdown": _shutdown_observation.duplicate(true),
		"history": _history.duplicate(true), "historyLimit": HISTORY_LIMIT, "historyDropped": _history_dropped,
		"rawResultRetention": "LATEST_SETTLED_LOAD_ONLY", "latestRawLoadId": _latest_raw_load_id,
		"latestRawObservedLoadId": _latest_raw_observed_load_id, "rawRetentionStatus": _raw_retention,
		"loadPolicy": "SERIAL_SESSION_LOADS_WHILE_IDLE_HEALTHY", "multiLevelSupported": true,
		"shutdownScope": "LOCAL_FACADE_DRAIN_NOT_JS_HOST_DISPOSAL",
		"rollbackPerformed": false, "visualVerified": false, "runtimeVerified": false,
		"persistentReceiptWritten": false}

func get_original_result_json(load_id: String = "") -> String:
	# Never substitute a newer load's raw result for an older requested loadId.
	return _raw_result_json if load_id == "" or load_id == _latest_raw_load_id else ""

func get_original_result_info(load_id: String = "") -> Dictionary:
	var matched: bool = load_id == "" or load_id == _latest_raw_load_id
	var retention_status: String = _raw_retention if matched else "NOT_RETAINED"
	if not matched and _busy and _pending and load_id == _active_load_id:
		retention_status = "NOT_SETTLED"
	return {"loadId": _latest_raw_load_id if load_id == "" else load_id,
		"available": matched and _raw_retention == "RETAINED", "status": retention_status,
		"retention": "LATEST_SETTLED_LOAD_ONLY", "latestRawLoadId": _latest_raw_load_id,
		"observedLoadId": _latest_raw_observed_load_id if matched else "", "bytes": _raw_result_json.to_utf8_buffer().size() if matched else 0}

func _retain_raw(args: Array) -> Variant:
	_raw_result_json = ""
	_latest_raw_load_id = _active_load_id
	_latest_raw_observed_load_id = ""
	_raw_retention = "UNAVAILABLE_OR_LIMIT"
	if args.size() != 1:
		return null
	var text: Variant = _json.stringify(args[0])
	if typeof(text) != TYPE_STRING or text.to_utf8_buffer().size() > JSON_LIMIT:
		return null
	_raw_result_json = text
	_raw_retention = "RETAINED"
	var value: Variant = _parse(text)
	if value is Dictionary and _decimal(value.get("loadId")):
		_latest_raw_observed_load_id = value["loadId"]
	return value

func _on_resolved(args: Array, generation: int) -> void:
	if generation != _generation or _promise_settled or _exited:
		return
	_promise_settled = true
	_pending = false
	var envelope: Variant = _retain_raw(args)
	var raw: Variant = null
	if envelope is Dictionary and _keys(envelope, ["schema", "loadId", "result"]) and envelope.get("schema") == "wxslim-resource-executor-session-load-v1" and envelope.get("loadId") == _active_load_id and _decimal(_active_load_id):
		raw = envelope["result"]
	var outcome: String = "UNKNOWN"
	var code: String = "RESOURCE_FACADE_RESULT_INVALID"
	if _executor_binding(raw) and raw.get("finished") == true and raw.get("targetPackId") == _target and raw.get("manifest") == _manifest and raw.get("outcome") in ["SUCCESS", "FAILED", "CANCELLED", "UNKNOWN"]:
		outcome = raw["outcome"]
		code = "RESOURCE_FACADE_EXECUTOR_" + outcome
		if outcome == "SUCCESS" and not _scene_proof(raw):
			outcome = "UNKNOWN"
			code = "RESOURCE_FACADE_SCENE_PROOF_MISMATCH"
	else:
		_protocol_failed = true
	if code == "RESOURCE_FACADE_SCENE_PROOF_MISMATCH":
		_protocol_failed = true
	var scene: Node = get_tree().current_scene
	_completion = {"ok": outcome == "SUCCESS", "code": code, "outcome": outcome, "loadId": _active_load_id,
		"observedLoadId": _latest_raw_observed_load_id, "generation": generation,
		"identity": _identity.duplicate(true), "boot": _boot.duplicate(true), "targetPackId": _target,
		"sceneInstanceId": str(scene.get_instance_id()) if outcome == "SUCCESS" and is_instance_valid(scene) else null,
		"scenePath": _entries[_target] if outcome == "SUCCESS" else null,
		"promiseSettled": true, "sceneTreeConfirmationObserved": outcome == "SUCCESS",
		"visualVerified": false, "runtimeVerified": false, "rollbackPerformed": false}
	_publish_completion(generation)

func _on_rejected(args: Array, generation: int) -> void:
	if generation != _generation or _promise_settled or _exited:
		return
	_promise_settled = true
	_pending = false
	_retain_raw(args)
	_protocol_failed = true
	_completion = {"ok": false, "code": "RESOURCE_FACADE_PROMISE_REJECTED", "outcome": "UNKNOWN",
		"loadId": _active_load_id, "observedLoadId": _latest_raw_observed_load_id, "generation": generation,
		"identity": _identity.duplicate(true), "boot": _boot.duplicate(true), "targetPackId": _target,
		"promiseSettled": true, "sceneTreeConfirmationObserved": false, "sceneInstanceId": null, "scenePath": null,
		"rollbackPerformed": false, "visualVerified": false, "runtimeVerified": false}
	_publish_completion(generation)

func _publish_completion(generation: int) -> void:
	_state = "SHUTDOWN_PENDING" if _closing else _completion["outcome"]
	_code = _completion["code"]
	_history.append(_completion.duplicate(true))
	if _history.size() > HISTORY_LIMIT:
		_history.pop_front()
		_history_dropped += 1
	# Busy stays true through signal handlers and the deferred tail. Reentrant
	# completed handlers cannot load again or have a newer callback freed here.
	_after_settlement.call_deferred(generation)
	completed.emit(_completion.duplicate(true))

func _after_settlement(generation: int) -> void:
	if generation != _generation or not _promise_settled or _pending or _exited:
		return
	_resolve_callback = null
	_reject_callback = null
	_promise = null
	_promise_chain = null
	if _closing:
		_busy = false
		_finish_shutdown()
	else:
		# Only the session's current phase/health can admit another request.
		var session: Variant = _live_session()
		_state = "READY" if not _protocol_failed and _session_ready(session) else "SESSION_NOT_REUSABLE"
		_busy = false

func _finish_shutdown() -> void:
	if _busy or _pending or _closed or _exited or not _closing or not _close_confirmed:
		return
	if _connected:
		var session: Variant = _live_session()
		if not _session_binding(session) or session.get("closed") != true or session.get("busy") != false:
			_state = "SHUTDOWN_SESSION_PENDING_OR_UNKNOWN"
			return # Includes requests this facade does not own; never abort them.
	if is_instance_valid(_receiver):
		_receiver.invalidate()
		_receiver.queue_free()
		_receiver = null
	_connected = false
	_closed = true
	_state = "SHUTDOWN_COMPLETE"
	_shutdown_observation = {"ok": true, "code": "RESOURCE_FACADE_LOCAL_DRAIN_COMPLETE", "pending": false, "busy": false,
		"lastLoadId": _last_claimed_load_id, "promiseSettled": _promise_settled, "sessionCloseConfirmed": _close_confirmed,
		"hostDisposed": false, "mountedResourcesReleased": false, "rollbackPerformed": false}
	_app = null
	_json = null
	_resolve_callback = null
	_reject_callback = null
	_promise = null
	_promise_chain = null
	shutdown_completed.emit(_shutdown_observation.duplicate(true))

func _exit_tree() -> void:
	_exited = true
	_connected = false
	_closing = true
	if _busy or _pending:
		_state = "EXITED_PENDING_UNKNOWN"
		_code = "RESOURCE_FACADE_FORCED_EXIT_UNDRAINED"
	# Exit is not an awaitable drain. Do not clear pending, report completion,
	# or explicitly release callbacks here; engine destruction may release them.
	if is_instance_valid(_receiver):
		_receiver.invalidate()
		_receiver.queue_free()

func _resident() -> bool:
	return is_inside_tree() and not is_queued_for_deletion() and get_parent() == get_tree().root and get_tree().current_scene != self

func _initial_binding(app_status: Variant, config: Variant) -> bool:
	if not app_status is Dictionary or app_status.get("schema") != "wxslim-resource-interfaces-v2" or app_status.get("installed") != true or app_status.get("closed") != false:
		return false
	if not config is Dictionary or not _keys(config, ["schema", "identity", "boot", "manifest"]) or config.get("schema") != "wxslim-resource-command-config-v1":
		return false
	if not _valid_identity(config.get("identity")) or not _valid_boot(config.get("boot")) or app_status.get("identity") != config["identity"] or app_status.get("boot") != config["boot"]:
		return false
	var lifecycle: Variant = app_status.get("lifecycle")
	if not lifecycle is Dictionary or lifecycle.get("schema") != "wxslim-resource-host-lifecycle-v1" or lifecycle.get("invalidated") != false or lifecycle.get("stage") != "INSTALLED":
		return false
	var transport: Variant = lifecycle.get("transport")
	if not transport is Dictionary or transport.get("attached") != false or transport.get("invalidated") != false or transport.get("pending") != null:
		return false # Another receiver must not consume this bridge's attach-once.
	var manifest: Variant = config["manifest"]
	if not manifest is Dictionary or not _keys(manifest, ["packs"]) or not manifest["packs"] is Array or manifest["packs"].is_empty() or manifest["packs"].size() > 128:
		return false
	var seen: Dictionary = {}
	for pack: Variant in manifest["packs"]:
		if not pack is Dictionary or not _keys(pack, ["id", "bytes", "sha256", "entryScene", "requires"]) or typeof(pack["id"]) != TYPE_STRING or seen.has(pack["id"]) or not typeof(pack["entryScene"]) in [TYPE_NIL, TYPE_STRING]:
			return false
		seen[pack["id"]] = true
	var session: Variant = app_status.get("executor")
	return session is Dictionary and session.get("schema") == "wxslim-resource-executor-session-v1" and session.get("identity") == config["identity"] and session.get("boot") == config["boot"] and session.get("manifest") == manifest and session.get("phase") == "IDLE" and session.get("closed") == false and session.get("closedReason") == null and session.get("busy") == false and session.get("activeLoadId") == null and session.get("activeJob") == null

func _live_session() -> Variant:
	var value: Variant = _json_value(_app.status())
	if not value is Dictionary or value.get("schema") != "wxslim-resource-interfaces-v2" or value.get("identity") != _identity or value.get("boot") != _boot or value.get("installed") != true or value.get("closed") != false:
		return null
	var session: Variant = value.get("executor")
	return session if _session_binding(session) else null

func _session_binding(value: Variant) -> bool:
	return value is Dictionary and value.get("schema") == "wxslim-resource-executor-session-v1" and value.get("identity") == _identity and value.get("boot") == _boot and value.get("manifest") == _manifest and value.get("phase") in ["IDLE", "RUNNING", "CLOSED"] and typeof(value.get("busy")) == TYPE_BOOL and typeof(value.get("closed")) == TYPE_BOOL

func _session_ready(value: Variant) -> bool:
	return _session_binding(value) and value.get("phase") == "IDLE" and value.get("closed") == false and value.get("closedReason") == null and value.get("busy") == false and value.get("activeLoadId") == null and value.get("activeJob") == null

func _executor_binding(raw: Variant) -> bool:
	return raw is Dictionary and raw.get("schema") == "wxslim-resource-executor-v1" and raw.get("identity") == _identity and raw.get("boot") == _boot

func _decimal(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 32 or value[0] == "0":
		return false
	for character: String in value:
		if character < "0" or character > "9":
			return false
	return true

func _greater(value: String, previous: String) -> bool:
	return value.length() > previous.length() or (value.length() == previous.length() and value > previous)

func _scene_proof(raw: Dictionary) -> bool:
	var target_state: Variant = raw.get("targetState")
	var receipt: Variant = raw.get("memoryReceipt")
	if raw.get("sceneTreeConfirmationObserved") != true or not raw.has("failure") or raw["failure"] != null or not target_state is Dictionary or target_state.get("phase") != "ENDED" or not target_state.get("terminal") is Dictionary or target_state["terminal"].get("status") != "SUCCESS":
		return false
	var expected_state_identity: Dictionary = {"taskId": _identity["taskId"], "attemptId": _identity["attemptId"], "engineSessionId": _identity["engineSession"], "packId": _target}
	if target_state.get("schema") != "wxslim-resource-load-state-v2" or target_state.get("identity") != expected_state_identity:
		return false
	if not receipt is Dictionary or receipt.get("schema") != "wxslim-resource-executor-memory-receipt-v1" or receipt.get("status") != "SUCCESS" or receipt.get("identity") != _identity or receipt.get("boot") != _boot or receipt.get("targetPackId") != _target or receipt.get("persisted") != false:
		return false
	if not raw.get("adapters") is Array:
		return false
	var evidence: Dictionary = {}
	var count: int = 0
	for adapter: Variant in raw["adapters"]:
		if not adapter is Dictionary:
			continue
		var report: Variant = adapter.get("report")
		if report is Dictionary and report.get("op") == "LOAD_SCENE" and report.get("packId") == _target:
			count += 1
			var result: Variant = report.get("result")
			if report.get("identity") == _identity and result is Dictionary and result.get("ok") == true and result.get("code") == "SCENE_TREE_CONFIRMED" and result.get("evidence") is Dictionary:
				evidence = result["evidence"]
	var scene: Node = get_tree().current_scene
	return count == 1 and not evidence.is_empty() and is_instance_valid(scene) and scene.scene_file_path == _entries[_target] and scene.get_parent() == get_tree().root and scene.is_inside_tree() and scene.is_node_ready() and not scene.is_queued_for_deletion() and evidence.get("state") == "TREE_CONFIRMED" and evidence.get("sceneChangedObserved") == true and evidence.get("exactInstance") == true and evidence.get("targetInstanceId") == str(scene.get_instance_id()) and evidence.get("currentSceneId") == str(scene.get_instance_id()) and evidence.get("loadedResourcePath") == _entries[_target] and evidence.get("currentScenePath") == _entries[_target] and evidence.get("parentIsRoot") == true and evidence.get("insideTree") == true and evidence.get("nodeReady") == true and evidence.get("queuedForDeletion") == false and evidence.get("visualVerified") == false

func _valid_identity(value: Variant) -> bool:
	if not value is Dictionary or not _keys(value, ["taskId", "attemptId", "engineSession"]):
		return false
	for key: String in ["taskId", "attemptId", "engineSession"]:
		if typeof(value[key]) != TYPE_STRING or value[key].is_empty() or value[key].length() > 128:
			return false
		for index: int in value[key].length():
			if value[key].unicode_at(index) < 32 or value[key].unicode_at(index) == 127:
				return false
	return true

func _valid_boot(value: Variant) -> bool:
	if not value is Dictionary or not _keys(value, ["packageId", "pckSha256", "wasmSha256"]) or typeof(value["packageId"]) != TYPE_STRING or value["packageId"].is_empty() or value["packageId"].length() > 128:
		return false
	for key: String in ["pckSha256", "wasmSha256"]:
		if typeof(value[key]) != TYPE_STRING or value[key].length() != 64:
			return false
		for character: String in value[key]:
			if not character in "0123456789abcdef":
				return false
	return true

func _keys(value: Dictionary, expected: Array) -> bool:
	return value.size() == expected.size() and expected.all(func(key: Variant) -> bool: return value.has(key))

func _parse(raw: Variant) -> Variant:
	if typeof(raw) != TYPE_STRING or raw.to_utf8_buffer().size() > JSON_LIMIT:
		return null
	var parser: JSON = JSON.new()
	return parser.data if parser.parse(raw) == OK else null

func _json_value(value: Variant) -> Variant:
	return _parse(_json.stringify(value))

func _reply(ok: bool, code: String) -> Dictionary:
	_code = code
	return {"ok": ok, "code": code, "state": _state, "busy": _busy, "pending": _pending, "loadId": _active_load_id,
		"promiseSettled": _promise_settled, "loadPolicy": "SERIAL_SESSION_LOADS_WHILE_IDLE_HEALTHY"}
