extends Node
## Explicit one-shot scene component, not an autoload. Connect completed before start.
## Parent must be a resident receiver directly under /root, outside current_scene.
## Resource loading/instantiation can run user scripts and is NOT zero side effects.
## Source only until independently checked; no visual/render/device acceptance.
signal completed(result: Dictionary)

var _started: bool = false
var _ended: bool = false
var _stopped: bool = false
var _tree: SceneTree
var _guard: Callable
var _target: Node
var _target_id: int = 0
var _handoff_in_progress: bool = false
var _submitted: bool = false
var _last_ok: bool = false
var _last_code: String = "SCENE_NOT_STARTED"
var _evidence: Dictionary = {
	"schema": "wxslim-resource-scene-evidence-v1", "entryScene": "", "loadedResourcePath": null,
	"resourceLoadAttempted": false, "packedSceneVerified": false, "canInstantiate": null,
	"instantiated": false, "targetInstanceId": null, "signalConnectError": null,
	"changeAttempted": false, "changeError": null, "submitted": false,
	"sceneChangedObserved": false, "currentSceneId": null, "currentScenePath": null,
	"exactInstance": null, "parentIsRoot": null, "insideTree": null,
	"nodeReady": null, "queuedForDeletion": null, "guardState": "NOT_CHECKED",
	"state": "NOT_ATTEMPTED", "rollbackPerformed": false, "visualVerified": false,
	"evidenceScope": "NATIVE_OR_WEB_SCENE_TREE_ONLY"
}

func snapshot() -> Dictionary:
	return {"ok": _last_ok, "code": _last_code, "evidence": _evidence.duplicate(true)}

func start(entry_scene: String, guard: Callable) -> void:
	_begin(entry_scene, guard, null, false)

func start_native_test(packed: PackedScene, entry_scene: String, guard: Callable) -> void:
	# Native-only explicit model: no ResourceLoader and no invented resource identity.
	if OS.has_feature("web"):
		return
	_begin(entry_scene, guard, packed, true)

func _begin(entry_scene: String, guard: Callable, model_scene: PackedScene, model: bool) -> void:
	if _started:
		return # One-shot: never emit a second completion or replace the first state.
	_started = true
	_guard = guard
	_evidence["entryScene"] = entry_scene
	if model:
		_evidence["evidenceScope"] = "NATIVE_MEMORY_MODEL_ONLY"
	if not _placement_valid():
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_RESIDENT_PLACEMENT_REQUIRED")
		return
	if (model and (entry_scene != "" or (model_scene != null and model_scene.resource_path != ""))) or (not model and not _valid_entry(entry_scene)):
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_ENTRY_INVALID")
		return
	if not _check_guard():
		_not_submitted(_guard_failure_code())
		return
	var resource: Resource = model_scene
	if not model:
		_evidence["resourceLoadAttempted"] = true
		resource = ResourceLoader.load(entry_scene, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE_DEEP)
	if _stopped:
		return
	if not _check_guard():
		_not_submitted(_guard_failure_code())
		return
	if not resource is PackedScene:
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_PACKED_RESOURCE_REQUIRED")
		return
	var packed: PackedScene = resource as PackedScene
	_evidence["packedSceneVerified"] = true
	_evidence["loadedResourcePath"] = packed.resource_path
	if (model and packed.resource_path != "") or (not model and packed.resource_path != entry_scene):
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_LOADED_PATH_MISMATCH")
		return
	_evidence["canInstantiate"] = packed.can_instantiate()
	if not _evidence["canInstantiate"]:
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_CANNOT_INSTANTIATE")
		return
	_target = packed.instantiate()
	if _stopped:
		_release_unsubmitted()
		return
	if not is_instance_valid(_target):
		_evidence["state"] = "PREPARE_FAILED"
		_finish(false, "SCENE_INSTANTIATION_FAILED")
		return
	_target_id = _target.get_instance_id()
	_evidence["instantiated"] = true
	_evidence["targetInstanceId"] = str(_target_id)
	if not _check_guard():
		_not_submitted(_guard_failure_code())
		return
	if not _placement_valid() or _target.is_inside_tree() or _target.get_parent() != null or _target.is_queued_for_deletion():
		_not_submitted("SCENE_PRE_SUBMIT_STATE_INVALID")
		return
	var connection_error: Error = _tree.scene_changed.connect(_on_scene_changed)
	_evidence["signalConnectError"] = connection_error
	if connection_error != OK:
		_not_submitted("SCENE_SIGNAL_CONNECT_FAILED")
		return
	# Last synchronous gate; no await/frame/timer separates it from the change call.
	if not _check_guard():
		_not_submitted(_guard_failure_code())
		return
	_evidence["changeAttempted"] = true
	_evidence["state"] = "SUBMITTED_UNCONFIRMED"
	_handoff_in_progress = true
	# Fixed scene_tree.cpp:1735–1743 removes the old scene before returning OK.
	# Its exit callbacks may reenter us. Never free the target during this handoff.
	var change_error: Error = _tree.change_scene_to_node(_target)
	_handoff_in_progress = false
	_evidence["changeError"] = change_error
	if change_error == OK:
		_submitted = true
		_evidence["submitted"] = true
	if _stopped:
		return
	if change_error != OK:
		_evidence["state"] = "UNKNOWN_AFTER_SUBMIT"
		_finish(false, "SCENE_CHANGE_CALL_FAILED")
		return
	_last_code = "SCENE_WAITING_FOR_TREE_SIGNAL"

func _on_scene_changed() -> void:
	if _stopped or _ended:
		return
	# Fixed scene_tree.cpp:1687–1695 sets current_scene, add_child, then emits.
	# A different/reentrant change must not satisfy this request by matching a path.
	_evidence["sceneChangedObserved"] = true
	if not _observe_current_scene():
		_evidence["state"] = "UNKNOWN_AFTER_SUBMIT"
		_finish(false, "SCENE_TREE_SIGNAL_MISMATCH")
		return
	_evidence["state"] = "TREE_CONFIRMED"
	if not _check_guard():
		_finish(false, _guard_failure_code(true))
		return
	# Callable guards may be reentrant; re-read rather than trusting stale values.
	if not _observe_current_scene():
		_evidence["state"] = "UNKNOWN_AFTER_SUBMIT"
		_finish(false, "SCENE_TREE_CHANGED_DURING_GUARD")
		return
	_finish(true, "SCENE_TREE_CONFIRMED")

func _observe_current_scene() -> bool:
	var current: Node = _tree.current_scene
	for key: String in ["currentSceneId", "currentScenePath", "exactInstance", "parentIsRoot", "insideTree", "nodeReady", "queuedForDeletion"]:
		_evidence[key] = null
	if is_instance_valid(current):
		_evidence["currentSceneId"] = str(current.get_instance_id())
		_evidence["currentScenePath"] = current.scene_file_path
		_evidence["exactInstance"] = current.get_instance_id() == _target_id
		_evidence["parentIsRoot"] = current.get_parent() == _tree.root
		_evidence["insideTree"] = current.is_inside_tree()
		_evidence["nodeReady"] = current.is_node_ready()
		_evidence["queuedForDeletion"] = current.is_queued_for_deletion()
	return _submitted and is_instance_valid(current) and _evidence["exactInstance"] == true and _evidence["currentScenePath"] == _evidence["loadedResourcePath"] and _evidence["parentIsRoot"] == true and _evidence["insideTree"] == true and _evidence["nodeReady"] == true and _evidence["queuedForDeletion"] == false

func _placement_valid() -> bool:
	if not is_inside_tree():
		return false
	_tree = get_tree()
	var resident: Node = get_parent()
	if resident == null or resident.get_parent() != _tree.root or not _tree.root.is_ancestor_of(self):
		return false
	var scene: Node = _tree.current_scene
	return scene == null or (scene != resident and scene != self and not scene.is_ancestor_of(self))

func _check_guard() -> bool:
	if _stopped or not _guard.is_valid():
		_evidence["guardState"] = "INVALID"
		return false
	var value: Variant = _guard.call()
	if _stopped or typeof(value) != TYPE_BOOL:
		_evidence["guardState"] = "INVALID"
		return false
	_evidence["guardState"] = "ALLOWED" if value else "DENIED"
	return value

func _not_submitted(code: String) -> void:
	_evidence["state"] = "NOT_SUBMITTED"
	_release_unsubmitted()
	_finish(false, code)

func _guard_failure_code(after_submit: bool = false) -> String:
	if _evidence["guardState"] == "INVALID":
		return "SCENE_GUARD_INVALID_AFTER_SUBMIT" if after_submit else "SCENE_GUARD_INVALID"
	return "SCENE_REQUEST_INACTIVE_AFTER_SUBMIT" if after_submit else "SCENE_REQUEST_INACTIVE"

func _release_unsubmitted() -> void:
	if not _submitted and not _handoff_in_progress and is_instance_valid(_target) and not _target.is_inside_tree() and _target.get_parent() == null:
		_target.free()
		_target = null

func _disconnect_signal() -> void:
	if is_instance_valid(_tree) and _tree.scene_changed.is_connected(_on_scene_changed):
		_tree.scene_changed.disconnect(_on_scene_changed)

func _finish(ok: bool, code: String) -> void:
	if _ended or _stopped:
		return
	_ended = true
	_last_ok = ok
	_last_code = code
	_disconnect_signal()
	_guard = Callable()
	completed.emit(snapshot())

func invalidate() -> void:
	if _stopped:
		return
	_stopped = true
	_disconnect_signal()
	_release_unsubmitted()
	_guard = Callable()
	if _started and not _ended:
		_last_code = "SCENE_RECEIVER_EXITED_UNCONFIRMED"
		_evidence["state"] = "UNKNOWN_AFTER_SUBMIT" if _submitted or _handoff_in_progress else "NOT_SUBMITTED"

func _exit_tree() -> void:
	invalidate()

func _valid_entry(value: String) -> bool:
	if not value.begins_with("res://") or value.length() > 1024 or not (value.ends_with(".tscn") or value.ends_with(".scn")):
		return false
	var relative: String = value.substr(6)
	for index: int in relative.length():
		var code: int = relative.unicode_at(index)
		if code < 32 or (code >= 127 and code <= 159) or code in [58, 92, 65279]:
			return false
	for part: String in relative.split("/", true):
		if part.is_empty() or part in [".", ".."]:
			return false
	return true
