extends "res://godot-upstream-storage-observation.gd"
## UI-only subclass; all FileAccess operations and comparisons remain inherited.
var _flow: JavaScriptObject
var _status: Label
var _cloud: Label
var _previous_available := false

func _ready() -> void:
	var theme_cn := Theme.new()
	theme_cn.default_font = load("res://StorageCJK.otf")
	theme_cn.default_font_size = 24
	theme = theme_cn
	var margin := MarginContainer.new()
	add_child(margin)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left", "right", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	margin.add_theme_constant_override("margin_top", 104)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	margin.add_child(box)
	var title := Label.new()
	title.text = "存档验证"
	title.add_theme_font_size_override("font_size", 36)
	box.add_child(title)
	_status = Label.new()
	_status.text = "正在核对环境，请稍候。"
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_status)
	_button = Button.new()
	_button.text = "第一步：开始写入验证"
	_button.custom_minimum_size.y = 88
	_button.disabled = true
	_button.pressed.connect(_run_once)
	box.add_child(_button)
	_previous_input = LineEdit.new()
	_previous_input.visible = false
	box.add_child(_previous_input)
	_previous_button = Button.new()
	_previous_button.text = "第二步：读取上次存档"
	_previous_button.custom_minimum_size.y = 88
	_previous_button.disabled = true
	_previous_button.pressed.connect(_read_previous_once)
	box.add_child(_previous_button)
	_output = TextEdit.new()
	_output.editable = false
	_output.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_output)
	_cloud = Label.new()
	_cloud.text = "云日志：等待状态。完整日志保留在本机。"
	_cloud.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_cloud)
	var timer := Timer.new()
	timer.wait_time = 2.0
	timer.timeout.connect(_cloud_tick)
	add_child(timer)
	timer.start()
	call_deferred("_init_flow")

func _init_flow() -> void:
	_flow = JavaScriptBridge.get_interface("StorageValidationFlow")
	if _flow == null:
		_status.text = "初始化失败：验证接口不可用，请保留日志。"
		return
	var state: Variant = JSON.parse_string(str(_flow.start()))
	if typeof(state) != TYPE_DICTIONARY or not state.has("currentRef"):
		_status.text = "初始化失败：身份未就绪，请保留日志。"
		return
	_previous_available = state.get("ok", false)
	_previous_input.text = str(state.get("previousRef", ""))
	_previous_button.disabled = not _previous_available
	_button.disabled = _previous_available or state.get("code") != "NO_COMPLETED_WRITE"
	if _previous_available:
		_status.text = "已找到本包上次成功记录。\n请点第二步，只读取，不重新写入。"
	elif state.get("code") == "NO_COMPLETED_WRITE":
		_status.text = "先点第一步；成功后从右上角重新进入，再点第二步。无需复制编号。"
	else:
		_status.text = "记录未就绪，请保留现场与日志。\n" + str(state.get("code"))
	_output.text = "实际后端：" + str(state.get("actualMode", "未知")) + "\n基础库：" + str(state.get("sdkVersion", "未知")) + "\n\n本页只验证存档与接口，不自动判定画面通过。"

func _run_once() -> void:
	if _used or _flow == null or _previous_available:
		return
	var result: Variant = JSON.parse_string(str(_flow.nativeCheck()))
	if typeof(result) != TYPE_DICTIONARY or result.get("ok") != true:
		_used = true
		_button.disabled = true
		_previous_button.disabled = true
		_status.text = "随机接口检查失败，已停止，请保留日志。"
		return
	super._run_once()

func _record(step: String, ok: bool, details: Variant) -> bool:
	var previous_text := _output.text
	super._record(step, ok, details)
	_output.text = previous_text
	var names := {"environment":"运行环境", "empty":"空文件", "bytes":"字节写入与截短", "grow":"分段写入", "truncate":"截断为空文件", "missing_parent":"不存在的父目录", "previous_target":"上次记录关联", "complete":"本轮检查完成", "unique_files":"文件独立性"}
	_output.text += "\n" + str(names.get(step, "文件检查")) + ("：符合预期" if ok else "：失败，停止")
	var row := {"ref":_reference,"currentRef":_reference,"previousRef":_previous_reference,"mode":_mode,"seq":_sequence,"step":step,"expectedSatisfied":ok,"details":details,"writePerformed":false if _mode == "READ_PREVIOUS" else null}
	var receipt: Variant = JSON.parse_string(str(_flow.observe(JSON.stringify(row))))
	if not ok or typeof(receipt) != TYPE_DICTIONARY or receipt.get("ok") != true:
		_status.text = "检查未通过，已停止。请保留页面；无需重复操作。"
		_output.text += "\n" + str(receipt)
		return false
	if step == "complete":
		if _mode == "WRITE_CURRENT":
			_status.text = "第一步通过，记录已保存。\n请从右上角重新进入，再点第二步。"
		else:
			_status.text = "第二步通过：已读回上次四个文件。\n请告知你采用的重新进入方式。"
	return true

func _cloud_tick() -> void:
	if _flow == null:
		return
	var state: Variant = JSON.parse_string(str(_flow.cloudStatus()))
	if typeof(state) != TYPE_DICTIONARY or not state.get("available", false):
		_cloud.text = "云日志不可用，请保留本地完整日志。"
	elif state.get("stopped", false):
		_cloud.text = "云日志已到时停止；以实际收到的记录为准。"
	elif state.get("failures", 0) > 0:
		_cloud.text = "云日志发送失败，正在等待；本地日志仍保留。"
	elif state.get("queued", 1) == 0 and not state.get("busy", true):
		_cloud.text = "云日志已获接收确认；仍需核对云端记录。"
	else:
		_cloud.text = "云日志正在发送，请稍候。"
