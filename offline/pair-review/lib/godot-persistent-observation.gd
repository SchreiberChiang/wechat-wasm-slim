extends Control
## Explicit one-shot development observation. No startup writes, cleanup or retry.
## Caller writer reports and same-session byte readback do not prove durability.
const Client = preload("res://godot-persistent-file-client.gd")
const USER_ROOT: String = "/userfs/wxslim_persistent_probe/"
const MAX_RECORDS: int = 12
const MAX_LOG_BYTES: int = 64 * 1024
var _used: bool = false
var _stopped: bool = false
var _records: int = 0
var _log_bytes: int = 0
var _client = Client.new()
var _button: Button
var _output: TextEdit

func _ready() -> void:
	var box := VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(box)
	var title := Label.new()
	title.text = "存档电脑观察（耐久性、手机未验）"
	box.add_child(title)
	_button = Button.new()
	_button.text = "运行一次（写入并保留测试文件）"
	_button.pressed.connect(_run_once)
	box.add_child(_button)
	_output = TextEdit.new()
	_output.editable = false
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_output)

func _record(step: String, expected: bool, raw: Variant) -> bool:
	if _stopped:
		return false
	var json: String = JSON.stringify({"step": step, "expectedSatisfied": expected, "raw": raw, "engineResultVerified": false, "durability": "NOT_PROVEN", "phone": "NOT_RUN"})
	var line: String = "[PERSISTENT_PROBE] " + json
	var length: int = (line + "\n").to_utf8_buffer().size()
	# Reserve one complete small terminal record. Never truncate raw and present
	# it as a complete result; on overflow the omitted record is explicitly named.
	if _records >= MAX_RECORDS - 1 or _log_bytes + length > MAX_LOG_BYTES - 1024:
		_stopped = true
		var terminal: String = "[PERSISTENT_PROBE] " + JSON.stringify({"step": "logBudgetStop", "expectedSatisfied": false, "omittedStep": step, "rawOmitted": true, "reason": "LOG_BUDGET_EXCEEDED", "recordsBeforeStop": _records, "bytesBeforeStop": _log_bytes, "engineResultVerified": false})
		_output.text += terminal + "\n"
		print(terminal)
		return false
	_records += 1
	_log_bytes += length
	_output.text += line + "\n"
	print(line)
	return true

func _run_once() -> void:
	if _used:
		return
	_used = true
	_button.disabled = true
	var connected: Dictionary = _client.connect_interface()
	if not _record("connect", connected.get("ok") == true, connected) or connected.get("ok") != true:
		return
	# Read-only host projection; unknown environment fields remain unknown.
	# No GL queries, device inference or fabricated SDK/backend identity.
	var observer: JavaScriptObject = JavaScriptBridge.get_interface("__WXSLIM_PERSISTENT_OBSERVATION__")
	if observer == null:
		_record("environment", false, "OBSERVATION_INTERFACE_UNAVAILABLE")
		return
	var environment_json: Variant = observer.readIdentityJSON()
	if typeof(environment_json) != TYPE_STRING or environment_json.to_utf8_buffer().size() > 65536:
		_record("environment", false, {"code": "OBSERVATION_JSON_INVALID_OR_OVER_BUDGET", "rawOmitted": true})
		return
	var environment: Variant = JSON.parse_string(environment_json)
	if typeof(environment) != TYPE_DICTIONARY:
		_record("environment", false, environment_json)
		return
	var api: JavaScriptObject = JavaScriptBridge.get_interface("__WXSLIM_PERSISTENT_FILES__")
	if api == null:
		_record("configuration", false, "INTERFACE_UNAVAILABLE")
		return
	var raw: Variant = api.configurationJSON()
	if typeof(raw) != TYPE_STRING or raw.length() > 65536:
		_record("configuration", false, raw)
		return
	var config: Variant = JSON.parse_string(raw)
	if typeof(config) != TYPE_DICTIONARY:
		_record("configuration", false, raw)
		return
	var session: Variant = config.get("sessionId")
	if typeof(session) != TYPE_STRING or not _session_token(session) or config.get("identity") != connected.get("identity") or config.get("mountPath") != "/userfs" or config.get("maxRequests", 0) < 4 or config.get("maxFileBytes", 0) < 8:
		_record("configuration", false, config)
		return
	var identity: Dictionary = config["identity"]
	var environment_matches: bool = environment.get("schema") == "wxslim-persistent-observation-identity-v1" and environment.get("packageId") == identity.get("packageId") and environment.get("sessionId") == session and environment.get("wasmSha256") == identity.get("wasmSha256")
	environment_matches = environment_matches and environment.get("requestedMode") in ["glx", "webgl"] and environment.get("actualMode") == environment.get("requestedMode") and typeof(environment.get("webgl2")) == TYPE_BOOL and environment["webgl2"] and typeof(environment.get("nativeStateProof")) == TYPE_BOOL and not environment["nativeStateProof"]
	# SDK/device strings may remain null/unknown. Preserve them without claiming
	# a fixed SDK. Missing backend/WebGL2/identity evidence stops before file I/O.
	if not _record("environment", environment_matches, environment) or not environment_matches:
		return
	var actual: String = ProjectSettings.globalize_path("user://")
	var mapped: bool = actual == USER_ROOT and DirAccess.dir_exists_absolute(actual)
	# Fixed main.cpp:2256 calls ensure_user_data_dir(); core/os/os.cpp:434-441
	# creates its directory recursively. This fixture never creates directories.
	if not _record("userRoot", mapped, {"actual": actual, "sessionId": session, "identity": config.get("identity")}) or not mapped:
		return
	var base: String = "user://probe-" + session
	var empty_path: String = base + "-empty.bin"
	var bytes_path: String = base + "-bytes.bin"
	var missing_parent: String = base + "-missing"
	# Check every planned path before the first write. Never overwrite old evidence.
	for target: String in [empty_path, bytes_path, missing_parent]:
		if FileAccess.file_exists(target) or DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(target)):
			_record("uniquePaths", false, target)
			return
	if not _save("empty", empty_path, PackedByteArray()):
		return
	if not _save("binary", bytes_path, PackedByteArray([0, 255, 128, 195, 169, 0, 10, 42])):
		return
	if not _save("shortOverwrite", bytes_path, PackedByteArray([0, 231])):
		return
	var failure: Dictionary = _client.save_bytes(missing_parent + "/absent.bin", PackedByteArray([1]))
	var writer: Variant = failure.get("writer")
	var host: Variant = failure.get("hostResult")
	var expected: bool = failure.get("ok") == false and failure.get("code") == "SAVE_CLIENT_HOST_REJECTED" and typeof(writer) == TYPE_DICTIONARY and typeof(host) == TYPE_DICTIONARY
	if expected:
		expected = typeof(writer.get("openError")) == TYPE_INT and writer["openError"] != OK and host.get("ok") == false and host.get("engineResultVerified") == false and host.get("writer") == writer
		for field: String in ["storeReturned", "storeError", "flushError", "closeError", "stillOpen"]:
			expected = expected and writer.has(field) and writer[field] == null
	if expected:
		var receipt: Variant = host.get("receipt")
		expected = typeof(receipt) == TYPE_DICTIONARY
		if expected:
			# Verification stops before native readback: null/[] mean not attempted.
			expected = receipt.get("status") == "FAILED" and receipt.get("code") == "SAVE_WRITER_EVIDENCE_MISSING" and receipt.has("nativeReadbackVerified") and receipt["nativeReadbackVerified"] == null and receipt.get("engineResultVerified") == false and receipt.get("sessionId") == session and receipt.get("identity") == config.get("identity") and receipt.get("callerWriterEvidence") == null and receipt.get("files") == []
			var ticket: Variant = host.get("ticket")
			expected = expected and typeof(ticket) == TYPE_DICTIONARY
			if expected:
				expected = receipt.get("requestId") == ticket.get("requestId") and ticket.get("sessionId") == session
	if _record("missingParentOpenFailure", expected, failure) and expected:
		_record("oneShotObservationsComplete", true, "Same-session observations only; no restart/durability/atomicity/phone acceptance. Files retained.")

func _save(step: String, path: String, bytes: PackedByteArray) -> bool:
	var observed: Dictionary = _client.save_bytes(path, bytes)
	var expected: bool = observed.get("ok") == true and observed.get("code") == "SAVE_EXPECTED_BYTES_OBSERVED" and observed.get("engineResultVerified") == false
	return _record(step, expected, observed) and expected

func _session_token(value: String) -> bool:
	if value.length() < 1 or value.length() > 128:
		return false
	for index: int in range(value.length()):
		var c: int = value.unicode_at(index)
		if not ((c >= 48 and c <= 57) or (c >= 65 and c <= 90) or (c >= 97 and c <= 122) or c == 45 or c == 95):
			return false
	return true
