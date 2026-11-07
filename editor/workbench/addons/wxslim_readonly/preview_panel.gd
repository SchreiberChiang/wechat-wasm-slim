@tool
extends VBoxContainer

# 新版面板：设置、门禁，并通过 quick-adapter.mjs 调用快速流程（导出并转换、打开、取消）。
# 设置草稿保存在插件本机状态目录（*.private.* 已被 .gitignore 排除）。
#
# 布局：顶栏（标题 + 保存/放弃）固定；中间滚动区是三个可折叠设置组，组标题直接显示当前取值；
# 底栏（状态卡 + 导出与打开）固定。设置组完整时默认收起，一眼只看三行摘要。

const INSTALL_LOCATOR := "res://addons/wxslim_readonly/workbench.path"
const SETTINGS_FILE := "panel-preview-settings.private.json"
const LAST_RUN_FILE := "panel-preview-last-run.private.json"
const STEP_TEXT := {"start": "准备运行目录", "export": "导出 PCK", "convert": "官方转换", "devtools": "生成电脑预览包", "open": "打开开发者工具"}
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
	"publish": ["appid", "appidFrom", "gameName", "output", "storage"],
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
var _confirm: ConfirmationDialog
var _project: LineEdit
var _advanced: FoldableContainer
var _appid_source_value := ""
var _job := {}
var _cancel_job := {}
var _cancel_button: Button
var _cancel_confirm: ConfirmationDialog
var _poll_elapsed := 0.0
var _last_run := {}

func _state_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string("res://.godot/wxslim/state.path").strip_edges()
	return ProjectSettings.globalize_path("res://")

func _workbench_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string(INSTALL_LOCATOR).strip_edges()
	return ProjectSettings.globalize_path("res://")

func _default_settings() -> Dictionary:
	return {"storage": "project", "template": "", "orientation": "portrait", "glx": true, "skipPrewarm": false, "subpackages": "none", "scenes": [], "appid": "", "appidFrom": "", "gameName": "", "output": "", "project": ""}

func _installed() -> bool:
	return FileAccess.file_exists(INSTALL_LOCATOR)

# 安装到游戏后导出的就是当前工程；在源码工作台里开发时由「游戏工程目录」指定。
func _game_project() -> String:
	return ProjectSettings.globalize_path("res://").trim_suffix("/") if _installed() else _saved.project

func _config_file() -> String:
	return _state_directory().path_join("local-config.json")

func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_load_capabilities()
	_load_settings()
	_notice = AcceptDialog.new()
	_notice.title = "微信小游戏导出"
	add_child(_notice)
	_confirm = ConfirmationDialog.new()
	_confirm.title = "确认导出并转换"
	_confirm.ok_button_text = "开始"
	_confirm.cancel_button_text = "取消"
	_confirm.confirmed.connect(func(): _quick_start("run"))
	add_child(_confirm)
	_cancel_confirm = ConfirmationDialog.new()
	_cancel_confirm.title = "取消导出并转换"
	_cancel_confirm.dialog_text = "正在执行的步骤会在安全点停止（导出要等编辑器进程退出），后面的步骤不再开始。\n不回滚：已写入的内容保留在本次运行目录，可手动删除。"
	_cancel_confirm.ok_button_text = "取消运行"
	_cancel_confirm.cancel_button_text = "继续运行"
	_cancel_confirm.confirmed.connect(_quick_cancel)
	add_child(_cancel_confirm)
	_load_last_run()
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
	title.text = "微信小游戏导出"
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
	# 手动改动 AppID 后，之前从文件读到的来源不再对应，清掉来源记录。
	_appid.text_changed.connect(func(value: String):
		if not _loading and value.strip_edges() != _appid_source_value:
			_draft.appidFrom = ""
			_refresh()
	)
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
	var parts := _foldable("高级", parent, true)
	_advanced = parts[0]
	var body: VBoxContainer = parts[1]
	# 安装到游戏后导出的就是当前打开的工程；只有在源码工作台里开发面板时才需要另指游戏目录。
	if not _installed():
		var project := _field("游戏工程目录（源码工作台用）", body, "project")
		var project_row := HBoxContainer.new()
		project.add_child(project_row)
		_project = _line_edit(project_row, "含 project.godot 和 Web 导出预设的游戏目录", "project")
		var project_picker := FileDialog.new()
		project_picker.file_mode = FileDialog.FILE_MODE_OPEN_DIR
		project_picker.access = FileDialog.ACCESS_FILESYSTEM
		project_picker.dir_selected.connect(func(value: String):
			_project.text = value
			_project.text_changed.emit(value)
		)
		add_child(project_picker)
		var project_choose := Button.new()
		project_choose.text = "选择…"
		project_choose.pressed.connect(func(): project_picker.popup_centered_ratio(0.7))
		project_row.add_child(project_choose)
		_note("插件安装到游戏后，导出的就是当前打开的工程，不会显示这一项。改动后点顶部「保存设置」。", project)
	_note("以下功能还在「微信导出·旧版（待并入）」停靠栏，接入本面板后移除旧版：2D 与自定义模板、按场景分包、自建引擎构建（维护者用）、打开已有任务（查看或取消命令行及上次会话的任务）。", body)

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
	_task_line.text = "任务：空闲"
	body.add_child(_task_line)
	_missing_box = HFlowContainer.new()
	body.add_child(_missing_box)
	var row := HFlowContainer.new()
	footer.add_child(row)
	_export_button = Button.new()
	_export_button.text = "导出并转换"
	_export_button.custom_minimum_size = Vector2(130, 32)
	_export_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_export_button.pressed.connect(func(): _quick_start("plan"))
	row.add_child(_export_button)
	_open_button = Button.new()
	_open_button.text = "在开发者工具中打开"
	_open_button.custom_minimum_size = Vector2(130, 32)
	_open_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_open_button.pressed.connect(func(): _quick_start("open"))
	row.add_child(_open_button)
	_cancel_button = Button.new()
	_cancel_button.text = "取消"
	_cancel_button.custom_minimum_size = Vector2(80, 32)
	_cancel_button.tooltip_text = "停止本次导出并转换；不回滚"
	_cancel_button.pressed.connect(func(): _cancel_confirm.popup_centered())
	row.add_child(_cancel_button)
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
	_appid_source_value = _draft.appid if not _draft.appidFrom.is_empty() else ""
	if _project != null:
		_project.text = _draft.project
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
	_appid_source_value = value
	_draft.appidFrom = path
	_appid.text = value
	_appid.text_changed.emit(value)
	_log_line("已从 %s 读取 AppID，保存设置后生效。" % path)

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

# ---------- 快速流程任务 ----------

func _show_notice(title: String, text: String) -> void:
	_notice.title = title
	_notice.dialog_text = text
	_notice.popup_centered()

func _load_last_run() -> void:
	var file := _state_directory().path_join(LAST_RUN_FILE)
	var data = JSON.parse_string(FileAccess.get_file_as_string(file)) if FileAccess.file_exists(file) else null
	_last_run = data if data is Dictionary else {}

func _save_last_run(result: Dictionary, settings_key: String) -> void:
	_last_run = {"settings": settings_key, "run": result.get("run", ""), "projectConfig": result.get("projectConfig", ""),
		"devtoolsConfig": result.get("devtoolsConfig", ""), "packageId": _package_id(result)}
	var file := FileAccess.open(_state_directory().path_join(LAST_RUN_FILE), FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(_last_run, "\t") + "\n")
		file.close()

# 上次成功的输出只在设置没变时可用；改过模板、方向等之后必须重新导出并转换。
func _last_run_usable() -> bool:
	if _last_run.is_empty() or _last_run.get("settings", "") != JSON.stringify(_saved):
		return false
	var target: String = _last_run.get("devtoolsConfig", "")
	if target.is_empty():
		target = _last_run.get("projectConfig", "")
	return not target.is_empty() and FileAccess.file_exists(target)

func _package_id(result: Dictionary) -> String:
	var steps: Dictionary = result.get("steps", {})
	if steps.get("devtools") is Dictionary:
		return str(steps.devtools.get("packageId", ""))
	if steps.get("convert") is Dictionary and steps.convert.get("outcome") is Dictionary:
		return str(steps.convert.outcome.get("packageId", ""))
	return ""

# 写请求文件并启动适配器；失败时提示并返回空字典，什么都没有执行。
func _spawn_adapter(node: String, mode: String, request: Dictionary) -> Dictionary:
	var token := "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var logs := _state_directory().path_join("logs")
	DirAccess.make_dir_recursive_absolute(logs)
	var request_file := FileAccess.open(logs.path_join(token + ".quick-request.private.json"), FileAccess.WRITE)
	if request_file == null:
		_show_notice("无法开始", "无法写入插件日志目录：" + logs)
		return {}
	request_file.store_string(JSON.stringify(request))
	request_file.close()
	var adapter := _workbench_directory().path_join("quick-adapter.mjs")
	var pid := OS.create_process(node, PackedStringArray([adapter, _config_file(), mode, token]), false)
	if pid <= 0:
		_show_notice("无法开始", "没能启动 Node 进程；没有执行任何步骤。")
		return {}
	return {"pid": pid, "token": token, "result": logs.path_join(token + ".quick-result.private.json"), "events": logs.path_join(token + ".quick-events.private.jsonl")}

# 取消只针对本面板发起、还在进行的「导出并转换」。由适配器找到运行目录，走共用任务核心的取消。
func _quick_cancel() -> void:
	if _job.is_empty() or _job.mode != "run" or not _cancel_job.is_empty() or _job.get("cancelling", false):
		return
	var config = JSON.parse_string(FileAccess.get_file_as_string(_config_file())) if FileAccess.file_exists(_config_file()) else null
	if not config is Dictionary:
		return
	var spawned := _spawn_adapter(str(config.get("nodeExecutable", "")), "cancel", {"runToken": _job.token})
	if spawned.is_empty():
		return
	_cancel_job = spawned
	_job.cancelling = true
	_task_line.text = "任务：正在取消…（等当前步骤到安全点）"
	_log_line("已请求取消导出并转换。")
	set_process(true)
	_refresh()

func _on_cancel_result(result: Dictionary) -> void:
	var task = result.get("task")
	if result.get("status") == "CANCEL_REQUESTED":
		if task is Dictionary:
			_log_line("取消请求已送达 %s 任务 %s（%s）。" % [STEP_TEXT.get(str(task.get("step", "")), task.get("step", "")), task.get("taskId", ""),
				"该任务已结束" if task.get("alreadyEnded") == true else "等待它在安全点停止"])
		else:
			_log_line("已写入取消标记：" + str(result.get("note", "下一步开始前停止")))
	else:
		# 例如运行目录尚未建立或运行刚好结束；面板保持运行状态，结果以运行本身的收据为准。
		if not _job.is_empty():
			_job.cancelling = false
		_log_line("取消没有生效：%s" % str(result.get("message", result.get("code", ""))))
	_refresh()

func _quick_start(mode: String) -> void:
	if not _job.is_empty():
		return
	var config = JSON.parse_string(FileAccess.get_file_as_string(_config_file())) if FileAccess.file_exists(_config_file()) else null
	if not config is Dictionary or not FileAccess.file_exists(str(config.get("nodeExecutable", ""))):
		_show_notice("无法开始", "没有找到插件本机配置或 Node：%s\n请先用安装版的 install.mjs 安装插件。" % _config_file())
		return
	var request := {}
	if mode == "open":
		if not _last_run_usable():
			return
		var target: String = _last_run.get("devtoolsConfig", "")
		request = {"projectConfig": target if not target.is_empty() else _last_run.get("projectConfig", "")}
	else:
		request = {"project": _game_project(), "settings": _saved}
	var spawned := _spawn_adapter(str(config.nodeExecutable), mode, request)
	if spawned.is_empty():
		return
	# 记下发起时的设置：运行期间若又保存了新设置，结果只算在发起时那份设置名下。
	_job = spawned
	_job.merge({"mode": mode, "started": Time.get_ticks_msec(), "settings": JSON.stringify(_saved)})
	_task_line.text = {"plan": "任务：正在检查…", "run": "任务：开始导出…", "open": "任务：正在打开开发者工具…"}[mode]
	_log_line({"plan": "开始只读检查。", "run": "开始导出并转换，运行目录在输出目录下。", "open": "打开 " + str(request.get("projectConfig", ""))}[mode])
	_poll_elapsed = 0.0
	set_process(true)
	_refresh()

func _process(delta: float) -> void:
	if _job.is_empty() and _cancel_job.is_empty():
		set_process(false)
		return
	_poll_elapsed += delta
	if _poll_elapsed < 0.5:
		return
	_poll_elapsed = 0.0
	if not _cancel_job.is_empty():
		if FileAccess.file_exists(_cancel_job.result):
			var cancel_result = JSON.parse_string(FileAccess.get_file_as_string(_cancel_job.result))
			_cancel_job = {}
			_on_cancel_result(cancel_result if cancel_result is Dictionary else {})
		elif not OS.is_process_running(int(_cancel_job.pid)):
			_cancel_job = {}
			_log_line("取消进程已退出但没有结果；请查看插件 logs。")
	if _job.is_empty():
		return
	var seconds := int((Time.get_ticks_msec() - int(_job.started)) / 1000)
	if _job.mode == "run" and FileAccess.file_exists(_job.events):
		var lines := FileAccess.get_file_as_string(_job.events).strip_edges().split("\n")
		var last = JSON.parse_string(lines[lines.size() - 1]) if lines.size() > 0 and not lines[0].is_empty() else null
		if last is Dictionary:
			var phase := {"start": "", "plan": "计划中", "execute": "进行中", "done": "完成"}.get(str(last.get("phase", "")), "")
			_task_line.text = "任务：%s%s · %s（%d 秒）" % ["正在取消 · " if _job.get("cancelling", false) else "", STEP_TEXT.get(str(last.get("step", "")), ""), phase, seconds]
	if FileAccess.file_exists(_job.result):
		var result = JSON.parse_string(FileAccess.get_file_as_string(_job.result))
		var job := _job
		_job = {}
		_on_quick_result(job, result if result is Dictionary else {})
	elif not OS.is_process_running(int(_job.pid)):
		_job = {}
		_task_line.text = "任务：适配进程已退出但没有结果；请查看插件 logs。"
		_refresh()

func _on_quick_result(job: Dictionary, result: Dictionary) -> void:
	var seconds := int((Time.get_ticks_msec() - int(job.started)) / 1000)
	var blockers: Array = result.get("blockers", [])
	var messages := PackedStringArray(blockers.map(func(b): return "· " + str(b.get("message", b.get("code", "")))))
	match job.mode:
		"plan":
			if result.get("ready") == true:
				var lines := PackedStringArray()
				for step in result.get("steps", []):
					lines.append("· %s：%s" % [step.get("title", ""), step.get("detail", "")])
					if step.has("note"):
						lines.append("    %s" % step.note)
				_confirm.dialog_text = "将依次执行：\n%s\n\n每次运行使用新目录，不覆盖旧输出；任一步失败即停止，不回滚。" % "\n".join(lines)
				_task_line.text = "任务：检查通过，等待确认"
				_confirm.popup_centered()
			else:
				_task_line.text = "任务：检查未通过"
				_show_notice("还不能导出", "\n".join(messages) if not messages.is_empty() else str(result.get("message", "检查失败")))
		"run":
			if result.get("status") == "SUCCESS":
				_save_last_run(result, job.settings)
				_task_line.text = "任务：完成（%d 秒）· 包号 %s" % [seconds, _last_run.packageId]
				_log_line("导出并转换完成：" + str(result.get("run", "")))
			elif result.get("status") == "CANCELLED":
				_task_line.text = "任务：已取消（%d 秒）" % seconds
				_log_line("已取消：%s。没有回滚，已写入的内容保留在 %s" % [str(result.get("error", {}).get("message", "")), str(result.get("run", ""))])
			elif result.get("status") == "BLOCKED":
				_task_line.text = "任务：未开始"
				_show_notice("还不能导出", "\n".join(messages))
			else:
				var error: Dictionary = result.get("error", {})
				_task_line.text = "任务：失败 · %s" % str(error.get("code", result.get("code", "")))
				_show_notice("导出并转换失败", "%s\n\n已写入的内容保留在：%s" % [str(error.get("message", result.get("message", ""))), str(result.get("run", "插件 logs"))])
		"open":
			if result.get("status") == "SUCCESS":
				_task_line.text = "任务：开发者工具已打开"
			else:
				_task_line.text = "任务：打开失败"
				_show_notice("打开失败", str(result.get("message", "")))
	_refresh()

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
	if not _installed() and _saved.project.is_empty():
		missing.append(["未选游戏工程目录", "advanced"])
	if _settings_dirty():
		missing.append(["设置未保存", "save"])
	return missing

func _missing_for_open() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append("未选模板")
	if not _appid_valid(_saved.appid):
		missing.append("AppID 未保存")
	if not _last_run_usable():
		missing.append("当前设置还没有转换成功的输出")
	return missing

func _focus_missing(target: String) -> void:
	if target == "save":
		_settings_save.grab_focus()
		return
	if target == "advanced":
		_advanced.folded = false
		_project.grab_focus()
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
	var filled := {"template": not _draft.template.is_empty(), "output": not _draft.output.is_empty(), "appid": _appid_valid(_draft.appid), "project": _installed() or not _draft.project.is_empty()}
	_advanced.title = ("⚠ " if not filled.project else "") + "高级" + ("  ●" if _draft.project != _saved.project else "")
	_advanced.tooltip_text = "" if filled.project else "还差：游戏工程目录"
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
	# 完整模板不能跳过预热：切到完整模板时自动取消勾选，而不是留下一个勾着但点不动的选项。
	if _draft.template == "full" and _draft.skipPrewarm:
		_draft.skipPrewarm = false
		_loading = true
		_prewarm.button_pressed = false
		_loading = false
	_prewarm.disabled = _draft.template == "full"
	_prewarm_note.text = "完整模板启动时固定预热，跳过需重建引擎。" if _draft.template == "full" else "是否生效以所选引擎为准，待核实。"
	if _draft.appid.is_empty():
		_appid_note.text = "转换前必填。只检查格式，不代表微信后台有效。"
	elif not _appid_valid(_draft.appid):
		_appid_note.text = "格式应为 wx 加 16 位小写十六进制。"
	elif not _draft.appidFrom.is_empty():
		_appid_note.text = "格式正确，来自 " + _draft.appidFrom
	else:
		_appid_note.text = "格式正确，手动填写；转换时作为本机 AppID 来源。"

	_engine_line.text = "引擎：%s   AppID：%s" % [TEMPLATES.get(_saved.template, "未选"), _mask_appid(_saved.appid) + " ✓" if _appid_valid(_saved.appid) else "未设置"]
	_engine_line.tooltip_text = "完整和 2D 模板的引擎文件由安装版自动提供。"
	_output_line.text = "输出：" + (_saved.output if not _saved.output.is_empty() else "未选择")
	_output_line.tooltip_text = _saved.output

	var export_missing := _missing_for_export()
	var open_missing := _missing_for_open()
	var busy := not _job.is_empty()
	_export_button.disabled = busy or not export_missing.is_empty()
	_export_button.text = "导出中…" if busy and _job.mode == "run" else "导出并转换"
	_export_button.tooltip_text = "" if export_missing.is_empty() else "还差：" + "、".join(PackedStringArray(export_missing.map(func(m): return m[0])))
	_cancel_button.visible = busy and _job.mode == "run"
	_cancel_button.disabled = _job.get("cancelling", false)
	_cancel_button.text = "取消中…" if _job.get("cancelling", false) else "取消"
	_open_button.disabled = busy or not open_missing.is_empty()
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
