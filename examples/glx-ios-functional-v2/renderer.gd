extends Node

signal operation(name: String, details: Dictionary)
signal recreate_requested
const Visual = preload("res://visual_canvas.gd")
var stage: Control
var host_stage: Control
var actions: VBoxContainer
var step_id := ""
var action_map: Dictionary = {}
var action_nodes: Dictionary = {}
var owned: Array[Node] = []
var panels: Array[NinePatchRect] = []
var worlds: Array[SubViewport] = []
var cubes: Array[MeshInstance3D] = []
var views: Array[TextureRect] = []
var side_running := [true, true]
var direct_world: Node3D
var direct_camera: Camera3D
var direct_model: Node3D
var lamp: DirectionalLight3D
var front_sheet: MeshInstance3D
var back_sheet: MeshInstance3D
var stripe: Control
var sample_text: Label
var timer_label: Label
var direct_rect := Rect2()
var alternate := false
var left_text := false
var right_large := false
var cleared := false
var recreate_count := 0
var run_seconds := 0.0
var observing := false
var observation_ended := false
var elapsed := 0.0
var event_count := 0
var state: Dictionary = {}
var last_build_success := false

func build(id: String, target: Control, action_container: VBoxContainer) -> void:
	clear()
	last_build_success = false
	step_id = id
	host_stage = target
	stage = Control.new()
	stage.name = "RendererDesignCanvas"
	stage.size = Vector2(620, 340)
	stage.mouse_filter = Control.MOUSE_FILTER_PASS
	_own(stage, host_stage)
	actions = action_container
	alternate = false
	left_text = false
	right_large = false
	cleared = false
	recreate_count = 0
	run_seconds = 0
	observing = false
	observation_ended = false
	side_running = [true, true]
	state = {"step_id": id, "visual_verdict": "manual_only", "render_path": "canvas"}
	match id:
		"B01-image":
			_view(_number_texture(), Rect2(10, 20, 230, 200))
			_reference("reference", "独立示意：1左上 2右上\n3左下 4右下；箭头向上")
		"B01-text":
			sample_text = _label(stage, "中文测试，123！", Rect2(12, 80, 610, 120), 34)
			_button("big_text", "大字", func():
				sample_text.add_theme_font_size_override("font_size", 52)
				state["font_size"] = 52
				_emit("text_enlarged", {"font_size": 52}))
		"B01-alpha":
			var canvas := _canvas("alpha", Rect2(10, 12, 600, 250))
			canvas.dragged.connect(func(p: Vector2):
				state["red_circle_position"] = [p.x, p.y]
				_emit("red_circle_dragged", {"position": [p.x, p.y]}))
			_register("drag_red_circle", func(): canvas._move(canvas.size / 2))
		"B02-clip": _build_clip()
		"B03-horizontal", "B03-vertical":
			_build_nine(false)
			_slider("width" if id.ends_with("horizontal") else "height", "宽度" if id.ends_with("horizontal") else "高度", 0, 1, .35, _resize_stretch)
		"B04-width", "B04-height":
			_build_nine(true)
			if id.ends_with("width"):
				_slider("tile_width", "宽度 A=左端 / B=右端", 0, 1, .2, _resize_tile)
			else:
				_button("taller", "变高 / 恢复高度", func():
					alternate = not alternate
					for p in panels: p.size.y = 138 if alternate else 95
					_emit("tile_height_changed", {"height": panels[0].size.y}))
		"B05-center", "B05-texture":
			_canvas("checker", Rect2(10, 10, 600, 260))
			var panel := _nine(Rect2(42, 35, 400, 210), 0, true)
			if id.ends_with("center"):
				_button("toggle_center", "隐藏中心 / 显示中心", func():
					panel.draw_center = not panel.draw_center
					_emit("nine_center_changed", {"draw_center": panel.draw_center}))
			else:
				_button("swap_texture", "换一套边框", func():
					alternate = not alternate
					panel.texture = _nine_texture(alternate, true)
					_emit("nine_texture_changed", {"corners": "ABCD" if alternate else "1234"}))
				_slider("panel_size", "面板大小", 0, 1, .35, func(v: float):
					panel.size.x = 260 + 280 * v
					_emit("nine_resized", {"width": panel.size.x}))
		"B06-texture", "B06-light", "B07-front", "B07-back": _build_direct()
		"B08-left", "B08-right", "B08-resize", "S01-run", "S02-resume", "S03-recreate": _build_views_and_actions()
	update_layout(host_stage.get_global_rect())
	last_build_success = true
	_emit("renderer_built", {"step_id": step_id, "render_path": state["render_path"]})

func clear() -> void:
	for node in owned:
		if is_instance_valid(node):
			if node.get_parent(): node.get_parent().remove_child(node)
			node.queue_free()
	owned.clear()
	stage = null
	host_stage = null
	panels.clear()
	worlds.clear()
	cubes.clear()
	views.clear()
	action_map.clear()
	action_nodes.clear()
	direct_world = null
	direct_camera = null
	direct_model = null
	lamp = null
	front_sheet = null
	back_sheet = null
	stripe = null
	timer_label = null
	observing = false

func get_state() -> Dictionary:
	var result := state.duplicate(true)
	result.merge({"step_id": step_id, "action_ids": action_map.keys(), "action_nodes": action_nodes.duplicate(), "event_count": event_count, "side_running": side_running.duplicate(), "recreate_count": recreate_count, "content_cleared": cleared, "observation_seconds": run_seconds, "observation_ended": observation_ended, "viewport_sizes": worlds.map(func(v): return [v.size.x, v.size.y]), "viewport_count": worlds.size(), "direct_root_3d": is_instance_valid(direct_world), "last_build_success": last_build_success, "cube_rotations": cubes.map(func(c): return [c.rotation.x, c.rotation.y, c.rotation.z])}, true)
	return result

func exercise_action(action_id: String) -> void:
	if action_map.has(action_id): action_map[action_id].call()
	else: _emit("unknown_action", {"action_id": action_id})

func _emit(event: String, details: Dictionary = {}) -> void:
	event_count += 1
	state["last_action"] = event
	state["last_details"] = details.duplicate(true)
	operation.emit(event, details)

func _own(node: Node, parent: Node) -> void:
	parent.add_child(node)
	owned.append(node)

func _label(parent: Node, text: String, rect: Rect2, font_size: int = 23) -> Label:
	var label := Label.new()
	label.text = text
	label.position = rect.position
	label.size = rect.size
	label.add_theme_font_size_override("font_size", font_size)
	if not parent is Control:
		_set_host_font(label)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_own(label, parent)
	return label

func _set_host_font(label: Label) -> void:
	# Theme lookup does not cross a SubViewport / non-Control boundary. Use the
	# same bundled host font there, rather than relying on native OS fallback.
	if is_instance_valid(host_stage):
		label.add_theme_font_override("font", host_stage.get_theme_default_font())

func _register(id: String, callback: Callable) -> void:
	action_map[id] = callback

func _button(id: String, text: String, callback: Callable) -> void:
	var button := Button.new()
	button.name = id
	button.text = text
	button.add_theme_font_size_override("font_size", 24)
	button.custom_minimum_size.y = 54
	button.pressed.connect(callback)
	_own(button, actions)
	_register(id, callback)
	action_nodes[id] = str(button.get_path())

func _slider(id: String, title: String, low: float, high: float, value: float, callback: Callable) -> void:
	var label := Label.new()
	label.text = title
	label.add_theme_font_size_override("font_size", 24)
	_own(label, actions)
	var slider := HSlider.new()
	slider.name = id
	slider.min_value = low
	slider.max_value = high
	slider.step = .01
	slider.value = value
	slider.custom_minimum_size.y = 48
	slider.value_changed.connect(callback)
	_own(slider, actions)
	_register(id, func(): slider.value = high if slider.value < (low + high) / 2 else low)
	action_nodes[id] = str(slider.get_path())

func _canvas(kind: String, rect: Rect2) -> Visual:
	var canvas := Visual.new()
	canvas.kind = kind
	canvas.position = rect.position
	canvas.size = rect.size
	_own(canvas, stage)
	return canvas

func _view(texture: Texture2D, rect: Rect2) -> TextureRect:
	var view := TextureRect.new()
	view.texture = texture
	view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	view.stretch_mode = TextureRect.STRETCH_SCALE
	view.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	view.position = rect.position
	view.size = rect.size
	view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_own(view, stage)
	return view

func _reference(kind: String, text: String) -> void:
	var direct := step_id.begins_with("B06") or step_id.begins_with("B07")
	var rect := Rect2(500, 12, 110, 76) if direct else Rect2(350, 12, 180, 120)
	_canvas(kind, rect)
	_label(stage, text, Rect2(470, 98, 148, 210) if direct else Rect2(320, 140, 270, 120), 20)
	if kind == "reference":
		for i in range(4):
			_label(stage, str(i + 1), Rect2(rect.position + Vector2(5 + (i % 2) * (rect.size.x - 32), 2 + (i / 2) * (rect.size.y - 30)), Vector2(32, 30)), 21 if direct else 24)

func _build_clip() -> void:
	var clip := Control.new()
	clip.position = Vector2(45, 30)
	clip.size = Vector2(420, 200)
	clip.clip_contents = true
	_own(clip, stage)
	stripe = Visual.new()
	stripe.kind = "stripes"
	stripe.size = Vector2(290, 180)
	stripe.position = Vector2(-100, 10)
	clip.add_child(stripe)
	_canvas("clip_border", Rect2(45, 30, 420, 200))
	_canvas("dot", Rect2(510, 95, 40, 40))
	_slider("clip_offset", "拖条纹到白框左右两端", -260, 380, -100, func(v: float):
		stripe.position.x = v
		_emit("clip_slider_dragged", {"stripe_x": v}))

func _nine(rect: Rect2, mode: int, transparent: bool = false) -> NinePatchRect:
	var panel := NinePatchRect.new()
	panel.texture = _nine_texture(false, transparent)
	panel.patch_margin_left = 24
	panel.patch_margin_right = 24
	panel.patch_margin_top = 24
	panel.patch_margin_bottom = 24
	panel.axis_stretch_horizontal = mode
	panel.axis_stretch_vertical = mode
	panel.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	panel.position = rect.position
	panel.size = rect.size
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_own(panel, stage)
	panels.append(panel)
	return panel

func _build_nine(tiled: bool) -> void:
	if tiled:
		_label(stage, "上：TILE（可半砖）   下：TILE_FIT（完整砖）", Rect2(8, 0, 600, 30), 20)
		_nine(Rect2(20, 34, 440, 95), NinePatchRect.AXIS_STRETCH_MODE_TILE)
		_nine(Rect2(20, 167, 440, 95), NinePatchRect.AXIS_STRETCH_MODE_TILE_FIT)
	else:
		_label(stage, "固定小样                 可变面板：彩角24×24", Rect2(8, 0, 600, 35), 21)
		_nine(Rect2(12, 60, 120, 120), NinePatchRect.AXIS_STRETCH_MODE_STRETCH)
		_nine(Rect2(160, 45, 350, 200), NinePatchRect.AXIS_STRETCH_MODE_STRETCH)
		# The white 24px outline is an independent fixed corner-size guide.
		_canvas("clip_border", Rect2(160, 45, 24, 24))

func _resize_stretch(value: float) -> void:
	if step_id.ends_with("horizontal"): panels[1].size.x = 140 + 280 * value
	else: panels[1].size.y = 80 + 180 * value
	_emit("nine_resized", {"size": [panels[1].size.x, panels[1].size.y]})

func _resize_tile(value: float) -> void:
	for panel in panels: panel.size.x = 240 + 300 * value
	_emit("tile_width_changed", {"width": panels[0].size.x})

func _glyph(image: Image, symbol: String, origin: Vector2i, scale: int, color: Color) -> void:
	var glyphs := {"1": ["010", "110", "010", "010", "111"], "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"], "4": ["101", "101", "111", "001", "001"], "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"], "C": ["111", "100", "100", "100", "111"], "D": ["110", "101", "101", "101", "110"]}
	var rows: Array = glyphs[symbol]
	for y in range(5):
		for x in range(3):
			if rows[y][x] == "1": image.fill_rect(Rect2i(origin + Vector2i(x, y) * scale, Vector2i.ONE * scale), color)

func _number_texture() -> ImageTexture:
	var image := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	image.fill(Color("275b77"))
	for i in range(4):
		_glyph(image, str(i + 1), Vector2i(7 + (i % 2) * 94, 5 + (i / 2) * 100), 3, Color.WHITE)
	image.fill_rect(Rect2i(60, 38, 9, 60), Color.WHITE)
	for y in range(25): image.fill_rect(Rect2i(64 - y, 25 + y, y * 2 + 1, 1), Color.WHITE)
	return ImageTexture.create_from_image(image)

func _nine_texture(letters: bool = false, transparent: bool = false) -> ImageTexture:
	var image := Image.create(96, 96, false, Image.FORMAT_RGBA8)
	for y in range(96):
		for x in range(96):
			var corner := (x < 24 or x >= 72) and (y < 24 or y >= 72)
			var color := Color("abd1d0") if (x / 8 + y / 8) % 2 == 0 else Color("44757d")
			if corner:
				var index := (1 if x >= 72 else 0) + (2 if y >= 72 else 0)
				color = [Color("d03d45"), Color("218653"), Color("356bc5"), Color("bc8c22")][index]
			elif x < 24 or x >= 72 or y < 24 or y >= 72:
				color = Color("f0c070") if (x % 16 > 1 and y % 16 > 1) else Color("563f2b")
			if transparent and (x < 4 or y < 4 or x >= 92 or y >= 92): color = Color.TRANSPARENT
			image.set_pixel(x, y, color)
	for i in range(4):
		_glyph(image, ["A", "B", "C", "D"][i] if letters else str(i + 1), Vector2i(7 + (i % 2) * 72, 5 + (i / 2) * 72), 3, Color.WHITE)
	return ImageTexture.create_from_image(image)

func _material(color: Color, texture: Texture2D = null) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.albedo_texture = texture
	if texture != null:
		# BoxMesh UVs use a 3x2 face atlas (Godot 4.7 BoxMesh reference).
		# Repeat the complete numbered image on each face without reading mesh/GPU data.
		material.uv1_scale = Vector3(3, 2, 1)
		material.texture_repeat = true
	material.roughness = .8
	if color.a < 1:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material

func _cube(parent: Node) -> MeshInstance3D:
	var cube := MeshInstance3D.new()
	cube.mesh = BoxMesh.new()
	cube.material_override = _material(Color.WHITE, _number_texture())
	parent.add_child(cube)
	return cube

func _environment(parent: Node, color: Color) -> void:
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = color
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color.WHITE
	environment.environment.ambient_light_energy = .32
	parent.add_child(environment)

func _light(parent: Node) -> DirectionalLight3D:
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-25, -42, 0)
	light.light_energy = 1.2
	parent.add_child(light)
	return light

func _build_direct() -> void:
	state["render_path"] = "root_viewport_direct_3d"
	direct_world = Node3D.new()
	_own(direct_world, self)
	_environment(direct_world, Color("11243a"))
	direct_camera = Camera3D.new()
	direct_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	direct_camera.size = 10
	direct_camera.position = Vector3(0, 0, 10)
	direct_world.add_child(direct_camera)
	direct_camera.current = true
	direct_model = Node3D.new()
	direct_world.add_child(direct_model)
	var cube := _cube(direct_model)
	cubes.append(cube)
	lamp = _light(direct_world)
	if step_id.begins_with("B06"):
		cube.rotation_degrees = Vector3(-18, 25, 0)
		_reference("reference", "正面四角：1 2 / 3 4\n↑朝上；指定面：正面")
		if step_id.ends_with("texture"):
			_button("stop_front", "停在正面", func():
				side_running[0] = false
				cube.rotation = Vector3.ZERO
				_emit("cube_stopped_front", {"rotation": [0, 0, 0]}))
		else:
			side_running[0] = false
			lamp.rotation_degrees = Vector3(-25, -45, 0)
			_button("light_right", "灯移到右边", func():
				lamp.rotation_degrees = Vector3(-25, 75, 0)
				_emit("light_moved", {"side": "right", "yaw_degrees": 75, "target_face": "front_arrow"}))
			_button("light_left", "灯回左边", func():
				lamp.rotation_degrees = Vector3(-25, -45, 0)
				_emit("light_moved", {"side": "left", "yaw_degrees": -45, "target_face": "front_arrow"}))
	else:
		side_running[0] = false
		cube.material_override = _material(Color.WHITE, _nine_texture())
		front_sheet = _sheet(Color(1, .04, .04, .48), Vector3(-.3, 0, 1), Vector2(1.5, 1.3))
		back_sheet = _sheet(Color(.05, .2, 1, 1), Vector3(.15, 0, -1), Vector2(2.1, 1.3))
		front_sheet.visible = false
		back_sheet.visible = false
		_reference("depth_ref", "独立简图：红片在前\n方块挡住后方蓝片中央")
		if step_id.ends_with("front"):
			back_sheet.visible = true
			_button("add_front", "加上前面的红片", func():
				front_sheet.visible = true
				_emit("front_red_shown", {"alpha": .48, "depth": 1}))
		else:
			_button("show_back", "显示后面的蓝片", func():
				back_sheet.visible = true
				_emit("back_blue_shown", {"depth": -1}))
			_button("move_cube", "暂时移开方块 / 放回", func():
				cube.position.x = 1.65 if cube.position.x == 0 else 0
				_emit("occluder_moved", {"x": cube.position.x}))

func _sheet(color: Color, position: Vector3, dimensions: Vector2) -> MeshInstance3D:
	var sheet := MeshInstance3D.new()
	var mesh := QuadMesh.new()
	mesh.size = dimensions
	sheet.mesh = mesh
	sheet.position = position
	sheet.material_override = _material(color)
	direct_model.add_child(sheet)
	return sheet

func update_layout(stage_rect: Rect2) -> void:
	direct_rect = stage_rect
	if is_instance_valid(stage):
		var factor := minf(stage_rect.size.x / 620.0, stage_rect.size.y / 340.0)
		stage.scale = Vector2.ONE * factor
		stage.position = (stage_rect.size - stage.size * factor) / 2
	if is_instance_valid(direct_camera):
		# Use the fitted design canvas, not unused vertical stage space. Reserve its
		# right column for the independent Canvas reference and its explanation.
		var canvas_rect := stage.get_global_rect()
		var factor := stage.scale.x
		var content_rect := Rect2(canvas_rect.position + Vector2(12, 18) * factor, Vector2(420, 280) * factor)
		var focus := content_rect.get_center()
		var world_center := direct_camera.project_position(focus, 10)
		var world_right := direct_camera.project_position(focus + Vector2(content_rect.size.x, 0), 10)
		var world_bottom := direct_camera.project_position(focus + Vector2(0, content_rect.size.y), 10)
		var depth_test := step_id.begins_with("B07")
		var scale_value := minf(world_center.distance_to(world_right) / (3.8 if depth_test else 1.9), world_center.distance_to(world_bottom) / (1.8 if depth_test else 1.9)) * .88
		direct_model.scale = Vector3.ONE * scale_value
		direct_model.position = world_center - Vector3(.5 * scale_value if depth_test else 0, 0, 0)
		state["direct_stage_rect"] = [stage_rect.position.x, stage_rect.position.y, stage_rect.size.x, stage_rect.size.y]
		state["direct_content_rect"] = [content_rect.position.x, content_rect.position.y, content_rect.size.x, content_rect.size.y]
	if views.size() == 2:
		var width := 248.0
		var height := 202.0
		for i in range(2):
			views[i].position = Vector2(8 + i * 312, 32)
			views[i].size = Vector2(width, height)
		if right_large:
			views[1].size = Vector2(296, 240)
			views[1].position.x = 312

func _new_view(index: int) -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(320, 260)
	viewport.own_world_3d = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_own(viewport, self)
	worlds.append(viewport)
	_environment(viewport, Color("153f79") if index == 0 else Color("652d74"))
	var camera := Camera3D.new()
	camera.position = Vector3(0, .3, 3.4)
	camera.fov = 40
	viewport.add_child(camera)
	camera.look_at(Vector3.ZERO)
	camera.current = true
	var cube := _cube(viewport)
	cube.rotation_degrees = Vector3(-18, 25, 0)
	cubes.append(cube)
	_light(viewport)
	views.append(_view(viewport.get_texture(), Rect2(8 + index * 290, 32, 280, 230)))
	_label(stage, "L 左蓝底" if index == 0 else "R 右紫底", Rect2(10 + index * 290, 0, 240, 32), 23)

func _build_pair() -> void:
	_new_view(0)
	_new_view(1)
	update_layout(host_stage.get_global_rect())
	var drag := _canvas("drag", Rect2(312, 32, 296, 240))
	drag.dragged.connect(func(p: Vector2):
		if cubes.size() == 2:
			cubes[1].rotation.y = p.x * .025
			cubes[1].rotation.x = p.y * .015
			_emit("right_cube_dragged", {"position": [p.x, p.y]}))
	_register("drag_right_cube", func():
		if cubes.size() == 2:
			cubes[1].rotate_y(.5)
			_emit("right_cube_dragged", {"source": "harness"}))

func _build_views_and_actions() -> void:
	state["render_path"] = "independent_subviewports"
	_build_pair()
	match step_id:
		"B08-left": _button("left_toggle", "只换左边", _toggle_left)
		"B08-right": _button("right_rotate", "只转右边", func():
			side_running = [false, true]
			_emit("right_rotation_started", {"left_paused": true}))
		"B08-resize": _button("right_resize", "放大右窗 / 恢复大小", func():
			side_running = [false, true]
			right_large = not right_large
			worlds[1].size = Vector2i(480, 390) if right_large else Vector2i(320, 260)
			update_layout(host_stage.get_global_rect())
			_emit("right_viewport_resized", {"size": [worlds[1].size.x, worlds[1].size.y], "left_paused": true}))
		"S01-run":
			timer_label = _label(stage, "点开始观察：120秒，结束后仍需人工判定", Rect2(8, 274, 600, 45), 20)
			_button("start_observation", "开始观察（两分钟）", func():
				run_seconds = 0
				observing = true
				observation_ended = false
				side_running = [true, true]
				_emit("observation_started", {"duration_seconds": 120}))
		"S02-resume":
			_label(stage, "请在手机上回桌面约10秒再回来；勿强退、清缓存", Rect2(8, 274, 600, 60), 20)
			_button("resume_swap", "回来后换图", func():
				alternate = not alternate
				cubes[1].material_override = _material(Color.WHITE, _nine_texture(alternate))
				_emit("resume_texture_changed", {"alternate": alternate, "host_hide_show_required": true}))
		"S03-recreate":
			_button("clear_content", "清空内容", _destroy_content)
			_button("recreate_content", "重新创建（最多三组）", _request_recreate)

func _toggle_left() -> void:
	side_running[1] = false
	left_text = not left_text
	if left_text:
		# A real 2D Canvas is drawn inside the left SubViewport, over its independent world.
		var label := Label.new()
		label.name = "LeftText"
		label.text = "L\n中文测试 123"
		label.add_theme_font_size_override("font_size", 36)
		_set_host_font(label)
		label.position = Vector2(22, 40)
		label.size = Vector2(290, 140)
		worlds[0].add_child(label)
		cubes[0].visible = false
	else:
		var label := worlds[0].get_node_or_null("LeftText")
		if label:
			worlds[0].remove_child(label)
			label.queue_free()
		cubes[0].visible = true
	side_running[0] = not left_text
	_emit("left_content_changed", {"content": "text" if left_text else "cube", "right_paused": true})

func _destroy_content() -> void:
	if cleared or recreate_count >= 3:
		_emit("content_clear_refused", {"cleared": cleared, "completed_groups": recreate_count})
		return
	var released := worlds.size()
	for node in owned.duplicate():
		if node is SubViewport or (node is Control and node.get_parent() == stage):
			owned.erase(node)
			if node.get_parent(): node.get_parent().remove_child(node)
			node.queue_free()
	worlds.clear()
	cubes.clear()
	views.clear()
	cleared = true
	state["clear_ticks_ms"] = Time.get_ticks_msec()
	_label(stage, "内容已清空\n约2秒后按重新创建", Rect2(20, 60, 550, 130), 30)
	_emit("content_destroyed", {"group": recreate_count + 1, "subviewports_removed": released, "gpu_reclamation_claimed": false})

func _request_recreate() -> void:
	if not cleared or recreate_count >= 3:
		_emit("content_recreate_refused", {"cleared": cleared, "completed_groups": recreate_count})
		return
	_emit("recreate_requested", {"group": recreate_count + 1})
	recreate_requested.emit()

func perform_recreate() -> void:
	last_build_success = false
	if not cleared or recreate_count >= 3:
		_emit("content_recreate_refused", {"cleared": cleared, "completed_groups": recreate_count})
		return
	for node in owned.duplicate():
		if node is Control and node.get_parent() == stage:
			owned.erase(node)
			stage.remove_child(node)
			node.queue_free()
	recreate_count += 1
	cleared = false
	side_running = [true, true]
	_build_pair()
	last_build_success = true
	_emit("content_recreated", {"group": recreate_count, "clear_interval_ms": Time.get_ticks_msec() - state.get("clear_ticks_ms", 0), "viewport_count": worlds.size()})

func _process(delta: float) -> void:
	elapsed += delta
	for i in range(cubes.size()):
		if is_instance_valid(cubes[i]) and side_running[mini(i, 1)]: cubes[i].rotate_y(delta * (.5 if i == 0 else -.7))
	if observing:
		run_seconds += delta
		if is_instance_valid(timer_label): timer_label.text = "观察 %.0f / 120 秒；完成后拖动右侧方块" % minf(run_seconds, 120)
		if run_seconds >= 120:
			observing = false
			observation_ended = true
			_emit("observation_interval_ended", {"elapsed_seconds": run_seconds, "visual_verdict": "manual_only"})
