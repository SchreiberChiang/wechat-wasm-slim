@tool
extends ConfirmationDialog

signal operation_requested(operation: String, payload: Dictionary)

var _catalog_token := ""
var _rows: Dictionary = {}
var _body: VBoxContainer
var _pack_body: VBoxContainer
var _read_button: Button
var _dependencies: TextEdit
var _ack: CheckBox
var _note: Label
var _busy := false

func _ready() -> void:
	title = "拆包结果 → 运行时资源配置（开发测试）"
	dialog_hide_on_ok = false
	ok_button_text = "校验并保存配置草稿（不组包）"
	cancel_button_text = "返回"
	confirmed.connect(_submit)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(760, 580)
	add_child(scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_body)
	_note = Label.new()
	_note.text = "先在主面板选择成功的拆包任务 REQUEST、目录和 ID，再读取结果（无需保存选择）。\n每包需明确选择入口场景或‘仅挂载’，共享依赖需手工确认。\n不是自动依赖扫描；源码接收器和真实加载仍需另外核验。"
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.add_child(_note)
	_read_button = Button.new()
	_read_button.text = "读取所选拆包任务及实际 PCK"
	_read_button.pressed.connect(func(): operation_requested.emit("resource-partition-outputs", {}))
	_body.add_child(_read_button)
	_pack_body = VBoxContainer.new()
	_body.add_child(_pack_body)
	var label := Label.new()
	label.text = "显式文件依赖（每行 res://来源 -> res://依赖；空白表示未声明文件边）"
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.add_child(label)
	_dependencies = TextEdit.new()
	_dependencies.custom_minimum_size.y = 90
	_dependencies.text_changed.connect(_declaration_changed)
	_body.add_child(_dependencies)
	_ack = CheckBox.new()
	_ack.text = "我已核对入口、包依赖和文件依赖；未声明不等于不存在依赖"
	_ack.toggled.connect(func(_pressed: bool): set_busy(_busy))
	_body.add_child(_ack)
	set_busy(false)

func report_failure(message: String) -> void:
	_note.text = message

func _line(parent: VBoxContainer, label: String, initial: String = "") -> LineEdit:
	var caption := Label.new()
	caption.text = label
	parent.add_child(caption)
	var field := LineEdit.new()
	field.text = initial
	field.text_changed.connect(func(_text: String): _declaration_changed())
	parent.add_child(field)
	return field

func _declaration_changed() -> void:
	if is_instance_valid(_ack):
		_ack.button_pressed = false

func clear_catalog() -> void:
	_catalog_token = ""
	_rows.clear()
	if is_instance_valid(_pack_body):
		for child in _pack_body.get_children():
			_pack_body.remove_child(child)
			child.queue_free()
	_declaration_changed()
	set_busy(_busy)

func accept_catalog(token: String, data: Dictionary) -> bool:
	clear_catalog()
	if data.get("schema") != "wxslim-local-resource-catalog-v1" or not data.get("packs") is Array or data.packs.size() < 2 or not data.get("selection") is Dictionary:
		return false
	for pack in data.packs:
		if not pack is Dictionary or not pack.get("id") is String or pack.get("role") not in ["boot", "resource"] or not pack.get("sceneCandidates") is Array or not pack.get("sha256") is String or _rows.has(pack.id):
			clear_catalog()
			return false
		var box := VBoxContainer.new()
		_pack_body.add_child(box)
		var heading := Label.new()
		heading.text = "%s / %s / %s bytes / %s…" % [pack.id, pack.role, str(pack.get("bytes", "?")), pack.sha256.left(12)]
		box.add_child(heading)
		var scene := OptionButton.new()
		scene.add_item("请选择入口场景；不会自动猜测")
		scene.set_item_metadata(0, "__choose__")
		if pack.role == "resource":
			scene.add_item("仅挂载共享资源（没有入口场景）")
			scene.set_item_metadata(1, null)
		for candidate in pack.sceneCandidates:
			if not candidate is String or not candidate.begins_with("res://"):
				clear_catalog()
				return false
			scene.add_item(candidate)
			scene.set_item_metadata(scene.item_count - 1, candidate)
		scene.item_selected.connect(func(_index: int): _declaration_changed())
		box.add_child(scene)
		var requires := _line(box, "需要先挂载的包 ID，逗号分隔（boot 自动作为基础，不需重复填）")
		requires.editable = pack.role != "boot"
		var root: LineEdit = null
		if pack.role == "resource":
			root = _line(box, "微信代码包目录", "resources/" + pack.id)
		_rows[pack.id] = {"role": pack.role, "scene": scene, "requires": requires, "root": root}
	_catalog_token = token
	_dependencies.text = ""
	_note.text = "已读取任务 %s 的实际 PCK。候选场景仍由共同计划核对归属。\n只保存本地配置草稿；不重新拆包、不创建输出目录、不写项目。\n来源：%s" % [str(data.selection.get("taskId", "?")), str(data.selection.get("root", "?"))]
	set_busy(_busy)
	return true

func set_busy(busy: bool) -> void:
	_busy = busy
	if not is_instance_valid(_read_button):
		return
	_read_button.disabled = busy
	_dependencies.editable = not busy
	_ack.disabled = busy
	for row in _rows.values():
		row.scene.disabled = busy
		row.requires.editable = not busy and row.role != "boot"
		if is_instance_valid(row.root):
			row.root.editable = not busy
	get_ok_button().disabled = busy or _catalog_token.is_empty() or not _ack.button_pressed

func _submit() -> void:
	if _busy or _catalog_token.is_empty() or not _ack.button_pressed:
		return
	var packs: Array = []
	for id in _rows:
		var row: Dictionary = _rows[id]
		var scene = row.scene.get_selected_metadata()
		if scene == "__choose__":
			_note.text = "每包必须明确选择入口或仅挂载；未保存。"
			return
		var requires: Array = []
		for item in row.requires.text.split(",", false):
			requires.append(item.strip_edges())
		packs.append({"id": id, "root": row.root.text if is_instance_valid(row.root) else null, "requires": requires, "entryScene": scene})
	var dependencies: Array = []
	for line in _dependencies.text.split("\n", false):
		if line.strip_edges().is_empty():
			continue
		var parts: PackedStringArray = line.split("->", true)
		if parts.size() != 2:
			_note.text = "文件依赖格式不正确；每行应为 res://来源 -> res://依赖。"
			return
		dependencies.append({"from": parts[0].strip_edges(), "to": parts[1].strip_edges(), "kind": "runtime-declaration"})
	operation_requested.emit("prepare-resource-config", {"catalogToken": _catalog_token, "packs": packs, "dependencies": dependencies, "dependencyAcknowledged": true})
