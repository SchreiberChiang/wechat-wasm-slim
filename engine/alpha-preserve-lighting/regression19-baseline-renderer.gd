extends "res://renderer_base.gd"

const Checker = preload("res://regression-checker.gd")
var spec: Dictionary = {}
var active_lights: Array[Light3D] = []
var samples: Array[MeshInstance3D] = []
var fade_groups: Array[Control] = []
var fade_badges: Array[Control] = []
var notes: Dictionary = {}

func clear() -> void:
	active_lights.clear()
	samples.clear()
	fade_groups.clear()
	fade_badges.clear()
	notes.clear()
	super.clear()

func _process(_delta: float) -> void:
	pass # All poses remain fixed for manual observation and exact references.

func build_state(value: Dictionary, target: Control, action_container: VBoxContainer) -> void:
	spec = value
	super.build("B07-front" if spec.kind in ["red", "gradient", "layers", "scissor"] else "D15-alpha", target, action_container)
	last_build_success = false
	side_running = [false, false]
	if is_instance_valid(lamp): active_lights.append(lamp)
	match spec.kind:
		"red", "layers", "scissor":
			front_sheet.visible = true
			var material := front_sheet.material_override as StandardMaterial3D
			material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED if spec.get("opaque", false) else BaseMaterial3D.TRANSPARENCY_ALPHA
			material.albedo_color.a = 1.0 if spec.get("opaque", false) else .48
			if spec.kind == "layers":
				_sheet(Color(.05, 1, .1, .48), Vector3(.3, 0, .75), Vector2(1.5, 1.3))
			if spec.kind == "scissor": _scissor()
		"gradient": _gradient()
		"offscreen", "shadow", "lights", "background", "fade", "custom":
			_offscreen()
			if spec.kind in ["shadow", "lights"]: _ground()
			if spec.kind == "shadow": active_lights[0].shadow_enabled = bool(spec.shadow)
			if spec.kind == "lights": _lighting(str(spec.light), worlds[0], false)
			if spec.kind == "background":
				worlds[0].transparent_bg = bool(spec.transparent)
				_checker(Rect2(8, 32, 248, 202))
			if spec.kind == "fade": _fade()
			if spec.kind == "custom": _custom()
	update_layout(target.get_global_rect())
	last_build_success = true
	_emit("content_created", {"state":spec.key,"visual":"NOT_INFERRED"})

func _reference(_kind: String, _text: String) -> void:
	# The authoritative screenshot is below the live area; no schematic is passed off as a reference.
	var text := "红片在前\n方块居中\n蓝片在后"
	if spec.kind == "scissor": text = "橙片在前\n方块居中\n蓝片在后"
	if spec.kind == "layers": text = "红片在前\n绿片在中\n方块与蓝片在后"
	_label(stage, text, Rect2(460, 65, 155, 210), 24)

func _offscreen() -> void:
	_new_view(0)
	var viewport := worlds[0]
	for child in viewport.get_children():
		if child is Light3D: active_lights.append(child)
	var right := _view(views[0].texture, Rect2(320, 32, 248, 202))
	var mat := ShaderMaterial.new()
	mat.shader = load("res://display_ignore_alpha.gdshader")
	right.material = mat
	views.append(right)
	_clear_stage_labels()
	_label(stage, "左：默认混合", Rect2(8, 0, 270, 32), 23)
	_label(stage, "右：禁混合参照", Rect2(320, 0, 292, 32), 23)
	_label(stage, "同一张离屏纹理 · 固定姿态", Rect2(8, 250, 604, 36), 22)
	if spec.kind == "background":
		_label(stage, "背景透明只验收左侧；右侧仅作诊断参照", Rect2(8, 292, 604, 42), 20)

func _clear_stage_labels() -> void:
	for child in stage.get_children():
		if child is Label:
			stage.remove_child(child)
			child.queue_free()

func _ground() -> void:
	var viewport := worlds[0]
	var camera := viewport.get_camera_3d()
	camera.position = Vector3(2.6, 2.2, 4)
	camera.look_at(Vector3(0, -.15, 0))
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(4, 4)
	floor_mesh.mesh = plane
	floor_mesh.position.y = -.7
	floor_mesh.material_override = _material(Color(.72, .72, .72, 1))
	viewport.add_child(floor_mesh)
	active_lights[0].rotation_degrees = Vector3(-45, -35, 0)
	var sheet := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(.8, .8)
	sheet.mesh = quad
	sheet.position = Vector3(-.8, .1, .8)
	sheet.material_override = _material(Color(1, .04, .04, .48))
	sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	viewport.add_child(sheet)
	notes["shadowTarget"] = "opaque cube on ground; transparent sheet casting disabled"

func _lighting(kind: String, parent: Node, shadow: bool) -> void:
	var first := active_lights[0]
	first.shadow_enabled = shadow
	if kind == "directional2" or kind == "directional1":
		first.light_color = Color(.12, .3, 1)
		if kind == "directional2":
			var second := DirectionalLight3D.new()
			second.rotation_degrees = Vector3(-45, 35, 0)
			second.light_color = Color(1, .12, .08)
			second.light_energy = 1.2
			second.shadow_enabled = shadow
			parent.add_child(second)
			active_lights.append(second)
	else:
		first.visible = false
		var light: Light3D = OmniLight3D.new() if kind == "omni" else SpotLight3D.new()
		light.position = Vector3(-.5, 2, 1.5)
		light.light_energy = 3.0
		if light is OmniLight3D: light.omni_range = 4.0
		else:
			light.spot_range = 5.0
			light.spot_angle = 28.0
		parent.add_child(light)
		light.look_at(Vector3(0, -.7, 0))
		active_lights.append(light)

func _gradient() -> void:
	for child in direct_model.get_children():
		direct_model.remove_child(child)
		child.queue_free()
	cubes.clear()
	front_sheet = null
	back_sheet = null
	_clear_stage_labels()
	var values := [0.0, .25, .48, .75, 1.0]
	for i in range(5):
		var x: float = (i - 2) * 2.0
		var back := _sheet(Color.WHITE, Vector3(x, 0, 0), Vector2(1.7, 1.7))
		back.material_override.albedo_texture = _nine_texture()
		var red := _sheet(Color(1, .04, .04, values[i]), Vector3(x, 0, .3), Vector2(1.7, 1.7))
		red.material_override.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		samples.append(red)
		_label(stage, str(roundi(values[i]*100))+"%", Rect2(5+i*124, 12, 115, 36), 25)
	_label(stage, "都走透明材质路径；100%不代表不透明队列", Rect2(8, 288, 600, 45), 22)

func _scissor() -> void:
	var image := Image.create(128, 64, false, Image.FORMAT_RGBA8)
	for i in range(4): image.fill_rect(Rect2i(i*32, 0, 32, 64), Color(1, .6, .05, [0.0, .35, .7, 1.0][i]))
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = ImageTexture.create_from_image(image)
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = float(spec.threshold)
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = .8
	front_sheet.material_override = mat
	_label(stage, "橙片宽度：原宽的"+("3/4" if spec.threshold < .5 else "1/2"), Rect2(8, 292, 600, 42), 23)
	notes["textureAlphaColumns"] = [0.0, .35, .7, 1.0]

func _checker(rect: Rect2) -> void:
	var checker := Checker.new()
	checker.position = rect.position
	checker.size = rect.size
	checker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_own(checker, stage)
	stage.move_child(checker, 0)

func _remove_views() -> Texture2D:
	var texture: Texture2D = views[0].texture
	for view in views:
		view.get_parent().remove_child(view)
		view.queue_free()
	views.clear()
	_clear_stage_labels()
	return texture

func _fade() -> void:
	var texture := _remove_views()
	for i in range(3):
		var alpha: float = [1.0, .5, 0.0][i]
		var rect := Rect2(8+i*207, 44, 190, 154)
		_checker(rect)
		var group := Control.new()
		group.position = rect.position
		group.size = rect.size
		group.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_own(group, stage)
		fade_groups.append(group)
		var view := _view(texture, Rect2(Vector2.ZERO, rect.size))
		view.reparent(group, false)
		views.append(view)
		var badge := ColorRect.new()
		badge.color = Color(1, .25, .08)
		badge.position = Vector2(7, 7)
		badge.size = Vector2(25, 25)
		badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
		group.add_child(badge)
		fade_badges.append(badge)
		if spec.target == "self": view.self_modulate.a = alpha
		else: group.modulate.a = alpha
		_label(stage, str(roundi(alpha*100))+"%", Rect2(rect.position.x, 3, 190, 35), 24)
	_label(stage, "橙色角标：自身淡出时不变；父级淡出时一起变淡", Rect2(8, 230, 604, 85), 23)
	notes["fadeProperty"] = "TextureRect.self_modulate" if spec.target == "self" else "parent.modulate"

func _custom() -> void:
	var texture := _remove_views()
	var viewport := worlds[0]
	viewport.size = Vector2i(640, 320)
	var camera := viewport.get_camera_3d()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 3.0
	camera.position = Vector3(0, 2.6, 5.5)
	camera.look_at(Vector3(0, -.1, 0))
	cubes[0].get_parent().remove_child(cubes[0])
	cubes[0].queue_free()
	cubes.clear()
	for i in range(2):
		var cube := _cube(viewport)
		cube.position.x = -.95 if i == 0 else .95
		cube.rotation_degrees = Vector3(0, 22, 0)
		var mat := ShaderMaterial.new()
		mat.shader = load("res://regression19-light-opaque.gdshader" if i == 0 else "res://regression19-light-alpha.gdshader")
		mat.set_shader_parameter("albedo_texture", _number_texture())
		cube.material_override = mat
		cubes.append(cube)
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(5, 3.5)
	floor_mesh.mesh = plane
	floor_mesh.position.y = -.65
	floor_mesh.material_override = _material(Color(.72, .72, .72, 1))
	viewport.add_child(floor_mesh)
	active_lights[0].rotation_degrees = Vector3(-45, -35, 0)
	_lighting(str(spec.light), viewport, bool(spec.shadow))
	views.append(_view(texture, Rect2(10, 36, 600, 300)))
	_label(stage, "不透明材质", Rect2(45, 0, 230, 34), 23)
	_label(stage, "48%半透明材质", Rect2(345, 0, 265, 34), 23)
	notes["customLight"] = "same Lambert light function; opaque fragment has no ALPHA assignment; transparent fragment writes .48"

func update_layout(rect: Rect2) -> void:
	super.update_layout(rect)
	if spec.get("kind", "") == "gradient" and is_instance_valid(direct_camera):
		var canvas := stage.get_global_rect()
		var content := Rect2(canvas.position + Vector2(8, 52)*stage.scale.x, Vector2(604, 230)*stage.scale.x)
		var center := direct_camera.project_position(content.get_center(), 10)
		var right := direct_camera.project_position(content.get_center()+Vector2(content.size.x, 0), 10)
		var scale_value := center.distance_to(right)/10.0
		direct_model.scale = Vector3.ONE*scale_value
		direct_model.position = center

func inspect_scene() -> Dictionary:
	var materials: Array = []
	var meshes: Array = cubes.duplicate()
	if is_instance_valid(front_sheet): meshes.append(front_sheet)
	meshes.append_array(samples)
	for mesh in meshes:
		var mat: Material = mesh.material_override
		if mat is StandardMaterial3D:
			materials.append({"type":"StandardMaterial3D","alpha":mat.albedo_color.a,"transparency":mat.transparency,"scissor":mat.alpha_scissor_threshold,"depth":mat.depth_draw_mode})
		elif mat is ShaderMaterial: materials.append({"type":"ShaderMaterial","shader":mat.shader.resource_path})
	var lights: Array = []
	for light in active_lights:
		lights.append({"type":light.get_class(),"visible":light.visible,"color":[light.light_color.r,light.light_color.g,light.light_color.b],"energy":light.light_energy,"shadow":light.shadow_enabled})
	var displays: Array = []
	for i in range(views.size()):
		var view := views[i]
		displays.append({"material":"default MIX" if view.material == null else view.material.shader.resource_path,"selfAlpha":view.self_modulate.a,"parentAlpha":fade_groups[i].modulate.a if fade_groups.size()>i else 1.0})
	return {"source":"scene properties only; not GPU queries","notes":notes,"materials":materials,"lights":lights,"sourceViewportCount":worlds.size(),"sourceViewportSize":[worlds[0].size.x,worlds[0].size.y] if worlds.size() else [],"transparentBackground":worlds[0].transparent_bg if worlds.size() else false,"displays":displays,"sameTextureObject":views.all(func(v): return v.texture == views[0].texture) if views.size() else false,"automaticVisualPass":false}
