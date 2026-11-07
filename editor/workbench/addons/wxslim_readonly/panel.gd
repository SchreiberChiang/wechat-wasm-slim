@tool
extends VBoxContainer

const INSTALL_LOCATOR := "res://addons/wxslim_readonly/workbench.path"

func _workbench_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string(INSTALL_LOCATOR).strip_edges()
	return ProjectSettings.globalize_path("res://")

func _state_directory() -> String:
	if FileAccess.file_exists(INSTALL_LOCATOR):
		return FileAccess.get_file_as_string("res://.godot/wxslim/state.path").strip_edges()
	return ProjectSettings.globalize_path("res://")

func _config_file() -> String:
	return _state_directory().path_join("local-config.json")

func _adapter_file() -> String:
	return _workbench_directory().path_join("adapter.mjs")
const RESOURCE_CONFIG_FORM = preload("res://addons/wxslim_readonly/resource_config_form.gd")
var _buttons: Array[Button] = []
var _state: Label
var _details: TextEdit
var _capabilities: ItemList
var _job: Dictionary = {}
var _request: LineEdit
var _root: LineEdit
var _task_id: LineEdit
var _configuration_text := ""
var _poll_elapsed := 0.0
var _execute_button: Button
var _cancel_button: Button
var _plan: Dictionary = {}
var _status_receipt: Dictionary = {}
var _plan_configuration := ""
var _status_configuration := ""
var _confirmation: Dictionary = {}
var _confirmation_configuration := ""
var _confirm_dialog: ConfirmationDialog
var _confirm_details: TextEdit
var _control_job: Dictionary = {}
var _last_execution_token := ""
var _last_execution_request_file := ""
var _execution_observation: Dictionary = {}
var _observe_button: Button
var _use_execution_button: Button
var _active_cancel_button: Button
var _confirmation_secondary := false
var _progress: Label
var _last_event: Label
var _confirmation_bounded := false
var _export_dialog: ConfirmationDialog
var _export_project: LineEdit
var _export_parent: LineEdit
var _export_name: LineEdit
var _export_preset: LineEdit
var _export_budget: SpinBox
var _export_cache_budget: SpinBox
var _export_import: CheckBox
var _raw_build_dialog: ConfirmationDialog
var _raw_build_paths: Dictionary = {}
var _raw_build_parent: LineEdit
var _raw_build_name: LineEdit
var _raw_build_recipe: OptionButton
var _raw_build_profile: OptionButton
var _raw_build_features: LineEdit
var _raw_build_jobs: SpinBox
var _raw_build_budget: SpinBox
var _official_dialog: ConfirmationDialog
var _open_project_config: LineEdit
var _official_paths: Dictionary = {}
var _official_parent: LineEdit
var _official_output_name: LineEdit
var _official_name: LineEdit
var _official_locale: LineEdit
var _official_mode: OptionButton
var _official_orientation: OptionButton
var _official_profile: OptionButton
var _official_login_code: CheckBox
var _official_large_pck_budget: CheckBox
var _official_skip_prewarm: CheckBox
var _official_prewarm_note: Label
var _official_usage_box: VBoxContainer
var _official_custom_box: VBoxContainer
var _official_custom_preparation: LineEdit
var _official_custom_usage: LineEdit
var _official_modules: Dictionary = {}
var _resource_dialog: ConfirmationDialog
var _resource_source: LineEdit
var _resource_parent: LineEdit
var _resource_name: LineEdit
var _resource_pack_name: LineEdit
var _resource_budget: SpinBox
var _resource_ack: CheckBox
var _resource_entries: ItemList
var _resource_target: OptionButton
var _resource_summary: Label
var _resource_inventory: Dictionary = {}
var _resource_inventory_token := ""
var _resource_inventory_source := ""
var _resource_generation := 0
var _resource_assignments: Dictionary = {}
var _resource_pack_ids: Array[String] = ["boot"]
var _resource_paths: Array[String] = []
var _resource_runtime_forms: Dictionary = {}
var _resource_runtime_next: Dictionary = {}
var _resource_prefill_button: Button
var _resource_config_form: RESOURCE_CONFIG_FORM
var _resource_boot_dialog: ConfirmationDialog
var _resource_boot_project: LineEdit
var _resource_boot_config: LineEdit
var _resource_boot_note: Label

func _ready() -> void:
	custom_minimum_size = Vector2(370, 420)
	var heading := Label.new()
	heading.text = "微信小游戏本地导出"
	add_child(heading)
	var notice := Label.new()
	notice.text = "计划仅供检查，不是执行授权。执行和取消均须重新准备并明确确认。\n执行 SUCCESS 不代表手机/画面通过；取消请求不代表已停止。\n没有上传入口。配置和日志仅保存在本地。"
	notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(notice)
	var legend := Label.new()
	legend.text = "能力状态：待核查 / 未实现 / 已实现待验证 /\n已验证可用（仅精确证据范围） / 当前配置不支持"
	add_child(legend)
	_setup_export_form()
	_setup_raw_build_form()
	_setup_official_form()
	var launch_dialog := ConfirmationDialog.new()
	launch_dialog.title = "打开本地微信小游戏"
	launch_dialog.ok_button_text = "在开发者工具中打开"
	var launch_body := VBoxContainer.new()
	launch_body.custom_minimum_size = Vector2(550, 60)
	launch_dialog.add_child(launch_body)
	_open_project_config = _selection_field("小游戏的 project.config.json", false, launch_body)
	var appid_from := _selection_field("AppID 来源（可选）· 已有小游戏的 project.config.json", false, launch_body)
	appid_from.name = "AppIdSource"
	appid_from.tooltip_text = "填写后将本地转换工程的两个占位字段绑定到该 AppID，再打开开发者工具。已有真实 AppID 可留空。"
	launch_dialog.confirmed.connect(func(): _start("open-project", {"configFile": _open_project_config.text, "appidFrom": appid_from.text}))
	add_child(launch_dialog)
	var launch := Button.new()
	launch.text = "在微信开发者工具中打开工程…"
	launch.pressed.connect(func(): launch_dialog.popup_centered())
	add_child(launch)
	_buttons.append(launch)
	_setup_resource_form()
	_setup_resource_config_form()
	_setup_resource_runtime_forms()
	_setup_resource_boot_form()
	var selection_notice := Label.new()
	selection_notice.text = "已有任务目录/ID可同时留空；查询状态时必填。"
	selection_notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(selection_notice)
	_request = _selection_field("已有 REQUEST JSON", false)
	_root = _selection_field("已有任务目录", true)
	_task_id = LineEdit.new()
	_task_id.placeholder_text = "任务 ID（不据此证明任务身份）"
	add_child(_task_id)
	var save := Button.new()
	save.text = "保存本地选择"
	save.pressed.connect(_start.bind("save-selection"))
	add_child(save)
	_buttons.append(save)
	_configuration_text = FileAccess.get_file_as_string(_config_file())
	var initial = JSON.parse_string(_configuration_text)
	if initial is Dictionary:
		_request.text = str(initial.get("requestFile", ""))
		_root.text = str(initial.get("taskRoot", ""))
		_task_id.text = str(initial.get("taskId", ""))
	for field in [_request, _root, _task_id]:
		field.text_changed.connect(_selection_changed)
	var row := HFlowContainer.new()
	add_child(row)
	for item in [["能力清单", "capabilities"], ["任务类型", "list"], ["只读计划", "plan"], ["已有任务状态", "status"]]:
		var button := Button.new()
		button.text = item[0]
		button.pressed.connect(_start.bind(item[1]))
		row.add_child(button)
		_buttons.append(button)
	_execute_button = Button.new()
	_execute_button.text = "准备执行…"
	_execute_button.pressed.connect(_start.bind("prepare-execute"))
	row.add_child(_execute_button)
	_cancel_button = Button.new()
	_cancel_button.text = "准备取消所选任务…"
	_cancel_button.pressed.connect(_start.bind("prepare-cancel"))
	row.add_child(_cancel_button)
	_observe_button = Button.new()
	_observe_button.text = "刷新本次执行收据"
	_observe_button.pressed.connect(_observe_execution)
	row.add_child(_observe_button)
	_use_execution_button = Button.new()
	_use_execution_button.text = "使用本次任务并保存选择"
	_use_execution_button.pressed.connect(_use_execution_selection)
	row.add_child(_use_execution_button)
	_active_cancel_button = Button.new()
	_active_cancel_button.text = "准备取消已核输出任务…"
	_active_cancel_button.pressed.connect(_prepare_active_cancel)
	row.add_child(_active_cancel_button)
	_confirm_dialog = ConfirmationDialog.new()
	_confirm_dialog.title = "明确确认本地任务操作"
	_confirm_dialog.ok_button_text = "确认上述精确范围"
	_confirm_dialog.cancel_button_text = "返回"
	_confirm_dialog.dialog_autowrap = true
	_confirm_dialog.confirmed.connect(_confirm_task_operation)
	_confirm_dialog.canceled.connect(_discard_confirmation)
	add_child(_confirm_dialog)
	_confirm_details = TextEdit.new()
	_confirm_details.editable = false
	_confirm_details.custom_minimum_size = Vector2(660, 300)
	_confirm_dialog.add_child(_confirm_details)
	_state = Label.new()
	_state.text = "未查询。无终态收据不能当作正在运行。"
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_state)
	_progress = Label.new()
	_progress.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_progress.text = "适配器存活只是本面板启动的进程观察；任务以共享收据为准。"
	add_child(_progress)
	_last_event = Label.new()
	_last_event.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_last_event.text = "最后记录阶段尚未读取；请手动刷新任务收据，不自动轮询。"
	add_child(_last_event)
	_capabilities = ItemList.new()
	_capabilities.custom_minimum_size.y = 150
	add_child(_capabilities)
	_details = TextEdit.new()
	_details.editable = false
	_details.custom_minimum_size.y = 240
	_details.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_details.text = "点击能力清单或任务类型开始只读检查。计划与状态使用集中配置。\n完整 stdout/stderr 留在 logs/*.private.*，不复制到公共文档。"
	add_child(_details)
	_refresh_controls()
	set_process(false)

func _setup_export_form() -> void:
	var open_form := Button.new()
	open_form.text = "新建 PCK 导出计划…"
	open_form.pressed.connect(func(): _export_dialog.popup_centered_clamped(Vector2i(720, 560)))
	add_child(open_form)
	_buttons.append(open_form)
	_export_dialog = ConfirmationDialog.new()
	_export_dialog.title = "选择工程并生成共用导出计划"
	_export_dialog.ok_button_text = "生成计划（不导出）"
	_export_dialog.cancel_button_text = "返回"
	_export_dialog.confirmed.connect(_prepare_export_form)
	add_child(_export_dialog)
	var body := VBoxContainer.new()
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(600, 320)
	_export_dialog.add_child(scroll)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(body)
	var note := Label.new()
	note.text = "这里只在插件 logs 保存小型配置并调用共用只读计划，不创建输出目录。\n预设必须已存在于工程；编辑器使用集中配置中的固定版本。\n真正导出前还会确认输出范围；工程导入可能写入 .godot 和 UID 文件。"
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	_export_project = _selection_field("Godot 源工程目录", true, body)
	_export_parent = _selection_field("输出父目录（必须已存在）", true, body)
	_export_name = LineEdit.new()
	_export_name.placeholder_text = "新的输出子目录名称"
	_export_name.text = "wechat-pck-export"
	body.add_child(_export_name)
	_export_preset = LineEdit.new()
	_export_preset.placeholder_text = "工程中现有导出预设名称，例如 Web"
	body.add_child(_export_preset)
	_export_budget = _budget_field(body, "输出目录上限 MiB", 8, 272, 32)
	_export_cache_budget = _budget_field(body, "工程导入缓存允许增长 MiB", 0, 4096, 32)
	_export_import = CheckBox.new()
	_export_import.text = "我知悉实际导出时会更新源工程导入缓存与 UID；此步尚不执行"
	body.add_child(_export_import)

func _budget_field(parent: Control, caption: String, minimum: float, maximum: float, initial: float) -> SpinBox:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var label := Label.new()
	label.text = caption
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)
	var field := SpinBox.new()
	field.min_value = minimum
	field.max_value = maximum
	field.step = 1
	field.value = initial
	row.add_child(field)
	return field

func _setup_raw_build_form() -> void:
	var open_form := Button.new()
	open_form.text = "新建官方引擎构建计划…"
	open_form.pressed.connect(func(): _raw_build_dialog.popup_centered(Vector2i(780, 680)))
	add_child(open_form)
	_buttons.append(open_form)
	_raw_build_dialog = ConfirmationDialog.new()
	_raw_build_dialog.title = "固定官方源码重建（仅开发验证）"
	_raw_build_dialog.ok_button_text = "生成计划（不构建）"
	_raw_build_dialog.cancel_button_text = "返回"
	_raw_build_dialog.confirmed.connect(_prepare_raw_build_form)
	add_child(_raw_build_dialog)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(740, 580)
	_raw_build_dialog.add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(body)
	var note := Label.new()
	note.text = "仅生成共用计划，不下载、复制源码或调用编译器。\n请选择已取得的固定依赖；计划只检查配方，实际文件身份和资源余量在执行前核验。\n源码配方与模块裁剪是两项不同选择。新版仍待干净构建及功能运行验收。\n真实构建另行确认，并在新输出目录进行；原始构建成功后还需配对后处理、转换和设备验收。"
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	_raw_build_recipe = OptionButton.new()
	_raw_build_recipe.add_item("功能修正版：24补丁 / 33份源码（待验收）")
	_raw_build_recipe.set_item_metadata(0, "official-c050-capability-24")
	_raw_build_recipe.add_item("历史基础版：20补丁 / 31份源码")
	_raw_build_recipe.set_item_metadata(1, "official-c050-base-20")
	body.add_child(_raw_build_recipe)
	_raw_build_profile = OptionButton.new()
	_raw_build_profile.add_item("完整模块")
	_raw_build_profile.set_item_metadata(0, "full")
	_raw_build_profile.add_item("保守裁剪：固定移除7个模块（需另验项目依赖）")
	_raw_build_profile.set_item_metadata(1, "conservative")
	_raw_build_profile.add_item("自定义维度、模块和类")
	_raw_build_profile.set_item_metadata(2, "custom")
	body.add_child(_raw_build_profile)
	_raw_build_features = _selection_field("裁剪配置 JSON（纯 2D 示例位于 engine/custom-2d-plan.example.json）", false, body)
	_raw_build_features.get_parent().hide()
	_raw_build_profile.item_selected.connect(func(index: int): _raw_build_features.get_parent().visible = index == 2)
	_raw_build_paths["sdk"] = _selection_field("固定 Emscripten SDK 目录", true, body)
	for item in [["python", "固定 Python 可执行文件", "*.exe ; Executable"], ["library", "026e 官方 GLX 静态库", "*.a ; Static library"], ["sconsWheel", "固定 SCons wheel", "*.whl ; Python wheel"], ["sdkArchive", "固定 SDK 原始压缩包", "* ; All files"], ["gitExecutable", "Git 可执行文件", "*.exe ; Executable"], ["upstreamSource", "已认证的存档后端来源 JS", "*.js ; JavaScript"]]:
		_raw_build_paths[item[0]] = _selection_field(item[1], false, body, item[2])
	_raw_build_parent = _selection_field("输出父目录（必须已存在）", true, body)
	_raw_build_name = LineEdit.new()
	_raw_build_name.placeholder_text = "新的构建子目录名称"
	_raw_build_name.text = "official-capability-build"
	body.add_child(_raw_build_name)
	_raw_build_jobs = _budget_field(body, "编译并行数（执行前另核资源）", 1, 16, 6)
	_raw_build_budget = _budget_field(body, "构建目录预算上限 GiB", 8, 20, 8)

func _prepare_raw_build_form() -> void:
	var output_name := _raw_build_name.text
	if output_name.is_empty() or output_name != output_name.strip_edges() or output_name in [".", ".."] or "/" in output_name or "\\" in output_name or ":" in output_name or not _raw_build_parent.text.is_absolute_path():
		_fail("请选择输出父目录和新的构建子目录名称；尚未生成计划。")
		return
	var payload := {"sourceRecipe": _raw_build_recipe.get_selected_metadata(), "profile": _raw_build_profile.get_selected_metadata(),
		"work": _raw_build_parent.text.path_join(output_name), "jobs": int(_raw_build_jobs.value), "budgetBytes": int(_raw_build_budget.value) * 1073741824}
	if payload.profile == "custom":
		if payload.sourceRecipe != "official-c050-capability-24":
			_fail("自定义裁剪使用 24 补丁功能配方，请先选择该配方。")
			return
		var file := FileAccess.open(_raw_build_features.text, FileAccess.READ)
		if file == null or file.get_length() > 65536:
			_fail("请选择可读的裁剪配置 JSON，上限 64 KiB。")
			return
		var features = JSON.parse_string(file.get_as_text())
		if not features is Dictionary:
			_fail("裁剪配置须为包含维度、模块及类选择的 JSON 对象。")
			return
		payload.features = features
	for key in _raw_build_paths:
		if not _raw_build_paths[key].text.is_absolute_path():
			_fail("请明确选择每项已有依赖；路径不会从旧任务或其它工程推测。尚未生成计划。")
			return
		payload[key] = _raw_build_paths[key].text
	_start("prepare-raw-build-request", payload)

func _setup_official_form() -> void:
	var open_form := Button.new()
	open_form.text = "新建官方转换计划…"
	open_form.pressed.connect(func(): _official_dialog.popup_centered_clamped(Vector2i(760, 640)))
	add_child(open_form)
	_buttons.append(open_form)
	_official_dialog = ConfirmationDialog.new()
	_official_dialog.title = "官方转换：c050 配对引擎（开发测试）"
	_official_dialog.ok_button_text = "生成计划（不转换）"
	_official_dialog.cancel_button_text = "返回"
	_official_dialog.confirmed.connect(_prepare_official_form)
	add_child(_official_dialog)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(720, 540)
	_official_dialog.add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(body)
	var note := Label.new()
	note.text = "请选择明确配对的微信引擎 JS/WASM，以及已导出的 PCK。\n完整与保守配方均为开发测试；计划仍校验配对和转换器指纹，不能使用任意 Godot Web 引擎。\n接口文件必须明确选择；本步骤不配置 AppID，资源分包还需后续组包。\n计划显示预计占用；默认任务预算 120 MiB。"
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	_official_profile = OptionButton.new()
	_official_profile.add_item("早期完整 c050（开发测试）")
	_official_profile.set_item_metadata(0, "full-official-c050-dev")
	_official_profile.add_item("早期保守 c050（开发测试）")
	_official_profile.set_item_metadata(1, "conservative-official-c050-dev")
	_official_profile.add_item("新版完整 c050（含输入、音频和网络修正）")
	_official_profile.set_item_metadata(2, "full-official-c050-capability-dev")
	_official_profile.add_item("自建 c050 配对（完整、保守或自定义裁剪）")
	_official_profile.set_item_metadata(3, "custom-official-c050-dev")
	_official_profile.item_selected.connect(_official_profile_changed)
	body.add_child(_official_profile)
	_official_large_pck_budget = CheckBox.new()
	_official_large_pck_budget.text = "大 PCK 转换预算 144 MiB（默认 120 MiB）"
	body.add_child(_official_large_pck_budget)
	_official_skip_prewarm = CheckBox.new()
	_official_skip_prewarm.text = "跳过默认 3D 预热"
	_official_skip_prewarm.disabled = true
	_official_skip_prewarm.tooltip_text = "共同计划核对所选引擎，显示它能否读取启动 PCK 中的预热设置。"
	body.add_child(_official_skip_prewarm)
	_official_prewarm_note = Label.new()
	_official_prewarm_note.text = "当前完整配对启动时绑定默认 GLES3 场景着色器，无法从启动 PCK 切换预热。"
	_official_prewarm_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(_official_prewarm_note)
	var capability_note := Label.new()
	capability_note.text = "请选择该配方配套的 JS 和 WASM。已验证的设备、包号和能力范围见官方路线入口文档。"
	capability_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(capability_note)
	_official_login_code = CheckBox.new()
	_official_login_code.text = "接入临时登录 code（未实测，不是业务登录）"
	_official_login_code.tooltip_text = "默认关闭；开启仅生成接口，游戏需显式请求。不要打印 code；不会自动登录或连接业务后端。"
	body.add_child(_official_login_code)
	_official_usage_box = VBoxContainer.new()
	body.add_child(_official_usage_box)
	var usage_note := Label.new()
	usage_note.text = "保守版移除了以下模块，请逐项确认本工程没有使用。未知或使用时请选择完整版。\n这是手工声明，不是自动依赖扫描；声明由本地读取的实际 PCK 哈希绑定，后续共用计划再次核验。"
	usage_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_official_usage_box.add_child(usage_note)
	for module_name in ["gltf", "fbx", "vhacd", "webxr", "mobile_vr", "enet", "upnp"]:
		var check := CheckBox.new()
		check.text = "确认未使用：" + module_name
		_official_modules[module_name] = check
		_official_usage_box.add_child(check)
	_official_usage_box.hide()
	_official_custom_box = VBoxContainer.new()
	body.add_child(_official_custom_box)
	_official_custom_preparation = _selection_field("自建配对的准备配置", false, _official_custom_box)
	_official_custom_usage = _selection_field("已核对的启动 PCK 功能声明", false, _official_custom_box)
	_official_custom_box.hide()
	for item in [["js", "配对引擎 JS", "*.js ; JavaScript"], ["wasm", "配对引擎 WASM", "*.wasm ; WASM"], ["pck", "已导出的游戏 PCK", "*.pck,*.bin ; PCK"], ["transformer", "固定官方转换器", "*.exe ; EXE"], ["interfaces", "本次游戏接口 JS", "*.js ; JavaScript"]]:
		_official_paths[item[0]] = _selection_field(item[1], false, body, item[2])
	_official_paths["pck"].text_changed.connect(func(_text: String): _reset_official_module_declarations())
	_official_parent = _selection_field("输出父目录（必须已存在）", true, body)
	_official_output_name = LineEdit.new()
	_official_output_name.text = "wechat-official-output"
	_official_output_name.placeholder_text = "新的转换任务子目录名称"
	body.add_child(_official_output_name)
	_official_name = LineEdit.new()
	_official_name.placeholder_text = "项目显示名称"
	body.add_child(_official_name)
	_official_locale = LineEdit.new()
	_official_locale.text = "en"
	_official_locale.tooltip_text = "宿主 locale，沿用官方配方默认 en；不自动推断场景语言。"
	body.add_child(_official_locale)
	_official_mode = OptionButton.new()
	_official_mode.add_item("请选择渲染后端")
	_official_mode.add_item("GLX（实际设备能力仍须验证）")
	_official_mode.set_item_metadata(1, "glx")
	_official_mode.add_item("WebGL（电脑对照）")
	_official_mode.set_item_metadata(2, "webgl")
	body.add_child(_official_mode)
	_official_orientation = OptionButton.new()
	_official_orientation.add_item("竖屏 portrait")
	_official_orientation.set_item_metadata(0, "portrait")
	_official_orientation.add_item("横屏 landscape")
	_official_orientation.set_item_metadata(1, "landscape")
	body.add_child(_official_orientation)

func _reset_official_module_declarations() -> void:
	for module_name in _official_modules:
		_official_modules[module_name].button_pressed = false

func _official_profile_changed(_index: int) -> void:
	_reset_official_module_declarations()
	_official_usage_box.visible = _official_profile.get_selected_metadata() == "conservative-official-c050-dev"
	_official_custom_box.visible = _official_profile.get_selected_metadata() == "custom-official-c050-dev"
	_official_prewarm_note.text = "选择自建配对后生成计划，查看这份引擎的预热能力。纯 2D 裁剪仍使用 GLES3 后端。" if _official_custom_box.visible else "当前引擎的默认 3D 预热在 GLES3 中执行。当前配对无法读取启动 PCK 的跳过预热设置。"
	# All three currently registered pairs lack the native guard. Never enable on a label alone.
	_official_skip_prewarm.set_pressed_no_signal(false)
	_official_skip_prewarm.disabled = true

func _setup_resource_form() -> void:
	var open_form := Button.new()
	open_form.text = "声明 PCK 资源归属并生成拆包计划…"
	open_form.pressed.connect(func(): _resource_dialog.popup_centered(Vector2i(860, 700)))
	add_child(open_form)
	_buttons.append(open_form)
	_resource_dialog = ConfirmationDialog.new()
	_resource_dialog.title = "实际 PCK 清单 → 手工声明资源归属"
	_resource_dialog.ok_button_text = "生成计划（不拆包）"
	_resource_dialog.cancel_button_text = "返回"
	_resource_dialog.confirmed.connect(_prepare_resource_form)
	add_child(_resource_dialog)
	var body := VBoxContainer.new()
	body.custom_minimum_size = Vector2(820, 600)
	_resource_dialog.add_child(body)
	var note := Label.new()
	note.text = "读取实际 PCK 后，所有条目初始归 boot；选择条目可移动到显式创建的 resource 包。\n这里不自动扫描依赖，也不证明导入/UID 依赖完整；脚本和元数据必须留 boot，由共用计划核验。\n本步只保留本地声明/草稿，不拆包、不创建输出目录；执行仍须另行确认。"
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	_resource_source = _selection_field("实际源 PCK", false, body, "*.pck,*.bin ; PCK")
	_resource_source.text_changed.connect(_resource_source_changed)
	var read_inventory := Button.new()
	read_inventory.text = "读取实际 PCK 清单（只读）"
	read_inventory.pressed.connect(_read_resource_inventory)
	body.add_child(read_inventory)
	_buttons.append(read_inventory)
	_resource_summary = Label.new()
	_resource_summary.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_resource_summary.text = "尚未读取清单。"
	body.add_child(_resource_summary)
	var row := HBoxContainer.new()
	body.add_child(row)
	_resource_pack_name = LineEdit.new()
	_resource_pack_name.placeholder_text = "新 resource 包 ID（小写字母开头）"
	_resource_pack_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_resource_pack_name)
	var add_pack := Button.new()
	add_pack.text = "创建资源包"
	add_pack.pressed.connect(_resource_add_pack)
	row.add_child(add_pack)
	_buttons.append(add_pack)
	_resource_target = OptionButton.new()
	_resource_target.add_item("boot")
	row.add_child(_resource_target)
	var move_entries := Button.new()
	move_entries.text = "将选中条目移至目标包"
	move_entries.pressed.connect(_resource_move_entries)
	row.add_child(move_entries)
	_buttons.append(move_entries)
	_resource_entries = ItemList.new()
	_resource_entries.select_mode = ItemList.SELECT_MULTI
	_resource_entries.custom_minimum_size.y = 220
	body.add_child(_resource_entries)
	_resource_parent = _selection_field("输出父目录（必须已存在）", true, body)
	_resource_name = LineEdit.new()
	_resource_name.text = "wechat-resource-partition"
	_resource_name.placeholder_text = "新的拆包任务子目录名称"
	body.add_child(_resource_name)
	_resource_budget = _budget_field(body, "任务输出上限 MiB", 4, 260, 32)
	_resource_ack = CheckBox.new()
	_resource_ack.text = "我已手工核对依赖与条目归属；清单不是自动依赖分析"
	_resource_ack.toggled.connect(func(_pressed: bool): _refresh_controls())
	body.add_child(_resource_ack)

func _setup_resource_config_form() -> void:
	_resource_config_form = RESOURCE_CONFIG_FORM.new()
	_resource_config_form.operation_requested.connect(_start)
	add_child(_resource_config_form)
	var open_form := Button.new()
	open_form.text = "从拆包结果填写运行时依赖…"
	open_form.pressed.connect(func(): _resource_config_form.popup_centered(Vector2i(800, 660)))
	add_child(open_form)
	_buttons.append(open_form)

func _setup_resource_runtime_forms() -> void:
	for kind in ["install", "interfaces", "assembly"]:
		var title := "接入资源加载脚本" if kind == "install" else ("准备资源接口计划" if kind == "interfaces" else "资源最终组包计划")
		var open_form := Button.new()
		open_form.text = title + "…"
		open_form.pressed.connect(_open_resource_runtime_form.bind(kind))
		add_child(open_form)
		_buttons.append(open_form)
		var dialog := ConfirmationDialog.new()
		dialog.title = title + "（开发测试）"
		dialog.ok_button_text = "生成计划（不执行）"
		dialog.cancel_button_text = "返回"
		dialog.confirmed.connect(_prepare_resource_runtime_form.bind(kind))
		add_child(dialog)
		var body := VBoxContainer.new()
		body.custom_minimum_size.x = 700
		dialog.add_child(body)
		var note := Label.new()
		note.text = "使用已经生成的资源配置和实际文件；仍由同一 CLI 核对。\n这里只写本地计划草稿，不创建输出目录；执行须另行确认。\n依赖仍需明确声明，boot 中的接收脚本及手机运行尚需单独验证。"
		if kind == "install":
			note.text = "本步只生成接入计划。确认执行后，将补齐4份脚本并加入 WxResource Autoload。\n请先保存工程，执行时不要同时编辑。原配置会保留；已有不同内容的脚本不会被覆盖。\n取消或失败会保留已写入文件，不自动回滚；不会导出、转换或修改游戏切场景逻辑。"
		note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		body.add_child(note)
		var paths: Dictionary = {}
		if kind == "install":
			paths.projectFile = _selection_field("原项目 project.godot", false, body, "project.godot ; Godot project")
		else:
			paths.resourceConfigFile = _selection_field("资源配置 JSON（包含实际 PCK 哈希与依赖）", false, body, "*.json ; JSON")
		if kind == "interfaces":
			paths.js = _selection_field("配对引擎 JS", false, body, "*.js ; JavaScript")
			paths.wasm = _selection_field("配对引擎 WASM", false, body, "*.wasm ; WASM")
		elif kind == "assembly":
			paths.officialConfigFile = _selection_field("这次官方转换使用的配置 JSON", false, body, "*.json ; JSON")
			paths.convertedOutput = _selection_field("已完成的官方 converted 输出目录", true, body)
		var parent := _selection_field("输出父目录（必须已存在）", true, body)
		var leaf := LineEdit.new()
		leaf.text = "wechat-resource-" + kind
		body.add_child(leaf)
		var budget := _budget_field(body, "任务输出上限 MiB", 4, 384 if kind == "assembly" else 8, 32 if kind == "assembly" else 4)
		_resource_runtime_forms[kind] = {"dialog": dialog, "paths": paths, "parent": parent, "leaf": leaf, "budget": budget}
		if kind == "install":
			var ack := CheckBox.new()
			ack.text = "我理解执行会写入选定项目；已保存工程，接受部分写入保留"
			body.add_child(ack)
			_resource_runtime_forms[kind].ack = ack
			paths.projectFile.text_changed.connect(func(_value: String): ack.button_pressed = false)
			ack.toggled.connect(func(_pressed: bool): _refresh_controls())
		if kind == "interfaces":
			for field in paths.values():
				field.text_changed.connect(_clear_resource_runtime_handoff)
			parent.text_changed.connect(_clear_resource_runtime_handoff)
			leaf.text_changed.connect(_clear_resource_runtime_handoff)
			budget.value_changed.connect(_clear_resource_runtime_handoff)
	_resource_prefill_button = Button.new()
	_resource_prefill_button.text = "按资源接口计划预填官方转换表单…"
	_resource_prefill_button.disabled = true
	_resource_prefill_button.pressed.connect(_prefill_resource_official_form)
	add_child(_resource_prefill_button)

func _open_resource_runtime_form(kind: String) -> void:
	_resource_runtime_forms[kind].dialog.popup_centered(Vector2i(760, 580))

func _setup_resource_boot_form() -> void:
	_resource_boot_dialog = ConfirmationDialog.new()
	_resource_boot_dialog.title = "接收器接入计划／实际 PCK核对（只读）"
	_resource_boot_dialog.ok_button_text = "核对实际文件"
	_resource_boot_dialog.cancel_button_text = "返回"
	_resource_boot_dialog.dialog_hide_on_ok = false
	add_child(_resource_boot_dialog)
	var body := VBoxContainer.new()
	body.custom_minimum_size.x = 720
	_resource_boot_dialog.add_child(body)
	_resource_boot_note = Label.new()
	_resource_boot_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_resource_boot_note.text = "选择原项目和已导出的分包配置，核对四份接收器、Autoload及启动场景。\n只检查源码与包内字节；不修改工程，不导出，不代表真实运行通过。\n字节码或未知映射不能代替原文匹配，检查会明确报告。"
	body.add_child(_resource_boot_note)
	_resource_boot_project = _selection_field("原项目 project.godot", false, body, "project.godot ; Godot project")
	var source_plan := Button.new()
	source_plan.text = "生成接收器接入计划（不写项目）"
	source_plan.pressed.connect(func(): _start("resource-source-plan", {"projectFile": _resource_boot_project.text}))
	body.add_child(source_plan)
	_buttons.append(source_plan)
	_resource_boot_config = _selection_field("已导出资源配置 JSON", false, body, "*.json ; JSON")
	_resource_boot_dialog.confirmed.connect(func():
		_start("resource-boot-check", {"schema": "wxslim-resource-boot-check-v1", "projectFile": _resource_boot_project.text, "resourceConfigFile": _resource_boot_config.text})
	)
	var open_form := Button.new()
	open_form.text = "核对启动接收器与实际 PCK…"
	open_form.pressed.connect(func(): _resource_boot_dialog.popup_centered(Vector2i(760, 340)))
	add_child(open_form)
	_buttons.append(open_form)

func _clear_resource_runtime_handoff(_changed: Variant) -> void:
	_resource_runtime_next = {}
	if is_instance_valid(_resource_prefill_button):
		_resource_prefill_button.disabled = true

func _prepare_resource_runtime_form(kind: String) -> void:
	var form: Dictionary = _resource_runtime_forms[kind]
	var leaf: String = form.leaf.text
	if not form.parent.text.is_absolute_path() or leaf.is_empty() or leaf in [".", ".."] or leaf.contains("/") or leaf.contains("\\") or leaf.contains(":"):
		_fail("请选择已有输出父目录，并填写单个新目录名称。")
		return
	var payload := {"output": form.parent.text.path_join(leaf), "budgetBytes": int(form.budget.value) * 1048576}
	if kind == "install":
		if not form.ack.button_pressed:
			_fail("请先确认接入的项目及写入范围。")
			return
		payload.allowProjectWrites = true
	for key in form.paths:
		payload[key] = form.paths[key].text
	_start("prepare-resource-" + kind + "-request", payload)

func _prefill_resource_official_form() -> void:
	if not _job.is_empty() or not _control_job.is_empty() or _resource_runtime_next.is_empty():
		return
	for key in ["js", "wasm", "pck", "interfaces"]:
		_official_paths[key].text = _resource_runtime_next[key]
	_resource_runtime_forms.assembly.paths.resourceConfigFile.text = _resource_runtime_next.resourceConfigFile
	_state.text = "已预填本次计划的路径；接口文件仍须执行生成后才能转换。请核对引擎配方及其余选项。未保存选择、未执行任务。"
	_official_dialog.popup_centered(Vector2i(760, 640))

func _resource_source_changed(_value: String) -> void:
	_resource_generation += 1
	_resource_inventory = {}
	_resource_inventory_token = ""
	_resource_inventory_source = ""
	_resource_assignments = {}
	_resource_pack_ids = ["boot"]
	_resource_paths.clear()
	_resource_target.clear()
	_resource_target.add_item("boot")
	_resource_entries.clear()
	_resource_ack.button_pressed = false
	_resource_summary.text = "源选择已变化；必须重新读取实际清单。"
	_refresh_controls()

func _resource_same_path(left: String, right: String) -> bool:
	var a := left.replace("\\", "/").simplify_path()
	var b := right.replace("\\", "/").simplify_path()
	return a.to_lower() == b.to_lower() if OS.get_name() == "Windows" else a == b

func _resource_form_ready() -> bool:
	return not _resource_inventory.is_empty() and not _resource_inventory_token.is_empty() and _resource_same_path(_resource_source.text, _resource_inventory_source)

func _read_resource_inventory() -> void:
	if not _job.is_empty() or not _control_job.is_empty():
		return
	_resource_source_changed(_resource_source.text)
	if not _resource_source.text.is_absolute_path():
		_fail("请选择实际 PCK 的绝对路径；尚未读取。")
		return
	_start("resource-inventory", {"sourcePath": _resource_source.text})

func _resource_add_pack() -> void:
	if not _job.is_empty() or not _control_job.is_empty() or not _resource_form_ready():
		return
	var id := _resource_pack_name.text
	var pattern := RegEx.new()
	pattern.compile("^[a-z][a-z0-9_-]{0,47}$")
	if pattern.search(id) == null or id in _resource_pack_ids or _resource_pack_ids.size() >= 128:
		_resource_summary.text = "包 ID 必须唯一，匹配 [a-z][a-z0-9_-]{0,47}；总包数最多 128。"
		return
	_resource_pack_ids.append(id)
	_resource_ack.button_pressed = false
	_resource_target.add_item(id)
	_resource_target.select(_resource_pack_ids.size() - 1)
	_resource_pack_name.text = ""
	_resource_render_entries()

func _resource_move_entries() -> void:
	if not _job.is_empty() or not _control_job.is_empty() or not _resource_form_ready() or _resource_target.selected < 0:
		return
	for index in _resource_entries.get_selected_items():
		_resource_assignments[_resource_paths[index]] = _resource_pack_ids[_resource_target.selected]
	_resource_ack.button_pressed = false
	_resource_render_entries()

func _resource_render_entries() -> void:
	_resource_entries.clear()
	var counts: Dictionary = {}
	for id in _resource_pack_ids:
		counts[id] = {"entries": 0, "bytes": 0}
	for index in range(_resource_paths.size()):
		var path: String = _resource_paths[index]
		var id: String = _resource_assignments[path]
		var bytes := int(_resource_inventory.entries[index].bytes)
		counts[id].entries += 1
		counts[id].bytes += bytes
		_resource_entries.add_item("%s | %s | %d bytes" % [id, path, bytes])
	var summaries: Array[String] = []
	for id in _resource_pack_ids:
		summaries.append("%s: %d 条 / %d bytes" % [id, counts[id].entries, counts[id].bytes])
	_resource_summary.text = "已绑定实际清单；%s\n依赖需手工声明；最终规则仍由共用计划核验。" % "; ".join(summaries)
	_refresh_controls()

func _accept_resource_inventory(result: Dictionary) -> void:
	var data: Dictionary = result.data
	var inventory: Variant = data.get("inventory")
	var pin: Variant = data.get("pin")
	if data.get("schema") != "wxslim-local-resource-inventory-v1" or not data.get("sourcePath") is String or not inventory is Dictionary or inventory.get("schema") != "wxslim-pck-inventory-v1" or inventory.get("status") != "PASS_PCK_STRUCTURE_ONLY" or not inventory.get("entries") is Array or not pin is Dictionary or not pin.get("sha256") is String or inventory.get("bytes") != pin.get("bytes") or inventory.get("sha256") != pin.get("sha256"):
		_fail("资源清单身份或 pin 不完整；不采用。")
		return
	var hash_pattern := RegEx.new()
	hash_pattern.compile("^[a-f0-9]{64}$")
	if hash_pattern.search(pin.sha256) == null:
		_fail("资源清单 pin SHA256 格式错误；不采用。")
		return
	if _job.get("resourceGeneration") != _resource_generation or not _resource_same_path(str(_job.get("resourceSource", "")), _resource_source.text) or not _resource_same_path(data.sourcePath, _resource_source.text):
		_fail("资源清单返回时源选择已变化；丢弃旧结果，重新读取。")
		return
	var paths: Array[String] = []
	var assignments: Dictionary = {}
	for entry in inventory.entries:
		if not entry is Dictionary or not entry.get("path") is String or entry.path.is_empty() or assignments.has(entry.path) or not (entry.get("bytes") is int or entry.get("bytes") is float):
			_fail("资源清单条目格式错误；不采用。")
			return
		var bytes := float(entry.bytes)
		if not is_finite(bytes) or bytes < 0 or bytes != floor(bytes):
			_fail("资源清单条目大小错误；不采用。")
			return
		paths.append(entry.path)
		assignments[entry.path] = "boot"
	_resource_inventory = inventory.duplicate(true)
	_resource_inventory_token = result.token
	_resource_inventory_source = data.sourcePath
	_resource_paths = paths
	_resource_assignments = assignments
	_resource_render_entries()
	_state.text = "已只读获取实际 PCK 清单；尚未生成拆包计划。"
	_details.text = JSON.stringify({"sourcePath": data.sourcePath, "pin": pin, "entries": paths.size(), "inventoryToken": result.token}, "\t")

func _prepare_resource_form() -> void:
	if not _job.is_empty() or not _control_job.is_empty():
		return
	var leaf := _resource_name.text
	if not _resource_form_ready() or not _resource_ack.button_pressed:
		_fail("请重新读取实际 PCK 清单并确认手工依赖声明；尚未生成计划。")
		return
	if not _resource_parent.text.is_absolute_path() or not DirAccess.dir_exists_absolute(_resource_parent.text) or leaf.is_empty() or leaf != leaf.strip_edges() or leaf in [".", ".."] or "/" in leaf or "\\" in leaf or ":" in leaf:
		_fail("请选择现有输出父目录与新的子目录名称；尚未生成计划。")
		return
	var packs: Array = []
	for id in _resource_pack_ids:
		var paths: Array[String] = []
		for path in _resource_paths:
			if _resource_assignments.get(path) == id:
				paths.append(path)
		packs.append({"id": id, "role": "boot" if id == "boot" else "resource", "paths": paths})
	var payload := {"sourcePath": _resource_inventory_source, "output": _resource_parent.text.path_join(leaf), "budgetBytes": int(_resource_budget.value) * 1048576, "packs": packs, "dependencyAcknowledged": true}
	var envelope := _write_resource_declaration(payload)
	if not envelope.is_empty():
		_start("prepare-resource-request", envelope)

# Logical-byte guard only; no files are created by this scan. Reject links and
# incomplete traversal rather than guessing a safe remaining budget.
func _resource_directory_bytes(directory: String, depth: int = 0) -> int:
	if depth > 32:
		return -1
	var dir := DirAccess.open(directory)
	if dir == null:
		return -1
	dir.include_hidden = true
	if dir.list_dir_begin() != OK:
		return -1
	var total := 0
	var name := dir.get_next()
	while not name.is_empty():
		if dir.is_link(name):
			dir.list_dir_end()
			return -1
		var path := directory.path_join(name)
		var size := 0
		if dir.current_is_dir():
			size = _resource_directory_bytes(path, depth + 1)
		else:
			var file := FileAccess.open(path, FileAccess.READ)
			if file == null:
				dir.list_dir_end()
				return -1
			size = file.get_length()
			file.close()
		if size < 0:
			dir.list_dir_end()
			return -1
		total += size
		if total >= 16777216:
			dir.list_dir_end()
			return -1
		name = dir.get_next()
	dir.list_dir_end()
	return total

func _resource_path_exists(directory: DirAccess, name: String) -> bool:
	return directory.file_exists(name) or directory.dir_exists(name) or directory.is_link(name)

func _write_resource_declaration(payload: Dictionary) -> Dictionary:
	var bytes := (JSON.stringify(payload, "\t") + "\n").to_utf8_buffer()
	var root := _state_directory()
	var logs := root.path_join("logs")
	var dir := DirAccess.open(logs)
	var total := _resource_directory_bytes(root)
	# Match adapter headroom: 4 MiB stdout/result + 2 MiB resource drafts.
	if bytes.size() > 1048576 or dir == null or total < 0 or total + bytes.size() >= 10485760:
		_fail("声明超过1 MiB、插件预算余量不足或目录不可安全读取；未写入声明。")
		return {}
	var token := "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var final_name := token + ".resource-declaration.private.json"
	var temporary_name := token + ".resource-declaration.private.tmp"
	var claim_name := token + ".resource-declaration.claim"
	if _resource_path_exists(dir, final_name) or _resource_path_exists(dir, temporary_name) or _resource_path_exists(dir, claim_name):
		_fail("声明名称已占用；拒绝覆盖，未写入。")
		return {}
	# Cooperative exclusive claim, not protection against hostile external writers.
	if DirAccess.make_dir_absolute(logs.path_join(claim_name)) != OK:
		_fail("声明排他 claim 失败；未触碰已有文件或 claim。")
		return {}
	var message := ""
	var hash := ""
	if _resource_path_exists(dir, final_name) or _resource_path_exists(dir, temporary_name):
		message = "声明名称在 claim 后已占用；拒绝覆盖。"
	else:
		var temporary := logs.path_join(temporary_name)
		var file := FileAccess.open(temporary, FileAccess.WRITE)
		if file == null:
			message = "声明临时文件无法创建。"
		else:
			file.store_buffer(bytes)
			file.flush()
			var write_error := file.get_error()
			file.close()
			hash = FileAccess.get_sha256(temporary)
			if write_error != OK or hash != bytes.get_string_from_utf8().sha256_text():
				message = "声明写入或实际 SHA256 核对失败。"
			elif _resource_path_exists(dir, final_name):
				message = "声明最终文件已存在；拒绝覆盖。"
			elif DirAccess.rename_absolute(temporary, logs.path_join(final_name)) != OK:
				message = "声明原子重命名失败。"
			elif FileAccess.get_sha256(logs.path_join(final_name)) != hash:
				message = "声明最终文件 SHA256 核对失败。"
	# Only our empty claim is removed. Partial files are evidence, never cleaned.
	var release := DirAccess.remove_absolute(logs.path_join(claim_name))
	if release != OK:
		message += " 本次 claim 无法释放；已保留，不自动清理。"
	if not message.is_empty():
		_fail(message + " 已产生的声明草稿保留在 logs；未启动任务。")
		return {}
	return {"declarationToken": token, "declarationSha256": hash, "inventoryToken": _resource_inventory_token}

func _resource_plan_summary(value: Dictionary) -> Dictionary:
	var summary := {"schema": value.get("schema"), "action": value.get("action"), "eligible": value.get("eligible"), "purpose": value.get("purpose"), "reason": value.get("reason"), "admission": value.get("admission"), "dependencyClosure": "NOT_INFERRED", "scope": "SUMMARY_ONLY_FULL_RECEIPT_IN_LOCAL_LOGS"}
	var plan: Variant = value.get("plan")
	if plan is Dictionary:
		summary.planSha256 = plan.get("planSha256")
		summary.outputBytes = plan.get("outputBytes")
		summary.receiptReserveBytes = plan.get("receiptReserveBytes")
		if plan.get("input") is Dictionary:
			summary.output = plan.input.get("output")
			summary.budgetBytes = plan.input.get("budgetBytes")
			summary.sourcePath = plan.input.get("sourcePath")
		if plan.get("outputs") is Array:
			summary.outputs = plan.outputs
	return summary

func _prepare_official_form() -> void:
	var output_name := _official_output_name.text
	if output_name.is_empty() or output_name != output_name.strip_edges() or output_name in [".", ".."] or "/" in output_name or "\\" in output_name or ":" in output_name:
		_fail("请输入新的转换任务子目录名称，不含路径分隔符；尚未生成计划。")
		return
	if not _official_parent.text.is_absolute_path() or _official_mode.selected < 1:
		_fail("请选择输出父目录与明确的渲染后端；尚未生成计划。")
		return
	var payload := {"output": _official_parent.text.path_join(output_name), "name": _official_name.text, "locale": _official_locale.text,
		"renderMode": _official_mode.get_selected_metadata(), "orientation": _official_orientation.get_selected_metadata(),
		"engineProfile": _official_profile.get_selected_metadata(), "removedModules": null, "loginCode": _official_login_code.button_pressed,
		"skipDefault3dPrewarm": _official_skip_prewarm.button_pressed, "largePckBudget": _official_large_pck_budget.button_pressed}
	if payload.engineProfile == "conservative-official-c050-dev":
		var declarations := {}
		for module_name in _official_modules:
			if not _official_modules[module_name].button_pressed:
				_fail("保守版需逐项确认未使用被移除模块；未知或使用时请选择完整版。尚未生成计划。")
				return
			declarations[module_name] = "unused"
		payload.removedModules = declarations
	if payload.engineProfile == "custom-official-c050-dev":
		if not _official_custom_preparation.text.is_absolute_path() or not _official_custom_usage.text.is_absolute_path():
			_fail("请选择本次配对的准备配置和已核对的启动 PCK 功能声明。")
			return
		var usage_file := FileAccess.open(_official_custom_usage.text, FileAccess.READ)
		if usage_file == null or usage_file.get_length() > 65536:
			_fail("无法读取启动 PCK 功能声明，文件上限 64 KiB。")
			return
		var usage: Variant = JSON.parse_string(usage_file.get_as_text())
		if not usage is Dictionary:
			_fail("启动 PCK 功能声明必须是 JSON 对象。")
			return
		payload.customPreparation = _official_custom_preparation.text
		payload.projectUsage = usage
	for key in _official_paths:
		payload[key] = _official_paths[key].text
	_start("prepare-official-request", payload)

func _prepare_export_form() -> void:
	var output_name := _export_name.text
	if output_name.is_empty() or output_name != output_name.strip_edges() or output_name in [".", ".."] or "/" in output_name or "\\" in output_name or ":" in output_name:
		_fail("请输入新的输出子目录名称，不含路径分隔符；尚未生成计划。")
		return
	if not _export_project.text.is_absolute_path() or not _export_parent.text.is_absolute_path() or not _export_import.button_pressed:
		_fail("请选择源工程和现有输出父目录，并确认导入写入说明；尚未生成计划。")
		return
	_start("prepare-export-request", {
		"project": _export_project.text, "preset": _export_preset.text,
		"output": _export_parent.text.path_join(output_name),
		"budgetBytes": int(_export_budget.value) * 1048576,
		"cacheGrowthBudgetBytes": int(_export_cache_budget.value) * 1048576,
		"allowImportWrites": _export_import.button_pressed
	})

func _selection_changed(_value: String) -> void:
	if is_instance_valid(_resource_config_form):
		_resource_config_form.clear_catalog()
	_invalidate_task_bindings()
	_refresh_controls()

func _invalidate_task_bindings() -> void:
	# A receipt from an old REQUEST must never become the current task selection.
	if is_instance_valid(_request) and _request.text != _last_execution_request_file:
		_last_execution_token = ""
		_last_execution_request_file = ""
	_plan = {}
	_status_receipt = {}
	_plan_configuration = ""
	_status_configuration = ""
	_execution_observation = {}
	if is_instance_valid(_last_event):
		_last_event.text = "任务/选择绑定已变化；最后记录阶段需手动重新读取，不能沿用上次任务的事件。"
	_discard_confirmation()

func _discard_confirmation() -> void:
	_confirmation = {}
	_confirmation_configuration = ""
	_confirmation_secondary = false
	_confirmation_bounded = false

func _selection_is_saved() -> bool:
	var config = JSON.parse_string(_configuration_text)
	return config is Dictionary and _request.text == config.get("requestFile", "") and _root.text == config.get("taskRoot", "") and _task_id.text == config.get("taskId", "")

func _can_execute() -> bool:
	return _job.is_empty() and _control_job.is_empty() and _selection_is_saved() and not _plan.is_empty() and _plan.get("schema") == "wxslim-task-plan-v1" and _plan.get("eligible") == true and _plan.get("purpose") in ["development-test", "supported-use"] and _plan_configuration == _configuration_text

func _can_cancel() -> bool:
	if _plan.get("action") == "official-pair-prepare" or _plan.get("executionMode") == "bounded-files":
		return false
	return _job.is_empty() and _control_job.is_empty() and _selection_is_saved() and not _root.text.is_empty() and not _task_id.text.is_empty() and _status_configuration == _configuration_text and _status_receipt.get("schema") == "wxslim-task-status-v1" and _status_receipt.get("taskId") == _task_id.text and _status_receipt.get("inputBinding") == "MATCHED_EXECUTION_SNAPSHOT" and _status_receipt.get("terminalPresent") == false and _status_receipt.get("status") == "NO_TERMINAL_RECEIPT"

func _can_cancel_observed_execution() -> bool:
	var assessment = _execution_observation.get("assessment")
	return _control_job.is_empty() and not _last_execution_token.is_empty() and _execution_observation.get("schema") == "wxslim-local-execution-observation-v1" and _execution_observation.get("executionToken") == _last_execution_token and _execution_observation.get("status") == "TASK_RECEIPT_MATCHED" and _execution_observation.get("cancelEligible") == true and _execution_observation.get("taskRoot") is String and _execution_observation.get("taskId") is String and assessment is Dictionary and assessment.get("taskId") == _execution_observation.get("taskId") and assessment.get("inputBinding") == "MATCHED_EXECUTION_SNAPSHOT" and assessment.get("terminalPresent") == false and assessment.get("status") == "NO_TERMINAL_RECEIPT"

func _can_select_execution() -> bool:
	return _job.is_empty() and _control_job.is_empty() and _selection_is_saved() and not _last_execution_token.is_empty() and _request.text == _last_execution_request_file

func _refresh_controls() -> void:
	var idle := _job.is_empty() and _control_job.is_empty()
	for button in _buttons:
		button.disabled = not _job.is_empty() or not _control_job.is_empty()
	for field in [_request, _root, _task_id]:
		field.editable = _job.is_empty() and _control_job.is_empty()
	if is_instance_valid(_official_dialog):
		_official_profile.disabled = not idle
		_official_mode.disabled = not idle
		_official_orientation.disabled = not idle
		for key in _official_paths:
			_official_paths[key].editable = idle
		for field in [_official_parent, _official_output_name, _official_name, _official_locale]:
			field.editable = idle
		for module_name in _official_modules:
			_official_modules[module_name].disabled = not idle
		_official_dialog.get_ok_button().disabled = not idle
	if is_instance_valid(_raw_build_dialog):
		_raw_build_recipe.disabled = not idle
		_raw_build_profile.disabled = not idle
		_raw_build_jobs.editable = idle
		_raw_build_budget.editable = idle
		for field in _raw_build_paths.values() + [_raw_build_parent, _raw_build_name]:
			field.editable = idle
		_raw_build_dialog.get_ok_button().disabled = not idle
	if is_instance_valid(_resource_dialog):
		for field in [_resource_source, _resource_parent, _resource_name, _resource_pack_name]:
			field.editable = idle
		_resource_target.disabled = not idle
		_resource_budget.editable = idle
		_resource_ack.disabled = not idle
		_resource_entries.mouse_filter = Control.MOUSE_FILTER_STOP if idle else Control.MOUSE_FILTER_IGNORE
		_resource_entries.focus_mode = Control.FOCUS_ALL if idle else Control.FOCUS_NONE
		_resource_dialog.get_ok_button().disabled = not idle or not _resource_form_ready() or not _resource_ack.button_pressed
	for form in _resource_runtime_forms.values():
		for field in form.paths.values():
			field.editable = idle
		form.parent.editable = idle
		form.leaf.editable = idle
		form.budget.editable = idle
		form.dialog.get_ok_button().disabled = not idle
		if form.has("ack"):
			form.ack.disabled = not idle
			form.dialog.get_ok_button().disabled = not idle or not form.ack.button_pressed
	if is_instance_valid(_resource_prefill_button):
		_resource_prefill_button.disabled = not idle or _resource_runtime_next.is_empty()
	if is_instance_valid(_resource_config_form):
		_resource_config_form.set_busy(not idle)
	if is_instance_valid(_resource_boot_dialog):
		_resource_boot_project.editable = idle
		_resource_boot_config.editable = idle
		_resource_boot_dialog.get_ok_button().disabled = not idle
	if is_instance_valid(_execute_button):
		_execute_button.disabled = not _can_execute()
		_execute_button.tooltip_text = "先保存选择并读取允许本用途的计划；准备后仍须确认精确目录/预算。"
	if is_instance_valid(_cancel_button):
		_cancel_button.disabled = not _can_cancel()
		_cancel_button.tooltip_text = "仅已核执行快照且无终态的保存选择；不会使用保存的旧身份代替本次执行。"
	if is_instance_valid(_observe_button):
		_observe_button.disabled = _last_execution_token.is_empty() or not _control_job.is_empty() or (not _job.is_empty() and _job.operation != "execute")
		_observe_button.tooltip_text = "手动读取本次执行已绑定输出的真实任务收据；可能核输入哈希/大小，不自动高频轮询。"
	if is_instance_valid(_active_cancel_button):
		_active_cancel_button.disabled = not _can_cancel_observed_execution()
		_active_cancel_button.tooltip_text = "只有TASK身份经共同status核执行快照后可准备取消；不证明该任务必属于当前子进程。"
	if is_instance_valid(_use_execution_button):
		_use_execution_button.disabled = not _can_select_execution()
		_use_execution_button.tooltip_text = "重新核对本次执行的真实任务和当前REQUEST，然后保存目录/ID；不会执行任务，无需复制任务编号。"

func _confirm_task_operation() -> void:
	if _confirmation.is_empty() or not _selection_is_saved() or not _control_job.is_empty() or (not _job.is_empty() and not _confirmation_secondary):
		return
	var current := FileAccess.get_file_as_string(_config_file())
	if current != _confirmation_configuration or current != _configuration_text:
		_invalidate_task_bindings()
		_fail("本地配置已变化，确认失效；重新读取计划或状态后准备。")
		_refresh_controls()
		return
	var action: String = _confirmation.get("action", "")
	if action not in ["execute", "cancel"]:
		_discard_confirmation()
		_fail("确认无效；重新准备，不自动重试。")
		return
	var payload := {"schema": "wxslim-local-task-confirmation-v1", "preparationToken": _confirmation.preparationToken, "bindingSha256": _confirmation.bindingSha256, "confirmed": true}
	var secondary := _confirmation_secondary
	var bounded := _confirmation_bounded
	_discard_confirmation()
	if secondary:
		_execution_observation = {}
		_start_control(action, payload)
	else:
		_start(action, payload, bounded)

func _observe_execution() -> void:
	if not _last_execution_token.is_empty():
		_start_control("observe-execution", {"executionToken": _last_execution_token})

func _use_execution_selection() -> void:
	if _can_select_execution():
		_start("select-execution", {"executionToken": _last_execution_token, "expectedConfigurationText": _configuration_text})

func _prepare_active_cancel() -> void:
	if _can_cancel_observed_execution():
		_start_control("prepare-active-cancel", {"executionToken": _last_execution_token})

func _start_control(operation: String, payload: Dictionary) -> void:
	if not _control_job.is_empty() or operation not in ["observe-execution", "prepare-active-cancel", "cancel"]:
		return
	var config = JSON.parse_string(FileAccess.get_file_as_string(_config_file()))
	if not config is Dictionary or not config.get("nodeExecutable") is String or not FileAccess.file_exists(config.nodeExecutable) or config.nodeExecutable.get_file().to_lower() not in ["node", "node.exe"]:
		_fail("独立收据/取消适配器配置无效；任务状态未知。")
		return
	var token := "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var encoded_payload := _payload_argument(payload)
	if encoded_payload.is_empty():
		return
	var args := PackedStringArray([_adapter_file(), _config_file(), operation, token, encoded_payload])
	var pid := OS.create_process(config.nodeExecutable, args, false)
	if pid <= 0:
		_fail("独立适配器未能创建；不能据此判断任务已结束。")
		return
	_control_job = {"pid": pid, "token": token, "operation": operation, "result": _state_directory().path_join("logs").path_join(token + ".result.private.json"), "started": Time.get_ticks_msec()}
	_refresh_controls()
	set_process(true)

func _selection_field(caption: String, directory: bool, parent: Control = null, filter: String = "*.json ; JSON") -> LineEdit:
	var row := HBoxContainer.new()
	if parent == null:
		add_child(row)
	else:
		parent.add_child(row)
	var field := LineEdit.new()
	field.placeholder_text = caption
	field.tooltip_text = caption
	field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(field)
	var picker := FileDialog.new()
	picker.access = FileDialog.ACCESS_FILESYSTEM
	picker.file_mode = FileDialog.FILE_MODE_OPEN_DIR if directory else FileDialog.FILE_MODE_OPEN_FILE
	if not directory:
		picker.filters = PackedStringArray([filter])
	add_child(picker)
	if directory:
		picker.dir_selected.connect(func(value: String):
			field.text = value
			field.text_changed.emit(value)
		)
	else:
		picker.file_selected.connect(func(value: String):
			field.text = value
			field.text_changed.emit(value)
		)
	var button := Button.new()
	button.text = "选择…"
	button.pressed.connect(func(): picker.popup_centered_ratio(0.7))
	row.add_child(button)
	_buttons.append(button)
	return field

func _start(operation: String, payload: Dictionary = {}, bounded: bool = false) -> void:
	if not _job.is_empty() or not _control_job.is_empty():
		return
	if operation not in ["open-project", "capabilities", "list", "plan", "status", "prepare-export-request", "prepare-raw-build-request", "prepare-official-request", "resource-inventory", "prepare-resource-request", "resource-partition-outputs", "prepare-resource-config", "resource-boot-check", "resource-source-plan", "prepare-resource-interfaces-request", "prepare-resource-assembly-request", "prepare-resource-install-request", "save-selection", "select-execution", "prepare-execute", "prepare-cancel", "execute", "cancel"]:
		_fail("操作不在本地任务协议允许范围。")
		return
	if operation == "prepare-execute" and not _can_execute():
		return
	if operation == "prepare-cancel" and not _can_cancel():
		return
	if operation == "select-execution" and not _can_select_execution():
		return
	if operation in ["plan", "status", "prepare-execute", "prepare-cancel", "execute", "cancel"] and not _selection_is_saved():
		_fail("选择已变化；先显式保存，再读取新的计划或状态。")
		return
	if operation in ["prepare-execute", "prepare-cancel", "execute", "cancel"] and FileAccess.get_file_as_string(_config_file()) != _configuration_text:
		_invalidate_task_bindings()
		_fail("配置已被外部修改；控制绑定失效，请重新加载本地配置。")
		_refresh_controls()
		return
	var config = JSON.parse_string(FileAccess.get_file_as_string(_config_file()))
	if not config is Dictionary or not config.get("nodeExecutable", "") is String or not FileAccess.file_exists(config.get("nodeExecutable", "")):
		_fail("本地配置无效或 Node 不存在；未启动查询。")
		return
	if config.nodeExecutable.get_file().to_lower() not in ["node", "node.exe"]:
		_fail("仅允许集中配置中的 Node 可执行文件；不启动 shell。")
		return
	var token := "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var result_path := _state_directory().path_join("logs").path_join(token + ".result.private.json")
	var args := PackedStringArray([_adapter_file(), _config_file(), operation, token])
	if operation == "resource-partition-outputs":
		payload = {"requestFile": _request.text, "root": _root.text, "taskId": _task_id.text}
	if operation == "save-selection":
		var encoded_selection := _payload_argument({"expected": _configuration_text, "selection": {"requestFile": _request.text, "taskRoot": _root.text, "taskId": _task_id.text}})
		if encoded_selection.is_empty():
			return
		args.append(encoded_selection)
	elif operation in ["open-project", "execute", "cancel", "prepare-export-request", "prepare-raw-build-request", "prepare-official-request", "resource-inventory", "prepare-resource-request", "resource-partition-outputs", "prepare-resource-config", "resource-boot-check", "resource-source-plan", "prepare-resource-interfaces-request", "prepare-resource-assembly-request", "prepare-resource-install-request", "select-execution"]:
		if payload.is_empty():
			_fail("没有本次明确确认；不启动控制操作。")
			return
		var encoded_payload := _payload_argument(payload)
		if encoded_payload.is_empty():
			return
		args.append(encoded_payload)
	if operation in ["save-selection", "select-execution", "execute", "cancel", "prepare-export-request", "prepare-raw-build-request", "prepare-official-request", "prepare-resource-request", "prepare-resource-config", "prepare-resource-interfaces-request", "prepare-resource-assembly-request", "prepare-resource-install-request"]:
		_invalidate_task_bindings()
	if operation == "prepare-resource-interfaces-request":
		_resource_runtime_next = {}
	if operation == "resource-partition-outputs":
		_resource_config_form.clear_catalog()
	var pid := OS.create_process(config.nodeExecutable, args, false)
	if pid <= 0:
		_fail("查询进程未能创建；不代表任务失败或正在运行。")
		return
	_job = {"pid": pid, "token": token, "operation": operation, "result": result_path, "started": Time.get_ticks_msec(), "bounded": bounded}
	if operation == "resource-inventory":
		_job.resourceSource = payload.sourcePath
		_job.resourceGeneration = _resource_generation
	if operation == "execute":
		_last_execution_token = token
		_last_execution_request_file = _request.text
		_execution_observation = {}
		_last_event.text = "本次执行的最后记录阶段尚未读取；请手动刷新本次执行收据。"
		if bounded:
			_last_event.text = "本次仅准备两个新文件，没有持久TASK、阶段日志或中途取消。"
	_poll_elapsed = 0.0
	_refresh_controls()
	_state.text = "本地操作已启动；正在等待完整共享收据。"
	if operation == "execute":
		_state.text = "执行适配器已启动；尚无任务终态。手动刷新真实输出收据后才能准备取消；不强杀。"
		if bounded:
			_state.text = "有界文件准备适配器已启动；只写计划中的两个新文件，无中途取消，不是编译。"
	set_process(true)

func _payload_argument(payload: Dictionary) -> String:
	# Godot's Windows process quoting does not preserve embedded JSON quotes.
	# UTF-8 base64 is one whitespace-free argument; this does not grant task access.
	var bytes := JSON.stringify(payload).to_utf8_buffer()
	if bytes.size() > 16384:
		_fail("本地表单参数超过16 KiB；未启动操作。请减少参数或使用已有REQUEST入口。")
		return ""
	return "wxslim-json64:" + Marshalls.raw_to_base64(bytes)

func _process(delta: float) -> void:
	if _job.is_empty() and _control_job.is_empty():
		return
	_poll_elapsed += delta
	if _poll_elapsed < 0.5:
		return
	_poll_elapsed = 0.0
	_poll_main_result()
	_poll_control_result()

func _poll_main_result() -> void:
	if _job.is_empty():
		return
	var elapsed := int((Time.get_ticks_msec() - _job.started) / 1000)
	if _job.operation == "execute":
		_progress.text = "执行适配器存活：%s；等待 %d 秒。阶段事件需手动刷新真实收据；不以存活推导任务运行或完成百分比。" % [str(OS.is_process_running(_job.pid)), elapsed]
		if _job.get("bounded", false):
			_progress.text = "文件准备适配器存活：%s；等待 %d 秒。没有持久任务控制器或阶段百分比，无中途取消。" % [str(OS.is_process_running(_job.pid)), elapsed]
	elif elapsed >= 30:
		_progress.text = "本地操作已等待 %d 秒，尚无完整结果；不推断任务状态，不自动重试。" % elapsed
	if FileAccess.file_exists(_job.result):
		var file := FileAccess.open(_job.result, FileAccess.READ)
		if file == null or file.get_length() > 4194304:
			_fail("结果无法读取或超限；任务状态及写入副作用未知，须核共享收据。")
			_finish()
			return
		var result = JSON.parse_string(file.get_as_text())
		if not result is Dictionary or result.get("schema") != "wxslim-local-plugin-result-v1" or result.get("token") != _job.token or result.get("operation") != _job.operation or not result.get("ok") is bool:
			_fail("查询结果身份或格式错误；任务状态未知。")
		else:
			_present(result)
		_finish()
	elif not OS.is_process_running(_job.pid):
		_fail("本地进程已退出但没有完整结果；任务状态未知。控制操作可能已写入，须核共享收据和本地日志。")
		_finish()

func _poll_control_result() -> void:
	if _control_job.is_empty():
		return
	if FileAccess.file_exists(_control_job.result):
		var file := FileAccess.open(_control_job.result, FileAccess.READ)
		if file == null or file.get_length() > 4194304:
			_execution_observation = {}
			_fail("独立收据结果无法读取；取消可用性及任务状态未知。")
		else:
			var result = JSON.parse_string(file.get_as_text())
			if not result is Dictionary or result.get("schema") != "wxslim-local-plugin-result-v1" or result.get("token") != _control_job.token or result.get("operation") != _control_job.operation or not result.get("ok") is bool:
				_execution_observation = {}
				_fail("独立收据身份或格式错误；不允许取消。")
			else:
				_present(result, true)
		_finish_control()
	elif not OS.is_process_running(_control_job.pid):
		_execution_observation = {}
		_fail("独立适配器退出但无完整结果；控制副作用未知，核共享收据。")
		_finish_control()

func _finish_control() -> void:
	_control_job = {}
	_refresh_controls()
	set_process(not _job.is_empty())

func _present(result: Dictionary, secondary: bool = false) -> void:
	if result.operation == "open-project":
		var launch_result = result.get("data", {})
		if result.ok:
			_state.text = "开发者工具已接受打开工程。"
			_details.text = str(launch_result.get("project", ""))
		else:
			_fail(str(launch_result.get("message", result.get("code", "打开失败"))))
		return
	if result.operation == "execute" and result.ok and result.get("outputFile") is String:
		if result.data.action == "project-pck-export":
			_official_paths["pck"].text = result.outputFile
			_reset_official_module_declarations()
		elif result.data.action in ["official-convert", "resource-runtime-assemble"]:
			_open_project_config.text = result.outputFile
	if not result.ok:
		if result.operation in ["resource-boot-check", "resource-source-plan"]:
			_fail("启动接线检查未完成：%s。原工程和包未改；请核对本地错误记录。" % result.get("code", "QUERY_FAILED"))
			_resource_boot_note.text = _state.text
			_details.text = JSON.stringify(result, "\t")
			return
		if result.operation in ["resource-partition-outputs", "prepare-resource-config"]:
			_fail("资源配置读取/校验失败：%s。未执行拆包或组包；草稿和错误记录留在插件 logs。" % result.get("code", "QUERY_FAILED"))
			_resource_config_form.report_failure(_state.text)
			_details.text = JSON.stringify(result, "\t")
			return
		if result.operation in ["resource-inventory", "prepare-resource-request"]:
			_fail("资源读取/计划失败：%s。未执行拆包；本地清单、声明或草稿可能已保留在 logs。" % result.get("code", "QUERY_FAILED"))
			_resource_summary.text = _state.text
			if result.get("draftFiles") is Dictionary:
				_details.text += "\n保留草稿：\n" + JSON.stringify(result.draftFiles, "\t")
			return
		_fail("本地操作失败：%s。不能由适配器失败推断任务未执行；请核对共享收据及本地日志。" % result.get("code", "QUERY_FAILED"))
		if result.operation == "prepare-export-request":
			_fail("导出计划未完成：%s。尚未执行导出；小型草稿和日志可能已保留在插件 logs，原错误不隐藏。" % result.get("code", "QUERY_FAILED"))
		elif result.operation == "prepare-official-request":
			_fail("官方转换计划未完成：%s。尚未运行转换器；小型草稿和日志可能已保留在插件 logs，原错误不隐藏。" % result.get("code", "QUERY_FAILED"))
		elif result.operation == "prepare-raw-build-request":
			_fail("构建计划未完成：%s。尚未下载源码或调用编译器；小型草稿和日志可能已保留在插件 logs。" % result.get("code", "QUERY_FAILED"))
		elif result.operation in ["save-selection", "select-execution"]:
			_fail("选择保存未取得完整成功收据；配置可能已保存，请重新加载插件配置后核对。")
		if result.get("data") is Dictionary:
			_details.text = JSON.stringify(result.data, "\t")
		if result.get("draftFiles") is Dictionary:
			_details.text += "\n保留草稿：\n" + JSON.stringify(result.draftFiles, "\t")
		if secondary:
			_execution_observation = {}
		return
	if not result.get("data") is Dictionary:
		_fail("结果缺少结构化共享数据；任务状态未知。")
		if result.operation in ["resource-boot-check", "resource-source-plan"]:
			_resource_boot_note.text = _state.text
		if result.operation in ["resource-partition-outputs", "prepare-resource-config"]:
			_resource_config_form.report_failure(_state.text)
		return
	var data: Dictionary = result.data
	if result.operation == "resource-source-plan":
		if data.get("schema") != "wxslim-resource-project-source-plan-v1" or data.get("status") not in ["READY_FOR_REVIEW_NOT_EXECUTION", "ALREADY_MATCHED_NOT_RUNTIME_PROOF", "BLOCKED"] or not data.get("changes") is Array or not data.get("blockers") is Array or data.get("projectWritten") != false or data.get("executionAuthorized") != false:
			_fail("接收器接入计划不完整；未写项目。")
			_resource_boot_note.text = _state.text
			return
		var lines := PackedStringArray(["接收器计划：%s；未写项目。需要接入时使用单独的脚本接入计划，执行前另行确认。" % str(data.status)])
		for change in data.changes:
			if not change is Dictionary or not change.get("path") is String or not change.get("action") is String:
				_fail("接收器文件改动列表不完整；未写项目。")
				_resource_boot_note.text = _state.text
				return
			lines.append("%s：%s" % [change.path, change.action])
		if not data.blockers.is_empty():
			lines.append(JSON.stringify(data.blockers))
		_resource_boot_note.text = "\n".join(lines)
		_state.text = lines[0]
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation == "resource-boot-check":
		if data.get("schema") != "wxslim-resource-boot-check-v1" or data.get("status") not in ["PASS_SOURCE_AND_REQUIRED_BOOT_WIRING_ONLY", "BLOCKED"] or not data.get("blockers") is Array or data.get("projectWritten") != false or data.get("runtimeEligible") != false:
			_fail("启动接线结果不完整；不能记为通过。")
			_resource_boot_note.text = _state.text
			return
		_state.text = "源码与导出启动包所需接线已匹配；尚未运行、未验证完整依赖。" if data.status == "PASS_SOURCE_AND_REQUIRED_BOOT_WIRING_ONLY" else "启动接线未通过；请查看具体缺项。原项目与包未改。"
		_resource_boot_note.text = _state.text + "\n" + JSON.stringify(data.blockers)
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation == "resource-inventory":
		_accept_resource_inventory(result)
		return
	if result.operation == "resource-partition-outputs":
		if not _resource_config_form.accept_catalog(result.token, data):
			_fail("拆包清单不完整或身份不匹配，不能填写资源配置。")
			_resource_config_form.report_failure(_state.text)
			return
		_state.text = "成功拆包收据与实际 PCK 已核对；请明确入口与依赖。尚未生成运行时配置。"
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation == "prepare-resource-config":
		if data.get("schema") != "wxslim-local-resource-config-draft-v1" or data.get("selectionSaved") != false or data.get("taskExecuted") != false or not data.get("configFile") is String or not data.configFile.is_absolute_path() or not data.get("plan") is Dictionary or data.plan.get("status") != "PASS_DECLARED_PACK_PLAN_ONLY" or data.plan.get("artifactIntegrityChecked") != true:
			_fail("资源配置缺少实际文件的共同核验；未接入后续表单。")
			_resource_config_form.report_failure(_state.text)
			return
		_resource_runtime_forms.interfaces.paths.resourceConfigFile.text = data.configFile
		_resource_runtime_forms.assembly.paths.resourceConfigFile.text = data.configFile
		_resource_boot_config.text = data.configFile
		_resource_config_form.hide()
		_state.text = "运行时资源配置草稿已校验并填入接口/组包表单。仅声明依赖通过，不证明依赖完整或启动接收器可用；未执行任务。"
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation in ["prepare-resource-interfaces-request", "prepare-resource-assembly-request", "prepare-resource-install-request"]:
		var kind := "install" if result.operation == "prepare-resource-install-request" else ("interfaces" if result.operation == "prepare-resource-interfaces-request" else "assembly")
		var action := "resource-project-install" if kind == "install" else ("resource-interfaces-prepare" if kind == "interfaces" else "resource-runtime-assemble")
		if data.get("schema") != "wxslim-local-resource-runtime-draft-v1" or data.get("kind") != kind or data.get("selectionSaved") != false or data.get("taskExecuted") != false or not data.get("requestFile") is String or not data.get("plan") is Dictionary or data.plan.get("schema") != "wxslim-task-plan-v1" or data.plan.get("action") != action:
			_fail("资源草稿缺少匹配的共同计划；未执行。")
			return
		_request.text = data.requestFile
		_root.text = ""
		_task_id.text = ""
		_invalidate_task_bindings()
		if kind == "interfaces" and data.plan.get("eligible") == true and data.get("nextInputs") is Dictionary:
			var next: Dictionary = data.nextInputs
			var valid: bool = next.get("state") == "SUGGESTED_PATHS_ONLY_EXECUTION_NOT_PERFORMED"
			for key in ["js", "wasm", "pck", "interfaces", "resourceConfigFile"]:
				valid = valid and next.get(key) is String and str(next.get(key)).is_absolute_path()
			if valid:
				_resource_runtime_next = next.duplicate(true)
		_state.text = "资源计划已生成，eligible=%s。未执行、未创建输出目录；保存本地选择并读取计划后，才能准备执行。" % str(data.plan.get("eligible", false))
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation in ["prepare-export-request", "prepare-raw-build-request", "prepare-official-request", "prepare-resource-request"]:
		var export_form: bool = result.operation == "prepare-export-request"
		var raw_build_form: bool = result.operation == "prepare-raw-build-request"
		var resource_form: bool = result.operation == "prepare-resource-request"
		var expected_schema := "wxslim-local-export-draft-v1" if export_form else "wxslim-local-official-draft-v1"
		var expected_action := "project-pck-export" if export_form else "official-convert"
		if resource_form:
			expected_schema = "wxslim-local-resource-draft-v1"
			expected_action = "resource-pck-partition"
		if raw_build_form:
			expected_schema = "wxslim-local-raw-build-draft-v1"
			expected_action = "official-raw-engine-build"
		if data.get("schema") != expected_schema or data.get("selectionSaved") != false or data.get("taskExecuted") != false or not data.get("requestFile") is String or not data.get("plan") is Dictionary or data.plan.get("schema") != "wxslim-task-plan-v1" or data.plan.get("action") != expected_action:
			_fail("草稿缺少匹配的共用计划；未保存选择、未执行。")
			return
		_request.text = data.requestFile
		_root.text = ""
		_task_id.text = ""
		_invalidate_task_bindings()
		_state.text = "草稿已生成，共用门禁 eligible=%s。尚未构建/导出/转换/拆包、未创建输出目录。先点‘保存本地选择’，再读计划；执行仍需另行确认。" % str(data.plan.get("eligible", false))
		if result.operation == "prepare-official-request":
			var prewarm: Dictionary = data.plan.get("plan", {}).get("startupPrewarm", {})
			if prewarm.get("support") == "REQUIRES_ENGINE_REBUILD":
				_state.text += "\n本计划的引擎启动时绑定默认 GLES3 场景着色器。启用跳过预热需要含原生开关的配对。"
			else:
				_state.text += "\n此配对的原生预热开关支持情况待核实。"
		if resource_form:
			_details.text = JSON.stringify({"schema": data.schema, "configFile": data.get("configFile"), "requestFile": data.requestFile, "selectionSaved": false, "taskExecuted": false, "plan": _resource_plan_summary(data.plan), "packs": _resource_pack_ids.size(), "entries": _resource_paths.size()}, "\t")
		else:
			_details.text = JSON.stringify(data, "\t")
		return
	if result.operation == "observe-execution":
		if data.get("schema") != "wxslim-local-execution-observation-v1" or data.get("executionToken") != _last_execution_token:
			_execution_observation = {}
			_fail("执行观察与本次token不匹配；取消禁用。")
			return
		_execution_observation = data.duplicate(true)
		if data.get("status") == "BOUNDED_FILE_OPERATION":
			_state.text = "本次为有界文件准备：%s。没有持久TASK，不读取父目录任务，不支持中途取消。" % str(data.get("outputDirectory", "UNKNOWN"))
			_last_event.text = "此模式没有任务阶段日志；请查看文件准备结果，不能推导正在编译或运行成功。"
			_details.text = JSON.stringify(data, "\t")
			return
		_state.text = "真实输出收据观察：%s。公共status不观测任务进程；PID归属未证明。" % str(data.get("status", "UNKNOWN"))
		if data.get("assessment") is Dictionary:
			_state.text += " 任务收据=%s；取消请求不等于停止。" % str(data.assessment.get("status", "UNKNOWN"))
			_last_event.text = _format_status_progress(data.assessment)
		else:
			_last_event.text = "本次执行尚无已绑定任务收据，最后记录阶段未知；请手动刷新。"
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation == "save-selection":
		_configuration_text = data.configurationText
		_state.text = "本地选择已保存；未执行任务。计划/状态下次点击时使用该选择。"
		_details.text = JSON.stringify(data.selection, "\t")
		return
	if result.operation == "select-execution":
		var selection: Variant = data.get("selection")
		var saved: Variant = JSON.parse_string(str(data.get("configurationText", "")))
		var assessment: Variant = data.get("assessment")
		if data.get("schema") != "wxslim-local-execution-selection-v1" or data.get("executionToken") != _last_execution_token or data.get("expectedConfigurationText") != _configuration_text or data.get("selectionSaved") != true or data.get("taskExecuted") != false or not selection is Dictionary or not saved is Dictionary or not assessment is Dictionary:
			_fail("本次任务选择回复已过期或身份不完整；不采用。配置可能已保存，请重新加载后核对。")
			return
		if selection.get("requestFile") != _request.text or selection.get("requestFile") != _last_execution_request_file or not selection.get("taskRoot") is String or not selection.get("taskId") is String or assessment.get("schema") != "wxslim-task-status-v1" or assessment.get("taskId") != selection.taskId or assessment.get("inputBinding") != "MATCHED_EXECUTION_SNAPSHOT" or saved.get("requestFile") != selection.requestFile or saved.get("taskRoot") != selection.taskRoot or saved.get("taskId") != selection.taskId or FileAccess.get_file_as_string(_config_file()) != data.configurationText:
			_fail("本次任务选择与当前配置或收据不匹配；不采用，重新加载配置后核对。")
			return
		_root.text = selection.taskRoot
		_task_id.text = selection.taskId
		_configuration_text = data.configurationText
		_invalidate_task_bindings()
		_state.text = "本次任务目录和ID已核对并保存；未执行任务。点击‘已有任务状态’查看终态，无需复制编号。"
		_details.text = JSON.stringify(data, "\t")
		return
	if result.operation in ["prepare-execute", "prepare-cancel", "prepare-active-cancel"]:
		var assessment = data.get("assessment")
		var confirmation = data.get("confirmation")
		_details.text = JSON.stringify(data, "\t")
		if not assessment is Dictionary or not confirmation is Dictionary or confirmation.get("schema") != "wxslim-local-task-confirmation-v1" or confirmation.get("action") != ("execute" if result.operation == "prepare-execute" else "cancel") or not confirmation.get("preparationToken") is String or not confirmation.get("bindingSha256") is String:
			_fail("准备结果绑定缺失，不能确认或执行。")
			return
		if result.operation == "prepare-execute" and assessment.get("eligible") != true:
			_state.text = "共享能力/用途门禁拒绝执行；计划没有授权。"
			return
		if result.operation != "prepare-execute" and (assessment.get("inputBinding") != "MATCHED_EXECUTION_SNAPSHOT" or assessment.get("terminalPresent") != false or assessment.get("status") != "NO_TERMINAL_RECEIPT"):
			_state.text = "所选任务已结束、已请求取消或执行快照未绑定；不发取消。"
			return
		_confirmation = confirmation.duplicate(true)
		_confirmation_configuration = _configuration_text
		_confirmation_secondary = result.operation == "prepare-active-cancel"
		_confirmation_bounded = result.operation == "prepare-execute" and assessment.get("action") in ["official-pair-prepare", "custom-pair-prepare"] and assessment.get("executionMode") == "bounded-files"
		_confirm_details.text = JSON.stringify(assessment, "\t")
		if assessment.get("action") == "resource-pck-partition":
			_confirm_details.text = JSON.stringify(_resource_plan_summary(assessment), "\t")
		if _confirmation_secondary:
			if assessment.get("taskId") != _execution_observation.get("taskId"):
				_discard_confirmation()
				_fail("新的取消准备与已观察任务ID不匹配；重新刷新。")
				return
			_confirm_details.text = "已核输出目录：%s\n任务ID：%s\n不证明该任务必属于当前适配器的子进程。\n" % [str(_execution_observation.get("taskRoot", "UNKNOWN")), str(assessment.get("taskId", "UNKNOWN"))] + _confirm_details.text
		elif result.operation == "prepare-cancel":
			if assessment.get("taskId") != _task_id.text:
				_discard_confirmation()
				_fail("取消准备与当前保存的任务ID不匹配；重新读取状态。")
				return
			_confirm_details.text = "保存的精确任务目录：%s\n任务ID：%s\n" % [_root.text, _task_id.text] + _confirm_details.text
		_confirm_dialog.dialog_text = "确认执行上述计划的精确输出目录及空间范围已获批准。计划只是计划；执行 SUCCESS 不代表手机、画面或基础能力通过。确认后仍重新核输入与能力门禁。" if confirmation.action == "execute" else "确认向上述精确 root/taskId 申请安全取消。取消请求不是已停止；等待子进程关闭与终态，不强杀、不自动重试。"
		if _confirmation_bounded:
			_confirm_dialog.dialog_text = "确认只在上述既有父目录排他写入计划中的JS和准备收据两个新文件。无持久任务控制器、无中途取消；失败可能留部分文件，不自动覆盖/重试。准备成功仍NOT_ADMITTED，不代表引擎、手机或画面通过。"
		_state.text = "准备完成，等待用户明确确认；尚未启动控制操作。"
		_confirm_dialog.popup_centered(Vector2i(720, 520))
		return
	_state.text = "只读查询完成；未启动构建、转换、上传或取消。"
	if result.operation == "capabilities":
		_capabilities.clear()
		for capability in data.capabilities:
			var index := _capabilities.add_item("%s — %s" % [capability.name, capability.statusLabel])
			_capabilities.set_item_tooltip(index, capability.limit)
			if capability.status in ["missing", "unsupported", "pending"]:
				_capabilities.set_item_disabled(index, true)
	if result.operation == "status":
		_status_receipt = data.duplicate(true)
		_status_configuration = _configuration_text
		_last_event.text = _format_status_progress(data)
		var status: String = data.get("status", "UNKNOWN")
		_state.text = "任务收据状态：" + status + "；进程存活未观测。"
		if status == "NO_TERMINAL_RECEIPT":
			_state.text = "未知：没有终态收据；不能推断正在运行。"
		elif status == "CANCEL_REQUESTED":
			_state.text = "已有取消请求；不能推断已停止或正在运行。"
		if not data.get("warnings", []).is_empty():
			_state.text += " 有告警，请查看下方完整结果。"
	if result.operation == "plan":
		_plan = data.duplicate(true)
		_plan_configuration = _configuration_text
		_state.text = "计划仅供检查，尚未授权执行。共享门禁 eligible=%s；用途=%s；原因=%s。" % [str(data.get("eligible", false)), str(data.get("purpose", "UNKNOWN")), str(data.get("reason", "UNKNOWN"))]
	if result.operation == "execute":
		_state.text = "执行收据：%s。SUCCESS 仅表示本任务的执行/静态检查，不等于手机或画面通过。" % str(data.get("status", "UNKNOWN"))
		if data.get("action") in ["official-pair-prepare", "custom-pair-prepare"] and data.get("executionMode") == "bounded-files" and data.get("taskId") == null:
			_state.text = "两个文件准备结果：%s / %s。没有taskId或中途取消；NOT_ADMITTED，不是编译或手机验收。" % [str(data.get("status", "UNKNOWN")), str(data.get("artifactState", "UNKNOWN"))]
		elif data.has("taskId"):
			_state.text += " 实际 taskId=%s；后续状态需显式绑定对应任务目录。" % str(data.taskId)
	if result.operation == "cancel":
		_last_event.text = _format_status_progress(data)
		_state.text = "取消操作收据：%s。请求已受理不代表已停止；以共享终态为准。" % str(data.get("status", "UNKNOWN"))
		if data.get("cancel") is Dictionary:
			if data.cancel.get("alreadyEnded") == true:
				_state.text = "任务已有终态 %s；取消请求未新增。" % str(data.get("status", "UNKNOWN"))
			elif data.cancel.get("accepted") == true:
				_state.text = "取消请求已保存；任务收据 %s，不代表已停止。等待共享终态。" % str(data.get("status", "UNKNOWN"))
	_details.text = JSON.stringify(_resource_plan_summary(data) if result.operation == "plan" and data.get("action") == "resource-pck-partition" else data, "\t")

func _progress_token(value: Variant) -> String:
	if not value is String or value.is_empty() or value.length() > 64:
		return "UNKNOWN"
	for character in value:
		var code: int = str(character).unicode_at(0)
		if not ((code >= 65 and code <= 90) or (code >= 48 and code <= 57) or character == "_"):
			return "UNKNOWN"
	return value

func _format_status_progress(receipt: Dictionary) -> String:
	var progress = receipt.get("progress")
	if not progress is Dictionary or progress.get("source") != "events.jsonl" or progress.get("scope") != "LAST_RECORDED_EVENT_NOT_LIVENESS_OR_TERMINAL" or progress.get("readStatus") not in ["COMPLETE", "PARTIAL", "UNAVAILABLE"]:
		return "最后记录阶段：UNKNOWN（没有可用的共同 progress 合同）。请手动刷新；不据此判断任务存活或终态。"
	var read_status: String = progress.readStatus
	var text := "最后记录阶段："
	var event = progress.get("lastEvent")
	if event is Dictionary:
		text += "未记录" if event.get("stage") == null else _progress_token(event.get("stage"))
		var at = event.get("at")
		var valid_time: bool = at is String and at.length() >= 20 and at.length() <= 40
		if valid_time:
			for character in at:
				if character not in "0123456789TZ:.-+":
					valid_time = false
					break
		text += "；事件时间：%s" % (at if valid_time else "UNKNOWN")
		text += "；事件 status 字段：%s" % ("未记录" if event.get("status") == null else _progress_token(event.get("status")))
		var wall_ms = event.get("wallMs")
		if (wall_ms is int or wall_ms is float) and is_finite(float(wall_ms)) and float(wall_ms) >= 0.0:
			text += "；该事件 wallMs：%.3f ms" % float(wall_ms)
	else:
		text += "UNKNOWN（没有可展示的最后事件）"
	text += "。读取=%s" % read_status
	if read_status != "COMPLETE" or progress.get("reason") != null:
		text += "；读取不完整/不可用原因：%s" % _progress_token(progress.get("reason"))
	text += "。仅为最后写入的事件，不表示任务正在执行、已结束或完成百分比；请手动刷新。"
	return text

func _fail(message: String) -> void:
	_state.text = message
	_details.text = message

func _finish() -> void:
	var bounded: bool = _job.get("bounded", false)
	_job = {}
	_progress.text = "主适配器已返回或无完整结果；任务终态以共享收据为准，最后事件需手动刷新。"
	if bounded:
		_progress.text = "文件准备适配器已返回或无完整结果；本动作没有TASK/终态控制器。失败需核实两输出和部分写入记录。"
	_refresh_controls()
	set_process(not _control_job.is_empty())
