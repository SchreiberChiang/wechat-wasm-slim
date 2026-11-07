# One sample only. No acceptance harness, queries, readback or alpha workaround.
extends Control

var cube: MeshInstance3D

func _ready() -> void:
	var background := ColorRect.new()
	background.color = Color("11243a")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)
	var heading := Label.new()
	heading.text = "Godot + GLX\nTexture / shadow / red alpha 48%"
	heading.position = Vector2(24, 24)
	heading.add_theme_font_size_override("font_size", 24)
	add_child(heading)
	var viewport := SubViewport.new()
	viewport.size = Vector2i(640, 520)
	viewport.own_world_3d = true
	viewport.transparent_bg = false
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(viewport)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color("153f79")
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color.WHITE
	env.environment.ambient_light_energy = 0.32
	viewport.add_child(env)
	var camera := Camera3D.new()
	camera.position = Vector3(3, 2.4, 5)
	camera.fov = 45
	viewport.add_child(camera)
	camera.look_at(Vector3(0, -0.1, 0))
	camera.current = true
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-45, -42, 0)
	light.light_energy = 1.2
	light.shadow_enabled = true
	viewport.add_child(light)
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(5, 4)
	ground.mesh = plane
	ground.position.y = -0.65
	ground.material_override = material(Color.WHITE)
	viewport.add_child(ground)
	cube = MeshInstance3D.new()
	cube.mesh = BoxMesh.new()
	var cube_material := material(Color.WHITE)
	cube_material.albedo_texture = texture_pattern()
	cube_material.uv1_scale = Vector3(3, 2, 1)
	cube_material.texture_repeat = true
	cube.material_override = cube_material
	viewport.add_child(cube)
	var red := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(1.5, 1.3)
	red.mesh = quad
	red.position = Vector3(-0.6, 0, 1)
	var red_material := material(Color(1, 0.04, 0.04, 0.48))
	red_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	red_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	red.material_override = red_material
	viewport.add_child(red)
	var image := TextureRect.new()
	image.texture = viewport.get_texture()
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	image.offset_left = 20
	image.offset_right = -20
	image.offset_top = 115
	image.offset_bottom = -150
	# Default Canvas MIX, no custom material or forced alpha.
	add_child(image)
	var status := Label.new()
	status.position = Vector2(24, 690)
	status.size = Vector2(590, 110)
	status.add_theme_font_size_override("font_size", 16)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status.text = "Native reference only. Phone GLX still needs verification."
	add_child(status)
	if OS.has_feature("web"):
		var bridge = JavaScriptBridge.get_interface("SimpleGlxDelivery")
		if bridge != null:
			status.text = str(bridge.sceneReady())
		else:
			push_error("SimpleGlxDelivery host interface missing")
	print("[SIMPLE_SCENE] created; visual result not inferred")

func material(color: Color) -> StandardMaterial3D:
	var result := StandardMaterial3D.new()
	result.albedo_color = color
	result.roughness = 0.8
	return result

func texture_pattern() -> ImageTexture:
	var image := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	image.fill(Color("1e799d"))
	for y in range(8):
		for x in range(8):
			if (x + y) % 2 == 0:
				image.fill_rect(Rect2i(x * 8, y * 8, 8, 8), Color("b6e4e0"))
	image.fill_rect(Rect2i(29, 12, 6, 40), Color.WHITE)
	return ImageTexture.create_from_image(image)

func _process(delta: float) -> void:
	if is_instance_valid(cube):
		cube.rotate_y(delta * 0.35)
