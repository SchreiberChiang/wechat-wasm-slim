extends SceneTree
## Native PCK verifier source: fixed editor check-only passed 2026-11-04.
## Export, pack mounting and fixture execution remain NOT_RUN.
## Launch with boot: --main-pack BOOT --path EMPTY_RUN --script ABS_EXTERNAL_SCRIPT
## -- CONFIG_ABSOLUTE CONFIG_SHA256. No editor/import/export or filesystem writes.
## Loads/instantiates only the controlled fixture; never adds it to the tree.
## Native reader evidence only, not WX helper/JSBridge/WASM/GLX/device acceptance.
const MAX_CONFIG: int = 256 * 1024
const MAX_PACK: int = 32 * 1024 * 1024
const MAX_TOTAL: int = 64 * 1024 * 1024
var _checks: Array[Dictionary] = []
var _failures: Array[String] = []
var _observations: Array[Dictionary] = []
var _config: Dictionary = {}
var _packs: Dictionary = {}
var _owners: Dictionary = {}
var _verified_entries: Dictionary = {}
var _mode: String = ""

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var arguments: PackedStringArray = OS.get_cmdline_user_args()
	if not _check(arguments.size() == 2, "ARGUMENT_COUNT"):
		_finish("FAILED", 1)
		return
	if not _check(_absolute(arguments[0]) and _hash(arguments[1]), "CONFIG_ARGUMENTS"):
		_finish("FAILED", 1)
		return
	for argument: String in OS.get_cmdline_args():
		if argument in ["--editor", "-e", "--import"] or argument.begins_with("--export"):
			_check(false, "EDITOR_IMPORT_EXPORT_FORBIDDEN")
	if not _failures.is_empty():
		_finish("FAILED", 1)
		return
	var config_file: FileAccess = FileAccess.open(arguments[0], FileAccess.READ)
	if not _check(config_file != null, "CONFIG_OPEN"):
		_finish("FAILED", 1)
		return
	var config_length: int = config_file.get_length()
	if not _check(config_length > 0 and config_length <= MAX_CONFIG, "CONFIG_SIZE"):
		config_file.close()
		_finish("FAILED", 1)
		return
	var raw: PackedByteArray = config_file.get_buffer(config_length)
	var read_error: Error = config_file.get_error()
	config_file.close()
	var digest: String = FileAccess.get_sha256(arguments[0])
	_observations.append({"kind": "config", "file": arguments[0], "bytes": raw.size(), "sha256": digest})
	if not _check(raw.size() == config_length and read_error == OK and digest == arguments[1], "CONFIG_PIN"):
		_finish("FAILED", 1)
		return
	# Hash the same bytes that will be parsed, avoiding a hash/read replacement race.
	var hasher: HashingContext = HashingContext.new()
	if not _check(hasher.start(HashingContext.HASH_SHA256) == OK and hasher.update(raw) == OK, "CONFIG_HASH_START_UPDATE"):
		_finish("FAILED", 1)
		return
	var raw_hash: PackedByteArray = hasher.finish()
	if not _check(raw_hash.size() == 32 and raw_hash.hex_encode() == arguments[1], "CONFIG_READ_BYTES_PIN"):
		_finish("FAILED", 1)
		return
	var parser: JSON = JSON.new()
	if not _check(parser.parse(raw.get_string_from_utf8()) == OK and typeof(parser.data) == TYPE_DICTIONARY, "CONFIG_JSON"):
		_finish("FAILED", 1)
		return
	_config = parser.data
	if not _validate_config():
		_finish("FAILED", 1)
		return
	_mode = _config["mode"]
	# Fixed source main.cpp:1763/1859 consumes --path/--main-pack before
	# :2245 set_cmdline(execpath, main_args, user_args). This is NOT a full argv receipt.
	# The outer owned-process args/PID record remains authoritative for consumed flags.
	var engine_arguments: PackedStringArray = OS.get_cmdline_args()
	var main_packs: Array[String] = []
	var roots: Array[String] = []
	for index: int in engine_arguments.size():
		if engine_arguments[index] in ["--main-pack", "--path"]:
			var argument_value: String = engine_arguments[index + 1] if index + 1 < engine_arguments.size() else ""
			if engine_arguments[index] == "--main-pack":
				main_packs.append(argument_value)
			else:
				roots.append(argument_value)
	_observations.append({"kind": "engineArguments", "engineArgs": engine_arguments,
		"scope": "PARAMETERS_MAY_BE_CONSUMED_USE_OUTER_PROCESS_RECEIPT",
		"mainPackParameterObserved": not main_packs.is_empty(), "pathParameterObserved": not roots.is_empty()})
	if not main_packs.is_empty():
		_check(main_packs.size() == 1 and _absolute(main_packs[0]) and _normalize(main_packs[0]) == _normalize(_packs["boot"]["file"]), "OBSERVED_BOOT_ARGUMENT_UNIQUE_MATCH")
	if not roots.is_empty():
		_check(roots.size() == 1 and _absolute(roots[0]) and _normalize(roots[0]) == _normalize(_config["runRoot"]), "OBSERVED_PATH_ARGUMENT_UNIQUE_MATCH")
	var cwd_access: DirAccess = DirAccess.open(".")
	if not _check(cwd_access != null, "FILESYSTEM_CWD_READ"):
		_finish("FAILED", 1)
		return
	var actual_cwd: String = cwd_access.get_current_dir()
	# project_settings.cpp:689–704 returns after explicit main-pack setup;
	# resource_path may stay empty. :266–272 globalize_path then strips res://.
	var resource_root: String = ProjectSettings.globalize_path("res://")
	_observations.append({"kind": "roots", "resourceRoot": resource_root, "actualCwd": actual_cwd, "requestedRunRoot": _config["runRoot"], "editorHint": Engine.is_editor_hint()})
	_check(_normalize(actual_cwd) == _normalize(_config["runRoot"]), "FILESYSTEM_CWD_IS_RUN_ROOT")
	_check(resource_root.is_empty() or _normalize(resource_root) == _normalize(_config["runRoot"]), "RESOURCE_ROOT_EMPTY_OR_RUN_ROOT")
	if not _failures.is_empty():
		_finish("FAILED", 1)
		return
	_check(not FileAccess.file_exists(_config["sourceSentinel"]), "SOURCE_SENTINEL_NOT_VISIBLE")
	_check(not FileAccess.file_exists("res://project.godot") or _owners.has("project.godot"), "NO_UNOWNED_PROJECT_SOURCE")
	for id: String in ["boot", "shared", "level"]:
		var pack: Dictionary = _packs[id]
		_check_file(pack["file"], int(pack["bytes"]), pack["sha256"], "PACK_" + id.to_upper())
	_check_visible("boot")
	if _owners.has("boot.tscn") or _owners.has("boot.tscn.remap"):
		_check_scene_mapping("res://boot.tscn", "boot")
	_check_missing("shared")
	_check_missing("level")
	if not _failures.is_empty():
		_finish("FAILED", 1)
		return
	if _mode == "boot_only":
		_finish("EXPECTED_BOOT_ONLY_MISSING", 0)
		return
	if _mode == "normal":
		if not _check(ProjectSettings.load_resource_pack(_packs["shared"]["file"], false), "MOUNT_SHARED_FALSE"):
			_finish("FAILED_UNKNOWN_MOUNT_EFFECTS", 1)
			return
		_check_visible("shared")
		_import_metadata()
		_check_missing("level")
		if not _failures.is_empty():
			_finish("FAILED", 1)
			return
	if not _check(ProjectSettings.load_resource_pack(_packs["level"]["file"], false), "MOUNT_LEVEL_FALSE"):
		_finish("FAILED_UNKNOWN_MOUNT_EFFECTS", 1)
		return
	_check_visible("level")
	_check_scene_mapping(_config["level"]["entry"], "level")
	if not _failures.is_empty():
		_finish("FAILED", 1)
		return
	var level: Dictionary = _config["level"]
	var scene_resource: Resource = ResourceLoader.load(level["entry"], "PackedScene", ResourceLoader.CACHE_MODE_IGNORE_DEEP)
	if _mode == "missing_shared":
		_check_missing("shared")
		var missing_texture: Resource = ResourceLoader.load(level["texturePath"], "Texture2D", ResourceLoader.CACHE_MODE_IGNORE_DEEP)
		_observations.append({"kind": "negativeControl", "sceneReturned": scene_resource != null,
			"sceneType": scene_resource.get_class() if scene_resource != null else "", "textureReturned": missing_texture != null})
		_check(scene_resource == null or scene_resource is PackedScene, "NEGATIVE_SCENE_TYPE")
		_check(missing_texture == null, "NEGATIVE_IMPORTED_TEXTURE_UNAVAILABLE")
		_finish("EXPECTED_SHARED_DEPENDENCY_MISSING" if _failures.is_empty() else "FAILED", 0 if _failures.is_empty() else 1)
		return
	if not _check(scene_resource is PackedScene, "EXPECTED_PACKED_SCENE"):
		_finish("FAILED", 1)
		return
	var packed: PackedScene = scene_resource as PackedScene
	if not _check(packed.can_instantiate(), "PACKED_SCENE_CAN_INSTANTIATE"):
		_finish("FAILED", 1)
		return
	var instance: Node = packed.instantiate()
	if not _check(instance != null, "SCENE_INSTANTIATED_OFF_TREE"):
		_finish("FAILED", 1)
		return
	var script: Script = instance.get_script() as Script
	_check(script != null, "ROOT_SCRIPT_PRESENT")
	if script != null:
		_check(script.resource_path == level["script"], "ROOT_SCRIPT_PATH")
		_check(script.get_global_name() == level["globalName"], "ROOT_SCRIPT_GLOBAL_NAME")
	_check(instance.get("marker") == level["marker"], "ROOT_MARKER")
	var sprite: Node = instance.get_node_or_null("Sprite")
	_check(sprite is Sprite2D, "SPRITE_NODE_TYPE")
	if sprite is Sprite2D:
		var texture: Texture2D = (sprite as Sprite2D).texture
		_check_texture(texture, level, "SCENE_TEXTURE")
		_check_import_uid(texture, level)
	instance.free()
	_finish("PASS_NATIVE_PACK_LOAD_ONLY" if _failures.is_empty() else "FAILED", 0 if _failures.is_empty() else 1)

func _validate_config() -> bool:
	if not _check(_keys(_config, ["schema", "mode", "runRoot", "sourceSentinel", "packs", "level"]), "CONFIG_EXACT_KEYS"):
		return false
	if not _check(_config["schema"] == "wxslim-native-pck-check-v1" and _config["mode"] in ["normal", "boot_only", "missing_shared"] and _absolute(_config["runRoot"]) and _config["sourceSentinel"] == "res://source-only-marker.txt", "CONFIG_HEADER"):
		return false
	if not _check(typeof(_config["packs"]) == TYPE_ARRAY and _config["packs"].size() == 3, "THREE_PACKS"):
		return false
	var total: int = 0
	var entry_total: int = 0
	var aliases: Dictionary = {}
	var pack_files: Dictionary = {}
	for value: Variant in _config["packs"]:
		if not _check(typeof(value) == TYPE_DICTIONARY and _keys(value, ["id", "file", "bytes", "sha256", "entries"]), "PACK_EXACT_KEYS"):
			return false
		var pack: Dictionary = value
		if not _check(pack["id"] in ["boot", "shared", "level"] and not _packs.has(pack["id"]) and _absolute(pack["file"]) and _integer(pack["bytes"], 4, MAX_PACK) and _hash(pack["sha256"]), "PACK_IDENTITY_PIN"):
			return false
		var normalized: String = _normalize(pack["file"])
		if not _check(not pack_files.has(normalized), "PACK_FILE_UNIQUE"):
			return false
		pack_files[normalized] = true
		total += int(pack["bytes"])
		if not _check(total <= MAX_TOTAL and typeof(pack["entries"]) == TYPE_ARRAY and not pack["entries"].is_empty(), "PACK_BUDGET_ENTRIES"):
			return false
		for entry_value: Variant in pack["entries"]:
			if not _check(typeof(entry_value) == TYPE_DICTIONARY and _keys(entry_value, ["path", "bytes", "sha256"]), "ENTRY_EXACT_KEYS"):
				return false
			var entry: Dictionary = entry_value
			if not _check(_relative(entry["path"]) and _integer(entry["bytes"], 0, MAX_PACK) and _hash(entry["sha256"]), "ENTRY_PIN_PATH"):
				return false
			var alias: String = String(entry["path"]).to_lower()
			if not _check(not aliases.has(alias), "ENTRY_UNIQUE_OWNERSHIP"):
				return false
			aliases[alias] = true
			_owners[entry["path"]] = pack["id"]
			var entry_path: String = entry["path"]
			if entry_path.ends_with(".gd") or entry_path.ends_with(".gdc") or entry_path.ends_with(".gd.remap") or entry_path.ends_with(".gdc.remap") or entry_path in [".godot/global_script_class_cache.cfg", ".godot/uid_cache.bin", "project.binary", "project.godot"]:
				if not _check(pack["id"] == "boot", "SCRIPTS_METADATA_REMAP_IN_BOOT"):
					return false
			entry_total += 1
			if not _check(entry_total <= 4096, "ENTRY_COUNT_BUDGET"):
				return false
		_packs[pack["id"]] = pack
	var level: Variant = _config["level"]
	if not _check(typeof(level) == TYPE_DICTIONARY and _keys(level, ["entry", "script", "globalName", "marker", "texturePath", "textureWidth", "textureHeight"]), "LEVEL_EXACT_KEYS"):
		return false
	if not _check(level["entry"] == "res://level.tscn" and level["script"] == "res://level.gd" and level["globalName"] == "WxslimResourceFixtureLevel" and level["marker"] == "wxslim-level-v1" and level["texturePath"] == "res://shared/checker.svg" and _integer(level["textureWidth"], 16, 16) and _integer(level["textureHeight"], 16, 16), "FIXED_LEVEL_CONTRACT"):
		return false
	var level_owned: bool = _owners.get("level.tscn") == "level" or _owners.get("level.tscn.remap") == "level"
	return _check(level_owned and _owners.get("level.gd") == "boot" and _owners.get("shared/checker.svg.import") == "shared" and _owners.get("native_verify.gd") == "boot" and _owners.get(".godot/global_script_class_cache.cfg") == "boot" and _owners.get(".godot/uid_cache.bin") == "boot" and (_owners.has("project.binary") or _owners.has("project.godot")), "REQUIRED_BOOT_LEVEL_ENTRIES")

func _check_file(path: String, expected_bytes: int, expected_hash: String, label: String) -> bool:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if not _check(file != null, label + "_OPEN"):
		return false
	var actual_bytes: int = file.get_length()
	file.close()
	var actual_hash: String = FileAccess.get_sha256(path)
	_observations.append({"kind": "file", "label": label, "path": path, "bytes": actual_bytes, "sha256": actual_hash})
	return _check(actual_bytes == expected_bytes and actual_hash.length() == 64 and actual_hash == expected_hash, label + "_PIN")

func _check_visible(id: String) -> void:
	for entry: Dictionary in _packs[id]["entries"]:
		if _check_file("res://" + entry["path"], int(entry["bytes"]), entry["sha256"], id.to_upper() + "_ENTRY"):
			_verified_entries[entry["path"]] = true

func _check_scene_mapping(logical: String, owner: String) -> void:
	var relative: String = logical.trim_prefix("res://")
	var remap_entry: String = relative + ".remap"
	var target: String = logical
	if _owners.has(remap_entry):
		if not _check(_owners.get(remap_entry) == owner and _verified_entries.has(remap_entry), "SCENE_REMAP_OWNER_AND_HASH"):
			return
		var remap_file: ConfigFile = ConfigFile.new()
		if not _check(remap_file.load("res://" + remap_entry) == OK, "SCENE_REMAP_READ"):
			return
		if not _check(remap_file.get_sections() == PackedStringArray(["remap"]) and remap_file.get_section_keys("remap") == PackedStringArray(["path"]), "SCENE_REMAP_SINGLE_PATH"):
			return
		var value: Variant = remap_file.get_value("remap", "path", null)
		if not _check(typeof(value) == TYPE_STRING and value.begins_with("res://") and _relative(value.substr(6)) and value != logical and value.ends_with(".scn"), "SCENE_REMAP_CANONICAL_BINARY_TARGET"):
			return
		target = value
	var target_entry: String = target.trim_prefix("res://")
	var owned: bool = _owners.get(target_entry) == owner
	var verified: bool = _verified_entries.has(target_entry)
	var visible: bool = FileAccess.file_exists(target)
	_observations.append({"kind": "sceneMapping", "logical": logical, "remapEntry": remap_entry if _owners.has(remap_entry) else "", "target": target, "owner": _owners.get(target_entry), "entryHashPreviouslyVerified": verified, "visible": visible})
	_check(owned and verified and visible, "SCENE_TARGET_OWNER_HASH_VISIBLE")

func _check_missing(id: String) -> void:
	for entry: Dictionary in _packs[id]["entries"]:
		var path: String = "res://" + entry["path"]
		var exists: bool = FileAccess.file_exists(path)
		var cached: bool = ResourceLoader.has_cached(path)
		_observations.append({"kind": "missing", "pack": id, "path": path, "exists": exists, "cached": cached})
		_check(not exists and not cached, id.to_upper() + "_ENTRY_ABSENT_UNCACHED")

func _check_texture(texture: Texture2D, level: Dictionary, label: String) -> void:
	_check(texture is CompressedTexture2D, label + "_COMPRESSED_TYPE")
	if texture != null:
		_observations.append({"kind": "texture", "label": label, "class": texture.get_class(), "path": texture.resource_path, "width": texture.get_width(), "height": texture.get_height()})
		_check(texture.get_width() == int(level["textureWidth"]) and texture.get_height() == int(level["textureHeight"]), label + "_DIMENSIONS")

func _import_metadata() -> Dictionary:
	var level: Dictionary = _config["level"]
	var imported: ConfigFile = ConfigFile.new()
	if not _check(imported.load(level["texturePath"] + ".import") == OK, "IMPORT_CONFIG_READ"):
		return {}
	var remap: Variant = imported.get_value("remap", "path", null)
	var uid: Variant = imported.get_value("remap", "uid", null)
	_observations.append({"kind": "import", "path": remap, "uid": uid})
	if not _check(typeof(remap) == TYPE_STRING and remap.begins_with("res://") and _owners.get(remap.substr(6)) == "shared", "IMPORT_TARGET_OWNED_BY_SHARED"):
		return {}
	if not _check(typeof(uid) == TYPE_STRING and uid.begins_with("uid://"), "IMPORT_UID_PRESENT"):
		return {}
	return {"path": remap, "uid": uid}

func _check_import_uid(texture: Texture2D, level: Dictionary) -> void:
	var metadata: Dictionary = _import_metadata()
	if metadata.is_empty():
		return
	var remap: String = metadata["path"]
	var uid: String = metadata["uid"]
	_check(FileAccess.file_exists(remap), "IMPORT_TARGET_VISIBLE")
	if texture is CompressedTexture2D:
		_check((texture as CompressedTexture2D).get_load_path() == remap, "TEXTURE_ACTUAL_IMPORT_PATH")
	var id: int = ResourceUID.text_to_id(uid)
	if not _check(id >= 0 and ResourceUID.has_id(id), "UID_REGISTERED"):
		return
	var mapped: String = ResourceUID.get_id_path(id)
	_observations.append({"kind": "uid", "uid": uid, "mappedPath": mapped})
	_check(mapped == level["texturePath"], "UID_EXPECTED_SOURCE_PATH")
	var uid_texture: Resource = ResourceLoader.load(uid, "Texture2D", ResourceLoader.CACHE_MODE_IGNORE_DEEP)
	_check(uid_texture is CompressedTexture2D, "UID_TEXTURE_TYPE")
	if uid_texture is CompressedTexture2D:
		_check_texture(uid_texture as Texture2D, level, "UID_TEXTURE")
		_check((uid_texture as CompressedTexture2D).get_load_path() == remap, "UID_TEXTURE_IMPORT_PATH")

func _check(condition: bool, code: String) -> bool:
	_checks.append({"code": code, "ok": condition})
	if not condition:
		_failures.append(code)
	return condition

func _keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key: Variant in expected:
		if not value.has(key):
			return false
	return true

func _hash(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.length() != 64:
		return false
	for character: String in value:
		if not character in "0123456789abcdef":
			return false
	return true

func _integer(value: Variant, minimum: int, maximum: int) -> bool:
	if typeof(value) == TYPE_INT:
		return value >= minimum and value <= maximum
	return typeof(value) == TYPE_FLOAT and is_finite(value) and value >= minimum and value <= maximum and floorf(value) == value

func _absolute(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.length() > 2048 or not value.is_absolute_path() or value.contains("://"):
		return false
	# Do not construct a NUL-containing Godot String while checking for NUL.
	for index: int in value.length():
		if value.unicode_at(index) == 0:
			return false
	return true

func _relative(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 1024 or value.begins_with("/") or value.contains(":") or value.contains("\\"):
		return false
	for character: int in value.to_utf8_buffer():
		if character < 32 or character == 127:
			return false
	for part: String in value.split("/", true):
		if part.is_empty() or part in [".", ".."]:
			return false
	return true

func _normalize(value: String) -> String:
	return value.replace("\\", "/").simplify_path().trim_suffix("/").to_lower()

func _finish(status: String, exit_code: int) -> void:
	var verifier_script: Script = get_script() as Script
	var verifier_path: String = verifier_script.resource_path if verifier_script != null else ""
	var verifier_sha: String = FileAccess.get_sha256(verifier_path) if not verifier_path.is_empty() else ""
	print("PCK_NATIVE_VERIFY ", JSON.stringify({"schema": "wxslim-native-pck-result-v1", "mode": _mode,
		"status": status, "version": Engine.get_version_info(), "checks": _checks, "failures": _failures,
		"verifier": {"path": verifier_path, "sha256": verifier_sha, "source": "get_script().resource_path; raw FileAccess.get_sha256 at report time", "scope": "May be an external script, not the older boot entry; outer process receipt must pin launch identity. Not an attestation of in-memory compiled bytes."},
		"observations": _observations, "scope": "Native PCK reader only; not WX helper/JSBridge/WASM/GLX/device acceptance",
		"filesystemWritesRequested": false, "sceneAddedToTree": false, "unloadOrRollbackRequested": false}))
	quit(exit_code)
