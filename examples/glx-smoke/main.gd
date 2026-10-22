extends Control

const Pattern2D = preload("res://pattern_2d.gd")

var offscreen_2d: SubViewport
var offscreen_3d: SubViewport
var cube: MeshInstance3D
var texture_view: TextureRect
var status_label: Label
var lifecycle_label: Label
var diagnostic_text: TextEdit
var show_3d := false
var small_buffer := false
var draw_callback_seen := false
var resize_count := 0
var lifecycle_events: Array[String] = []


func _ready() -> void:
	_build_viewports()
	_build_ui()
	get_viewport().size_changed.connect(_on_root_resize)
	RenderingServer.frame_post_draw.connect(_on_frame_post_draw)
	_on_root_resize()


func _process(delta: float) -> void:
	if show_3d:
		cube.rotate_y(delta * 0.8)
		cube.rotate_x(delta * 0.35)


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
	if is_instance_valid(lifecycle_label):
		lifecycle_label.text = "Godot notifications: " + ", ".join(lifecycle_events)


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


func _build_ui() -> void:
	var margins := MarginContainer.new()
	add_child(margins)
	margins.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "top", "right", "bottom"]:
		margins.add_theme_constant_override("margin_" + side, 20)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	margins.add_child(column)
	_add_label(column, "WXSLIM rendering smoke", 30)
	_add_label(column, "Direct 2D: six bars + moving white circle", 20)
	var direct_pattern := Pattern2D.new()
	direct_pattern.custom_minimum_size = Vector2(0, 120)
	column.add_child(direct_pattern)
	_add_label(column, "Offscreen texture: 2D pattern / rotating 3D box", 20)
	texture_view = TextureRect.new()
	texture_view.custom_minimum_size = Vector2(0, 240)
	texture_view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	texture_view.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	texture_view.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	texture_view.texture = offscreen_2d.get_texture()
	column.add_child(texture_view)
	var buttons := HBoxContainer.new()
	column.add_child(buttons)
	_add_button(buttons, "Switch 2D / 3D", _toggle_3d)
	_add_button(buttons, "Resize buffer", _resize_buffer)
	status_label = _add_label(column, "Waiting for Godot draw callback", 18)
	lifecycle_label = _add_label(column, "Godot notifications: none", 16)
	_add_button(column, "Read rendering diagnostic (manual)", _read_diagnostic)
	diagnostic_text = TextEdit.new()
	diagnostic_text.editable = false
	diagnostic_text.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	diagnostic_text.custom_minimum_size = Vector2(0, 260)
	diagnostic_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	diagnostic_text.add_theme_font_size_override("font_size", 16)
	diagnostic_text.text = "No diagnostic requested. This button reads memory only.\nA draw callback does not prove visible pixels or GLX compatibility."
	column.add_child(diagnostic_text)


func _add_label(parent: Node, text: String, font_size: int) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	parent.add_child(label)
	return label


func _add_button(parent: Node, text: String, callback: Callable) -> void:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 60
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.add_theme_font_size_override("font_size", 21)
	button.pressed.connect(callback)
	parent.add_child(button)


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


func _on_root_resize() -> void:
	resize_count += 1
	_refresh_status()


func _refresh_status() -> void:
	if not is_instance_valid(status_label):
		return
	status_label.text = "Draw callback: %s | offscreen: %s %s\nRoot: %s | size events: %d" % [
		"seen" if draw_callback_seen else "waiting",
		"3D" if show_3d else "2D", str(offscreen_2d.size),
		str(get_viewport().get_visible_rect().size), resize_count]


func _on_frame_post_draw() -> void:
	if draw_callback_seen:
		return
	draw_callback_seen = true
	print("[GLX_SMOKE] Godot frame_post_draw reached; this proves only the draw callback, not visible pixels, GLX, or phone compatibility.")
	_refresh_status()


func _read_diagnostic() -> void:
	var result := "Diagnostic unavailable: this native/headless run has no WeChat startup bridge."
	if OS.has_feature("web"):
		var bridge := JavaScriptBridge.get_interface("WxSlimGlxSmoke")
		if bridge == null:
			result = "Diagnostic unavailable: WxSlimGlxSmoke interface is missing from this package."
		else:
			result = str(bridge.readDiagnosticJson())
	diagnostic_text.text = result
	print("[GLX_SMOKE_MANUAL_DIAGNOSTIC] " + result)
