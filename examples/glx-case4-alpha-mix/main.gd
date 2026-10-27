extends Control

const HostBridge = preload("res://bridge.gd")
const SafeLayout = preload("res://safe_area_layout.gd")
const SafeQuery = preload("res://safe_area_query.gd")
const Store = preload("res://result_store.gd")
const STEP_NAMES := {"B01-image": "短回归：普通2D", "B06-texture": "短回归：直接3D", "B07-front": "原13：红片材质对照", "D15-alpha": "原15：最终显示混合对照", "N01-skin": "新增：两骨骼蒙皮", "N02-multimesh": "新增：批量实例", "N03-shader": "新增：不透明自定义shader", "N04-texture": "新增：纹理动态更新"}
var catalog: Dictionary = {}
var steps: Array = []
var store = Store.new()
var renderer: Node
var selected_index := -1
var transition_id := 0
var operation_sequence := 0
var transition_phase := "initializing"
var records: Array = []
var transitions: Dictionary = {}
var host: Dictionary = {}
var safe_layout: Dictionary = {}
var margins: MarginContainer
var stage: Control
var actions: VBoxContainer
var heading: Label
var instruction: Label
var expected: Label
var abnormal: Label
var status: Label
var identity: Label
var directory: OptionButton
var result_buttons: Dictionary = {}
var detail_scroll: ScrollContainer
var detail_toggle: CheckButton

func _ready() -> void:
	catalog = JSON.parse_string(FileAccess.get_file_as_string("res://cases.json"))
	for card in catalog.cards:
		for item in card.steps:
			var step: Dictionary = item.duplicate(true)
			step["cardId"] = card.id
			step["title"] = card.title
			step["reference"] = card.reference
			steps.append(step)
	store.initialize(catalog, steps)
	host = HostBridge.initialize()
	theme = Theme.new()
	if ResourceLoader.exists("res://fonts/AcceptanceCJK.otf"):
		theme.default_font = load("res://fonts/AcceptanceCJK.otf")
	else:
		var fallback := SystemFont.new()
		fallback.font_names = PackedStringArray(["Microsoft YaHei", "Noto Sans CJK SC", "sans-serif"])
		theme.default_font = fallback
		_log("font_missing_editor_fallback", {"font": "AcceptanceCJK.otf", "packageCoverageProven": false, "purpose": "temporary desktop editing only"})
	theme.default_font_size = 24
	theme.set_color("font_color", "Label", Color("edf5ff"))
	_build_ui()
	var renderer_script: Script = load("res://renderer.gd")
	if renderer_script == null:
		status.text = "绘图脚本缺失；不能进入观察"
		_log("renderer_load_failed", {})
		return
	renderer = renderer_script.new()
	add_child(renderer)
	renderer.operation.connect(_on_renderer_operation)
	if renderer.has_signal("recreate_requested"):
		renderer.recreate_requested.connect(_on_recreate_requested)
	get_viewport().size_changed.connect(_layout)
	stage.resized.connect(_stage_resized)
	_layout()
	_log("scene_ready", {"stepCount": steps.size(), "resultSource": "all_untested", "identityPolicy": "observed_only"})
	select_step(0)

func _label(parent: Node, text_value: String, font_size: int = 24) -> Label:
	var label := Label.new()
	label.text = text_value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _button(parent: Node, text_value: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text_value
	button.custom_minimum_size.y = 48
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.add_theme_font_size_override("font_size", 24)
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	margins = MarginContainer.new()
	# CanvasLayer is not a Control, so explicitly restore theme inheritance here.
	margins.theme = theme
	margins.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margins.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(margins)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margins.add_child(column)
	heading = _label(column, "GLX新一轮独立验收", 28)
	identity = _label(column, _identity_summary(), 18)
	status = _label(column, "准备中；尚未收到绘图回调", 22)
	instruction = _label(column, "", 26)
	expected = _label(column, "", 23)
	var details := HBoxContainer.new()
	column.add_child(details)
	detail_toggle = CheckButton.new()
	detail_toggle.text = "异常 / 示意 / 详情"
	detail_toggle.add_theme_font_size_override("font_size", 20)
	details.add_child(detail_toggle)
	detail_scroll = ScrollContainer.new()
	detail_scroll.theme = theme
	detail_scroll.visible = false
	# Overlay the demonstration only when explicitly expanded. The instruction,
	# result choices and bottom navigation retain their positions at small sizes.
	detail_scroll.z_index = 20
	var detail_style := StyleBoxFlat.new()
	detail_style.bg_color = Color("112236")
	detail_style.content_margin_left = 12
	detail_style.content_margin_right = 12
	detail_style.content_margin_top = 10
	detail_style.content_margin_bottom = 10
	detail_scroll.add_theme_stylebox_override("panel", detail_style)
	layer.add_child(detail_scroll)
	abnormal = _label(detail_scroll, "", 20)
	detail_toggle.toggled.connect(func(value: bool):
		detail_scroll.visible = value
		_stage_resized())
	stage = Control.new()
	stage.custom_minimum_size = Vector2(0, 225)
	stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stage.mouse_filter = Control.MOUSE_FILTER_PASS
	column.add_child(stage)
	actions = VBoxContainer.new()
	actions.add_theme_constant_override("separation", 4)
	column.add_child(actions)
	for field in ["visual", "interaction", "smoothness"]:
		var row := HBoxContainer.new()
		column.add_child(row)
		var captions := {"visual": "画面", "interaction": "响应", "smoothness": "停顿"}
		var label := _label(row, captions[field], 23)
		label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		label.custom_minimum_size.x = 65
		var option := OptionButton.new()
		option.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		option.custom_minimum_size.y = 48
		option.add_theme_font_size_override("font_size", 23)
		for value in store.choices[field]:
			option.add_item(store.display_value(value))
		option.item_selected.connect(_result_selected.bind(field))
		row.add_child(option)
		result_buttons[field] = option
	_label(column, "三项由人分别判断；动作与回调不会自动通过", 18)
	var nav := HBoxContainer.new()
	column.add_child(nav)
	_button(nav, "上一项", func(): select_step(maxi(0, selected_index - 1)))
	directory = OptionButton.new()
	directory.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	directory.custom_minimum_size.y = 48
	directory.add_theme_font_size_override("font_size", 20)
	for index in steps.size():
		directory.add_item("%02d %s" % [index + 1, STEP_NAMES.get(steps[index].id, steps[index].title)])
	directory.item_selected.connect(select_step)
	directory.get_popup().about_to_popup.connect(_constrain_directory_popup)
	directory.get_popup().visibility_changed.connect(func():
		if directory.get_popup().visible:
			_constrain_directory_popup())
	nav.add_child(directory)
	_button(nav, "下一项", func(): select_step(mini(steps.size() - 1, selected_index + 1)))

func _identity_summary() -> String:
	var actual := str(host.get("actualMode", "unavailable"))
	var device: Dictionary = host.get("device", {})
	var package: Dictionary = host.get("identity", {})
	var short_id := str(package.get("packageId", "unknown"))
	if short_id.length() > 16:
		short_id = short_id.right(12)
	var evidence := "SDK:%s · 包:%s" % [device.get("SDKVersion", "unknown"), short_id]
	if not OS.has_feature("web"):
		return "本机电脑原生 %s · %s\n不代表手机GLX验收" % [RenderingServer.get_current_rendering_method(), evidence]
	if actual.to_lower().contains("webgl"):
		return "实际:%s · %s\nWebGL电脑对照与手机GLX分别记录" % [actual, evidence]
	return "实际:%s · %s\n身份不明时不能标记GLX通过" % [actual, evidence]

func _layout() -> void:
	# Native desktop preview uses logical geometry; web below replaces it with
	# actual CSS window geometry. Do not apply a physical-pixel/DPR multiplier.
	var geometry := {"source": "native-logical-preview", "windowWidth": get_viewport_rect().size.x, "windowHeight": get_viewport_rect().size.y}
	if OS.has_feature("web"):
		var raw: Variant = JavaScriptBridge.eval(SafeQuery.CODE, true)
		if raw is String and raw.strip_edges().begins_with("{"):
			var parsed: Variant = JSON.parse_string(raw)
			if parsed is Dictionary:
				geometry.merge(parsed, true)
	safe_layout = SafeLayout.compute(get_viewport_rect().size, geometry)
	for side in ["left", "right", "top", "bottom"]:
		margins.add_theme_constant_override("margin_" + side, safe_layout[side])
	_stage_resized()
	if is_instance_valid(directory) and directory.get_popup().visible:
		_constrain_directory_popup()

func _constrain_directory_popup() -> void:
	if safe_layout.is_empty():
		return
	var popup := directory.get_popup()
	var logical_size := get_viewport_rect().size
	var available := Vector2i(maxi(1, int(logical_size.x) - int(safe_layout.left) - int(safe_layout.right)), maxi(1, int(logical_size.y) - int(safe_layout.top) - int(safe_layout.bottom)))
	# PopupMenu's internal scrolling follows its public Window size constraint.
	# Position within the safe region instead of below the bottom navigation.
	popup.min_size = Vector2i.ZERO
	popup.max_size = available
	var natural := popup.get_contents_minimum_size()
	popup.size = Vector2i(mini(available.x, maxi(int(directory.size.x), natural.x)), mini(available.y, natural.y))
	popup.position = Vector2i(int(safe_layout.left) + (available.x - popup.size.x) / 2, int(safe_layout.top))

func _stage_resized() -> void:
	if is_instance_valid(stage) and is_instance_valid(detail_scroll):
		detail_scroll.position = stage.get_global_rect().position
		detail_scroll.size = stage.size
	if is_instance_valid(renderer) and is_instance_valid(stage):
		renderer.update_layout(stage.get_global_rect())

# Deliberately awaits real frame_post_draw twice. Headless/no-draw stays preparing.
# A superseded transition may finish its await, but cannot build or report ready.
func select_step(index: int) -> void:
	if index < 0 or index >= steps.size() or not is_instance_valid(renderer):
		_log("step_selection_rejected", {"requestedIndex": index})
		return
	transition_id += 1
	var token := transition_id
	selected_index = index
	var step: Dictionary = steps[index]
	var timing := {"transitionId": token, "stepId": step.id, "beginTicksUsec": Time.get_ticks_usec()}
	transitions[token] = timing
	transition_phase = "preparation"
	_log("step_switch_begin", timing.duplicate(true))
	heading.text = "%02d / %02d  %s" % [index + 1, steps.size(), STEP_NAMES.get(step.id, step.title)]
	instruction.text = "动作：" + step.action
	expected.text = "预期：" + step.expected
	abnormal.text = "异常：%s\n示意：%s\n身份原始记录：%s" % [step.abnormal, step.reference, JSON.stringify(host)]
	status.text = "正在准备本项内容，可能停顿数秒；请稍候"
	detail_toggle.button_pressed = false
	# Hide old scene and actions during preparation without destroying them before draw.
	stage.visible = false
	actions.visible = false
	directory.select(index)
	_refresh_results()
	for option in result_buttons.values():
		option.disabled = true
	timing["preparationVisibleRequestedTicksUsec"] = Time.get_ticks_usec()
	_log("preparation_visible_requested", timing.duplicate(true))
	await RenderingServer.frame_post_draw
	timing["preparationFrameCallbackTicksUsec"] = Time.get_ticks_usec()
	timing["preparationCallbackWaitUsec"] = timing.preparationFrameCallbackTicksUsec - timing.preparationVisibleRequestedTicksUsec
	if token != transition_id:
		_log("transition_superseded", timing.duplicate(true))
		return
	_log("preparation_frame_callback", timing.duplicate(true))
	transition_phase = "building"
	timing["constructionBeginTicksUsec"] = Time.get_ticks_usec()
	renderer.clear()
	for child in actions.get_children():
		actions.remove_child(child)
		child.queue_free()
	stage.visible = true
	actions.visible = true
	renderer.build(step.id, stage, actions)
	if renderer.get("last_build_success") != true:
		transition_phase = "build_failed"
		status.text = "内容创建未完成；请保留日志，不能开始验收"
		_log("build_failed", timing.duplicate(true))
		return
	renderer.update_layout(stage.get_global_rect())
	timing["resourcesCreatedTicksUsec"] = Time.get_ticks_usec()
	timing["constructionDurationUsec"] = timing.resourcesCreatedTicksUsec - timing.constructionBeginTicksUsec
	transition_phase = "waiting_first_frame_callback"
	status.text = "内容已创建；等待绘图回调…"
	_log("resources_created", timing.duplicate(true))
	await RenderingServer.frame_post_draw
	timing["firstFrameCallbackTicksUsec"] = Time.get_ticks_usec()
	timing["firstCallbackWaitUsec"] = timing.firstFrameCallbackTicksUsec - timing.resourcesCreatedTicksUsec
	timing["overallDurationUsec"] = timing.firstFrameCallbackTicksUsec - timing.beginTicksUsec
	if token != transition_id:
		_log("transition_superseded", timing.duplicate(true))
		return
	_log("first_frame_callback", timing.duplicate(true))
	transition_phase = "ready"
	for option in result_buttons.values():
		option.disabled = false
	status.text = "内容已准备，请按说明观察；结果由你判断"
	_append_timing_details(timing)
	_log("ready_for_observation", {"transitionId": token, "stepId": step.id, "screenPresentationProven": false, "automaticPass": false})

func _on_recreate_requested() -> void:
	if transition_phase != "ready" or selected_index < 0 or steps[selected_index].id != "S03-recreate":
		_log("recreate_rejected", {"reason": "transition_active_or_wrong_step"})
		return
	transition_id += 1
	var token := transition_id
	var timing := {"transitionId": token, "stepId": "S03-recreate", "reason": "resource_recreate", "beginTicksUsec": Time.get_ticks_usec()}
	transitions[token] = timing
	transition_phase = "preparation"
	_log("step_switch_begin", timing.duplicate(true))
	status.text = "正在准备重建内容，可能停顿数秒；请稍候"
	actions.visible = false
	for option in result_buttons.values():
		option.disabled = true
	timing["preparationVisibleRequestedTicksUsec"] = Time.get_ticks_usec()
	_log("preparation_visible_requested", timing.duplicate(true))
	await RenderingServer.frame_post_draw
	timing["preparationFrameCallbackTicksUsec"] = Time.get_ticks_usec()
	timing["preparationCallbackWaitUsec"] = timing.preparationFrameCallbackTicksUsec - timing.preparationVisibleRequestedTicksUsec
	if token != transition_id:
		_log("transition_superseded", timing.duplicate(true))
		return
	_log("preparation_frame_callback", timing.duplicate(true))
	transition_phase = "building"
	timing["constructionBeginTicksUsec"] = Time.get_ticks_usec()
	renderer.perform_recreate()
	if renderer.get("last_build_success") != true:
		transition_phase = "build_failed"
		status.text = "重建未完成；请保留日志，不能开始验收"
		_log("build_failed", timing.duplicate(true))
		return
	timing["resourcesCreatedTicksUsec"] = Time.get_ticks_usec()
	timing["constructionDurationUsec"] = timing.resourcesCreatedTicksUsec - timing.constructionBeginTicksUsec
	transition_phase = "waiting_first_frame_callback"
	status.text = "重建内容已创建；等待绘图回调…"
	_log("resources_created", timing.duplicate(true))
	await RenderingServer.frame_post_draw
	timing["firstFrameCallbackTicksUsec"] = Time.get_ticks_usec()
	timing["firstCallbackWaitUsec"] = timing.firstFrameCallbackTicksUsec - timing.resourcesCreatedTicksUsec
	timing["overallDurationUsec"] = timing.firstFrameCallbackTicksUsec - timing.beginTicksUsec
	if token != transition_id:
		_log("transition_superseded", timing.duplicate(true))
		return
	_log("first_frame_callback", timing.duplicate(true))
	transition_phase = "ready"
	actions.visible = true
	for option in result_buttons.values():
		option.disabled = false
	status.text = "内容已准备，请按说明观察；结果由你判断"
	_append_timing_details(timing)
	_log("ready_for_observation", {"transitionId": token, "stepId": "S03-recreate", "screenPresentationProven": false, "automaticPass": false})

func _append_timing_details(timing: Dictionary) -> void:
	abnormal.text += "\n开发者计时：构造%.3f / 首回调等待%.3f / 整体%.3f毫秒。\n这是回调计时，不证明屏幕已呈现，也不是GPU耗时。\n原始计时：%s" % [timing.constructionDurationUsec / 1000.0, timing.firstCallbackWaitUsec / 1000.0, timing.overallDurationUsec / 1000.0, JSON.stringify(timing)]

func _result_selected(index: int, field: String) -> void:
	set_result(field, store.choices[field][index], "manual")

func _refresh_results() -> void:
	if selected_index < 0:
		return
	for field in result_buttons:
		result_buttons[field].select(store.choices[field].find(store.results[steps[selected_index].id][field]))

func set_result(field: String, value: String, source: String = "manual") -> bool:
	if selected_index < 0:
		return false
	# UI uses catalog values; harness may request the normalized display spelling.
	if value == "未测试" and store.defaults.has(field):
		value = store.defaults[field]
	var accepted: bool = store.record(steps[selected_index].id, field, value)
	_log("human_result" if source == "manual" else "harness_result", {"field": field, "value": value, "source": source, "isHumanJudgment": source == "manual", "accepted": accepted, "glxAcceptanceClaim": false})
	if accepted:
		_refresh_results()
	return accepted

func _on_renderer_operation(name: String, details: Dictionary) -> void:
	_log("scene_operation", {"name": name, "details": details.duplicate(true), "automaticPass": false})

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_APPLICATION_RESUMED:
		_log("application_lifecycle", {"notification": what, "evidence": "Godot notification; not proof of real host hide/show"})

func _log(event: String, details: Dictionary) -> void:
	operation_sequence += 1
	var record := {"event": event, "operationSequence": operation_sequence, "transitionId": transition_id, "stepIndex": selected_index, "stepId": steps[selected_index].id if selected_index >= 0 else "none", "ticksUsec": Time.get_ticks_usec(), "unixTimeSeconds": Time.get_unix_time_from_system(), "details": details}
	records.append(record.duplicate(true))
	HostBridge.emit_record(record)

func get_test_state() -> Dictionary:
	return {"selectedIndex": selected_index, "currentStep": steps[selected_index].duplicate(true) if selected_index >= 0 else {}, "stepId": steps[selected_index].id if selected_index >= 0 else "none", "phase": transition_phase, "transitionActive": transition_phase != "ready", "transitionId": transition_id, "currentTimings": transitions.get(transition_id, {}).duplicate(true), "operationSequence": operation_sequence, "steps": steps.duplicate(true), "results": store.results.duplicate(true), "transitions": transitions.duplicate(true), "records": records.duplicate(true), "host": host.duplicate(true), "safeLayout": safe_layout.duplicate(true), "screenPresentationProven": false, "automaticPass": false}
