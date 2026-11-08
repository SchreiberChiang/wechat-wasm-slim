extends RefCounted
## Future runtime adapter helper. Not an autoload/plugin; constructing it performs no I/O.
## Fixed desktop editor 4.7.2.stable.steam.ed1daf0bf: check-only parsed; manifest/
## in-memory SHA256 checks passed (see evidence). Stage, mount, scenes and JS/WASM/WeChat NOT_RUN.
## Manifest shape is exactly {"packs": [{id, bytes, sha256, entryScene, requires}]}.
## entryScene is an explicit null for data-only packs, otherwise a canonical scene path.
## Nullable-entry revision requires fresh native syntax/memory checks.
## Only resource packs belong here. Boot-pack identity/ownership is the caller's job.
## The caller must keep one instance for one actual engine session and serialize calls.
## No ArrayBuffer conversion, downloads, JS eval, callback-return protocol or scene loading.
## All hashing and I/O below are synchronous and can disturb frame timing.
## duplicate() isolates the verified PackedByteArray from later caller changes.
## Budgets bound declared/logical bytes, NOT JS/WASM/FS/process peak memory: the
## caller's buffer, verification copy, temporary copies and staged FS may coexist.

const MAX_PACK_BYTES: int = 32 * 1024 * 1024
const MAX_SESSION_BYTES: int = 64 * 1024 * 1024
const MAX_PACKS: int = 128
const ROOT_PREFIX: String = "/wxslim-resource-packs/"

var _begin_attempted: bool = false
var _initialized: bool = false
var _session: String = ""
var _root: String = ""
var _root_claimed: bool = false
var _root_state: String = "NOT_TOUCHED"
var _records: Dictionary = {}
var _owned_bytes: Dictionary = {}
var _declared_bytes: int = 0
var _held_bytes: int = 0
var _fs_reserved_bytes: int = 0
var _dirty: bool = false
var _operation: String = ""


func begin_manifest(manifest: Dictionary, engine_session: String) -> Dictionary:
	if _begin_attempted:
		return _failure("MANIFEST_ALREADY_ATTEMPTED")
	_begin_attempted = true
	if not _valid_session(engine_session):
		return _failure("ENGINE_SESSION_INVALID")
	if not _exact_keys(manifest, ["packs"]):
		return _failure("MANIFEST_KEYS_INVALID")
	if typeof(manifest["packs"]) != TYPE_ARRAY:
		return _failure("MANIFEST_PACKS_INVALID")
	var packs: Array = manifest["packs"]
	if packs.is_empty() or packs.size() > MAX_PACKS:
		return _failure("MANIFEST_PACK_COUNT_INVALID")
	var candidate_records: Dictionary = {}
	var total: int = 0
	for value: Variant in packs:
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("MANIFEST_PACK_INVALID")
		var pack: Dictionary = value
		if not _exact_keys(pack, ["id", "bytes", "sha256", "entryScene", "requires"]):
			return _failure("MANIFEST_PACK_KEYS_INVALID")
		if typeof(pack["id"]) != TYPE_STRING or typeof(pack["sha256"]) != TYPE_STRING or not typeof(pack["entryScene"]) in [TYPE_NIL, TYPE_STRING]:
			return _failure("MANIFEST_PACK_TYPES_INVALID")
		var pack_id: String = pack["id"]
		var expected_hash: String = pack["sha256"]
		var entry_scene: Variant = pack["entryScene"]
		if not _valid_id(pack_id) or candidate_records.has(pack_id):
			return _failure("MANIFEST_PACK_ID_INVALID")
		var byte_pin: Variant = pack["bytes"]
		var expected_bytes: int = 0
		if typeof(byte_pin) == TYPE_INT:
			expected_bytes = byte_pin
			if expected_bytes < 4 or expected_bytes > MAX_PACK_BYTES:
				return _failure("MANIFEST_PIN_INVALID")
		elif typeof(byte_pin) == TYPE_FLOAT:
			# Fixed JSON parser emits double, including integer-valued JSON numbers.
			# Validate the original value before int(): no truncation or tolerance.
			var float_bytes: float = byte_pin
			if not is_finite(float_bytes) or float_bytes < 4.0 or float_bytes > float(MAX_PACK_BYTES) or floorf(float_bytes) != float_bytes:
				return _failure("MANIFEST_BYTES_INVALID")
			expected_bytes = int(float_bytes)
		else:
			return _failure("MANIFEST_BYTES_INVALID")
		if not _valid_hash(expected_hash):
			return _failure("MANIFEST_PIN_INVALID")
		if entry_scene != null and not _valid_entry(String(entry_scene)):
			return _failure("MANIFEST_ENTRY_INVALID")
		if typeof(pack["requires"]) != TYPE_ARRAY:
			return _failure("MANIFEST_REQUIRES_INVALID")
		var requires: Array[String] = []
		var raw_requires: Array = pack["requires"]
		for dependency: Variant in raw_requires:
			if typeof(dependency) != TYPE_STRING:
				return _failure("MANIFEST_REQUIRES_INVALID")
			var dependency_id: String = dependency
			if not _valid_id(dependency_id) or dependency_id == pack_id or requires.has(dependency_id):
				return _failure("MANIFEST_REQUIRES_INVALID")
			requires.append(dependency_id)
		total += expected_bytes
		if total > MAX_SESSION_BYTES:
			return _failure("MANIFEST_DECLARED_BUDGET_EXCEEDED")
		candidate_records[pack_id] = {
			"id": pack_id, "bytes": expected_bytes, "sha256": expected_hash,
			"entryScene": entry_scene, "requires": requires,
			"state": "DECLARED", "fileState": "NOT_TOUCHED",
			"mountState": "NOT_ATTEMPTED", "mountCalls": 0,
			"lastError": "", "fileResiduePossible": false
		}
	for key: Variant in candidate_records:
		var record: Dictionary = candidate_records[key]
		var dependencies: Array = record["requires"]
		for dependency: String in dependencies:
			if not candidate_records.has(dependency):
				return _failure("MANIFEST_DEPENDENCY_NOT_ALLOWLISTED")
	var marks: Dictionary = {}
	for key: Variant in candidate_records:
		if not _visit_dependency(String(key), candidate_records, marks):
			return _failure("MANIFEST_DEPENDENCY_CYCLE")
	_session = engine_session
	_root = ROOT_PREFIX + engine_session
	_records = candidate_records
	_declared_bytes = total
	_initialized = true
	return {"ok": true, "code": "MANIFEST_ACCEPTED", "summary": state_summary()}


func verify_bytes(pack_id: String, bytes: PackedByteArray) -> Dictionary:
	var blocked: Dictionary = _guard(pack_id)
	if not blocked.is_empty():
		return blocked
	var record: Dictionary = _records[pack_id]
	var current: String = record["state"]
	if current not in ["DECLARED", "VERIFIED", "STAGED_VERIFIED", "MOUNTED"]:
		return _failure("PACK_FAILED_NO_RETRY")
	var expected_bytes: int = record["bytes"]
	if bytes.size() != expected_bytes:
		return _reject_verify(pack_id, "VERIFY_LENGTH_MISMATCH", current == "DECLARED")
	_operation = "VERIFYING"
	# Already-successful requests must still match the pin, but never replace the
	# owned snapshot, staged file or mount. There is no implicit content update.
	if current != "DECLARED":
		var repeated_hash: Dictionary = _hash_bytes(bytes)
		_operation = ""
		if not repeated_hash["ok"]:
			return repeated_hash
		if repeated_hash["sha256"] != record["sha256"]:
			return _failure("VERIFY_HASH_MISMATCH")
		return _pack_success(pack_id, "ALREADY_VERIFIED")
	if _held_bytes + expected_bytes > MAX_SESSION_BYTES:
		_operation = ""
		return _reject_verify(pack_id, "VERIFY_HELD_BUDGET_EXCEEDED", true)
	var snapshot: PackedByteArray = bytes.duplicate()
	var computed: Dictionary = _hash_bytes(snapshot)
	if not computed["ok"]:
		_operation = ""
		return _reject_verify(pack_id, String(computed["code"]), true)
	if computed["sha256"] != record["sha256"]:
		_operation = ""
		return _reject_verify(pack_id, "VERIFY_HASH_MISMATCH", true)
	_owned_bytes[pack_id] = snapshot
	_held_bytes += snapshot.size()
	record["verifiedBytes"] = snapshot.size()
	record["verifiedSha256"] = computed["sha256"]
	record["state"] = "VERIFIED"
	_operation = ""
	return _pack_success(pack_id, "VERIFIED")


func stage_verified(pack_id: String) -> Dictionary:
	var blocked: Dictionary = _guard(pack_id)
	if not blocked.is_empty():
		return blocked
	var record: Dictionary = _records[pack_id]
	var current: String = record["state"]
	if current in ["STAGED_VERIFIED", "MOUNTED"]:
		return _pack_success(pack_id, "ALREADY_STAGED")
	if current != "VERIFIED" or not _owned_bytes.has(pack_id):
		return _failure("STAGE_REQUIRES_VERIFIED_BYTES")
	var expected_bytes: int = record["bytes"]
	if _fs_reserved_bytes + expected_bytes > MAX_SESSION_BYTES:
		return _stage_failure(pack_id, "STAGE_FS_BUDGET_EXCEEDED", false)
	_operation = "STAGING"
	if not _root_claimed:
		if DirAccess.dir_exists_absolute(_root) or FileAccess.file_exists(_root):
			_root_state = "PREEXISTING_NOT_OWNED"
			return _stage_failure(pack_id, "SESSION_ROOT_ALREADY_EXISTS", false)
		_root_state = "UNKNOWN_OR_PARTIAL"
		var mkdir_error: int = DirAccess.make_dir_recursive_absolute(_root)
		if mkdir_error != OK:
			return _stage_failure(pack_id, "SESSION_ROOT_CREATE_FAILED", false, mkdir_error)
		_root_claimed = true
		_root_state = "OWNED_DIRECTORY"
	var file_path: String = _pack_path(pack_id)
	if FileAccess.file_exists(file_path) or DirAccess.dir_exists_absolute(file_path):
		return _stage_failure(pack_id, "STAGE_PATH_ALREADY_EXISTS", true)
	var snapshot: PackedByteArray = _owned_bytes[pack_id]
	# A failed attempt retains a pessimistic reservation and residue marker.
	_fs_reserved_bytes += expected_bytes
	record["state"] = "STAGING"
	record["fileState"] = "UNKNOWN_OR_PARTIAL"
	record["fileResiduePossible"] = true
	var output: FileAccess = FileAccess.open(file_path, FileAccess.WRITE)
	if output == null:
		return _stage_failure(pack_id, "STAGE_OPEN_FAILED", true, FileAccess.get_open_error())
	var stored: bool = output.store_buffer(snapshot)
	output.flush()
	var write_error: int = output.get_error()
	var observed_length: int = output.get_length()
	output.close()  # void API: close success cannot be inferred from a return code.
	var still_open: bool = output.is_open()
	if not stored or write_error != OK or observed_length != expected_bytes or still_open:
		return _stage_failure(pack_id, "STAGE_WRITE_OR_CLOSE_FAILED", true, write_error)
	var checked: Dictionary = _check_staged_file(pack_id)
	if not checked["ok"]:
		return _stage_failure(pack_id, String(checked["code"]), true)
	record["stagedSha256"] = checked["sha256"]
	record["stagedBytes"] = checked["bytes"]
	record["state"] = "STAGED_VERIFIED"
	record["fileState"] = "VERIFIED_READBACK"
	_release_owned(pack_id)
	snapshot = PackedByteArray()
	_operation = ""
	return _pack_success(pack_id, "STAGED_VERIFIED")


func mount_verified(pack_id: String) -> Dictionary:
	var blocked: Dictionary = _guard(pack_id)
	if not blocked.is_empty():
		return blocked
	var record: Dictionary = _records[pack_id]
	if record["state"] == "MOUNTED":
		return _pack_success(pack_id, "ALREADY_MOUNTED")
	if record["state"] != "STAGED_VERIFIED":
		return _failure("MOUNT_REQUIRES_STAGED_VERIFICATION")
	var dependencies: Array = record["requires"]
	for dependency: String in dependencies:
		var dependency_record: Dictionary = _records[dependency]
		if dependency_record["state"] != "MOUNTED":
			return _failure("MOUNT_DEPENDENCY_NOT_MOUNTED")
	_operation = "MOUNT_CHECK"
	var checked: Dictionary = _check_staged_file(pack_id)
	if not checked["ok"]:
		return _stage_failure(pack_id, String(checked["code"]), true)
	# Mount is not transactional. Any failure may have changed global resource
	# indices; dirty stays latched and ALL later mutating methods are blocked.
	_operation = "MOUNTING"
	_dirty = true
	record["state"] = "UNKNOWN_DIRTY"
	record["mountState"] = "UNKNOWN_DIRTY"
	record["mountCalls"] = 1
	var mounted: bool = ProjectSettings.load_resource_pack(_pack_path(pack_id), false)
	_operation = ""
	if not mounted:
		record["state"] = "MOUNT_FAILED"
		record["lastError"] = "MOUNT_FAILED_UNKNOWN_DIRTY"
		return _failure("MOUNT_FAILED_UNKNOWN_DIRTY")
	record["state"] = "MOUNTED"
	record["mountState"] = "MOUNTED"
	_dirty = false
	return _pack_success(pack_id, "MOUNTED")


func allowed_entry(pack_id: String) -> Dictionary:
	var blocked: Dictionary = _guard(pack_id)
	if not blocked.is_empty():
		return blocked
	var record: Dictionary = _records[pack_id]
	if record["entryScene"] == null:
		return _failure("ENTRY_SCENE_NOT_DECLARED")
	if record["state"] != "MOUNTED":
		return _failure("ENTRY_REQUIRES_MOUNTED_PACK")
	return {"ok": true, "code": "ENTRY_ALLOWLISTED_ONLY", "entryScene": record["entryScene"],
		"existsVerified": false, "packedSceneVerified": false, "sceneLoadAttempted": false}


func state_summary() -> Dictionary:
	var packs: Array[Dictionary] = []
	var ids: Array = _records.keys()
	ids.sort()
	for key: Variant in ids:
		var record: Dictionary = _records[key]
		packs.append(record.duplicate(true))
	return {"schema": "wxslim-godot-resource-session-v1", "initialized": _initialized,
		"engineSession": _session, "operation": _operation, "dirty": _dirty,
		"managedRootState": _root_state,
		"declaredBytes": _declared_bytes, "heldVerifiedBytes": _held_bytes,
		"fsReservedUpperBoundBytes": _fs_reserved_bytes, "packs": packs,
		"rollbackPerformed": false, "sceneLoadAttempted": false,
		"scope": "Hash pins, managed FS staging and mount result only; no PCK structure/dependency completeness, scene or device acceptance.",
		"memoryScope": "Tool logical budgets only; external JS buffers, duplicate/temporary storage, allocator overhead and FS residency are not a process peak limit."}


func _hash_bytes(bytes: PackedByteArray) -> Dictionary:
	var hasher: HashingContext = HashingContext.new()
	var start_error: int = hasher.start(HashingContext.HASH_SHA256)
	if start_error != OK:
		return _failure("HASH_START_FAILED", start_error)
	var update_error: int = hasher.update(bytes)
	if update_error != OK:
		return _failure("HASH_UPDATE_FAILED", update_error)
	var digest: PackedByteArray = hasher.finish()
	if digest.size() != 32:
		return _failure("HASH_FINISH_FAILED")
	var result: String = digest.hex_encode()
	if not _valid_hash(result):
		return _failure("HASH_RESULT_INVALID")
	return {"ok": true, "sha256": result}


func _check_staged_file(pack_id: String) -> Dictionary:
	var record: Dictionary = _records[pack_id]
	var file_path: String = _pack_path(pack_id)
	var input: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if input == null:
		return _failure("STAGE_READBACK_OPEN_FAILED", FileAccess.get_open_error())
	var observed_bytes: int = input.get_length()
	var read_error: int = input.get_error()
	input.close()
	if input.is_open() or read_error != OK or observed_bytes != int(record["bytes"]):
		return _failure("STAGE_READBACK_LENGTH_FAILED", read_error)
	var digest: String = FileAccess.get_sha256(file_path)
	if not _valid_hash(digest) or digest != record["sha256"]:
		return _failure("STAGE_READBACK_HASH_FAILED")
	return {"ok": true, "bytes": observed_bytes, "sha256": digest}


func _guard(pack_id: String) -> Dictionary:
	if not _initialized:
		return _failure("SESSION_NOT_INITIALIZED")
	if _dirty:
		return _failure("SESSION_DIRTY_FRESH_ENGINE_REQUIRED")
	if not _operation.is_empty():
		return _failure("SESSION_BUSY")
	if not _valid_id(pack_id) or not _records.has(pack_id):
		return _failure("PACK_NOT_ALLOWLISTED")
	return {}


func _reject_verify(pack_id: String, code: String, fail_first_attempt: bool) -> Dictionary:
	if fail_first_attempt:
		var record: Dictionary = _records[pack_id]
		record["state"] = "VERIFY_FAILED"
		record["lastError"] = code
	return _failure(code)


func _stage_failure(pack_id: String, code: String, residue_possible: bool, engine_error: int = -1) -> Dictionary:
	var record: Dictionary = _records[pack_id]
	record["state"] = "STAGE_FAILED"
	record["lastError"] = code
	record["fileResiduePossible"] = residue_possible
	if residue_possible:
		record["fileState"] = "UNKNOWN_OR_PARTIAL"
	_dirty = true
	_operation = ""
	return _failure(code, engine_error)


func _release_owned(pack_id: String) -> void:
	if _owned_bytes.has(pack_id):
		var bytes: PackedByteArray = _owned_bytes[pack_id]
		_held_bytes -= bytes.size()
		_owned_bytes.erase(pack_id)


func _pack_success(pack_id: String, code: String) -> Dictionary:
	var record: Dictionary = _records[pack_id]
	return {"ok": true, "code": code, "pack": record.duplicate(true)}


func _failure(code: String, engine_error: int = -1) -> Dictionary:
	var result: Dictionary = {"ok": false, "code": code}
	if engine_error >= 0:
		result["engineError"] = engine_error
	return result


func _pack_path(pack_id: String) -> String:
	var record: Dictionary = _records[pack_id]
	return _root + "/" + pack_id + "-" + String(record["sha256"]) + ".pck"


func _exact_keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key: Variant in expected:
		if not value.has(key):
			return false
	return true


func _valid_id(value: String) -> bool:
	if value.is_empty() or value.length() > 48 or value.unicode_at(0) < 97 or value.unicode_at(0) > 122:
		return false
	for index: int in range(value.length()):
		var code: int = value.unicode_at(index)
		if not ((code >= 97 and code <= 122) or (code >= 48 and code <= 57) or code == 45 or code == 95):
			return false
	return true


func _valid_session(value: String) -> bool:
	if value.length() < 8 or value.length() > 64:
		return false
	for index: int in range(value.length()):
		var code: int = value.unicode_at(index)
		if not ((code >= 97 and code <= 122) or (code >= 48 and code <= 57) or code == 45 or code == 95):
			return false
	return true


func _valid_hash(value: String) -> bool:
	if value.length() != 64:
		return false
	for index: int in range(value.length()):
		var code: int = value.unicode_at(index)
		if not ((code >= 48 and code <= 57) or (code >= 97 and code <= 102)):
			return false
	return true


func _valid_entry(value: String) -> bool:
	if not value.begins_with("res://") or value.length() > 1024:
		return false
	if not (value.ends_with(".tscn") or value.ends_with(".scn")):
		return false
	var relative: String = value.substr(6)
	for index: int in range(relative.length()):
		var code: int = relative.unicode_at(index)
		if code < 32 or (code >= 127 and code <= 159) or code == 65279 or code == 58 or code == 92:
			return false
	for part: String in relative.split("/", true):
		if part.is_empty() or part == "." or part == "..":
			return false
	return true


func _visit_dependency(pack_id: String, records: Dictionary, marks: Dictionary) -> bool:
	var mark: int = int(marks.get(pack_id, 0))
	if mark == 1:
		return false
	if mark == 2:
		return true
	marks[pack_id] = 1
	var record: Dictionary = records[pack_id]
	var dependencies: Array = record["requires"]
	for dependency: String in dependencies:
		if not _visit_dependency(dependency, records, marks):
			return false
	marks[pack_id] = 2
	return true
