extends Node

signal operation(name: String, details: Dictionary)
const Visual = preload("res://visual_canvas.gd")
var stage: Control
var host_stage: Control
var actions: VBoxContainer
var step_id := ""
var action_map: Dictionary = {}
var action_nodes: Dictionary = {}
var owned: Array[Node] = []
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
var direct_rect := Rect2()
var right_large := false
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
	right_large = false
	side_running = [true, true]
	state = {"step_id": id, "visual_verdict": "manual_only", "render_path": "canvas"}
	match id:
		"B07-front": _build_direct()
		"D15-alpha": pass
		_: return
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

func get_state() -> Dictionary:
	var result := state.duplicate(true)
	result.merge({"step_id": step_id, "action_ids": action_map.keys(), "action_nodes": action_nodes.duplicate(), "event_count": event_count, "side_running": side_running.duplicate(), "viewport_sizes": worlds.map(func(v): return [v.size.x, v.size.y]), "viewport_count": worlds.size(), "direct_root_3d": is_instance_valid(direct_world), "last_build_success": last_build_success, "cube_rotations": cubes.map(func(c): return [c.rotation.x, c.rotation.y, c.rotation.z])}, true)
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

func _button(id: String, _text: String, callback: Callable) -> void:
	# No user controls in cloud demonstration. Preserve action semantics only.
	_register(id, callback)

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
	var direct := step_id == "B07-front"
	var rect := Rect2(500, 12, 110, 76) if direct else Rect2(350, 12, 180, 120)
	_canvas(kind, rect)
	_label(stage, text, Rect2(470, 98, 148, 210) if direct else Rect2(320, 140, 270, 120), 20)
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
	side_running[0] = false
	cube.material_override = _material(Color.WHITE, _nine_texture())
	front_sheet = _sheet(Color(1, .04, .04, .48), Vector3(-.3, 0, 1), Vector2(1.5, 1.3))
	back_sheet = _sheet(Color(.05, .2, 1, 1), Vector3(.15, 0, -1), Vector2(2.1, 1.3))
	front_sheet.visible = false
	back_sheet.visible = false
	_reference("depth_ref", "独立简图：红片在前\n方块挡住后方蓝片中央")
	back_sheet.visible = true
	_button("add_front", "加上前面的红片", func():
		front_sheet.visible = true
		_emit("front_red_shown", {"alpha": .48, "depth": 1}))

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

func _process(delta: float) -> void:
	for i in range(cubes.size()):
		if is_instance_valid(cubes[i]) and side_running[mini(i, 1)]: cubes[i].rotate_y(delta * (.5 if i == 0 else -.7))
