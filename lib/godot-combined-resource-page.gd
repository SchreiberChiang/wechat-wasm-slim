extends "res://runtime_trigger.gd"
## UI/composition wrapper. Original load/cancel/result/content-proof code is inherited.
var _layer: CanvasLayer
var _message: Label
var _page_active := false
var _connected_once := false
var _scope: JavaScriptObject
var _association_ok := false
var _start_scene_id := 0
var _level_ref: WeakRef
var _level_id := 0

func _build_ui() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 9
	add_child(_layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(16, 16)
	panel.size = Vector2(608, 390)
	var readable := Theme.new()
	readable.default_font = load("res://ResourceCJK.otf")
	readable.default_font_size = 26
	panel.theme = readable
	_layer.add_child(panel)
	var margin := MarginContainer.new()
	for side: String in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16)
	panel.add_child(margin)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	margin.add_child(column)
	_label(column, "资源加载", 32, 42)
	_message = _label(column, "准备检查", 26, 100)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	column.add_child(row)
	_load_button = Button.new()
	_load_button.text = "加载一次"
	_cancel_button = Button.new()
	_cancel_button.text = "取消加载"
	for button: Button in [_load_button, _cancel_button]:
		button.custom_minimum_size = Vector2(270, 96)
		button.add_theme_font_size_override("font_size", 30)
		row.add_child(button)
	_load_button.pressed.connect(request_level)
	_cancel_button.pressed.connect(request_cancel)
	# Original result is retained. No extra default diagnostics button or log dump.
	# These labels satisfy the inherited presenter without adding tiny controls.
	_status_label = Label.new()
	_detail_label = Label.new()
	_identity_label = Label.new()
	_print_button = Button.new()
	for hidden: Control in [_status_label, _detail_label, _identity_label, _print_button]:
		hidden.visible = false
		column.add_child(hidden)
	_set_state("CONNECTING", "No load request.")
	_layer.visible = _page_active

func _set_state(value: String, detail: String) -> void:
	super._set_state(value, detail)
	if not is_instance_valid(_message):
		return
	var messages := {
		"CONNECTING": "正在核对运行接口，尚未请求资源。",
		"READY": "点一次加载。完成后应在下方看到蓝白方格；需要人工观察。",
		"LOADING": "正在读取和核对资源，请等待。",
		"SUCCESS": "加载和内容关联已核对。请观察下方蓝白方格是否正常；画面不会自动判定通过。",
		"CANCEL REQUESTED": "已请求取消，等待原操作结束。不会自动回退已完成的挂载。",
		"CANCELLED": "本次操作已取消。已挂载内容可能保留；本会话不重复加载。"
	}
	_message.text = messages.get(value, "未确认成功，请保留日志。本会话不重试。")
	if value not in messages:
		_message.text += "\n" + value + ": " + detail.left(140)

func connect_runtime() -> Dictionary:
	if _connected_once:
		return {"ok": false, "code": "COMBINED_RESOURCE_ALREADY_CONNECTED"}
	_connected_once = true
	if is_inside_tree() and is_instance_valid(get_tree().current_scene):
		_start_scene_id = get_tree().current_scene.get_instance_id()
	var attached: Dictionary = super.connect_runtime()
	if attached.get("ok") != true or not _ready_to_request:
		return attached
	_scope = JavaScriptBridge.get_interface("__WXSLIM_COMBINED_RESOURCE_SCOPE__")
	_association_ok = _scope_matches()
	if not _association_ok:
		_ready_to_request = false
		_set_state("UNKNOWN", "COMBINED_RESOURCE_IDENTITY_MISMATCH")
		_record("COMBINED_RESOURCE_IDENTITY_MISMATCH", {})
		return {"ok": false, "code": "COMBINED_RESOURCE_IDENTITY_MISMATCH"}
	_record("COMBINED_RESOURCE_ASSOCIATION", {"triggerId": str(get_instance_id()), "receiverId": str(_receiver.get_instance_id()), "parentIsRoot": get_parent() == get_tree().root, "triggerIsCurrentScene": self == get_tree().current_scene, "resourceRequest": false})
	return attached

func _scope_matches() -> bool:
	if _scope == null:
		return false
	var text: Variant = _scope.read()
	if not text is String or text.to_utf8_buffer().size() > 4096:
		return false
	var observed: Variant = _parse_json(text)
	return observed is Dictionary and observed.get("schema") == "wxslim-combined-resource-scope-v1" and observed.get("packageId") == _boot.get("packageId") and observed.get("resourceIdentity") == _identity and observed.get("resourceInstalled") == true and observed.get("resourceClosed") == false

func request_level() -> void:
	if not _page_active or not _association_ok or not _scope_matches():
		_association_ok = false
		_ready_to_request = false
		_set_state("UNKNOWN", "COMBINED_RESOURCE_REQUEST_SCOPE_INVALID")
		_record("COMBINED_RESOURCE_REQUEST_SCOPE_INVALID", {})
		return
	super.request_level()

func request_cancel() -> void:
	if not _page_active or not _association_ok or not _scope_matches():
		_association_ok = false
		_ready_to_request = false
		_set_state("UNKNOWN", "COMBINED_RESOURCE_CANCEL_SCOPE_INVALID")
		_record("COMBINED_RESOURCE_CANCEL_SCOPE_INVALID", {})
		return
	super.request_cancel()

func _on_resolved(args: Array) -> void:
	if _settled:
		return
	super._on_resolved(args)
	# Only inherited exact-instance/current-scene/content SUCCESS authorizes visibility.
	if _state == "SUCCESS":
		var level: Node = get_tree().current_scene
		if level is CanvasItem:
			_level_ref = weakref(level)
			_level_id = level.get_instance_id()
			level.visible = _page_active
		else:
			_set_state("UNKNOWN", "COMBINED_RESOURCE_LEVEL_NOT_CANVAS_ITEM")

func _owned_level() -> CanvasItem:
	if _level_ref == null:
		return null
	var level: Variant = _level_ref.get_ref()
	if is_instance_valid(level) and level is CanvasItem and level.get_instance_id() == _level_id and level == get_tree().current_scene and level.get_parent() == get_tree().root and level.scene_file_path == "res://level.tscn" and not level.is_queued_for_deletion():
		return level as CanvasItem
	return null

func can_leave_page() -> bool:
	if not _requested:
		return true
	if not _settled or _state not in ["SUCCESS", "FAILED", "CANCELLED"]:
		return false
	if _state == "SUCCESS":
		return _owned_level() != null
	# Failure/cancel may have side effects. Do not hide an unassociated new scene.
	var current: Node = get_tree().current_scene
	return is_instance_valid(current) and current.get_instance_id() == _start_scene_id

func set_page_active(active: bool) -> void:
	_page_active = active
	if is_instance_valid(_layer):
		_layer.visible = active
	var level: CanvasItem = _owned_level()
	if level != null:
		level.visible = active

func _exit_tree() -> void:
	var owned_receiver: Node = _receiver
	super._exit_tree()
	# Base invalidates first; then release only our root sibling instance.
	if is_instance_valid(owned_receiver):
		owned_receiver.queue_free()
	_scope = null
