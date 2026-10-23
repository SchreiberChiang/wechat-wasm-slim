extends Control

const Pattern2D = preload("res://pattern_2d.gd")
const AcceptanceFont = preload("res://fonts/AcceptanceCJK.otf")
const SafeAreaLayout = preload("res://safe_area_layout.gd")
const SafeAreaQuery = preload("res://safe_area_query.gd")

var offscreen_2d: SubViewport
var offscreen_3d: SubViewport
var cube: MeshInstance3D
var texture_view: TextureRect
var status_label: Label
var lifecycle_label: Label
var diagnostic_text: TextEdit
var identity_label: Label
var context_label: Label
var offscreen_title: Label
var audio_label: Label
var audio_player: AudioStreamPlayer
var audio_requests := 0
var show_3d := false
var small_buffer := false
var draw_callback_seen := false
var resize_count := 0
var lifecycle_events: Array[String] = []
var main_scroll: ScrollContainer
var more_panel: PanelContainer
var more_button: Button
var diagnostic_overlay: MarginContainer
var safe_margins: Array[MarginContainer] = []
var last_layout: Dictionary = {}


func _ready() -> void:
	theme = Theme.new()
	theme.default_font = AcceptanceFont
	theme.default_font_size = 34
	theme.set_color("font_color", "Label", Color("edf3ff"))
	_build_viewports()
	_build_ui()
	get_viewport().size_changed.connect(_on_root_resize)
	RenderingServer.frame_post_draw.connect(_on_frame_post_draw)
	_on_root_resize()
	_refresh_identity()
	if not OS.has_feature("web"):
		if "--acceptance-more" in OS.get_cmdline_user_args():
			_toggle_more_tests()
		if "--acceptance-diagnostics" in OS.get_cmdline_user_args():
			_read_diagnostic()


func _notification(what: int) -> void:
	var event := ""
	match what:
		NOTIFICATION_APPLICATION_PAUSED:
			event = "application paused"
		NOTIFICATION_APPLICATION_RESUMED:
			event = "application resumed"
		NOTIFICATION_APPLICATION_FOCUS_IN:
			event = "focus in"
		NOTIFICATION_APPLICATION_FOCUS_OUT:
			event = "focus out"
	if event.is_empty():
		return
	lifecycle_events.append(event)
	if lifecycle_events.size() > 4:
		lifecycle_events.pop_front()
	_refresh_status()


func _panel_style(color: String) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(color)
	style.set_corner_radius_all(18)
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 14
	style.content_margin_bottom = 14
	return style


func _card(parent: Node) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style("14253b"))
	parent.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	panel.add_child(column)
	return column


func _add_label(parent: Node, text: String, font_size: int = 34) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.add_theme_font_size_override("font_size", font_size)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label


func _add_button(parent: Node, text: String, callback: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 88 if primary else 82)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.add_theme_font_size_override("font_size", 36)
	button.add_theme_stylebox_override("normal", _panel_style("176c71" if primary else "243b58"))
	button.add_theme_stylebox_override("hover", _panel_style("23858b" if primary else "345372"))
	button.add_theme_stylebox_override("pressed", _panel_style("105056" if primary else "192f49"))
	button.pressed.connect(callback)
	parent.add_child(button)
	return button


func _build_ui() -> void:
	var backdrop := ColorRect.new()
	backdrop.color = Color("091323")
	backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(backdrop)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var margins := MarginContainer.new()
	add_child(margins)
	margins.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	safe_margins.append(margins)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	margins.add_child(column)
	main_scroll = ScrollContainer.new()
	main_scroll.name = "ContentScroll"
	main_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	main_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(main_scroll)
	var content := VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 12)
	main_scroll.add_child(content)
	var heading := VBoxContainer.new()
	heading.add_theme_constant_override("separation", 4)
	content.add_child(heading)
	_add_label(heading, "渲染画面验收", 50)
	identity_label = _add_label(heading, "会话：本地预览", 36)
	context_label = _add_label(heading, "实际上下文：待确认", 32)
	var direct_card := _card(content)
	_add_label(direct_card, "直接绘制 2D", 34)
	var direct_pattern := Pattern2D.new()
	direct_pattern.name = "DirectPattern"
	direct_pattern.custom_minimum_size = Vector2(0, 120)
	direct_pattern.mouse_filter = Control.MOUSE_FILTER_IGNORE
	direct_card.add_child(direct_pattern)
	var offscreen_card := _card(content)
	offscreen_title = _add_label(offscreen_card, "离屏纹理 2D", 34)
	texture_view = TextureRect.new()
	texture_view.name = "OffscreenTexture"
	texture_view.custom_minimum_size = Vector2(0, 180)
	texture_view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	texture_view.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	texture_view.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	texture_view.texture = offscreen_2d.get_texture()
	texture_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	offscreen_card.add_child(texture_view)
	more_panel = PanelContainer.new()
	more_panel.name = "MoreTests"
	more_panel.add_theme_stylebox_override("panel", _panel_style("14253b"))
	content.add_child(more_panel)
	var more := VBoxContainer.new()
	more.add_theme_constant_override("separation", 12)
	more_panel.add_child(more)
	_add_label(more, "更多测试", 38)
	_add_button(more, "切换离屏 2D / 3D", _toggle_3d)
	_add_button(more, "调整离屏尺寸", _resize_buffer)
	_add_button(more, "播放轻声测试音", _play_test_tone)
	audio_label = _add_label(more, "声音待人工确认；点击后请试听。", 32)
	status_label = _add_label(more, "等待绘制回调", 32)
	lifecycle_label = _add_label(more, "应用通知：暂无", 32)
	_add_label(more, "回调和上下文信息不代表画面通过。", 32)
	more_panel.hide()
	# Fixed footer is outside the ScrollContainer, above the vConsole/gesture gap.
	var actions := VBoxContainer.new()
	actions.name = "FixedActions"
	actions.add_theme_constant_override("separation", 10)
	column.add_child(actions)
	var diagnostic_button := _add_button(actions, "读取诊断", _read_diagnostic, true)
	diagnostic_button.name = "ReadDiagnostic"
	more_button = _add_button(actions, "更多测试", _toggle_more_tests)
	more_button.name = "ToggleMore"
	audio_player = AudioStreamPlayer.new()
	add_child(audio_player)
	_build_diagnostic_panel()


func _build_diagnostic_panel() -> void:
	diagnostic_overlay = MarginContainer.new()
	diagnostic_overlay.name = "DiagnosticOverlay"
	diagnostic_overlay.z_index = 20
	add_child(diagnostic_overlay)
	diagnostic_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	safe_margins.append(diagnostic_overlay)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style("132439"))
	diagnostic_overlay.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	panel.add_child(column)
	_add_label(column, "诊断详情", 42)
	_add_label(column, "仅显示当前读取结果，不代表画面通过。", 32)
	diagnostic_text = TextEdit.new()
	diagnostic_text.editable = false
	diagnostic_text.context_menu_enabled = false
	diagnostic_text.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	diagnostic_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	diagnostic_text.add_theme_font_size_override("font_size", 32)
	diagnostic_text.add_theme_color_override("font_readonly_color", Color("edf3ff"))
	column.add_child(diagnostic_text)
	_add_button(column, "返回画面", func() -> void: diagnostic_overlay.hide())
	diagnostic_overlay.hide()


func _toggle_more_tests() -> void:
	more_panel.visible = not more_panel.visible
	more_button.text = "收起更多测试" if more_panel.visible else "更多测试"
	if more_panel.visible:
		main_scroll.ensure_control_visible.call_deferred(more_panel)


func _read_window_geometry() -> Dictionary:
	var window_size := DisplayServer.window_get_size()
	var geometry := {"source": "native-window", "coordinateOrigin": "window", "windowWidth": window_size.x, "windowHeight": window_size.y}
	if OS.has_feature("web"):
		var raw: Variant = JavaScriptBridge.eval(SafeAreaQuery.CODE, true)
		var parsed: Variant = JSON.parse_string(str(raw))
		if parsed is Dictionary:
			geometry.merge(parsed, true)
	else:
		# Explicit native-only fixtures for local layout screenshots; never in web.
		for argument in OS.get_cmdline_user_args():
			if argument == "--acceptance-layout=island":
				geometry = {"source": "native-island-fixture", "coordinateOrigin": "screen", "coordinateOriginEvidence": "explicit-native-fixture", "windowWidth": 390, "windowHeight": 844, "screenWidth": 390, "screenHeight": 844, "screenTop": 0, "deviceOrientation": "portrait",
					"safeArea": {"left": 0, "top": 59, "right": 390, "bottom": 810}, "menu": {"left": 290, "top": 59, "right": 380, "bottom": 91}}
			elif argument == "--acceptance-layout=compact":
				geometry = {"source": "native-compact-fixture", "coordinateOrigin": "screen", "coordinateOriginEvidence": "explicit-native-fixture", "windowWidth": 360, "windowHeight": 640, "screenWidth": 360, "screenHeight": 640, "screenTop": 0, "deviceOrientation": "portrait",
					"safeArea": {"left": 0, "top": 24, "right": 360, "bottom": 620}, "menu": {"left": 270, "top": 50, "right": 350, "bottom": 82}}
	return geometry


func _on_root_resize() -> void:
	resize_count += 1
	last_layout = SafeAreaLayout.compute(get_viewport().get_visible_rect().size, _read_window_geometry())
	for margins in safe_margins:
		for side in ["left", "top", "right", "bottom"]:
			margins.add_theme_constant_override("margin_" + side, int(last_layout[side]))
	_refresh_status()


func _refresh_status() -> void:
	if not is_instance_valid(status_label):
		return
	offscreen_title.text = "离屏纹理 3D" if show_3d else "离屏纹理 2D"
	status_label.text = "绘制回调：%s\n离屏尺寸：%s\n窗口尺寸变化：%d 次" % [
		"已收到，画面待确认" if draw_callback_seen else "等待中",
		str(offscreen_2d.size), resize_count]
	var names := {"application paused": "进入后台", "application resumed": "恢复应用", "focus in": "获得焦点", "focus out": "失去焦点"}
	var translated: Array[String] = []
	for event in lifecycle_events:
		translated.append(str(names.get(event, "待确认")))
	lifecycle_label.text = "应用通知：" + ("、".join(translated) if not translated.is_empty() else "暂无")


func _read_diagnostic() -> void:
	_refresh_identity()
	var result := "诊断暂不可用：当前是本地预览，没有微信启动桥。"
	if OS.has_feature("web"):
		var bridge := JavaScriptBridge.get_interface("AuthorReleaseAcceptance")
		if bridge == null:
			result = "诊断暂不可用：当前包缺少验收接口。"
		else:
			result = str(bridge.readDiagnosticJson())
	diagnostic_text.text = result
	diagnostic_overlay.show()
	print("[AUTHOR_MANUAL_DIAGNOSTIC] " + result)


func _refresh_identity() -> void:
	identity_label.text = "会话：本地预览"
	context_label.text = "实际上下文：待确认"
	if not OS.has_feature("web"):
		return
	identity_label.text = "会话：待确认"
	var bridge := JavaScriptBridge.get_interface("AuthorReleaseAcceptance")
	if bridge == null:
		return
	# Preserve the existing SCENE/identity call; never auto-read manual diagnostics.
	var raw := str(bridge.readIdentityText())
	var session_pattern := RegEx.new()
	session_pattern.compile("#([0-9a-fA-F]{8})(?:[^0-9a-fA-F]|$)")
	var session_match := session_pattern.search(raw)
	if session_match != null:
		identity_label.text = "会话：" + session_match.get_string(1).to_lower()
	if raw.contains("FAILED:"):
		context_label.text = "上下文检查异常，请读取诊断"
		context_label.add_theme_color_override("font_color", Color("ffb29a"))
		return
	context_label.remove_theme_color_override("font_color")
	var marker := "Actual context: "
	var context_at := raw.find(marker)
	if context_at >= 0:
		var actual := raw.substr(context_at + marker.length()).split("\n")[0].strip_edges().to_lower()
		if actual == "glx":
			context_label.text = "实际上下文：GLX，画面待人工确认"
		elif actual == "webgl":
			context_label.text = "实际上下文：WebGL，画面待人工确认"


func _process(delta: float) -> void:
	if show_3d:
		cube.rotate_y(delta * 0.8)
		cube.rotate_x(delta * 0.35)


func _build_viewports() -> void:
	offscreen_2d = SubViewport.new()
	offscreen_2d.name = "Offscreen2D"
	offscreen_2d.size = Vector2i(640, 240)
	offscreen_2d.disable_3d = true
	offscreen_2d.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(offscreen_2d)
	var offscreen_pattern := Pattern2D.new()
	offscreen_2d.add_child(offscreen_pattern)
	offscreen_pattern.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	offscreen_3d = SubViewport.new()
	offscreen_3d.name = "Offscreen3D"
	offscreen_3d.size = Vector2i(640, 240)
	offscreen_3d.own_world_3d = true
	offscreen_3d.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(offscreen_3d)
	var world := Node3D.new()
	offscreen_3d.add_child(world)
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.position = Vector3(0, 0, 4)
	camera.current = true
	cube = MeshInstance3D.new()
	cube.mesh = BoxMesh.new()
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("30d5c8")
	material.roughness = 0.65
	cube.material_override = material
	world.add_child(cube)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-35, -30, 0)
	light.light_energy = 1.4
	world.add_child(light)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color("182438")
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color("99aabb")
	environment.environment.ambient_light_energy = 0.45
	world.add_child(environment)


func _toggle_3d() -> void:
	show_3d = not show_3d
	offscreen_3d.render_target_update_mode = SubViewport.UPDATE_ALWAYS if show_3d else SubViewport.UPDATE_DISABLED
	texture_view.texture = offscreen_3d.get_texture() if show_3d else offscreen_2d.get_texture()
	_refresh_status()


func _resize_buffer() -> void:
	small_buffer = not small_buffer
	var target_size := Vector2i(320, 120) if small_buffer else Vector2i(640, 240)
	offscreen_2d.size = target_size
	offscreen_3d.size = target_size
	_refresh_status()


func _on_frame_post_draw() -> void:
	if draw_callback_seen:
		return
	draw_callback_seen = true
	print("[AUTHOR_SCENE] Godot frame_post_draw reached; this proves only the draw callback, not visible pixels, GLX, or phone compatibility.")
	_refresh_status()


func _play_test_tone() -> void:
	# Generated only on an explicit button press. No imported asset or autoplay.
	var sample_rate := 22050
	var frame_count := int(sample_rate * 0.3)
	var samples := PackedByteArray()
	samples.resize(frame_count * 2)
	for frame in range(frame_count):
		var envelope := minf(1.0, minf(float(frame) / 220.0, float(frame_count - 1 - frame) / 220.0))
		var value := int(sin(TAU * 440.0 * frame / sample_rate) * 32767.0 * 0.08 * envelope)
		samples.encode_s16(frame * 2, value)
	var tone := AudioStreamWAV.new()
	tone.format = AudioStreamWAV.FORMAT_16_BITS
	tone.mix_rate = sample_rate
	tone.stereo = false
	tone.data = samples
	audio_player.stream = tone
	audio_player.play()
	audio_requests += 1
	audio_label.text = "已请求测试音：%d 次；是否听到请人工确认。" % audio_requests
