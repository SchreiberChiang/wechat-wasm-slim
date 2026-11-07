extends RefCounted
## Source preparation only: not an autoload, scene, startup hook or runtime install.
## Construction performs no I/O. Only explicit save_bytes() opens a file.
## Fixed df3 JSBridge transports strings, not Dictionary/PackedByteArray values.
## raw_to_base64 is a core Marshalls binding; empty bytes use an explicit "".
## FileAccess flush/close error propagation requires the reviewed GLX C++ patch
## in a new, independently checked build. This source does not establish that.
## Writer results are caller reports, never independent C++/device proof.
## No mkdir, retry, delete, eval, Promise, callback-return protocol or recovery.
## Logical limits do not bound peak memory: snapshot/base64/JS/native copies coexist.

const INTERFACE_NAME: String = "__WXSLIM_PERSISTENT_FILES__"
const JSON_LIMIT: int = 64 * 1024
const FILE_LIMIT: int = 1024 * 1024
const MAX_SAFE_INTEGER: int = 9007199254740991
var _interface: JavaScriptObject
var _config: Dictionary = {}
var _attempted: bool = false
var _active: bool = false
var _busy: bool = false
var _epoch: int = 0
var _last_ticket_id: int = 0


func connect_interface(interface_name: String = INTERFACE_NAME) -> Dictionary:
	if _attempted or interface_name != INTERFACE_NAME or not OS.has_feature("web"):
		return _failure("SAVE_CLIENT_CONNECT_UNAVAILABLE")
	_attempted = true
	_interface = JavaScriptBridge.get_interface(INTERFACE_NAME)
	if _interface == null:
		return _failure("SAVE_CLIENT_INTERFACE_UNAVAILABLE")
	var parsed: Variant = _parse(_interface.configurationJSON())
	if typeof(parsed) != TYPE_DICTIONARY or not _valid_config(parsed):
		invalidate()
		return _failure("SAVE_CLIENT_CONFIG_INVALID", {}, parsed)
	_config = parsed.duplicate(true)
	_active = true
	return {"ok": true, "code": "SAVE_CLIENT_CONNECTED", "identity": _config["identity"].duplicate(true), "engineResultVerified": false}


func invalidate() -> void:
	_active = false
	_epoch += 1
	_interface = null
	# No forced close, host reset, ticket retry, unmount or deletion.


func save_bytes(user_path: String, expected: PackedByteArray) -> Dictionary:
	if not _active or _interface == null or _busy:
		return _failure("SAVE_CLIENT_INACTIVE_OR_BUSY")
	_busy = true
	var result: Dictionary = _save(user_path, expected, _epoch)
	_busy = false
	return result


func _save(user_path: String, expected: PackedByteArray, epoch: int) -> Dictionary:
	if not user_path.begins_with("user://") or not _relative_path(user_path.substr(7)):
		return _failure("SAVE_CLIENT_USER_PATH_INVALID")
	var absolute: String = ProjectSettings.globalize_path(user_path)
	if not absolute.begins_with("/userfs/"):
		return _failure("SAVE_CLIENT_OUTSIDE_MOUNT")
	var relative: String = absolute.substr(8)
	if not _relative_path(relative) or expected.size() > int(_config["maxFileBytes"]):
		return _failure("SAVE_CLIENT_PATH_OR_SIZE_INVALID")
	var snapshot: PackedByteArray = expected.duplicate()
	# Encode before any FileAccess mutation, preserving an independent expected copy.
	var encoded: String = "" if snapshot.is_empty() else Marshalls.raw_to_base64(snapshot)
	if encoded.length() != 4 * ceili(float(snapshot.size()) / 3.0):
		return _failure("SAVE_CLIENT_ENCODING_FAILED")
	var prepared: Variant = _parse(_interface.prepareFile(relative, snapshot.size()))
	if not _live(epoch):
		return _failure("SAVE_CLIENT_INVALIDATED", {}, prepared)
	if typeof(prepared) != TYPE_DICTIONARY:
		return _protocol_failure("SAVE_CLIENT_PREPARE_INVALID", {}, prepared)
	if typeof(prepared.get("ok")) != TYPE_BOOL:
		return _protocol_failure("SAVE_CLIENT_PREPARE_INVALID", {}, prepared)
	if not prepared["ok"]:
		return _failure("SAVE_CLIENT_PREPARE_REJECTED", {}, prepared)
	if not _keys(prepared, ["ok", "code", "ticket"]) or prepared["code"] != "SAVE_PREPARED" or not _valid_ticket(prepared["ticket"], relative, snapshot.size()):
		return _protocol_failure("SAVE_CLIENT_TICKET_INVALID", {}, prepared)
	var ticket: Dictionary = prepared["ticket"].duplicate(true)
	_last_ticket_id = int(ticket["ticketId"])
	# ticketId is monotonic; requestId may remain unchanged when the host rejects
	# completion before entering session.verify. Never invent a local request id.
	var writer: Dictionary = {"openError": null, "storeReturned": null, "storeError": null, "flushError": null, "closeError": null, "stillOpen": null}
	var output: FileAccess = FileAccess.open(absolute, FileAccess.WRITE)
	var open_error: int = FileAccess.get_open_error()
	writer["openError"] = open_error
	if output != null:
		writer["storeReturned"] = output.store_buffer(snapshot)
		writer["storeError"] = output.get_error()
		output.flush()
		writer["flushError"] = output.get_error()
		output.close()
		writer["closeError"] = output.get_error()
		writer["stillOpen"] = output.is_open()
	# Keep the FileAccess reference through the explicit post-close error read.
	if not _live(epoch):
		return _failure("SAVE_CLIENT_INVALIDATED_AFTER_FILE_IO", writer)
	var completed: Variant = _parse(_interface.completeFile(JSON.stringify(ticket), JSON.stringify(writer), encoded))
	if not _live(epoch):
		return _failure("SAVE_CLIENT_INVALIDATED_AFTER_COMPLETION", writer, completed)
	if typeof(completed) != TYPE_DICTIONARY or not _valid_result(completed, ticket, writer):
		return _protocol_failure("SAVE_CLIENT_RESULT_INVALID", writer, completed)
	if not completed["ok"]:
		return _failure("SAVE_CLIENT_HOST_REJECTED", writer, completed)
	if not _writer_succeeded(writer) or not _valid_receipt(completed["receipt"], ticket, writer, snapshot.size()):
		return _protocol_failure("SAVE_CLIENT_VERIFIED_RESULT_INVALID", writer, completed)
	return {"ok": true, "code": "SAVE_EXPECTED_BYTES_OBSERVED", "writerEvidenceSource": "GODOT_FILEACCESS_CALLER_REPORTED", "writer": writer.duplicate(true), "hostResult": completed.duplicate(true), "engineResultVerified": false, "devicePersistence": "NOT_TESTED", "durability": "NOT_PROVEN"}


func _valid_config(value: Dictionary) -> bool:
	return _keys(value, ["schema", "sessionId", "identity", "mountPath", "maxFileBytes", "maxRequests"]) and value["schema"] == "wxslim-persistent-client-config-v1" and _token(value["sessionId"]) and _identity(value["identity"]) and value["mountPath"] == "/userfs" and _integer(value["maxFileBytes"], 1, FILE_LIMIT) and _integer(value["maxRequests"], 1, 1000000)


func _valid_ticket(value: Variant, relative: String, length: int) -> bool:
	if typeof(value) != TYPE_DICTIONARY or not _keys(value, ["schema", "sessionId", "identity", "ticketId", "requestId", "relativePath", "byteLength", "generationBeforeWrite"]):
		return false
	return value["schema"] == "wxslim-persistent-ticket-v1" and value["sessionId"] == _config["sessionId"] and value["identity"] == _config["identity"] and _identity(value["identity"]) and _integer(value["ticketId"], 1, MAX_SAFE_INTEGER) and int(value["ticketId"]) > _last_ticket_id and _integer(value["requestId"], 1, int(_config["maxRequests"])) and value["relativePath"] == relative and _integer(value["byteLength"], 0, int(_config["maxFileBytes"])) and int(value["byteLength"]) == length and _integer(value["generationBeforeWrite"], 0, MAX_SAFE_INTEGER)


func _valid_result(value: Dictionary, ticket: Dictionary, writer: Dictionary) -> bool:
	if not _keys(value, ["schema", "ok", "code", "ticket", "writerEvidenceSource", "writer", "receipt", "engineResultVerified"]):
		return false
	if value["schema"] != "wxslim-persistent-client-result-v1" or typeof(value["ok"]) != TYPE_BOOL or not _token(value["code"]) or value["ticket"] != ticket:
		return false
	if value["writerEvidenceSource"] != "GODOT_FILEACCESS_CALLER_REPORTED" or typeof(value["engineResultVerified"]) != TYPE_BOOL or value["engineResultVerified"]:
		return false
	if typeof(value["writer"]) != TYPE_DICTIONARY or not _keys(value["writer"], writer.keys()):
		return false
	for key: String in writer:
		var observed: Variant = value["writer"][key]
		var original: Variant = writer[key]
		if original == null:
			if observed != null:
				return false
		elif typeof(original) == TYPE_BOOL:
			if typeof(observed) != TYPE_BOOL or observed != original:
				return false
		elif not _integer(observed, 0, 2147483647) or int(observed) != int(original):
			return false
	return true


func _writer_succeeded(value: Dictionary) -> bool:
	return value["openError"] == OK and value["storeReturned"] == true and value["storeError"] == OK and value["flushError"] == OK and value["closeError"] == OK and value["stillOpen"] == false


func _valid_receipt(value: Variant, ticket: Dictionary, writer: Dictionary, length: int) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	for key: String in ["schema", "operation", "sessionId", "identity", "requestId", "status", "code", "expectedGeneration", "generationBefore", "generationAfter", "files", "callerWriterEvidence", "nativeReadbackVerified", "engineResultVerified", "restartRecovery", "durability", "atomicity"]:
		if not value.has(key):
			return false
	if value["schema"] != "wxslim-persistent-session-v1" or value["operation"] != "VERIFY" or value["sessionId"] != ticket["sessionId"] or value["identity"] != ticket["identity"] or not _integer(value["requestId"], 1, int(_config["maxRequests"])) or int(value["requestId"]) != int(ticket["requestId"]):
		return false
	if value["status"] != "VERIFIED" or value["code"] != "SAVE_EXPECTED_BYTES_OBSERVED" or typeof(value["nativeReadbackVerified"]) != TYPE_BOOL or not value["nativeReadbackVerified"] or typeof(value["engineResultVerified"]) != TYPE_BOOL or value["engineResultVerified"]:
		return false
	if value["restartRecovery"] != "NOT_TESTED" or value["durability"] != "NOT_PROVEN" or value["atomicity"] != "NOT_PROVEN":
		return false
	for key: String in ["expectedGeneration", "generationBefore", "generationAfter"]:
		if not _integer(value[key], 0, MAX_SAFE_INTEGER):
			return false
	if value["expectedGeneration"] != value["generationBefore"] or value["generationBefore"] != value["generationAfter"] or int(value["generationBefore"]) < int(ticket["generationBeforeWrite"]):
		return false
	var evidence: Variant = value["callerWriterEvidence"]
	if typeof(evidence) != TYPE_DICTIONARY or not _keys(evidence, ["storeReturned", "storeError", "flushError", "closeError"]):
		return false
	if typeof(evidence["storeReturned"]) != TYPE_BOOL or evidence["storeReturned"] != writer["storeReturned"]:
		return false
	for key: String in ["storeError", "flushError", "closeError"]:
		if not _integer(evidence[key], 0, 2147483647) or int(evidence[key]) != int(writer[key]):
			return false
	if typeof(value["files"]) != TYPE_ARRAY or value["files"].size() != 1:
		return false
	var file: Variant = value["files"][0]
	if typeof(file) != TYPE_DICTIONARY or not _keys(file, ["id", "expectedBytes", "memoryBytes", "nativeBytes", "memoryNativeMatch", "expectedContentMatch"]) or file["id"] != "save":
		return false
	for key: String in ["expectedBytes", "memoryBytes", "nativeBytes"]:
		if not _integer(file[key], 0, int(_config["maxFileBytes"])) or int(file[key]) != length:
			return false
	return typeof(file["memoryNativeMatch"]) == TYPE_BOOL and file["memoryNativeMatch"] and typeof(file["expectedContentMatch"]) == TYPE_BOOL and file["expectedContentMatch"]


func _live(epoch: int) -> bool:
	return _active and _interface != null and epoch == _epoch


func _parse(raw: Variant) -> Variant:
	if typeof(raw) != TYPE_STRING or raw.to_utf8_buffer().size() > JSON_LIMIT:
		return null
	var parser: JSON = JSON.new()
	if parser.parse(raw) != OK:
		return null
	return parser.data


func _keys(value: Dictionary, keys: Array) -> bool:
	return value.size() == keys.size() and keys.all(func(key: Variant) -> bool: return value.has(key))


func _integer(value: Variant, minimum: int, maximum: int) -> bool:
	if typeof(value) == TYPE_INT:
		return value >= minimum and value <= maximum
	if typeof(value) != TYPE_FLOAT:
		return false
	var number: float = value
	return is_finite(number) and floorf(number) == number and number >= float(minimum) and number <= float(maximum)


func _token(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 128:
		return false
	for character: String in value:
		if not character in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-":
			return false
	return true


func _identity(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY or not _keys(value, ["packageId", "wasmSha256"]) or not _token(value["packageId"]):
		return false
	if typeof(value["wasmSha256"]) != TYPE_STRING or value["wasmSha256"].length() != 64:
		return false
	for character: String in value["wasmSha256"]:
		if not character in "0123456789abcdef":
			return false
	return true


func _relative_path(value: String) -> bool:
	if value.is_empty() or value.length() > 1024:
		return false
	for part: String in value.split("/", true):
		if part.is_empty() or part.length() > 255 or part in [".", "..", "__proto__", "prototype", "constructor"]:
			return false
		for index: int in part.length():
			var point: int = part.unicode_at(index)
			if point < 32 or point == 127 or part[index] in "\\:?#%":
				return false
	return true


func _protocol_failure(code: String, writer: Dictionary, host_response: Variant) -> Dictionary:
	invalidate()
	return _failure(code, writer, host_response)


func _failure(code: String, writer: Dictionary = {}, host_response: Variant = null) -> Dictionary:
	return {"ok": false, "code": code, "writerEvidenceSource": "GODOT_FILEACCESS_CALLER_REPORTED", "writer": writer.duplicate(true), "hostResult": host_response, "engineResultVerified": false, "devicePersistence": "NOT_TESTED", "durability": "NOT_PROVEN"}
