@tool
extends VBoxContainer

# 新版面板预览：只演示布局、AppID 入口和前置条件门禁，不调用适配器、不执行任务。
# 设置草稿保存在插件本机状态目录（*.private.* 已被 .gitignore 排除）。

const INSTALL_LOCATOR := "res://addons/wxslim_readonly/workbench.path"
const SETTINGS_FILE := "panel-preview-settings.private.json"
const APPID_PATTERN := "^wx[0-9a-f]{16}$"
const TEMPLATES := {"full": "完整模板", "2d": "2D 模板", "custom": "自定义"}
const STORAGE := [["project", "跟随项目（res://wxslim.json）"], ["project-local", "仅本工程本机（.godot/wxslim/）"], ["machine", "仅本电脑（插件状态目录）"]]
const STATUS_TEXT := {"implemented": "已实现待验证", "unsupported": "不支持", "missing": "未实现", "pending": "待核查", "verified": "已验证"}
const STATUS_COLOR := {"implemented": Color(0.95, 0.75, 0.3), "unsupported": Color(0.6, 0.6, 0.6), "missing": Color(0.9, 0.4, 0.4), "pending": Color(0.55, 0.7, 0.9), "verified": Color(0.45, 0.85, 0.5)}
const CATEGORIES := [
	["渲染", ["render-"]], ["输入", ["input-"]], ["音频", ["audio"]], ["网络", ["network-"]],
	["存档与系统", ["persistent-save", "secure-random", "lifecycle-"]], ["登录", ["login-"]],
	["导出、转换与资源", ["project-pck-export", "official-convert", "resource-"]],
	["引擎与构建", ["engine-", "trim-", "wasm-"]], ["插件", ["plugin-", "safe-task-"]],
]

var _saved := {}
var _draft := {}
var _resource_saved := {"scenes": []}
var _resource_draft := {"scenes": []}
var _resource_list: VBoxContainer
var _subpackage_buttons := {}
var _subpackage_note: Label
var _captions := {}
var _detection_confirmed := false
var _capabilities := {}
var _loading := false

var _engine_line: Label
var _appid_line: Label
var _output_line: Label
var _task_line: Label
var _missing_box: HFlowContainer
var _settings: FoldableContainer
var _resources: FoldableContainer
var _template_buttons := {}
var _orientation_buttons := {}
var _storage: OptionButton
var _glx: CheckBox
var _glx_status: Label
var _prewarm: CheckBox
var _prewarm_note: Label
var _appid: LineEdit
var _appid_note: Label
var _game_name: LineEdit
var _output: LineEdit
var _custom_box: VBoxContainer
var _settings_save: Button
var _settings_discard: Button
var _resource_pack: LineEdit
var _resource_save: Button
var _resource_discard: Button
var _export_button: Button
var _open_button: Button
var _export_hint: Label
var _open_hint: Label
var _log: TextEdit
var _notice: AcceptDialog
var _lower: VBoxContainer
var _lock_note: Label
var _target: Control = self

func _state_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string("res://.godot/wxslim/state.path").strip_edges()
	return ProjectSettings.globalize_path("res://")

func _workbench_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string(INSTALL_LOCATOR).strip_edges()
	return ProjectSettings.globalize_path("res://")

func _default_settings() -> Dictionary:
	return {"storage": "project", "template": "", "orientation": "portrait", "glx": true, "skipPrewarm": false, "subpackages": "none", "appid": "", "gameName": "", "output": ""}

func _ready() -> void:
	add_theme_constant_override("separation", 8)
	_load_capabilities()
	_load_settings()
	_notice = AcceptDialog.new()
	_notice.title = "新版面板预览"
	add_child(_notice)
	var title := Label.new()
	title.text = "微信小游戏导出（新版预览）"
	title.add_theme_font_size_override("font_size", 16)
	add_child(title)
	# 上部内容可滚动；底栏（状态卡 + 导出与打开）固定在面板底部，不随展开内容下移。
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var content := VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 8)
	scroll.add_child(content)
	_target = content
	_build_settings()
	_lock_note = _label("先在上方选好模板、输出目录并填写 AppID，点「保存设置」后，下面的功能才能使用。", content)
	_lock_note.add_theme_color_override("font_color", STATUS_COLOR.implemented)
	_lower = VBoxContainer.new()
	_lower.add_theme_constant_override("separation", 8)
	content.add_child(_lower)
	_target = _lower
	_build_resources()
	_build_capabilities()
	_build_advanced()
	_build_log()
	var footer := VBoxContainer.new()
	footer.add_theme_constant_override("separation", 6)
	add_child(footer)
	_target = footer
	footer.add_child(HSeparator.new())
	_build_status_card()
	_build_actions()
	_apply_draft_to_controls()
	_settings.folded = _settings_ready()
	_refresh()

# ---------- 数据 ----------

func _load_capabilities() -> void:
	var file := _workbench_directory().path_join("../../lib/capabilities.json").simplify_path()
	var data = JSON.parse_string(FileAccess.get_file_as_string(file)) if FileAccess.file_exists(file) else null
	if data is Dictionary and data.get("capabilities") is Array:
		for item in data.capabilities:
			if item is Dictionary and item.get("id") is String:
				_capabilities[item.id] = item

func _load_settings() -> void:
	_saved = _default_settings()
	var file := _state_directory().path_join(SETTINGS_FILE)
	if FileAccess.file_exists(file):
		var data = JSON.parse_string(FileAccess.get_file_as_string(file))
		if data is Dictionary:
			for key in _saved.keys():
				if data.has(key) and typeof(data[key]) == typeof(_saved[key]):
					_saved[key] = data[key]
	_draft = _saved.duplicate()

func _write_settings() -> bool:
	var file := FileAccess.open(_state_directory().path_join(SETTINGS_FILE), FileAccess.WRITE)
	if file == null:
		_log_line("设置保存失败：无法写入插件状态目录。")
		return false
	file.store_string(JSON.stringify(_saved, "\t") + "\n")
	file.close()
	return true

func _appid_valid(value: String) -> bool:
	var regex := RegEx.create_from_string(APPID_PATTERN)
	return regex.search(value) != null

func _mask_appid(value: String) -> String:
	return value.left(6) + "…" + value.right(4) if value.length() > 10 else value

func _settings_dirty() -> bool:
	return _draft != _saved

func _resource_dirty() -> bool:
	return _resource_draft != _resource_saved

func _capability_status(id: String) -> String:
	var item: Dictionary = _capabilities.get(id, {})
	return str(item.get("status", "pending"))

# ---------- 界面 ----------

func _label(text: String, parent: Control, dim := false) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if dim:
		label.modulate = Color(1, 1, 1, 0.65)
	parent.add_child(label)
	return label

func _section(title: String, folded: bool) -> Array:
	var box := FoldableContainer.new()
	box.title = title
	box.folded = folded
	_target.add_child(box)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 6)
	box.add_child(body)
	return [box, body]

func _radio_group(parent: Control, items: Array, store: Dictionary, key: String) -> void:
	var group := ButtonGroup.new()
	var row := HFlowContainer.new()
	parent.add_child(row)
	for item in items:
		var radio := CheckBox.new()
		radio.text = item[1]
		radio.button_group = group
		radio.toggled.connect(func(on: bool):
			if on and not _loading:
				_draft[key] = item[0]
				_on_draft_changed()
		)
		row.add_child(radio)
		store[item[0]] = radio

func _build_status_card() -> void:
	var card := PanelContainer.new()
	_target.add_child(card)
	var body := VBoxContainer.new()
	card.add_child(body)
	_engine_line = _label("", body)
	_appid_line = _label("", body)
	_output_line = _label("", body)
	_task_line = _label("任务：空闲（预览版不执行任务）", body)
	_missing_box = HFlowContainer.new()
	body.add_child(_missing_box)

func _group(title: String, parent: Control, first := false) -> VBoxContainer:
	if not first:
		var gap := Control.new()
		gap.custom_minimum_size.y = 6
		parent.add_child(gap)
		parent.add_child(HSeparator.new())
	var heading := Label.new()
	heading.text = title
	heading.add_theme_font_size_override("font_size", 15)
	heading.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0))
	parent.add_child(heading)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	parent.add_child(box)
	return box

func _field(caption: String, parent: Control, key := "") -> VBoxContainer:
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 3)
	parent.add_child(item)
	var label := Label.new()
	label.text = caption + (" *" if not key.is_empty() else "")
	label.add_theme_font_size_override("font_size", 14)
	item.add_child(label)
	if not key.is_empty():
		_captions[key] = label
	return item

func _build_settings() -> void:
	var parts := _section("设置", false)
	_settings = parts[0]
	var body: VBoxContainer = parts[1]
	_label("带 * 的为必填。", body, true)

	var packing := _group("打包方式", body, true)
	var template := _field("模板", packing, "template")
	_radio_group(template, [["full", "完整模板"], ["2d", "2D 模板"], ["custom", "自定义…"]], _template_buttons, "template")
	_custom_box = VBoxContainer.new()
	template.add_child(_custom_box)
	_label("自定义需要重新编译引擎。先一键检测游戏没用到的功能，再确认裁剪项。", _custom_box, true)
	var detect := Button.new()
	detect.text = "一键检测可裁剪功能（尚未实现）"
	detect.disabled = true
	detect.tooltip_text = "现有代码没有自动扫描能力；见 docs/面板简化需求.md 第 5 节。"
	_custom_box.add_child(detect)
	var subpackages := _field("资源分包", packing)
	_radio_group(subpackages, [["none", "不分包"], ["scenes", "分包（按场景延后下载）"]], _subpackage_buttons, "subpackages")
	_subpackage_note = _label("", subpackages, true)

	var runtime := _group("运行效果", body)
	var orientation := _field("屏幕方向", runtime)
	_radio_group(orientation, [["portrait", "竖屏"], ["landscape", "横屏"]], _orientation_buttons, "orientation")
	var render := _field("渲染", runtime)
	_glx = CheckBox.new()
	_glx.text = "启用 GLX（取消则用 WebGL 电脑对照）"
	_glx.toggled.connect(func(on: bool):
		if not _loading:
			_draft.glx = on
			_on_draft_changed()
	)
	render.add_child(_glx)
	_glx_status = _label("", render, true)
	var prewarm := _field("启动预热", runtime)
	_prewarm = CheckBox.new()
	_prewarm.text = "跳过默认 3D 预热"
	_prewarm.toggled.connect(func(on: bool):
		if not _loading:
			_draft.skipPrewarm = on
			_on_draft_changed()
	)
	prewarm.add_child(_prewarm)
	_prewarm_note = _label("", prewarm, true)

	var publish := _group("发布信息", body)
	var appid := _field("AppID", publish, "appid")
	var appid_row := HBoxContainer.new()
	appid.add_child(appid_row)
	_appid = LineEdit.new()
	_appid.placeholder_text = "wx 开头，共 18 位"
	_appid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_appid.text_changed.connect(func(value: String):
		if not _loading:
			_draft.appid = value.strip_edges()
			_on_draft_changed()
	)
	appid_row.add_child(_appid)
	var read_config := Button.new()
	read_config.text = "从文件读取…"
	read_config.tooltip_text = "从已有小游戏的 project.config.json 读取 AppID"
	appid_row.add_child(read_config)
	var picker := FileDialog.new()
	picker.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	picker.access = FileDialog.ACCESS_FILESYSTEM
	picker.filters = PackedStringArray(["project.config.json ; 小游戏工程配置"])
	picker.file_selected.connect(_read_appid_from)
	add_child(picker)
	read_config.pressed.connect(func(): picker.popup_centered_ratio(0.7))
	_appid_note = _label("", appid, true)

	var game_name := _field("游戏名", publish)
	_game_name = LineEdit.new()
	_game_name.placeholder_text = "显示在开发者工具中的名称"
	_game_name.text_changed.connect(func(value: String):
		if not _loading:
			_draft.gameName = value
			_on_draft_changed()
	)
	game_name.add_child(_game_name)

	var output := _field("小游戏输出目录", publish, "output")
	var output_row := HBoxContainer.new()
	output.add_child(output_row)
	_output = LineEdit.new()
	_output.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_output.placeholder_text = "选择一个已存在的目录"
	_output.text_changed.connect(func(value: String):
		if not _loading:
			_draft.output = value.strip_edges()
			_on_draft_changed()
	)
	output_row.add_child(_output)
	var dir_picker := FileDialog.new()
	dir_picker.file_mode = FileDialog.FILE_MODE_OPEN_DIR
	dir_picker.access = FileDialog.ACCESS_FILESYSTEM
	dir_picker.dir_selected.connect(func(value: String):
		_output.text = value
		_output.text_changed.emit(value)
	)
	add_child(dir_picker)
	var choose := Button.new()
	choose.text = "选择…"
	choose.pressed.connect(func(): dir_picker.popup_centered_ratio(0.7))
	output_row.add_child(choose)

	var storage := _field("设置保存位置", publish)
	_storage = OptionButton.new()
	for item in STORAGE:
		_storage.add_item(item[1])
		_storage.set_item_metadata(_storage.item_count - 1, item[0])
	_storage.item_selected.connect(func(index: int):
		if not _loading:
			_draft.storage = str(_storage.get_item_metadata(index))
			_on_draft_changed()
	)
	storage.add_child(_storage)
	_label("预览版统一保存在插件本机状态目录；三种位置的实际读写在正式版实现。", storage, true)
	body.add_child(HSeparator.new())

	var buttons := HBoxContainer.new()
	body.add_child(buttons)
	_settings_save = Button.new()
	_settings_save.text = "保存设置"
	_settings_save.pressed.connect(_save_settings)
	buttons.add_child(_settings_save)
	_settings_discard = Button.new()
	_settings_discard.text = "放弃改动"
	_settings_discard.pressed.connect(func():
		_draft = _saved.duplicate()
		_apply_draft_to_controls()
		_log_line("已放弃设置改动。")
		_refresh()
	)
	buttons.add_child(_settings_discard)

func _build_actions() -> void:
	# 底栏要矮：两个按钮同一行（窄时自动换行），缺项只在状态卡里列一次，按钮悬停显示原因。
	var row := HFlowContainer.new()
	_target.add_child(row)
	_export_button = Button.new()
	_export_button.text = "③ 导出并转换"
	_export_button.custom_minimum_size = Vector2(130, 32)
	_export_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_export_button.pressed.connect(func(): _preview_only("导出并转换"))
	row.add_child(_export_button)
	_open_button = Button.new()
	_open_button.text = "在开发者工具中打开"
	_open_button.custom_minimum_size = Vector2(130, 32)
	_open_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_open_button.pressed.connect(func(): _preview_only("在开发者工具中打开"))
	row.add_child(_open_button)
	_export_hint = _label("", _target, true)
	_export_hint.visible = false
	_open_hint = _label("", _target, true)

func _build_resources() -> void:
	var parts := _section("② 分包场景", false)
	_resources = parts[0]
	var body: VBoxContainer = parts[1]
	_label("每个选中的场景单独成为一个分包，进入该场景前再下载。启动场景和共用资源留在首包。改动后须保存。", body, true)
	var pick := Button.new()
	pick.text = "选择要延后下载的场景…"
	body.add_child(pick)
	var picker := FileDialog.new()
	picker.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	picker.access = FileDialog.ACCESS_RESOURCES
	picker.filters = PackedStringArray(["*.tscn,*.scn ; 场景"])
	picker.files_selected.connect(func(paths: PackedStringArray):
		var scenes: Array = _resource_draft.scenes.duplicate()
		for path in paths:
			if not scenes.has(path):
				scenes.append(path)
		_resource_draft.scenes = scenes
		_refresh()
	)
	add_child(picker)
	pick.pressed.connect(func(): picker.popup_centered_ratio(0.7))
	_resource_list = VBoxContainer.new()
	body.add_child(_resource_list)
	_label("导出并转换时自动完成：接入加载脚本（写游戏工程前单独确认）→ 导出 → 拆包 → 生成接口 → 转换 → 组包。", body, true)
	_label("游戏代码需要在切换到这些场景前调用 WxResource.load_pack(\"包名\")。", body, true)
	var row := HBoxContainer.new()
	body.add_child(row)
	_resource_save = Button.new()
	_resource_save.text = "保存分包设置"
	_resource_save.pressed.connect(func():
		_resource_saved = _resource_draft.duplicate(true)
		_log_line("资源分包设置已保存（预览，仅本次编辑器会话）。")
		_refresh()
	)
	row.add_child(_resource_save)
	_resource_discard = Button.new()
	_resource_discard.text = "放弃改动"
	_resource_discard.pressed.connect(func():
		_resource_draft = _resource_saved.duplicate(true)
		_refresh()
	)
	row.add_child(_resource_discard)

func _build_capabilities() -> void:
	var parts := _section("功能支持", true)
	var body: VBoxContainer = parts[1]
	if _capabilities.is_empty():
		_label("没有读到 lib/capabilities.json。", body, true)
		return
	_label("状态来自能力清单，只代表实现情况；设备验收以证据范围为准。", body, true)
	var used := {}
	for category in CATEGORIES:
		var items := []
		for id in _capabilities.keys():
			if used.has(id):
				continue
			for prefix in category[1]:
				if str(id).begins_with(prefix):
					items.append(id)
					used[id] = true
					break
		if items.is_empty():
			continue
		var heading := Label.new()
		heading.text = category[0]
		heading.add_theme_font_size_override("font_size", 15)
		body.add_child(heading)
		for id in items:
			_capability_row(body, _capabilities[id])
	var rest := []
	for id in _capabilities.keys():
		if not used.has(id):
			rest.append(id)
	if not rest.is_empty():
		var heading := Label.new()
		heading.text = "其他"
		body.add_child(heading)
		for id in rest:
			_capability_row(body, _capabilities[id])

func _capability_row(parent: Control, item: Dictionary) -> void:
	var status := str(item.get("status", "pending"))
	var row := HBoxContainer.new()
	parent.add_child(row)
	var dot := Label.new()
	dot.text = "●"
	dot.add_theme_color_override("font_color", STATUS_COLOR.get(status, Color.WHITE))
	row.add_child(dot)
	var name_label := Label.new()
	name_label.text = "%s · %s" % [item.get("name", item.get("id")), STATUS_TEXT.get(status, status)]
	name_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)
	var limit := _label(str(item.get("limit", "")), parent, true)
	limit.add_theme_font_size_override("font_size", 12)

func _build_advanced() -> void:
	var parts := _section("高级", true)
	var body: VBoxContainer = parts[1]
	_label("自建引擎构建：给维护者用，需要固定 SDK、补丁配方和大型编译。预览版不提供入口，请用旧面板。", body, true)
	_label("打开已有任务（原「手动任务」）：用来查看、执行或取消命令行或上次会话创建的任务。日常流程由面板自动跟踪，不需要它。预览版请用旧面板。", body, true)

func _build_log() -> void:
	var parts := _section("日志", true)
	var body: VBoxContainer = parts[1]
	_log = TextEdit.new()
	_log.editable = false
	_log.custom_minimum_size.y = 120
	_log.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	body.add_child(_log)

# ---------- 行为 ----------

func _apply_draft_to_controls() -> void:
	_loading = true
	for key in _template_buttons.keys():
		_template_buttons[key].button_pressed = key == _draft.template
	for key in _orientation_buttons.keys():
		_orientation_buttons[key].button_pressed = key == _draft.orientation
	for key in _subpackage_buttons.keys():
		_subpackage_buttons[key].button_pressed = key == _draft.subpackages
	_glx.button_pressed = _draft.glx
	_prewarm.button_pressed = _draft.skipPrewarm
	_appid.text = _draft.appid
	_game_name.text = _draft.gameName
	_output.text = _draft.output
	for index in _storage.item_count:
		if _storage.get_item_metadata(index) == _draft.storage:
			_storage.select(index)
	_loading = false

func _on_draft_changed() -> void:
	_refresh()

func _read_appid_from(path: String) -> void:
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	var value := str(data.get("appid", "")) if data is Dictionary else ""
	if not _appid_valid(value):
		_appid_note.text = "这个文件里没有可用的 AppID。"
		return
	_appid.text = value
	_appid.text_changed.emit(value)
	_log_line("已从 %s 读取 AppID，保存设置后生效。" % path.get_file())

func _save_settings() -> void:
	if not _draft.appid.is_empty() and not _appid_valid(_draft.appid):
		_appid_note.text = "AppID 格式不对，未保存。"
		_settings.folded = false
		_appid.grab_focus()
		return
	var changed_build := false
	for key in ["template", "orientation", "glx", "skipPrewarm", "appid"]:
		if _draft[key] != _saved[key]:
			changed_build = true
	_saved = _draft.duplicate()
	if _write_settings():
		_log_line("设置已保存。" + ("之前的转换结果不再适用，需要重新导出并转换。" if changed_build else ""))
	if _settings_ready():
		_settings.folded = true
	_refresh()

func _settings_ready() -> bool:
	return not _saved.template.is_empty() and not _saved.output.is_empty() and _appid_valid(_saved.appid)

func _set_locked(node: Node, locked: bool) -> void:
	for child in node.get_children():
		if child is Control:
			if locked:
				if not child.has_meta("wx_lock"):
					child.set_meta("wx_lock", [child.mouse_filter, child.focus_mode])
				child.mouse_filter = Control.MOUSE_FILTER_IGNORE
				child.focus_mode = Control.FOCUS_NONE
			elif child.has_meta("wx_lock"):
				var original: Array = child.get_meta("wx_lock")
				child.mouse_filter = original[0]
				child.focus_mode = original[1]
				child.remove_meta("wx_lock")
		_set_locked(child, locked)

func _settings_summary() -> String:
	var parts := PackedStringArray([TEMPLATES.get(_saved.template, "?"), "竖屏" if _saved.orientation == "portrait" else "横屏", "GLX" if _saved.glx else "WebGL"])
	if _saved.skipPrewarm:
		parts.append("跳过预热")
	return "  ·  ".join(parts)

func _preview_only(action: String) -> void:
	_notice.dialog_text = "「%s」在预览版只检查前置条件，尚未接入执行。\n实际导出请暂用旧面板「微信导出·本地开发」。" % action
	_notice.popup_centered()

func _missing_for_export() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append(["未选模板", "template"])
	if _saved.output.is_empty():
		missing.append(["未选输出目录", "output"])
	if not _appid_valid(_saved.appid):
		missing.append(["AppID 未填写并保存", "appid"])
	if _settings_dirty():
		missing.append(["设置有未保存改动", "save"])
	if _saved.subpackages == "scenes" and _resource_saved.scenes.is_empty():
		missing.append(["分包场景未选择并保存", "resources"])
	if _saved.subpackages == "scenes" and _resource_dirty():
		missing.append(["分包场景有未保存改动", "resources"])
	if _saved.template == "custom" and not _detection_confirmed:
		missing.append(["自定义模板未完成检测", "template"])
	return missing

func _missing_for_open() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append(["未选模板", "template"])
	if not _appid_valid(_saved.appid):
		missing.append(["AppID 未填写并保存", "appid"])
	missing.append(["当前设置还没有转换成功的输出", "export"])
	return missing

func _focus_missing(target: String) -> void:
	match target:
		"resources":
			_resources.folded = false
			_resource_save.grab_focus()
		"export":
			_export_button.grab_focus()
		_:
			_settings.folded = false
			match target:
				"appid":
					_appid.grab_focus()
				"output":
					_output.grab_focus()
				"save":
					_settings_save.grab_focus()
				_:
					var first: CheckBox = _template_buttons.get("full")
					first.grab_focus()

func _refresh() -> void:
	var template_name: String = TEMPLATES.get(_saved.template, "未选模板")
	_engine_line.text = "引擎：%s   AppID：%s" % [template_name, _mask_appid(_saved.appid) + " ✓" if _appid_valid(_saved.appid) else "未设置"]
	_engine_line.tooltip_text = "完整和 2D 模板的引擎文件由安装版自动提供。"
	_appid_line.visible = false
	_output_line.text = "输出：" + (_saved.output if not _saved.output.is_empty() else "未选择")

	var settings_dirty := _settings_dirty()
	var settings_ok := _settings_ready()
	if settings_dirty:
		_settings.title = "① 设置  ● 未保存"
	elif settings_ok:
		_settings.title = "① 设置：" + _settings_summary()
	else:
		_settings.title = "① 设置（必填，未完成）"
	_lock_note.visible = not settings_ok
	var filled := {"template": not _draft.template.is_empty(), "output": not _draft.output.is_empty(), "appid": _appid_valid(_draft.appid)}
	for key in _captions.keys():
		if filled.get(key, true):
			_captions[key].remove_theme_color_override("font_color")
		else:
			_captions[key].add_theme_color_override("font_color", STATUS_COLOR.missing)
	_lower.modulate = Color(1, 1, 1, 1.0 if settings_ok else 0.4)
	_set_locked(_lower, not settings_ok)
	_settings_save.disabled = not settings_dirty
	_settings_discard.disabled = not settings_dirty
	var resource_dirty := _resource_dirty()
	_resources.title = "② 分包场景" + ("  ● 未保存" if resource_dirty else "（%d 个）" % _resource_saved.scenes.size())
	_resources.visible = _saved.subpackages == "scenes"
	_subpackage_note.text = "选「分包」并保存设置后，下方会出现「② 分包场景」，只需勾选要延后下载的场景。" if _draft.subpackages == "scenes" else "游戏全部内容放在首包里。"
	_render_resource_list()
	_resource_save.disabled = not resource_dirty
	_resource_discard.disabled = not resource_dirty

	_custom_box.visible = _draft.template == "custom"
	var glx_status := _capability_status("render-glx" if _draft.glx else "render-webgl")
	_glx_status.text = ("GLX 渲染" if _draft.glx else "WebGL 对照") + "：" + STATUS_TEXT.get(glx_status, glx_status)
	if _draft.template == "full":
		_prewarm.disabled = true
		_prewarm_note.text = "完整模板的引擎启动时固定预热，跳过需要重建引擎。"
	else:
		_prewarm.disabled = false
		_prewarm_note.text = "是否生效以所选引擎为准，待核实。"
	if _draft.appid.is_empty():
		_appid_note.text = "转换前必须填写并保存。只检查格式，不代表微信后台有效。"
	elif not _appid_valid(_draft.appid):
		_appid_note.text = "格式应为 wx 加 16 位小写十六进制。"
	else:
		_appid_note.text = "格式正确。" + ("尚未保存。" if _draft.appid != _saved.appid else "")

	var export_missing := _missing_for_export()
	var open_missing := _missing_for_open()
	_export_button.disabled = not export_missing.is_empty()
	_export_hint.text = "可以开始。" if export_missing.is_empty() else "还差：" + "、".join(PackedStringArray(export_missing.map(func(m): return m[0])))
	_open_button.disabled = not open_missing.is_empty()
	_export_button.tooltip_text = _export_hint.text
	var open_text := "还差：" + "、".join(PackedStringArray(open_missing.map(func(m): return m[0])))
	_open_button.tooltip_text = open_text
	# 导出缺项已在状态卡列出；只在导出可用而打开仍受阻时补一行说明。
	_open_hint.text = "打开" + open_text
	_open_hint.visible = export_missing.is_empty() and not open_missing.is_empty()
	_missing_box.visible = not export_missing.is_empty()

	for child in _missing_box.get_children():
		child.get_parent().remove_child(child)
		child.queue_free()
	if not export_missing.is_empty():
		var label := Label.new()
		label.text = "还差："
		label.add_theme_color_override("font_color", STATUS_COLOR.missing)
		_missing_box.add_child(label)
		for item in export_missing:
			var link := LinkButton.new()
			link.text = item[0]
			link.pressed.connect(_focus_missing.bind(item[1]))
			_missing_box.add_child(link)

func _pack_id(scene: String) -> String:
	var base := scene.get_file().get_basename().to_lower()
	var regex := RegEx.create_from_string("[^a-z0-9_-]")
	base = regex.sub(base, "_", true)
	return base if not base.is_empty() and base[0] >= "a" and base[0] <= "z" else "pack_" + base

func _dependency_closure(path: String, seen: Dictionary) -> void:
	if seen.has(path) or not ResourceLoader.exists(path):
		return
	seen[path] = true
	for entry in ResourceLoader.get_dependencies(path):
		var dep: String = entry.get_slice("::", entry.get_slice_count("::") - 1) if entry.contains("::") else entry
		if dep.begins_with("uid://"):
			dep = ResourceUID.uid_to_path(dep)
		if dep.begins_with("res://"):
			_dependency_closure(dep, seen)

func _render_resource_list() -> void:
	if _resource_list == null:
		return
	for child in _resource_list.get_children():
		child.get_parent().remove_child(child)
		child.queue_free()
	var scenes: Array = _resource_draft.scenes
	if scenes.is_empty():
		_label("还没有选择场景。", _resource_list, true)
		return
	var owners := {}
	var closures := {}
	for scene in scenes:
		var seen := {}
		_dependency_closure(scene, seen)
		closures[scene] = seen
		for path in seen.keys():
			owners[path] = owners.get(path, 0) + 1
	for scene in scenes:
		var own := 0
		var shared := 0
		for path in closures[scene].keys():
			if path == scene:
				continue
			if owners[path] > 1:
				shared += 1
			else:
				own += 1
		var row := HBoxContainer.new()
		_resource_list.add_child(row)
		var info := Label.new()
		info.text = "%s → 分包 %s\n自动带上 %d 个依赖；%d 个与其他分包共用，将放进首包" % [scene.get_file(), _pack_id(scene), own, shared]
		info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(info)
		var remove := Button.new()
		remove.text = "移除"
		remove.pressed.connect(func():
			var next: Array = _resource_draft.scenes.duplicate()
			next.erase(scene)
			_resource_draft.scenes = next
			_refresh()
		)
		row.add_child(remove)
	_label("依赖由编辑器静态分析得出，代码里用字符串动态加载的资源分析不到，需要自行确认。", _resource_list, true)
	if not _settings_ready():
		_set_locked(_resource_list, true)

func _log_line(text: String) -> void:
	if _log == null:
		return
	_log.text += Time.get_time_string_from_system() + "  " + text + "\n"
