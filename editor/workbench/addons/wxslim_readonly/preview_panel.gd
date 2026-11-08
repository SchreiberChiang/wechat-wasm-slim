@tool
extends VBoxContainer

# 「微信导出」面板：设置、检查，并通过 quick-adapter.mjs 调用快速流程（wxslim.mjs quick 的同一套接口）。
#   requirements：所选模板要确认的项目；plan：检查一次；run：导出并转换；status：单次运行的进度和结果；
#   runs：最近运行；cancel：取消；open：打开一次已完成的运行；receiver：按场景分包前往游戏里装分包加载脚本。
# 设置草稿保存在插件本机状态目录（*.private.* 已被 .gitignore 排除）。
#
# 布局：顶栏（标题 + 保存/放弃）固定；中间滚动区是三个可折叠设置组，组标题直接显示当前取值；
# 底栏（状态卡 + 导出与打开）固定。状态卡四行自动换行，窄侧栏、大字号时也能读全。
# 自建引擎和按请求文件打开任务只在命令行提供（见 docs/离线开发.md）。

const INSTALL_LOCATOR := "res://addons/wxslim_readonly/workbench.path"
const SETTINGS_FILE := "panel-preview-settings.private.json"
const LAST_RUN_FILE := "panel-preview-last-run.private.json"
const STEP_TEXT := {"start": "准备运行目录", "export": "导出 PCK", "split": "按场景拆包", "interfaces": "生成分包接口", "convert": "官方转换", "assemble": "组装分包", "devtools": "生成电脑预览包", "open": "打开开发者工具"}
const APPID_PATTERN := "^wx[0-9a-f]{16}$"
const TEMPLATES := {"full": "完整模板", "conservative": "保守模板", "2d": "2D 模板"}
const LOCALES := [["zh_CN", "简体中文（zh_CN）"], ["en", "英文（en）"]]
const PROJECT_SETTINGS := "res://wxslim.json"
const LOCAL_SETTINGS := "res://.godot/wxslim/panel-settings.json"
const RECEIVER_SCRIPT := "res://godot-resource-game-facade.gd"
const RECEIVER_AUTOLOAD := "*res://godot-resource-game-facade.gd"
# 与游戏相关、适合随项目共享的选择。输出目录、AppID 及其来源文件、源码工作台的游戏目录属于本机，始终只存在本机状态目录。
const SHARED_KEYS := ["template", "confirmNo3d", "confirmRemovedModules", "orientation", "glx", "skipPrewarm", "subpackages", "scenes", "gameName", "locale", "largePck", "loginCode"]
const STORAGE := [["project", "跟随项目"], ["project-local", "仅本工程本机"], ["machine", "仅本电脑"]]
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
	"packing": ["template", "confirmNo3d", "confirmRemovedModules", "subpackages", "scenes"],
	"runtime": ["orientation", "glx", "skipPrewarm", "locale", "largePck", "loginCode"],
	"publish": ["appid", "appidFrom", "gameName", "output", "storage"],
}
# 快速流程返回的错误 field → 面板里的设置组。不在面板里的项目（导出预设、主场景等）只在提示里说明怎么改。
const FIELD_GROUP := {
	"template": "packing", "confirmNo3d": "packing", "confirmRemovedModules": "packing", "subpackages": "packing", "scenes": "packing", "receiver": "packing",
	"orientation": "runtime", "glx": "runtime", "skipPrewarm": "runtime", "locale": "runtime", "largePck": "runtime", "loginCode": "runtime",
	"appid": "publish", "appidFrom": "publish", "output": "publish", "gameName": "publish", "project": "advanced",
}
const FIELD_HINT := {
	"exportPreset": "在 Godot「项目 → 导出」里保留恰好一个 Web 预设。",
	"mainScene": "在「项目 → 项目设置 → 应用 → 运行 → 主场景」里选好主场景。",
	"plugin": "在「项目 → 项目设置 → 插件」里启用微信导出插件。",
	"editor": "在「项目 → 项目设置 → 插件」里把微信导出插件关掉再打开，让它重新记录 Godot 编辑器的位置。",
	"release": "插件文件不全，请重新复制整个 addons/wxslim_readonly 文件夹。",
	"exportBudgetMiB": "游戏导出太大，超出了导出预算。",
	"importCacheBudgetMiB": "Godot 导入缓存增长太多。",
	"rebuiltPreparation": "自建引擎的设置不对，请用命令行检查（见离线开发说明）。",
}
# 与 lib/quick-flow.mjs 一致，仅在读到 quick requirements 之前用于提示；实际声明由快速流程按 PCK 生成。
const FALLBACK_REMOVED := {
	"2d": ["csg", "fbx", "gltf", "godot_physics_3d", "gridmap", "jolt_physics", "meshoptimizer", "mobile_vr", "navigation_3d", "vhacd", "webxr"],
	"conservative": ["enet", "fbx", "gltf", "mobile_vr", "upnp", "vhacd", "webxr"],
}
const CONFIRM_TEXT := {
	"2d": ["确认游戏没有用到 3D 功能", "会去掉 3D 渲染与物理、GLTF/FBX 导入、CSG、GridMap、3D 导航和 XR。首次转换要先核验引擎来源，约 4 到 5 分钟。"],
	"conservative": ["确认游戏没有用到下面这些功能", "保守版去掉 ENet 联机、FBX/GLTF 模型导入、VR/XR、UPnP 端口映射和凸分解碰撞，其余与完整版相同。"],
}
const RUN_STATUS := {"SUCCESS": ["完成", "verified"], "CANCELLED": ["已取消", "unsupported"], "FAILED": ["失败", "missing"], "UNFINISHED": ["未结束", "implemented"]}

var _saved := {}
var _draft := {}
var _capabilities := {}
var _loading := false
var _requirements := {}

var _groups := {}
var _group_errors := {}
var _captions := {}
var _save_state: Label
var _settings_save: Button
var _settings_discard: Button
var _template_buttons := {}
var _orientation_buttons := {}
var _subpackage_buttons := {}
var _confirm_box: VBoxContainer
var _confirm_check: CheckBox
var _confirm_note: Label
var _scene_box: VBoxContainer
var _scene_list: VBoxContainer
var _receiver_line: Label
var _receiver_button: Button
var _receiver_confirm: ConfirmationDialog
var _glx: CheckBox
var _glx_status: Label
var _prewarm: CheckBox
var _prewarm_note: Label
var _locale: OptionButton
var _locale_note: Label
var _large_pck: CheckBox
var _login_code: CheckBox
var _login_note: Label
var _appid: LineEdit
var _appid_note: Label
var _game_name: LineEdit
var _output: LineEdit
var _storage: OptionButton
var _storage_note: Label
var _lock_note: Label
var _lower: VBoxContainer
var _engine_line: Label
var _input_line: Label
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
var _runs_job := {}
var _status_job := {}
var _requirements_job := {}
var _receiver_job := {}
var _runs := []
var _runs_note: Label
var _runs_list: VBoxContainer
var _trash_confirm: ConfirmationDialog
var _poll_elapsed := 0.0
var _status_elapsed := 0.0
var _last_run := {}
var _pending_focus := ""

func _state_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string("res://.godot/wxslim/state.path").strip_edges()
	return ProjectSettings.globalize_path("res://")

func _workbench_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string(INSTALL_LOCATOR).strip_edges()
	return ProjectSettings.globalize_path("res://")

func _default_settings() -> Dictionary:
	return {"storage": "project", "template": "", "orientation": "portrait", "glx": true, "skipPrewarm": false, "confirmNo3d": false, "confirmRemovedModules": false,
		"subpackages": "none", "scenes": [], "appid": "", "appidFrom": "", "gameName": "", "output": "", "project": "",
		"locale": "zh_CN", "largePck": false, "loginCode": false}

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
	_notice.confirmed.connect(_focus_pending)
	_notice.canceled.connect(_focus_pending)
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
	_receiver_confirm = ConfirmationDialog.new()
	_receiver_confirm.title = "往游戏里装分包加载脚本"
	_receiver_confirm.ok_button_text = "装上"
	_receiver_confirm.cancel_button_text = "先不装"
	_receiver_confirm.confirmed.connect(func(): _receiver_start(true))
	add_child(_receiver_confirm)
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
	_refresh_runs()
	_request_requirements(_draft.template)

# ---------- 数据 ----------

func _load_capabilities() -> void:
	var file := _workbench_directory().path_join("../../lib/capabilities.json").simplify_path()
	var data = JSON.parse_string(FileAccess.get_file_as_string(file)) if FileAccess.file_exists(file) else null
	if data is Dictionary and data.get("capabilities") is Array:
		for item in data.capabilities:
			if item is Dictionary and item.get("id") is String:
				_capabilities[item.id] = item

# 设置保存位置：本机状态目录里始终有一份完整设置（含保存位置本身和只属于本机的路径）；
# 选「跟随项目」或「仅本工程本机」时，与游戏相关的选择另写到对应文件，读取时以它为准。
func _shared_file(storage: String) -> String:
	return {"project": PROJECT_SETTINGS, "project-local": LOCAL_SETTINGS}.get(storage, "")

func _overlay(target: Dictionary, file: String, keys: Array) -> bool:
	if not FileAccess.file_exists(file):
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(file))
	if not data is Dictionary:
		return false
	for key in keys:
		if data.has(key) and typeof(data[key]) == typeof(target[key]):
			target[key] = data[key]
	return true

func _load_settings() -> void:
	_saved = _default_settings()
	var had_machine := _overlay(_saved, _state_directory().path_join(SETTINGS_FILE), _saved.keys())
	# 新电脑上第一次打开、项目里已有随项目提交的设置：直接沿用它。
	if not had_machine and FileAccess.file_exists(PROJECT_SETTINGS):
		_saved.storage = "project"
	var shared := _shared_file(_saved.storage)
	if not shared.is_empty():
		_overlay(_saved, shared, SHARED_KEYS)
	# 旧版面板的「自定义」模板需要重建引擎，已改为只在命令行提供。
	if not TEMPLATES.has(_saved.template):
		_saved.template = ""
	_draft = _saved.duplicate(true)

func _write_json(file: String, value: Dictionary) -> bool:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(file.get_base_dir()))
	var handle := FileAccess.open(file, FileAccess.WRITE)
	if handle == null:
		return false
	handle.store_string(JSON.stringify(value, "\t") + "\n")
	handle.close()
	return true

func _write_settings(previous_storage := "") -> bool:
	if not _write_json(_state_directory().path_join(SETTINGS_FILE), _saved):
		_log_line("设置保存失败：无法写入插件状态目录。")
		return false
	var shared := _shared_file(_saved.storage)
	if not shared.is_empty():
		var value := {"schema": "wxslim-panel-settings-v1"}
		for key in SHARED_KEYS:
			value[key] = _saved[key]
		if not _write_json(shared, value):
			_log_line("设置保存失败：无法写入 " + shared)
			return false
	# 换了保存位置时不删旧文件，只提示它还在。
	var old := _shared_file(previous_storage)
	if previous_storage != _saved.storage and not old.is_empty() and FileAccess.file_exists(old):
		_log_line("保存位置已改为「%s」。旧位置的文件保留未删除：%s" % [_storage_label(_saved.storage), old])
	return true

func _storage_label(storage: String) -> String:
	for item in STORAGE:
		if item[0] == storage:
			return item[1]
	return storage

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

# 所选模板要确认的字段（confirmNo3d / confirmRemovedModules）；完整模板为空。
func _confirm_field(template: String) -> String:
	var req: Dictionary = _requirements.get(template, {})
	var list: Array = req.get("confirmations", [])
	if not list.is_empty() and list[0] is Dictionary:
		return str(list[0].get("field", ""))
	return {"2d": "confirmNo3d", "conservative": "confirmRemovedModules"}.get(template, "")

func _removed_modules(template: String) -> Array:
	var req: Dictionary = _requirements.get(template, {})
	var list: Array = req.get("confirmations", [])
	if not list.is_empty() and list[0] is Dictionary and list[0].get("removedModules") is Array:
		return list[0].removedModules
	return FALLBACK_REMOVED.get(template, [])

func _confirmed(settings: Dictionary) -> bool:
	var field := _confirm_field(settings.template)
	return field.is_empty() or settings.get(field, false) == true

func _receiver_installed() -> bool:
	if not _installed():
		return true  # 源码工作台里游戏在别处，交给快速流程的检查。
	return FileAccess.file_exists(RECEIVER_SCRIPT) and str(ProjectSettings.get_setting("autoload/WxResource", "")) == RECEIVER_AUTOLOAD

func _group_missing(group: String) -> Array:
	var missing := []
	match group:
		"packing":
			if _draft.template.is_empty():
				missing.append("未选模板")
			elif not _confirmed(_draft):
				missing.append("%s未确认" % TEMPLATES[_draft.template])
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
	# 不写死字号：跟随编辑器字号缩放，只用淡色区分说明文字。
	parent.add_child(label)
	return label

func _wrapped(parent: Control) -> Label:
	var label := Label.new()
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label

func _foldable(title: String, parent: Control, folded: bool) -> Array:
	var box := FoldableContainer.new()
	box.title = title
	box.folded = folded
	# 窄侧栏或大字号时标题显示省略号，悬停看全文，不把整个面板撑宽。
	box.title_text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	parent.add_child(box)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	box.add_child(body)
	return [box, body]

# 组内第一行：快速流程按 field 指回这一组时显示的原因。
func _error_label(group: String, body: Control) -> void:
	var label := _wrapped(body)
	label.add_theme_color_override("font_color", STATUS_COLOR.missing)
	label.visible = false
	_group_errors[group] = label

func _field(caption: String, parent: Control, key := "") -> VBoxContainer:
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 2)
	parent.add_child(item)
	var label := Label.new()
	label.text = caption + (" *" if not key.is_empty() else "")
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
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
				if key == "template":
					_request_requirements(item[0])
				_refresh()
		)
		row.add_child(radio)
		store[item[0]] = radio

func _check(parent: Control, text: String, key: String) -> CheckBox:
	var box := CheckBox.new()
	box.text = text
	box.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.toggled.connect(func(on: bool):
		if not _loading:
			_draft[key] = on
			_refresh()
	)
	parent.add_child(box)
	return box

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
	_error_label("packing", body)

	var template := _field("模板", body, "template")
	_radio_group(template, [["full", "完整"], ["conservative", "保守"], ["2d", "2D"]], _template_buttons, "template")
	_note("完整：引擎原样。保守：去掉少数不常用模块，包更小。2D：去掉全部 3D 功能，包最小。自己裁剪重建引擎请用命令行。", template)
	_confirm_box = VBoxContainer.new()
	template.add_child(_confirm_box)
	_confirm_check = CheckBox.new()
	_confirm_check.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_confirm_check.toggled.connect(func(on: bool):
		var field := _confirm_field(_draft.template)
		if not _loading and not field.is_empty():
			_draft[field] = on
			_refresh()
	)
	_confirm_box.add_child(_confirm_check)
	_confirm_note = _note("", _confirm_box)

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
	var how := _note("每个场景成为一个分包，进入前再下载；被首包或多个场景共用的资源留在首包。游戏代码要在进入这些场景前调用 WxResource.load_pack(\"包名\")。", _scene_box)
	how.tooltip_text = "导出并转换时自动完成：导出 → 拆包 → 生成分包接口 → 转换 → 组包。\n用字符串拼出来的动态加载（如 load(\"res://levels/\" + name)）分析不到，需要自己确认。\n用 preload 提前加载的场景不能分包。"
	var receiver_row := HBoxContainer.new()
	_scene_box.add_child(receiver_row)
	_receiver_line = _wrapped(receiver_row)
	_receiver_button = Button.new()
	_receiver_button.text = "装分包加载脚本…"
	_receiver_button.tooltip_text = "往游戏里新建 4 个脚本，并在项目设置里加自动加载 WxResource。\n不覆盖已有文件；写之前会列出要写的内容让你确认。"
	_receiver_button.pressed.connect(func(): _receiver_start(false))
	receiver_row.add_child(_receiver_button)

func _build_runtime(parent: Control) -> void:
	var parts := _foldable("运行效果", parent, false)
	_groups.runtime = parts[0]
	var body: VBoxContainer = parts[1]
	_error_label("runtime", body)
	var orientation := _field("屏幕方向", body)
	_radio_group(orientation, [["portrait", "竖屏"], ["landscape", "横屏"]], _orientation_buttons, "orientation")
	var render := _field("渲染", body)
	_glx = _check(render, "启用 GLX（取消为 WebGL 电脑对照）", "glx")
	_glx_status = _note("", render)
	var language := _field("语言", body)
	_locale = OptionButton.new()
	_locale.fit_to_longest_item = false
	_locale.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	for item in LOCALES:
		_locale.add_item(item[1])
		_locale.set_item_metadata(_locale.item_count - 1, item[0])
	_locale.item_selected.connect(func(index: int):
		if not _loading:
			_draft.locale = str(_locale.get_item_metadata(index))
			_refresh()
	)
	language.add_child(_locale)
	_locale_note = _note("", language)
	var size := _field("包大小", body)
	_large_pck = _check(size, "大 PCK：转换预算放宽到 144 MiB（默认 120 MiB）", "largePck")
	var login := _field("登录", body)
	_login_code = _check(login, "接入临时登录 code（未实测，不是业务登录）", "loginCode")
	_login_code.tooltip_text = "开启后只生成接口，游戏需要主动请求；不会自动登录或连接业务后端。不要把 code 打印到日志里。"
	_login_note = _note("", login)
	var prewarm := _field("启动预热", body)
	_prewarm = _check(prewarm, "跳过默认 3D 预热", "skipPrewarm")
	_prewarm_note = _note("", prewarm)

func _build_publish(parent: Control) -> void:
	var parts := _foldable("发布信息", parent, false)
	_groups.publish = parts[0]
	var body: VBoxContainer = parts[1]
	_error_label("publish", body)

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
	_output = _line_edit(output_row, "游戏工程之外、已存在的文件夹", "output")
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
	_storage.fit_to_longest_item = false
	_storage.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	for item in STORAGE:
		_storage.add_item(item[1])
		_storage.set_item_metadata(_storage.item_count - 1, item[0])
	_storage.item_selected.connect(func(index: int):
		if not _loading:
			_draft.storage = str(_storage.get_item_metadata(index))
			_refresh()
	)
	_storage.tooltip_text = "跟随项目：模板、方向、GLX、语言、分包场景和游戏名写入 res://wxslim.json，可随项目提交，导出游戏时自动排除。\n仅本工程本机：写入 .godot/wxslim/，不进版本库。\n仅本电脑：只存在插件状态目录。\n输出目录、AppID 和来源文件始终只存本机，不会写进项目。"
	_storage_note = _note("", storage)
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
	_build_runs(body)
	_note("自建引擎（自己裁剪模块重新编译）和按请求文件打开任意任务只在命令行提供，见安装版里的离线开发说明。", body)

# 最近运行：输出目录里快速流程的运行，含命令行和以前会话发起的。可打开、取消未结束的、在文件夹中显示、移到回收站。
func _build_runs(parent: Control) -> void:
	var box := _field("最近运行（输出目录）", parent)
	var row := HBoxContainer.new()
	box.add_child(row)
	_runs_note = _note("", row)
	_runs_note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var reload := Button.new()
	reload.text = "刷新"
	reload.pressed.connect(_refresh_runs)
	row.add_child(reload)
	_runs_list = VBoxContainer.new()
	_runs_list.add_theme_constant_override("separation", 2)
	box.add_child(_runs_list)
	_note("取消和失败不会回滚，留下的目录可以在这里移到回收站。", box)
	_trash_confirm = ConfirmationDialog.new()
	_trash_confirm.title = "移到回收站"
	_trash_confirm.ok_button_text = "移到回收站"
	_trash_confirm.cancel_button_text = "保留"
	_trash_confirm.confirmed.connect(func():
		var target: String = _trash_confirm.get_meta("run", "")
		if target.is_empty():
			return
		var error := OS.move_to_trash(target)
		_log_line(("已移到回收站：" if error == OK else "移到回收站失败（错误 %d）：" % error) + target)
		_refresh_runs()
	)
	add_child(_trash_confirm)

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
	# 四行都自动换行：窄侧栏、大字号下不截断，悬停看完整路径。
	_engine_line = _wrapped(body)
	_input_line = _wrapped(body)
	_output_line = _wrapped(body)
	_task_line = _wrapped(body)
	_task_line.text = "任务：空闲"
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
	_large_pck.button_pressed = _draft.largePck
	_login_code.button_pressed = _draft.loginCode
	for index in _locale.item_count:
		if _locale.get_item_metadata(index) == _draft.locale:
			_locale.select(index)
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
	var output_changed: bool = _draft.output != _saved.output
	var changed_build := false
	for key in ["template", "confirmNo3d", "confirmRemovedModules", "orientation", "glx", "skipPrewarm", "appid", "subpackages", "scenes", "locale", "largePck", "loginCode"]:
		if _draft[key] != _saved[key]:
			changed_build = true
	var previous_storage: String = _saved.storage
	_saved = _draft.duplicate(true)
	if _write_settings(previous_storage):
		_log_line("设置已保存。" + ("之前的转换结果不再适用，需要重新导出并转换。" if changed_build else ""))
	_clear_field_errors()
	for key in _groups.keys():
		if _group_missing(key).is_empty():
			_groups[key].folded = true
	if output_changed:
		_refresh_runs()
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

# ---------- 错误定位 ----------

func _clear_field_errors() -> void:
	for label in _group_errors.values():
		label.text = ""
		label.visible = false

# 快速流程的拦截或失败：按 field 把原因写到对应设置组的第一行，提示框关闭后展开该组并聚焦。
# reasonCode 只记日志，不直接给用户看。
func _show_problems(title: String, problems: Array, footer := "") -> void:
	_clear_field_errors()
	var lines := PackedStringArray()
	_pending_focus = ""
	for item in problems:
		if not item is Dictionary:
			continue
		var message := str(item.get("message", "")).strip_edges()
		if message.is_empty():
			message = "检查没有通过。"
		var field := str(item.get("field", ""))
		var group: String = FIELD_GROUP.get(field, "")
		if group in _group_errors:
			var label: Label = _group_errors[group]
			label.text = (label.text + "\n" if not label.text.is_empty() else "") + "⚠ " + message
			label.visible = true
			if _pending_focus.is_empty():
				_pending_focus = field
		var hint: String = FIELD_HINT.get(field, "")
		lines.append("· " + message + ("\n   " + hint if not hint.is_empty() and not message.contains(hint) else ""))
		if item.has("reasonCode"):
			_log_line("底层原因：%s（%s）" % [str(item.reasonCode), str(item.get("code", ""))])
		elif item.has("code"):
			_log_line("检查代码：" + str(item.code))
	var where := ""
	if not _pending_focus.is_empty():
		where = "\n\n点「确定」后跳到对应的设置。"
	_show_notice(title, "\n".join(lines) + ("\n\n" + footer if not footer.is_empty() else "") + where)

func _focus_pending() -> void:
	var field := _pending_focus
	_pending_focus = ""
	if field.is_empty():
		return
	var group: String = FIELD_GROUP.get(field, "")
	if group == "advanced":
		_focus_missing("advanced")
		return
	if not _groups.has(group):
		return
	_groups[group].folded = false
	var target: Control = {
		"appid": _appid, "appidFrom": _appid, "output": _output, "gameName": _game_name,
		"orientation": _orientation_buttons.get("portrait"), "glx": _glx, "skipPrewarm": _prewarm, "locale": _locale,
		"largePck": _large_pck, "loginCode": _login_code, "confirmNo3d": _confirm_check, "confirmRemovedModules": _confirm_check,
		"subpackages": _subpackage_buttons.get("scenes"), "scenes": _subpackage_buttons.get("scenes"), "receiver": _receiver_button,
	}.get(field, _template_buttons.get("full"))
	if target != null and target.is_visible_in_tree():
		target.grab_focus()

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
	_last_run = {"settings": settings_key, "run": result.get("run", ""), "packageId": _package_id(result)}
	var file := FileAccess.open(_state_directory().path_join(LAST_RUN_FILE), FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(_last_run, "\t") + "\n")
		file.close()

# 上次成功的运行只在设置没变时可用；改过模板、方向等之后必须重新导出并转换。打开时由快速流程再核对一次运行状态。
func _last_run_usable() -> bool:
	if _last_run.is_empty() or _last_run.get("settings", "") != JSON.stringify(_saved):
		return false
	var run: String = _last_run.get("run", "")
	return not run.is_empty() and DirAccess.dir_exists_absolute(run)

func _package_id(result: Dictionary) -> String:
	var steps: Dictionary = result.get("steps", {})
	if steps.get("devtools") is Dictionary:
		return str(steps.devtools.get("packageId", ""))
	if steps.get("convert") is Dictionary and steps.convert.get("outcome") is Dictionary:
		return str(steps.convert.outcome.get("packageId", ""))
	return ""

# 发给快速流程的设置：面板保存的设置，加上由语言推出的电脑预览包开关（预览包只支持 zh_CN）。
func _quick_settings() -> Dictionary:
	var settings := _saved.duplicate(true)
	settings.devtoolsPreview = settings.locale == "zh_CN"
	return settings

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
	return {"pid": pid, "token": token, "mode": mode, "result": logs.path_join(token + ".quick-result.private.json"), "events": logs.path_join(token + ".quick-events.private.jsonl")}

func _node_executable() -> String:
	var config = JSON.parse_string(FileAccess.get_file_as_string(_config_file())) if FileAccess.file_exists(_config_file()) else null
	var node := str(config.get("nodeExecutable", "")) if config is Dictionary else ""
	return node if not node.is_empty() and FileAccess.file_exists(node) else ""

# 读结果文件：有结果返回字典；进程已退出却没有结果返回 {"lost": true}；还在运行返回空字典。
func _poll_job(job: Dictionary) -> Dictionary:
	if job.is_empty():
		return {}
	if FileAccess.file_exists(job.result):
		var data = JSON.parse_string(FileAccess.get_file_as_string(job.result))
		return data if data is Dictionary else {"status": "FAILED", "message": "结果文件读不懂"}
	if not OS.is_process_running(int(job.pid)):
		return {"lost": true}
	return {}

# 所选模板要确认的项目来自 quick requirements；读到之前先用内置的列表。
func _request_requirements(template: String) -> void:
	if not TEMPLATES.has(template) or _requirements.has(template) or not _requirements_job.is_empty():
		return
	var node := _node_executable()
	if node.is_empty():
		return
	_requirements_job = _spawn_adapter(node, "requirements", {"template": template})
	if not _requirements_job.is_empty():
		_requirements_job.template = template
		set_process(true)

# 装分包加载脚本：先只列出要写的文件请用户确认，确认后再执行共用安装任务。
func _receiver_start(write: bool) -> void:
	if not _receiver_job.is_empty() or not _job.is_empty():
		return
	var node := _node_executable()
	if node.is_empty():
		_show_notice("无法开始", "插件还没准备好，或者没有找到 Node.js：%s\n请确认装了 Node.js 24，然后在「项目 → 项目设置 → 插件」里把微信导出插件关掉再打开。" % _config_file())
		return
	if _settings_dirty():
		_show_notice("先保存设置", "装加载脚本会用到已保存的输出目录，请先点「保存设置」。")
		return
	_receiver_job = _spawn_adapter(node, "receiver", {"project": _game_project(), "settings": _saved, "write": write})
	if _receiver_job.is_empty():
		return
	_receiver_job.write = write
	_receiver_line.text = "正在装分包加载脚本…" if write else "正在检查要写哪些文件…"
	set_process(true)
	_refresh()

func _on_receiver_result(job: Dictionary, result: Dictionary) -> void:
	match str(result.get("status", "")):
		"PLANNED":
			var lines := PackedStringArray()
			for item in result.get("planned", []):
				lines.append("· %s（%s）" % [str(item.get("path", "")), str(item.get("action", ""))])
			_receiver_confirm.dialog_text = "按场景分包需要游戏里有分包加载脚本。将往游戏工程写入：\n%s\n\n只新建缺少的文件、不覆盖已有文件，也不改主场景。写完后插件会刷新文件列表；不会自动回滚。" % "\n".join(lines)
			_receiver_confirm.popup_centered()
		"ALREADY_INSTALLED", "INSTALLED":
			if _installed():
				# 写入的是磁盘上的 project.godot；同步到编辑器内存里的项目设置，免得编辑器之后保存时把这一行丢掉。
				ProjectSettings.set_setting("autoload/WxResource", RECEIVER_AUTOLOAD)
				ProjectSettings.save()
				EditorInterface.get_resource_filesystem().scan()
			_log_line("分包加载脚本已就绪。" + ("任务记录：" + str(result.get("run", "")) if result.has("run") else ""))
		"BLOCKED":
			_show_problems("还不能装加载脚本", result.get("blockers", []))
		_:
			var error = result.get("error", result)
			_show_problems("装加载脚本没有完成", [error if error is Dictionary else {"message": str(error)}], "已写入的文件保留在游戏里，不会自动回滚。")
	_refresh()

# 取消本面板正在进行的「导出并转换」（按运行令牌），或「最近运行」里未结束的运行（按运行目录）。
# 由适配器确认运行目录，走共用任务核心的取消。
func _quick_cancel(run := "") -> void:
	if not _cancel_job.is_empty():
		return
	if run.is_empty() and (_job.is_empty() or _job.mode != "run" or _job.get("cancelling", false)):
		return
	var node := _node_executable()
	if node.is_empty():
		return
	var spawned := _spawn_adapter(node, "cancel", {"run": run} if not run.is_empty() else {"runToken": _job.token})
	if spawned.is_empty():
		return
	_cancel_job = spawned
	if run.is_empty():
		_job.cancelling = true
		_task_line.text = "任务：正在取消…（等当前步骤到安全点）"
		_log_line("已请求取消导出并转换。")
	else:
		_log_line("已请求取消：" + run)
	set_process(true)
	_refresh()

func _refresh_runs() -> void:
	if not _runs_job.is_empty() or _saved.output.is_empty():
		if _saved.output.is_empty():
			_runs = []
			_runs_note.text = "还没有输出目录。"
			_render_runs()
		return
	var node := _node_executable()
	if node.is_empty():
		_runs_note.text = "没有找到插件本机配置。"
		return
	_runs_job = _spawn_adapter(node, "runs", {"output": _saved.output})
	_runs_note.text = "正在读取…"
	set_process(true)

func _on_runs_result(result: Dictionary) -> void:
	if result.get("schema") == "wxslim-quick-runs-v1":
		_runs = result.get("runs", [])
		_runs_note.text = "共 %d 次运行%s" % [int(result.get("total", 0)), "，显示最近 %d 次" % _runs.size() if int(result.get("total", 0)) > _runs.size() else ""]
	else:
		_runs = []
		_runs_note.text = "读取失败：" + str(result.get("message", "没有结果"))
	_render_runs()

func _render_runs() -> void:
	if _runs_list == null:
		return
	for child in _runs_list.get_children():
		_runs_list.remove_child(child)
		child.queue_free()
	var busy := not _job.is_empty() or not _cancel_job.is_empty()
	for item in _runs.slice(0, 8):
		var status := str(item.get("status", ""))
		var shown: Array = RUN_STATUS.get(status, [status, "pending"])
		var row := HBoxContainer.new()
		_runs_list.add_child(row)
		var dot := Label.new()
		dot.text = "●"
		dot.add_theme_color_override("font_color", STATUS_COLOR[shown[1]])
		row.add_child(dot)
		var info := Label.new()
		var packs: Array = item.get("scenePacks", [])
		info.text = "%s · %s%s · %d MiB" % [str(item.get("name", "")), shown[0], " · %d 个分包" % packs.size() if not packs.is_empty() else "", int(float(item.get("bytes", 0)) / 1048576.0 + 0.5)]
		var tip := PackedStringArray([str(item.get("run", ""))])
		if not str(item.get("packageId", "")).is_empty():
			tip.append("包号 " + str(item.packageId))
		for pack in packs:
			if pack is Dictionary:
				tip.append("分包 %s ← %s" % [str(pack.get("id", "")), str(pack.get("scene", ""))])
		if item.get("error") is Dictionary:
			tip.append(str(item.error.get("message", "")))
		if status == "UNFINISHED":
			tip.append("没有结束收据：可能仍在运行，也可能进程已中断。")
		info.tooltip_text = "\n".join(tip)
		info.mouse_filter = Control.MOUSE_FILTER_PASS
		info.clip_text = true
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(info)
		if not str(item.get("openTarget", "")).is_empty():
			var open := Button.new()
			open.text = "打开"
			open.disabled = busy
			open.tooltip_text = "在微信开发者工具中打开这次的输出"
			open.pressed.connect(_quick_start.bind("open", str(item.run)))
			row.add_child(open)
		if status == "UNFINISHED":
			var stop := Button.new()
			stop.text = "取消"
			stop.disabled = busy or item.get("cancelRequested") == true
			stop.tooltip_text = "已请求过取消，等任务停止" if item.get("cancelRequested") == true else "请求取消；不回滚"
			stop.pressed.connect(_quick_cancel.bind(str(item.run)))
			row.add_child(stop)
		var show := Button.new()
		show.text = "…"
		show.tooltip_text = "在文件夹中显示"
		show.flat = true
		show.pressed.connect(func(): OS.shell_show_in_file_manager(str(item.run)))
		row.add_child(show)
		if status != "UNFINISHED":
			var trash := Button.new()
			trash.text = "×"
			trash.flat = true
			trash.disabled = busy
			trash.tooltip_text = "移到回收站"
			trash.pressed.connect(func():
				_trash_confirm.set_meta("run", str(item.run))
				_trash_confirm.dialog_text = "把这次运行移到回收站？\n%s\n%s · 约 %d MiB\n可以从回收站恢复。" % [str(item.run), shown[0], int(float(item.get("bytes", 0)) / 1048576.0 + 0.5)]
				_trash_confirm.popup_centered()
			)
			row.add_child(trash)
	if _runs.is_empty() and not _saved.output.is_empty() and _runs_job.is_empty():
		_note("这个输出目录里还没有运行。", _runs_list)

func _on_cancel_result(result: Dictionary) -> void:
	var task = result.get("task")
	if result.get("status") == "CANCEL_REQUESTED":
		if task is Dictionary:
			_log_line("取消请求已送达「%s」（%s）。" % [STEP_TEXT.get(str(task.get("step", "")), str(task.get("step", ""))),
				"该任务已结束" if task.get("alreadyEnded") == true else "等待它在安全点停止"])
		else:
			_log_line("已记下取消请求：下一步开始前停止。")
	else:
		# 例如运行目录尚未建立或运行刚好结束；面板保持运行状态，结果以运行本身的收据为准。
		if not _job.is_empty():
			_job.cancelling = false
		_log_line("取消没有生效：%s" % str(result.get("message", "没有结果")))
	_refresh_runs()
	_refresh()

func _quick_start(mode: String, open_run := "") -> void:
	if not _job.is_empty():
		return
	var node := _node_executable()
	if node.is_empty():
		_show_notice("无法开始", "插件还没准备好，或者没有找到 Node.js：%s\n请确认装了 Node.js 24，然后在「项目 → 项目设置 → 插件」里把微信导出插件关掉再打开。" % _config_file())
		return
	var request := {}
	if mode == "open":
		var run := open_run
		if run.is_empty():
			if not _last_run_usable():
				return
			run = _last_run.get("run", "")
		request = {"run": run, "settings": _saved}
	else:
		_clear_field_errors()
		request = {"project": _game_project(), "settings": _quick_settings()}
	var spawned := _spawn_adapter(node, mode, request)
	if spawned.is_empty():
		return
	# 记下发起时的设置：运行期间若又保存了新设置，结果只算在发起时那份设置名下。
	_job = spawned
	_job.merge({"started": Time.get_ticks_msec(), "settings": JSON.stringify(_saved), "run": ""})
	_task_line.text = {"plan": "任务：正在检查…", "run": "任务：开始导出…", "open": "任务：正在打开开发者工具…"}[mode]
	_task_line.tooltip_text = ""
	_log_line({"plan": "开始检查设置和游戏工程。", "run": "开始导出并转换，运行目录在输出目录下。", "open": "打开 " + str(request.get("run", ""))}[mode])
	_poll_elapsed = 0.0
	_status_elapsed = 0.0
	set_process(true)
	_refresh()

func _process(delta: float) -> void:
	if _job.is_empty() and _cancel_job.is_empty() and _runs_job.is_empty() and _status_job.is_empty() and _requirements_job.is_empty() and _receiver_job.is_empty():
		set_process(false)
		return
	_poll_elapsed += delta
	_status_elapsed += delta
	if _poll_elapsed < 0.5:
		return
	_poll_elapsed = 0.0
	var done := _poll_job(_requirements_job)
	if not done.is_empty():
		var template: String = _requirements_job.template
		_requirements_job = {}
		if done.get("schema") == "wxslim-template-requirements-v1":
			_requirements[template] = done
		_refresh()
		if TEMPLATES.has(_draft.template) and not _requirements.has(_draft.template) and _draft.template != template:
			_request_requirements(_draft.template)
	done = _poll_job(_receiver_job)
	if not done.is_empty():
		var job := _receiver_job
		_receiver_job = {}
		_on_receiver_result(job, done if not done.has("lost") else {"status": "FAILED", "message": "装加载脚本的进程退出了但没有结果；请查看插件 logs。"})
	done = _poll_job(_runs_job)
	if not done.is_empty():
		_runs_job = {}
		if done.has("lost"):
			_runs_note.text = "读取进程已退出但没有结果。"
		else:
			_on_runs_result(done)
	done = _poll_job(_cancel_job)
	if not done.is_empty():
		_cancel_job = {}
		if done.has("lost"):
			_log_line("取消进程已退出但没有结果；请查看插件 logs。")
		else:
			_on_cancel_result(done)
	done = _poll_job(_status_job)
	if not done.is_empty():
		_status_job = {}
		if not done.has("lost") and not _job.is_empty():
			_on_status_result(done)
	if _job.is_empty():
		return
	var seconds := int((Time.get_ticks_msec() - int(_job.started)) / 1000)
	if _job.mode == "run" and FileAccess.file_exists(_job.events):
		var lines := FileAccess.get_file_as_string(_job.events).strip_edges().split("\n")
		var last = JSON.parse_string(lines[lines.size() - 1]) if lines.size() > 0 and not lines[0].is_empty() else null
		if _job.run.is_empty():
			var first = JSON.parse_string(lines[0]) if lines.size() > 0 and not lines[0].is_empty() else null
			if first is Dictionary and first.get("phase") == "start":
				_job.run = str(first.get("run", ""))
		if last is Dictionary:
			var phase := {"start": "", "plan": "检查中", "analyze": "分析中", "execute": "进行中", "done": "完成"}.get(str(last.get("phase", "")), "")
			_task_line.text = "任务：%s%s · %s（%d 秒）" % ["正在取消 · " if _job.get("cancelling", false) else "", STEP_TEXT.get(str(last.get("step", "")), ""), phase, seconds]
		# 每 3 秒用 quick status 读一次本次运行的进度（任务最近记录的阶段），悬停状态行可看。
		if not _job.run.is_empty() and _status_job.is_empty() and _status_elapsed >= 3.0:
			_status_elapsed = 0.0
			var node := _node_executable()
			if not node.is_empty():
				_status_job = _spawn_adapter(node, "status", {"run": _job.run})
	done = _poll_job(_job)
	if done.has("lost"):
		_job = {}
		_task_line.text = "任务：后台进程退出了但没有结果；请查看插件 logs。"
		_refresh()
	elif not done.is_empty():
		var job := _job
		_job = {}
		_on_quick_result(job, done)

func _on_status_result(status: Dictionary) -> void:
	var progress = status.get("progress")
	var tip := PackedStringArray()
	if status.get("steps") is Dictionary:
		for key in status.steps.keys():
			var value := str(status.steps[key])
			if value != "NONE":
				tip.append("%s：%s" % [STEP_TEXT.get(key, key), {"SUCCESS": "完成", "RUNNING": "进行中", "FAILED": "失败", "CANCELLED": "已取消"}.get(value, value)])
	if progress is Dictionary and progress.get("lastEvent") is Dictionary:
		tip.append("最近记录：%s %s" % [str(progress.lastEvent.get("stage", "")), str(progress.lastEvent.get("status", ""))])
	if status.get("cancelRequested") == true:
		tip.append("已请求取消")
	_task_line.tooltip_text = "\n".join(tip)

func _on_quick_result(job: Dictionary, result: Dictionary) -> void:
	var seconds := int((Time.get_ticks_msec() - int(job.started)) / 1000)
	_task_line.tooltip_text = ""
	# 适配器自身的错误（参数、读写失败）也带 message，可能带 field。
	if result.get("schema") == "wxslim-quick-adapter-error-v1":
		_task_line.text = "任务：没有开始" if job.mode != "open" else "任务：打开失败"
		_show_problems("没能完成", [result])
		_refresh()
		return
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
				_task_line.text = "任务：检查没通过，见提示"
				_show_problems("还不能导出", result.get("blockers", []))
		"run":
			if result.get("status") == "SUCCESS":
				_save_last_run(result, job.settings)
				var packs: Array = result.get("scenePacks", [])
				_task_line.text = "任务：完成（%d 秒）· 包号 %s%s" % [seconds, _last_run.packageId, "· %d 个分包" % packs.size() if not packs.is_empty() else ""]
				_log_line("导出并转换完成：" + str(result.get("run", "")))
				for pack in packs:
					_log_line("分包 %s ← %s（%d 字节）" % [str(pack.get("id", "")), str(pack.get("scene", "")), int(pack.get("bytes", 0))])
			elif result.get("status") == "CANCELLED":
				_task_line.text = "任务：已取消（%d 秒）" % seconds
				_log_line("已取消：%s。没有回滚，已写入的内容保留在 %s" % [str(result.get("error", {}).get("message", "")), str(result.get("run", ""))])
			elif result.get("status") == "BLOCKED":
				_task_line.text = "任务：没有开始，见提示"
				_show_problems("还不能导出", result.get("blockers", []))
			else:
				var error: Dictionary = result.get("error", {})
				_task_line.text = "任务：失败（%d 秒），见提示" % seconds
				_show_problems("导出并转换失败", [error], "已写入的内容保留在：%s" % str(result.get("run", "插件 logs")))
		"open":
			if result.get("status") == "SUCCESS":
				_task_line.text = "任务：开发者工具已打开"
			else:
				_task_line.text = "任务：打开失败"
				_show_problems("打开失败", [result])
	if job.mode == "run":
		_refresh_runs()
	_refresh()

func _missing_for_export() -> Array:
	var missing := []
	if _saved.template.is_empty():
		missing.append(["未选模板", "packing"])
	elif not _confirmed(_saved):
		missing.append(["%s未确认" % TEMPLATES[_saved.template], "packing"])
	if _saved.subpackages == "scenes" and _saved.scenes.is_empty():
		missing.append(["未选分包场景", "packing"])
	if _saved.subpackages == "scenes" and not _receiver_installed():
		missing.append(["未装分包加载脚本", "receiver"])
	if _saved.loginCode and _saved.template != "full":
		missing.append(["登录 code 只支持完整模板", "runtime"])
	if _saved.loginCode and _saved.subpackages == "scenes":
		missing.append(["登录 code 不能和分包同时用", "runtime"])
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
		if _project != null:
			_project.grab_focus()
		return
	if target == "receiver":
		_groups.packing.folded = false
		_receiver_button.grab_focus()
		return
	_groups[target].folded = false
	match target:
		"publish":
			(_appid if not _appid_valid(_draft.appid) else _output).grab_focus()
		"runtime":
			_login_code.grab_focus()
		_:
			if _confirm_box.visible and not _confirmed(_draft):
				_confirm_check.grab_focus()
			else:
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
			parts.append(_draft.locale)
			if _draft.largePck:
				parts.append("大 PCK")
			if _draft.loginCode:
				parts.append("登录 code")
		"publish":
			parts.append(_mask_appid(_draft.appid) if _appid_valid(_draft.appid) else "AppID 未填")
			parts.append(_draft.output.get_file() if not _draft.output.is_empty() else "未选输出")
	return " · ".join(parts)

func _engine_text() -> String:
	if _saved.template.is_empty():
		return "引擎：未选模板"
	var text: String = TEMPLATES[_saved.template]
	text += " · " + ("GLX" if _saved.glx else "WebGL") + " · " + ("竖屏" if _saved.orientation == "portrait" else "横屏") + " · " + _saved.locale
	if _saved.subpackages == "scenes":
		text += " · 分包 %d 个场景" % _saved.scenes.size()
	return "引擎：" + text

func _refresh() -> void:
	var names := {"packing": "打包方式", "runtime": "运行效果", "publish": "发布信息"}
	for key in _groups.keys():
		var missing := _group_missing(key)
		var error_shown: bool = _group_errors.has(key) and _group_errors[key].visible
		var marks := ("⚠ " if not missing.is_empty() or error_shown else "")
		_groups[key].title = "%s%s：%s%s" % [marks, names[key], _group_summary(key), "  ●" if _group_dirty(key) else ""]
		_groups[key].tooltip_text = _groups[key].title + (("\n还差：" + "、".join(PackedStringArray(missing))) if not missing.is_empty() else "")
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
	if dirty:
		_save_state.text = "● 有未保存的改动（带 ● 的组）"
	elif not _settings_ready():
		_save_state.text = "第一次使用：选模板 → 填 AppID 和输出目录 → 保存设置 → 导出并转换。"
	else:
		_save_state.text = "设置已保存。点组标题可展开修改，带 * 的为必填。"
	_save_state.modulate = Color(1, 1, 1, 1.0 if dirty else 0.6)
	if dirty:
		_save_state.add_theme_color_override("font_color", STATUS_COLOR.implemented)
	else:
		_save_state.remove_theme_color_override("font_color")

	var settings_ok := _settings_ready()
	_lock_note.visible = not settings_ok
	_lower.modulate = Color(1, 1, 1, 1.0 if settings_ok else 0.4)
	_set_locked(_lower, not settings_ok)

	_storage_note.text = {"project": "写入 res://wxslim.json，导出游戏时自动排除。", "project-local": "写入 .godot/wxslim/panel-settings.json。", "machine": "只存在插件状态目录。"}.get(_draft.storage, "") + "输出目录和 AppID 只存本机。"

	# 模板确认：换模板就清掉两种确认，换回来要重新确认。
	var field := _confirm_field(_draft.template)
	for key in ["confirmNo3d", "confirmRemovedModules"]:
		if key != field and _draft[key]:
			_draft[key] = false
	_confirm_box.visible = not field.is_empty()
	if not field.is_empty():
		var texts: Array = CONFIRM_TEXT.get(_draft.template, ["确认游戏没有用到被移除的功能", ""])
		_loading = true
		_confirm_check.text = texts[0]
		_confirm_check.button_pressed = _draft.get(field, false)
		_loading = false
		var modules := ", ".join(PackedStringArray(_removed_modules(_draft.template)))
		_confirm_note.text = texts[1] + "\n移除的模块：" + modules
		_confirm_check.tooltip_text = "这份确认会写进每次转换的功能声明，并绑定导出的 PCK。\n用字符串动态加载的资源或类，插件检查不到，需要你自己确认。"

	_scene_box.visible = _draft.subpackages == "scenes"
	_render_scene_list()
	var receiver_ok := _receiver_installed()
	_receiver_line.text = ("分包加载脚本：已装好（WxResource）" if receiver_ok else "分包加载脚本：还没装，按场景分包前要先装") if _installed() else "分包加载脚本：导出前由检查确认"
	_receiver_line.add_theme_color_override("font_color", STATUS_COLOR.verified if receiver_ok and _installed() else STATUS_COLOR.implemented)
	_receiver_button.visible = not (receiver_ok and _installed())
	_receiver_button.disabled = not _receiver_job.is_empty() or not _job.is_empty() or _saved.output.is_empty()
	_receiver_button.tooltip_text = "先在「发布信息」里选好并保存输出目录" if _saved.output.is_empty() else "往游戏里新建 4 个脚本，并在项目设置里加自动加载 WxResource。\n不覆盖已有文件；写之前会列出要写的内容让你确认。"

	var glx_status := _capability_status("render-glx" if _draft.glx else "render-webgl")
	_glx_status.text = ("GLX 渲染" if _draft.glx else "WebGL 对照") + "：" + STATUS_TEXT.get(glx_status, glx_status)
	_locale_note.text = "游戏宿主的语言设置，不翻译游戏内容。" + ("" if _draft.locale == "zh_CN" else "选英文时不生成电脑预览包：GLX 包只能在手机上看，WebGL 包可以直接在开发者工具里打开。")
	# 登录 code 目前只在完整模板上接通；换成别的模板时清掉。
	if _draft.template != "full" and _draft.loginCode:
		_draft.loginCode = false
		_loading = true
		_login_code.button_pressed = false
		_loading = false
	_login_code.disabled = _draft.template != "full"
	_login_note.text = "只在完整模板可用。" if _draft.template != "full" else ("暂时不能和按场景分包同时用。" if _draft.subpackages == "scenes" else "默认关闭；开启后游戏要主动请求 code，不会自动登录。")
	# 安装版里的引擎启动时都固定预热：保持不勾选，而不是留下一个勾着但不会生效的选项。
	if _draft.skipPrewarm:
		_draft.skipPrewarm = false
		_loading = true
		_prewarm.button_pressed = false
		_loading = false
	_prewarm.disabled = true
	_prewarm_note.text = "安装版的引擎启动时都固定预热，跳过需要重建引擎（命令行）。"
	if _draft.appid.is_empty():
		_appid_note.text = "转换前必填。只检查格式，不代表微信后台有效。"
	elif not _appid_valid(_draft.appid):
		_appid_note.text = "格式应为 wx 加 16 位小写十六进制。"
	elif not _draft.appidFrom.is_empty():
		_appid_note.text = "格式正确，来自 " + _draft.appidFrom
	else:
		_appid_note.text = "格式正确，手动填写；转换时作为本机 AppID 来源。"

	_engine_line.text = _engine_text()
	_engine_line.tooltip_text = "引擎文件由插件安装版自动提供。AppID：" + (_mask_appid(_saved.appid) if _appid_valid(_saved.appid) else "未设置")
	var game := _game_project()
	_input_line.text = "输入：" + (game.get_file() if not game.is_empty() else "未选游戏工程") + ("（当前工程）" if _installed() else "")
	_input_line.tooltip_text = game
	_output_line.text = "输出：" + (_saved.output if not _saved.output.is_empty() else "未选择")
	_output_line.tooltip_text = _saved.output

	var export_missing := _missing_for_export()
	var open_missing := _missing_for_open()
	var busy := not _job.is_empty()
	_export_button.disabled = busy or not export_missing.is_empty() or not _receiver_job.is_empty()
	_export_button.text = "导出中…" if busy and _job.mode == "run" else "导出并转换"
	_export_button.tooltip_text = "" if export_missing.is_empty() else "还差：" + "、".join(PackedStringArray(export_missing.map(func(m): return m[0])))
	_cancel_button.visible = busy and _job.mode == "run"
	_cancel_button.disabled = _job.get("cancelling", false)
	_cancel_button.text = "取消中…" if _job.get("cancelling", false) else "取消"
	_open_button.disabled = busy or not open_missing.is_empty()
	_open_button.tooltip_text = "还差：" + "、".join(PackedStringArray(open_missing))
	_open_hint.text = "打开还差：" + "、".join(PackedStringArray(open_missing))
	_open_hint.visible = export_missing.is_empty() and not open_missing.is_empty()

	_render_runs()
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

# 列表里的依赖数和共用数只是编辑器内的估算；实际归属由快速流程按工程源码和导出的 PCK 计算。
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
		info.text = "%s → 包名 %s（依赖约 %d，共用 %d）" % [scene.get_file(), _pack_id(scene), own, shared]
		info.tooltip_text = "%s\n约 %d 个依赖跟着进分包；%d 个与其他分包共用，留在首包。\n首包也用到的资源同样留在首包，以导出时的计算为准。" % [scene, own, shared]
		info.mouse_filter = Control.MOUSE_FILTER_PASS
		info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
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
