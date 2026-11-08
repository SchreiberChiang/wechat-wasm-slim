extends Control
## Thin FileAccess test only. No custom storage protocol, mkdir or deletion.
## No I/O at startup. Select either one write run or one previous-session read.
var _button: Button
var _previous_button: Button
var _previous_input: LineEdit
var _output: TextEdit
var _observer: JavaScriptObject
var _prefix: String
var _used := false
var _reference := "UNKNOWN"
var _sequence := 0
var _mode := "NOT_SELECTED"
var _previous_reference := "NONE"

func _ready() -> void:
	var margin := MarginContainer.new()
	add_child(margin)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 24)
	margin.add_theme_constant_override("margin_right", 24)
	margin.add_theme_constant_override("margin_top", 96)
	margin.add_theme_constant_override("margin_bottom", 24)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	margin.add_child(box)
	var title := Label.new()
	title.text = "Storage check\nChoose one action; failures stop.\nOld read does not prove restart."
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.add_theme_font_size_override("font_size", 24)
	box.add_child(title)
	_button = Button.new()
	_button.text = "Run storage check once"
	_button.custom_minimum_size.y = 88
	_button.add_theme_font_size_override("font_size", 28)
	_button.pressed.connect(_run_once)
	box.add_child(_button)
	_previous_input = LineEdit.new()
	_previous_input.placeholder_text = "Paste previous ref from a completed write"
	_previous_input.custom_minimum_size.y = 64
	_previous_input.add_theme_font_size_override("font_size", 20)
	box.add_child(_previous_input)
	_previous_button = Button.new()
	_previous_button.text = "Read previous session only"
	_previous_button.custom_minimum_size.y = 88
	_previous_button.add_theme_font_size_override("font_size", 28)
	_previous_button.pressed.connect(_read_previous_once)
	box.add_child(_previous_button)
	_output = TextEdit.new()
	_output.editable = false
	_output.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_output.add_theme_font_size_override("font_size", 20)
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_output)

func _record(step: String, ok: bool, details: Variant) -> bool:
	_sequence += 1
	var line := "[STORAGE_CHECK] " + JSON.stringify({"ref": _reference, "currentRef": _reference, "previousRef": _previous_reference, "mode": _mode, "writePerformed": false if _mode == "READ_PREVIOUS" else null, "seq": _sequence, "step": step, "expectedSatisfied": ok, "details": details, "restartRecovery": "NOT_PROVEN_BY_READBACK" if _mode == "READ_PREVIOUS" else "NOT_TESTED"})
	print(line)
	_output.text += line + "\n"
	return ok

func _run_once() -> void:
	if _used:
		return
	_used = true
	_mode = "WRITE_CURRENT"
	_button.disabled = true
	_previous_button.disabled = true
	_previous_input.editable = false
	if not OS.has_feature("web"):
		_record("environment", false, "Requires the packaged WeChat web runtime.")
		return
	_observer = JavaScriptBridge.get_interface("UpstreamStorageObservation")
	if _observer == null:
		_record("environment", false, "OBSERVATION_INTERFACE_MISSING")
		return
	var identity: Variant = JSON.parse_string(str(_observer.begin()))
	if typeof(identity) != TYPE_DICTIONARY or identity.get("schema") != "wxslim-upstream-storage-observation-v1":
		_record("environment", false, "IDENTITY_NOT_READY")
		return
	_reference = str(identity.get("ref", "UNKNOWN"))
	_prefix = "user://" + str(identity.get("filePrefix", ""))
	if not _record("environment", ProjectSettings.globalize_path("user://") == identity.get("userRoot"), identity):
		return
	for suffix: String in ["empty", "bytes", "grow", "truncate", "missing"]:
		var target := _prefix + suffix + ".bin"
		if FileAccess.file_exists(target) or DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(target)):
			_record("unique_files", false, suffix)
			return
	if not _write("empty", PackedByteArray()):
		return
	if not _write("bytes", PackedByteArray([0, 255, 128, 195, 169, 0, 10, 42])):
		return
	if not _write("bytes", PackedByteArray([0, 231])):
		return
	if not _write("grow", PackedByteArray([1, 2, 3, 4, 5]), true):
		return
	if not _write("truncate", PackedByteArray([1, 2, 3])) or not _write("truncate", PackedByteArray()):
		return
	var missing := FileAccess.open(_prefix + "missing.bin/absent.bin", FileAccess.WRITE)
	var open_error := FileAccess.get_open_error()
	if missing != null:
		missing.close()
	if not _record("missing_parent", missing == null and open_error != OK, {"openError": open_error, "opened": missing != null}):
		return
	_record("complete", true, "Empty files: metadata checked. Nonempty files: bytes match. Restart and durability untested.")

func _read_previous_once() -> void:
	if _used:
		return
	_used = true
	_mode = "READ_PREVIOUS"
	_button.disabled = true
	_previous_button.disabled = true
	_previous_input.editable = false
	if not OS.has_feature("web"):
		_record("environment", false, "Requires the packaged WeChat web runtime.")
		return
	_observer = JavaScriptBridge.get_interface("UpstreamStorageObservation")
	if _observer == null:
		_record("environment", false, "OBSERVATION_INTERFACE_MISSING")
		return
	var identity: Variant = JSON.parse_string(str(_observer.begin()))
	if typeof(identity) != TYPE_DICTIONARY or identity.get("schema") != "wxslim-upstream-storage-observation-v1":
		_record("environment", false, "IDENTITY_NOT_READY")
		return
	var current: Dictionary = _parse_reference(identity.get("ref"))
	if current.is_empty() or current.get("packageId") != identity.get("packageId") or current.get("session") != identity.get("session"):
		_record("environment", false, "CURRENT_REFERENCE_INVALID")
		return
	_reference = identity.get("ref")
	if not _record("environment", typeof(identity.get("userRoot")) == TYPE_STRING and ProjectSettings.globalize_path("user://") == identity.get("userRoot"), identity):
		return
	var requested_ref: String = _previous_input.text
	var description: Variant = JSON.parse_string(str(_observer.describePrevious(requested_ref)))
	if not _previous_description_matches(description, _reference, requested_ref, identity.get("userRoot")):
		_record("previous_target", false, description)
		return
	_previous_reference = requested_ref
	_prefix = "user://" + description.get("filePrefix")
	_record("previous_target", true, description)
	if not _read_previous_file("empty", PackedByteArray()):
		return
	if not _read_previous_file("bytes", PackedByteArray([0, 231])):
		return
	if not _read_previous_file("grow", PackedByteArray([1, 2, 3, 4, 5])):
		return
	if not _read_previous_file("truncate", PackedByteArray()):
		return
	_record("complete", true, "Previous files read only. Empty: metadata. Nonempty: exact bytes. A real restart is not proven by readback.")

func _reference_token(value: String, alphabet: String, maximum: int) -> bool:
	if value.is_empty() or value.length() > maximum:
		return false
	for index: int in range(value.length()):
		if not alphabet.contains(value.substr(index, 1)):
			return false
	return true

func _parse_reference(value: Variant) -> Dictionary:
	if typeof(value) != TYPE_STRING or value.length() > 77:
		return {}
	var parts: PackedStringArray = value.split("#")
	if parts.size() != 2 or parts[0].length() != 27 or not parts[0].begins_with("wxslim-"):
		return {}
	if not _reference_token(parts[0].substr(7), "0123456789abcdef", 20):
		return {}
	var session: PackedStringArray = parts[1].split("-")
	if session.size() != 2:
		return {}
	for token: String in session:
		if not _reference_token(token, "0123456789abcdefghijklmnopqrstuvwxyz", 24):
			return {}
	return {"packageId": parts[0], "session": parts[1]}

func _previous_link_matches(value: Variant, current_ref: String, previous_ref: String) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	for key: String in ["currentRef", "previousRef", "referenceSource", "restartRecovery"]:
		if typeof(value.get(key)) != TYPE_STRING:
			return false
	if value.get("currentRef") != current_ref or value.get("previousRef") != previous_ref:
		return false
	if value.get("referenceSource") != "explicit_input" or value.get("restartRecovery") != "NOT_PROVEN_BY_READBACK":
		return false
	return typeof(value.get("writePerformed")) == TYPE_BOOL and value.get("writePerformed") == false

func _previous_description_matches(value: Variant, current_ref: String, previous_ref: String, user_root: String) -> bool:
	if not _previous_link_matches(value, current_ref, previous_ref):
		return false
	var current: Dictionary = _parse_reference(current_ref)
	var previous: Dictionary = _parse_reference(previous_ref)
	if current.is_empty() or previous.is_empty() or current.get("packageId") != previous.get("packageId") or current.get("session") == previous.get("session"):
		return false
	if typeof(value.get("ok")) != TYPE_BOOL or value.get("ok") != true:
		return false
	if typeof(value.get("code")) != TYPE_STRING or value.get("code") != "PREVIOUS_TARGET_ACCEPTED":
		return false
	for key: String in ["samePackage", "previousSessionDifferent"]:
		if typeof(value.get(key)) != TYPE_BOOL or value.get(key) != true:
			return false
	if typeof(value.get("userRoot")) != TYPE_STRING or value.get("userRoot") != user_root:
		return false
	return typeof(value.get("filePrefix")) == TYPE_STRING and value.get("filePrefix") == "probe-" + previous.get("session") + "-"

func _read_previous_file(suffix: String, expected: PackedByteArray) -> bool:
	var reader := FileAccess.open(_prefix + suffix + ".bin", FileAccess.READ)
	# readPerformed below describes explicit get_buffer, not backend lazy loading.
	var observed := {"openError": FileAccess.get_open_error(), "length": null, "lengthError": null, "readPerformed": false, "readError": null, "closeError": null}
	if reader == null:
		return _record(suffix, false, observed)
	if observed["openError"] != OK:
		reader.close()
		observed["closeError"] = reader.get_error()
		return _record(suffix, false, observed)
	var length: int = reader.get_length()
	observed["length"] = length
	observed["lengthError"] = reader.get_error()
	if observed["lengthError"] != OK or length < 0 or length > 32 or length != expected.size():
		reader.close()
		observed["closeError"] = reader.get_error()
		return _record(suffix, false, observed)
	var content_matches: bool = true
	if not expected.is_empty():
		var actual: PackedByteArray = reader.get_buffer(length)
		observed["readPerformed"] = true
		observed["readError"] = reader.get_error()
		observed["bytes"] = Array(actual)
		content_matches = observed["readError"] == OK and actual.size() == expected.size() and actual == expected
	reader.close()
	observed["closeError"] = reader.get_error()
	if not content_matches or observed["closeError"] != OK:
		return _record(suffix, false, observed)
	var native: Variant = JSON.parse_string(str(_observer.readPrevious(_previous_reference, suffix)))
	observed["native"] = native
	return _record(suffix, _previous_read_matches(native, _reference, _previous_reference, suffix, expected), observed)

func _previous_read_matches(native: Variant, current_ref: String, previous_ref: String, suffix: String, expected: PackedByteArray) -> bool:
	return _previous_link_matches(native, current_ref, previous_ref) and typeof(native.get("suffix")) == TYPE_STRING and native.get("suffix") == suffix and _native_bytes_match(native, expected)

func _native_size_matches(value: Variant, expected_length: int) -> bool:
	if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
		return false
	if typeof(value) == TYPE_FLOAT and (not is_finite(value) or floor(value) != value):
		return false
	return value >= 0 and value <= 32 and value == expected_length

func _native_bytes_match(native: Variant, expected: PackedByteArray) -> bool:
	if typeof(native) != TYPE_DICTIONARY:
		return false
	if typeof(native.get("ok")) != TYPE_BOOL or native.get("ok") != true:
		return false
	if typeof(native.get("code")) != TYPE_STRING or typeof(native.get("evidence")) != TYPE_STRING:
		return false
	if typeof(native.get("readPerformed")) != TYPE_BOOL:
		return false
	if not _native_size_matches(native.get("byteLength"), expected.size()):
		return false
	for key: String in ["before", "after"]:
		var metadata: Variant = native.get(key)
		if typeof(metadata) != TYPE_DICTIONARY:
			return false
		if typeof(metadata.get("isFile")) != TYPE_BOOL or metadata.get("isFile") != true:
			return false
		if not _native_size_matches(metadata.get("byteLength"), expected.size()):
			return false
	if expected.is_empty():
		return native.get("code") == "EMPTY_FILE_METADATA_VERIFIED" and native.get("evidence") == "file_metadata" and native.get("readPerformed") == false and not native.has("bytes")
	if native.get("code") != "NATIVE_BYTES_OBSERVED" or native.get("evidence") != "file_bytes" or native.get("readPerformed") != true:
		return false
	var actual: Variant = native.get("bytes")
	if typeof(actual) != TYPE_ARRAY or actual.size() != expected.size():
		return false
	for index: int in range(expected.size()):
		var value: Variant = actual[index]
		if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
			return false
		if typeof(value) == TYPE_FLOAT and (not is_finite(value) or floor(value) != value):
			return false
		if value < 0 or value > 255 or value != expected[index]:
			return false
	return true

func _write(suffix: String, expected: PackedByteArray, split_write := false) -> bool:
	var writer := FileAccess.open(_prefix + suffix + ".bin", FileAccess.WRITE)
	var observed := {"openError": FileAccess.get_open_error()}
	if writer == null:
		return _record(suffix, false, observed)
	var stored := true
	if split_write:
		stored = writer.store_buffer(expected.slice(0, 4))
		if stored:
			stored = writer.store_buffer(expected.slice(4))
	else:
		stored = writer.store_buffer(expected)
	observed["storeReturned"] = stored
	observed["storeError"] = writer.get_error()
	writer.flush()
	observed["flushError"] = writer.get_error()
	writer.close()
	observed["closeError"] = writer.get_error()
	var native: Variant = JSON.parse_string(str(_observer.readback(suffix)))
	observed["native"] = native
	var ok: bool = stored and observed["openError"] == OK and observed["storeError"] == OK and observed["flushError"] == OK and observed["closeError"] == OK
	ok = ok and _native_bytes_match(native, expected)
	return _record(suffix, ok, observed)
