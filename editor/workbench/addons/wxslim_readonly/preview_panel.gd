@tool
extends VBoxContainer

# 新版面板预览：只演示布局、AppID 入口和前置条件门禁，不调用适配器、不执行任务。
# 设置草稿保存在插件本机状态目录（*.private.* 已被 .gitignore 排除）。
#
# 布局：顶栏（标题 + 保存/放弃）固定；中间滚动区是三个可折叠设置组，组标题直接显示当前取值；
# 底栏（状态卡 + 导出与打开）固定。设置组完整时默认收起，一眼只看三行摘要。

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
# 每个设置组包含的字段，用于判断该组是否有未保存改动。
const GROUP_KEYS := {
	"packing": ["template", "subpackages", "scenes"],
	"runtime": ["orientation", "glx", "skipPrewarm"],
	"publish": ["appid", "gameName", "output", "storage"],
}

var _saved := {}
var _draft := {}
var _detection_confirmed := false
var _capabilities := {}
var _loading := false

var _groups := {}
var _captions := {}
var _save_state: Label
var _settings_save: Button
var _settings_discard: Button
var _template_buttons := {}
var _orientation_buttons := {}
var _subpackage_buttons := {}
var _custom_box: VBoxContainer
var _scene_box: VBoxContainer
var _scene_list: VBoxContainer
var _glx: CheckBox
var _glx_status: Label
var _prewarm: CheckBox
var _prewarm_note: Label
var _appid: LineEdit
var _appid_note: Label
var _game_name: LineEdit
var _output: LineEdit
var _storage: OptionButton
var _lock_note: Label
var _lower: VBoxContainer
var _engine_line: Label
var _output_line: Label
var _task_line: Label
var _missing_box: HFlowContainer
var _export_button: Button
var _open_button: Button
var _open_hint: Label
var _log: TextEdit
var _notice: AcceptDialog

func _state_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string("res://.godot/wxslim/state.path").strip_edges()
	return ProjectSettings.globalize_path("res://")

func _workbench_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string(INSTALL_LOCATOR).strip_edges()
	return ProjectSettings.globalize_path("res://")

func _default_settings() -> Dictionary:
	return {"storage": "project", "template": "", "orientation": "portrait", "glx": true, "skipPrewarm": false, "subpackages": "none", "scenes": [], "appid": "", "gameName": "", "output": ""}

func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_load_capabilities()
	_load_settings()
	_notice = AcceptDialog.new()
	_notice.title = "新版面板预览"
	add_child(_notice)
	_build_header()
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var content := VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 4)
	scroll.add_child(content)
	_build_packing(content)
	_build_runtime(content)
	_build_publish(content)
	_lock_note = _note("保存必填设置后，下面的功能才能使用。", content)
	_lock_note.add_theme_color_override("font_color", STATUS_COLOR.implemented)
	_lower = VBoxContainer.new()
	_lower.add_theme_constant_override("separation", 4)
	content.add_child(_lower)
	_build_capabilities(_lower)
	_build_advanced(_lower)
	_build_log(_lower)
	_build_footer()
	_apply_draft_to_controls()
	for key in _groups.keys():
		_groups[key].folded = _group_missing(key).is_empty()
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
	_draft = _saved.duplicate(true)

func _write_settings() -> bool:
	var file := FileAccess.open(_state_directory().path_join(SETTINGS_FILE), FileAccess.WRITE)
	if file == null:
		_log_line("设置保存失败：无法写入插件状态目录。")
		return false
	file.store_string(JSON.stringify(_saved, "\t") + "\n")
	file.close()
	return true

func _appid_valid(value: String) -> bool:
	return RegEx.create_from_string(APPID_PATTERN).search(value) != null

func _mask_appid(value: String) -> String:
	return value.left(6) + "…" + value.right(4) if value.length() > 10 else value

func _settings_dirty() -> bool:
	return _draft != _saved

func _group_dirty(group: String) -> bool:
	for key in GROUP_KEYS[group]:
		if _draft[key] != _saved[key]:
			return true
	return false

func _group_missing(group: String) -> Array:
	var missing := []
	match group:
		"packing":
			if _draft.template.is_empty():
				missing.append("未选模板")
			if _draft.subpackages == "scenes" and _draft.scenes.is_empty():
				missing.append("未选分包场景")
		"publish":
			if not _appid_valid(_draft.appid):
				missing.append("AppID")
			if _draft.output.is_empty():
				missing.append("输出目录")
	return missing

func _settings_ready() -> bool:
	return not _saved.template.is_empty() and not _saved.output.is_empty() and _appid_valid(_saved.appid)

func _capability_status(id: String) -> String:
	var item: Dictionary = _capabilities.get(id, {})
	return str(item.get("status", "pending"))

# ---------- 界面部件 ----------

func _note(text: String, parent: Control) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.modulate = Color(1, 1, 1, 0.6)
	label.add_theme_font_size_override("font_size", 12)
	parent.add_child(label)
	return label

func _foldable(title: String, parent: Control, folded: bool) -> Array:
	var box := FoldableContainer.new()
	box.title = title
	box.folded = folded
	parent.add_child(box)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	box.add_child(body)
	return [box, body]

func _field(caption: String, parent: Control, key := "") -> VBoxContainer:
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 2)
	parent.add_child(item)
	var label := Label.new()
	label.text = caption + (" *" if not key.is_empty() else "")
	item.add_child(label)
	if not key.is_empty():
		_captions[key] = label
	return item

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
				_refresh()
		)
		row.add_child(radio)
		store[item[0]] = radio

func _line_edit(parent: Control, placeholder: String, key: String) -> LineEdit:
	var edit := LineEdit.new()
	edit.placeholder_text = placeholder
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	edit.text_changed.connect(func(value: String):
		if not _loading:
			_draft[key] = value.strip_edges()
			_refresh()
	)
	parent.add_child(edit)
	return edit

# ---------- 顶栏与设置组 ----------

func _build_header() -> void:
	var row := HBoxContainer.new()
	add_child(row)
	var title := Label.new()
	title.text = "微信小游戏导出（预览）"
	title.add_theme_font_size_override("font_size", 16)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.clip_text = true
	row.add_child(title)
	_settings_save = Button.new()
	_settings_save.text = "保存设置"
	_settings_save.pressed.connect(_save_settings)
	row.add_child(_settings_save)
	_settings_discard = Button.new()
	_settings_discard.text = "放弃"
	_settings_discard.tooltip_text = "放弃所有未保存的设置改动"
	_settings_discard.pressed.connect(func():
		_draft = _saved.duplicate(true)
		_apply_draft_to_controls()
		_log_line("已放弃设置改动。")
		_refresh()
	)
	row.add_child(_settings_discard)
	_save_state = _note("", self)

func _build_packing(parent: Control) -> void:
	var parts := _foldable("打包方式", parent, false)
	_groups.packing = parts[0]
	var body: VBoxContainer = parts[1]

	var template := _field("模板", body, "template")
	_radio_group(template, [["full", "完整"], ["2d", "2D"], ["custom", "自定义…"]], _template_buttons, "template")
	_custom_box = VBoxContainer.new()
	template.add_child(_custom_box)
	_note("自定义需重新编译引擎：先检测游戏没用到的功能，再确认裁剪项。", _custom_box)
	var detect := Button.new()
	detect.text = "一键检测可裁剪功能（尚未实现）"
	detect.disabled = true
	_custom_box.add_child(detect)

	var subpackages := _field("资源分包", body)
	_radio_group(subpackages, [["none", "不分包"], ["scenes", "按场景分包"]], _subpackage_buttons, "subpackages")
	_scene_box = VBoxContainer.new()
	_scene_box.add_theme_constant_override("separation", 4)
	subpackages.add_child(_scene_box)
	var pick := Button.new()
	pick.text = "添加延后下载的场景…"
	_scene_box.add_child(pick)
	var picker := FileDialog.new()
	picker.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	picker.access = FileDialog.ACCESS_RESOURCES
	picker.filters = PackedStringArray(["*.tscn,*.scn ; 场景"])
	picker.files_selected.connect(func(paths: PackedStringArray):
		var scenes: Array = _draft.scenes.duplicate()
		for path in paths:
			if not scenes.has(path):
				scenes.append(path)
		_draft.scenes = scenes
		_refresh()
	)
	add_child(picker)
	pick.pressed.connect(func(): picker.popup_centered_ratio(0.7))
	_scene_list = VBoxContainer.new()
	_scene_list.add_theme_constant_override("separation", 2)
	_scene_box.add_child(_scene_list)
	var how := _note("每个场景成为一个分包，进入前再下载；共用资源留在首包。", _scene_box)
	how.tooltip_text = "导出并转换时自动完成：接入加载脚本（写游戏工程前单独确认）→ 导出 → 拆包 → 生成接口 → 转换 → 组包。\n游戏代码需要在进入这些场景前调用 WxResource.load_pack(\"包名\")。\n用字符串动态加载的资源分析不到，需要自行确认。"

func _build_runtime(parent: Control) -> void:
	var parts := _foldable("运行效果", parent, false)
	_groups.runtime = parts[0]
	var body: VBoxContainer = parts[1]
	var orientation := _field("屏幕方向", body)
	_radio_group(orientation, [["portrait", "竖屏"], ["landscape", "横屏"]], _orientation_buttons, "orientation")
	var render := _field("渲染", body)
	_glx = CheckBox.new()
	_glx.text = "启用 GLX（取消为 WebGL 电脑对照）"
	_glx.toggled.connect(func(on: bool):
		if not _loading:
			_draft.glx = on
			_refresh()
	)
	render.add_child(_glx)
	_glx_status = _note("", render)
	var prewarm := _field("启动预热", body)
	_prewarm = CheckBox.new()
	_prewarm.text = "跳过默认 3D 预热"
	_prewarm.toggled.connect(func(on: bool):
		if not _loading:
			_draft.skipPrewarm = on
			_refresh()
	)
	prewarm.add_child(_prewarm)
	_prewarm_note = _note("", prewarm)

func _build_publish(parent: Control) -> void:
	var parts := _foldable("发布信息", parent, false)
	_groups.publish = parts[0]
	var body: VBoxContainer = parts[1]

	var appid := _field("AppID", body, "appid")
	var appid_row := HBoxContainer.new()
	appid.add_child(appid_row)
	_appid = _line_edit(appid_row, "wx 开头，共 18 位", "appid")
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
	_appid_note = _note("", appid)

	var output := _field("输出目录", body, "output")
	var output_row := HBoxContainer.new()
	output.add_child(output_row)
	_output = _line_edit(output_row, "选择一个已存在的目录", "output")
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

	var game_name := _field("游戏名", body)
	_game_name = _line_edit(game_name, "显示在开发者工具中的名称", "gameName")

	var storage := _field("设置保存位置", body)
	_storage = OptionButton.new()
	for item in STORAGE:
		_storage.add_item(item[1])
		_storage.set_item_metadata(_storage.item_count - 1, item[0])
	_storage.item_selected.connect(func(index: int):
		if not _loading:
			_draft.storage = str(_storage.get_item_metadata(index))
			_refresh()
	)
	_storage.tooltip_text = "预览版统一保存在插件本机状态目录；三种位置的实际读写在正式版实现。"
	storage.add_child(_storage)

# ---------- 其他折叠区 ----------

func _build_capabilities(parent: Control) -> void:
	var body: VBoxContainer = _foldable("功能支持", parent, true)[1]
	if _capabilities.is_empty():
		_note("没有读到 lib/capabilities.json。", body)
		return
	_note("状态来自能力清单，只代表实现情况；设备验收以证据范围为准。", body)
	var used := {}
	for category in CATEGORIES + [["其他", [""]]]:
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
		body.add_child(heading)
		for id in items:
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
	name_label.tooltip_text = str(item.get("limit", ""))
	name_label.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(name_label)

func _build_advanced(parent: Control) -> void:
	var body: VBoxContainer = _foldable("高级", parent, true)[1]
	_note("自建引擎构建：给维护者用，需要固定 SDK、补丁配方和大型编译。预览版请用旧面板。", body)
	_note("打开已有任务（原「手动任务」）：查看、执行或取消命令行或上次会话创建的任务。日常流程由面板自动跟踪。预览版请用旧面板。", body)

func _build_log(parent: Control) -> void:
	var body: VBoxContainer = _foldable("日志", parent, true)[1]
	_log = TextEdit.new()
	_log.editable = false
	_log.custom_minimum_size.y = 120
	_log.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	body.add_child(_log)

# ---------- 底栏 ----------

func _build_footer() -> void:
	var footer := VBoxContainer.new()
	footer.add_theme_constant_override("separation", 4)
	add_child(footer)
	footer.add_child(HSeparator.new())
	var card := PanelContainer.new()
	footer.add_child(card)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 2)
	card.add_child(body)
	_engine_line = Label.new()
	_engine_line.clip_text = true
	body.add_child(_engine_line)
	_output_line = Label.new()
	_output_line.clip_text = true
	body.add_child(_output_line)
	_task_line = Label.new()
	_task_line.text = "任务：空闲（预览版不执行任务）"
	body.add_child(_task_line)
	_missing_box = HFlowContainer.new()
	body.add_child(_missing_box)
	var row := HFlowContainer.new()
	footer.add_child(row)
	_export_button = Button.new()
	_export_button.text = "导出并转换"
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
	_open_hint = _note("", footer)

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
		_groups.publish.folded = false
		_appid.grab_focus()
		return
	var changed_build := false
	for key in ["template", "orientation", "glx", "skipPrewarm", "appid", "subpackages", "scenes"]:
		if _draft[key] != _saved[key]:
			changed_build = true
	_saved = _draft.duplicate(true)
	if _write_settings():
		_log_line("设置已保存。" + ("之前的转换结果不再适用，需要重新导出并转换。" if changed_build else ""))
	for key in _groups.keys():
		if _group_missing(key).is_empty():
			_groups[key].folded = true
	_refresh()

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

func _preview_only(action: String) -> void:
	_notice.dialog_text = "「%s」在预览版只检查前置条件，尚未接入执行。\n实际导出请暂用旧面板「微信导出·本地开发」。" % action
	_notice.popup_centered()

func _missing_for_export() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append(["未选模板", "packing"])
	if _saved.subpackages == "scenes" and _saved.scenes.is_empty():
		missing.append(["未选分包场景", "packing"])
	if _saved.template == "custom" and not _detection_confirmed:
		missing.append(["自定义未完成检测", "packing"])
	if not _appid_valid(_saved.appid):
		missing.append(["AppID 未保存", "publish"])
	if _saved.output.is_empty():
		missing.append(["未选输出目录", "publish"])
	if _settings_dirty():
		missing.append(["设置未保存", "save"])
	return missing

func _missing_for_open() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append("未选模板")
	if not _appid_valid(_saved.appid):
		missing.append("AppID 未保存")
	missing.append("当前设置还没有转换成功的输出")
	return missing

func _focus_missing(target: String) -> void:
	if target == "save":
		_settings_save.grab_focus()
		return
	_groups[target].folded = false
	match target:
		"publish":
			(_appid if not _appid_valid(_draft.appid) else _output).grab_focus()
		_:
			(_template_buttons.full as CheckBox).grab_focus()

func _group_summary(group: String) -> String:
	var parts := PackedStringArray()
	match group:
		"packing":
			parts.append(TEMPLATES.get(_draft.template, "未选模板"))
			parts.append("分包 %d 个场景" % _draft.scenes.size() if _draft.subpackages == "scenes" else "不分包")
		"runtime":
			parts.append("竖屏" if _draft.orientation == "portrait" else "横屏")
			parts.append("GLX" if _draft.glx else "WebGL")
			if _draft.skipPrewarm:
				parts.append("跳过预热")
		"publish":
			parts.append(_mask_appid(_draft.appid) if _appid_valid(_draft.appid) else "AppID 未填")
			parts.append(_draft.output.get_file() if not _draft.output.is_empty() else "未选输出")
	return " · ".join(parts)

func _refresh() -> void:
	var names := {"packing": "打包方式", "runtime": "运行效果", "publish": "发布信息"}
	for key in _groups.keys():
		var missing := _group_missing(key)
		var marks := ("⚠ " if not missing.is_empty() else "")
		_groups[key].title = "%s%s：%s%s" % [marks, names[key], _group_summary(key), "  ●" if _group_dirty(key) else ""]
		_groups[key].tooltip_text = ("还差：" + "、".join(PackedStringArray(missing))) if not missing.is_empty() else ""
	var filled := {"template": not _draft.template.is_empty(), "output": not _draft.output.is_empty(), "appid": _appid_valid(_draft.appid)}
	for key in _captions.keys():
		if filled.get(key, true):
			_captions[key].remove_theme_color_override("font_color")
		else:
			_captions[key].add_theme_color_override("font_color", STATUS_COLOR.missing)

	var dirty := _settings_dirty()
	_settings_save.disabled = not dirty
	_settings_discard.disabled = not dirty
	_save_state.text = "● 有未保存的改动（带 ● 的组）" if dirty else "设置已保存。点组标题可展开修改，带 * 的为必填。"
	_save_state.modulate = Color(1, 1, 1, 1.0 if dirty else 0.6)
	if dirty:
		_save_state.add_theme_color_override("font_color", STATUS_COLOR.implemented)
	else:
		_save_state.remove_theme_color_override("font_color")

	var settings_ok := _settings_ready()
	_lock_note.visible = not settings_ok
	_lower.modulate = Color(1, 1, 1, 1.0 if settings_ok else 0.4)
	_set_locked(_lower, not settings_ok)

	_custom_box.visible = _draft.template == "custom"
	_scene_box.visible = _draft.subpackages == "scenes"
	_render_scene_list()
	var glx_status := _capability_status("render-glx" if _draft.glx else "render-webgl")
	_glx_status.text = ("GLX 渲染" if _draft.glx else "WebGL 对照") + "：" + STATUS_TEXT.get(glx_status, glx_status)
	_prewarm.disabled = _draft.template == "full"
	_prewarm_note.text = "完整模板启动时固定预热，跳过需重建引擎。" if _draft.template == "full" else "是否生效以所选引擎为准，待核实。"
	if _draft.appid.is_empty():
		_appid_note.text = "转换前必填。只检查格式，不代表微信后台有效。"
	elif not _appid_valid(_draft.appid):
		_appid_note.text = "格式应为 wx 加 16 位小写十六进制。"
	else:
		_appid_note.text = "格式正确。"

	_engine_line.text = "引擎：%s   AppID：%s" % [TEMPLATES.get(_saved.template, "未选"), _mask_appid(_saved.appid) + " ✓" if _appid_valid(_saved.appid) else "未设置"]
	_engine_line.tooltip_text = "完整和 2D 模板的引擎文件由安装版自动提供。"
	_output_line.text = "输出：" + (_saved.output if not _saved.output.is_empty() else "未选择")
	_output_line.tooltip_text = _saved.output

	var export_missing := _missing_for_export()
	var open_missing := _missing_for_open()
	_export_button.disabled = not export_missing.is_empty()
	_export_button.tooltip_text = "" if export_missing.is_empty() else "还差：" + "、".join(PackedStringArray(export_missing.map(func(m): return m[0])))
	_open_button.disabled = not open_missing.is_empty()
	_open_button.tooltip_text = "还差：" + "、".join(PackedStringArray(open_missing))
	_open_hint.text = "打开还差：" + "、".join(PackedStringArray(open_missing))
	_open_hint.visible = export_missing.is_empty() and not open_missing.is_empty()

	for child in _missing_box.get_children():
		_missing_box.remove_child(child)
		child.queue_free()
	_missing_box.visible = not export_missing.is_empty()
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
	var base := RegEx.create_from_string("[^a-z0-9_-]").sub(scene.get_file().get_basename().to_lower(), "_", true)
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

func _render_scene_list() -> void:
	for child in _scene_list.get_children():
		_scene_list.remove_child(child)
		child.queue_free()
	var scenes: Array = _draft.scenes
	if scenes.is_empty():
		_note("还没有添加场景。", _scene_list)
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
			if path != scene:
				if owners[path] > 1:
					shared += 1
				else:
					own += 1
		var row := HBoxContainer.new()
		_scene_list.add_child(row)
		var info := Label.new()
		info.text = "%s → %s（依赖 %d，共用 %d）" % [scene.get_file(), _pack_id(scene), own, shared]
		info.tooltip_text = "%s\n自动带上 %d 个依赖；%d 个与其他分包共用，将放进首包。" % [scene, own, shared]
		info.mouse_filter = Control.MOUSE_FILTER_PASS
		info.clip_text = true
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(info)
		var remove := Button.new()
		remove.text = "×"
		remove.tooltip_text = "移除这个场景"
		remove.flat = true
		remove.pressed.connect(func():
			var next: Array = _draft.scenes.duplicate()
			next.erase(scene)
			_draft.scenes = next
			_refresh()
		)
		row.add_child(remove)

func _log_line(text: String) -> void:
	if _log != null:
		_log.text += Time.get_time_string_from_system() + "  " + text + "\n"
