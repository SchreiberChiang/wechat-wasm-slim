extends "res://renderer_base.gd"

# Scene-only expansion. renderer_base.gd is byte-identical to the retained 20c
# source. No engine/GLX shim, GPU readback, format change or manual submission.
var red_opaque := false
var case_note: Label
var skeleton: Skeleton3D
var animation_player: AnimationPlayer
var skeleton_mesh: MeshInstance3D
var grid: MultiMeshInstance3D
var grid_spread := false
var grid_paused := false
var grid_motion_time := 0.0
var custom_material: ShaderMaterial
var shader_alternate := false
var dynamic_image: Image
var dynamic_texture: ImageTexture
var dynamic_running := true
var dynamic_alternate := false
var dynamic_frame := 0
var dynamic_updates := 0

func build(id: String, target: Control, action_container: VBoxContainer) -> void:
	super.build(id, target, action_container)
	last_build_success = false
	match id:
		"B01-image":
			var image_view: TextureRect
			for child in stage.get_children():
				if child is TextureRect:
					image_view = child
					break
			_button("flip_reference", "左右翻转 / 恢复", func():
				image_view.flip_h = not image_view.flip_h
				_emit("ordinary_2d_flipped", {"flip_h": image_view.flip_h}))
		"B06-texture": pass
		"B07-front": _extend_red_comparison()
		"D15-alpha": _build_alpha_comparison()
		"N01-skin": _build_skeleton()
		"N02-multimesh": _build_multimesh()
		"N03-shader": _build_shader()
		"N04-texture": _build_dynamic_texture()
		_: return
	update_layout(host_stage.get_global_rect())
	last_build_success = true
	_emit("round3_content_created", {"step_id": id, "render_path": state.render_path, "automaticPass": false})

func clear() -> void:
	super.clear()
	case_note = null
	skeleton = null
	animation_player = null
	skeleton_mesh = null
	grid = null
	custom_material = null
	dynamic_image = null
	dynamic_texture = null
	red_opaque = false
	grid_spread = false
	grid_paused = false
	grid_motion_time = 0.0
	shader_alternate = false
	dynamic_running = true
	dynamic_alternate = false
	dynamic_frame = 0
	dynamic_updates = 0

func _red_state() -> Dictionary:
	if not is_instance_valid(front_sheet): return {}
	var material := front_sheet.material_override as StandardMaterial3D
	var mesh := front_sheet.mesh as QuadMesh
	return {"visible": front_sheet.visible, "visibleInTree": front_sheet.is_visible_in_tree(), "opaque": red_opaque,
		"albedo": [material.albedo_color.r, material.albedo_color.g, material.albedo_color.b, material.albedo_color.a],
		"transparency": material.transparency, "cullMode": material.cull_mode, "depthDrawMode": material.depth_draw_mode,
		"localPosition": [front_sheet.position.x, front_sheet.position.y, front_sheet.position.z], "quadSize": [mesh.size.x, mesh.size.y],
		"lightEnergy": lamp.light_energy, "lightRotationDegrees": [lamp.rotation_degrees.x, lamp.rotation_degrees.y, lamp.rotation_degrees.z]}

func _emit(event: String, details: Dictionary = {}) -> void:
	var payload := details.duplicate(true)
	if step_id == "B07-front" and is_instance_valid(front_sheet):
		var red := _red_state()
		state["redSheet"] = red
		payload["redSheet"] = red
		if is_instance_valid(case_note):
			case_note.text = "红片：%s\n材质：%s" % ["已启用" if red.visible else "未显示", "不透明" if red_opaque else "半透明 48%"]
	super._emit(event, payload)

func _extend_red_comparison() -> void:
	# Retain the exact original13 creation, original add_front callback, back blue
	# sheet, camera, geometry and lighting. Only two material properties vary.
	case_note = _label(stage, "红片：未显示\n材质：半透明 48%", Rect2(455, 214, 160, 90), 22)
	_button("red_material", "切换材质：不透明 / 半透明", func():
		red_opaque = not red_opaque
		var material := front_sheet.material_override as StandardMaterial3D
		material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED if red_opaque else BaseMaterial3D.TRANSPARENCY_ALPHA
		material.albedo_color.a = 1.0 if red_opaque else .48
		# CULL_DISABLED and DEPTH_DRAW_OPAQUE stay unchanged in both modes.
		_emit("red_material_changed", {"geometryAndLightChanged": false, "visualPass": false}))
	state["redSheet"] = _red_state()

func _build_alpha_comparison() -> void:
	state["render_path"] = "one_subviewport_two_display_blend_modes"
	_new_view(0)
	var original := views[0]
	var compared := _view(original.texture, Rect2(320, 32, 248, 202))
	views.append(compared)
	var no_blend := ShaderMaterial.new()
	no_blend.shader = load("res://display_ignore_alpha.gdshader")
	compared.material = no_blend
	for child in stage.get_children():
		if child is Label and child.text == "L 左蓝底": child.text = "左：原混合"
	_label(stage, "右：忽略纹理alpha", Rect2(322, 0, 290, 32), 21)
	case_note = _label(stage, "同一张离屏纹理，只改变最终显示混合；这不是修复。", Rect2(10, 265, 600, 62), 21)
	state["displayComparison"] = {"sameTextureObject": original.texture == compared.texture,
		"sameTextureRid": original.texture.get_rid() == compared.texture.get_rid(),
		"sourceViewportCount": 1, "sourceViewportSize": [worlds[0].size.x, worlds[0].size.y],
		"sourceTransparentBackground": worlds[0].transparent_bg, "sourceHdr2D": worlds[0].use_hdr_2d,
		"leftMaterial": "original default MIX", "rightMaterial": "Canvas shader render_mode blend_disabled, default fragment retained",
		"sourceFormatClearLightLibraryChanged": false, "generalFixClaimed": false}
	_button("pause_source", "暂停 / 继续同一方块", func():
		side_running[0] = not side_running[0]
		_emit("shared_source_paused", {"running": side_running[0], "comparison": state.displayComparison}))

func _new_root() -> void:
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
	lamp = _light(direct_world)

func _build_skeleton() -> void:
	_new_root()
	skeleton = Skeleton3D.new()
	skeleton.name = "Skeleton3D"
	direct_model.add_child(skeleton)
	skeleton.add_bone("Root")
	skeleton.set_bone_rest(0, Transform3D(Basis.IDENTITY, Vector3(0, -.8, 0)))
	skeleton.add_bone("Tip")
	skeleton.set_bone_parent(1, 0)
	skeleton.set_bone_rest(1, Transform3D(Basis.IDENTITY, Vector3(0, .8, 0)))
	skeleton.reset_bone_poses()
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	var indices := PackedInt32Array()
	for segment in range(2):
		var low := -.8 + segment * .8
		for vertex in [Vector3(-.18, low, 0), Vector3(.18, low, 0), Vector3(-.18, low + .8, 0), Vector3(.18, low + .8, 0)]:
			vertices.append(vertex)
			normals.append(Vector3.FORWARD)
			colors.append(Color("f0a035") if segment == 1 else Color("28c6dc"))
			if is_zero_approx(vertex.y):
				# Both faces share the same blended hinge positions, avoiding an
				# artificial gap between two independently rigid rectangles.
				bones.append_array(PackedInt32Array([0, 1, 0, 0]))
				weights.append_array(PackedFloat32Array([.5, .5, 0, 0]))
			else:
				bones.append_array(PackedInt32Array([segment, 0, 0, 0]))
				weights.append_array(PackedFloat32Array([1, 0, 0, 0]))
		var offset := segment * 4
		indices.append_array(PackedInt32Array([offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_BONES] = bones
	arrays[Mesh.ARRAY_WEIGHTS] = weights
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	skeleton_mesh = MeshInstance3D.new()
	skeleton_mesh.name = "SkinnedStrip"
	skeleton_mesh.mesh = mesh
	skeleton_mesh.skeleton = NodePath("../Skeleton3D")
	skeleton_mesh.skin = skeleton.create_skin_from_rest_transforms()
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	skeleton_mesh.material_override = material
	direct_model.add_child(skeleton_mesh)
	animation_player = AnimationPlayer.new()
	direct_model.add_child(animation_player)
	var animation := Animation.new()
	animation.length = 2.0
	animation.loop_mode = Animation.LOOP_LINEAR
	var track := animation.add_track(Animation.TYPE_ROTATION_3D)
	animation.track_set_path(track, NodePath("Skeleton3D:Tip"))
	animation.rotation_track_insert_key(track, 0, Quaternion(Vector3.BACK, -.65))
	animation.rotation_track_insert_key(track, 1, Quaternion(Vector3.BACK, .65))
	animation.rotation_track_insert_key(track, 2, Quaternion(Vector3.BACK, -.65))
	var library := AnimationLibrary.new()
	library.add_animation("bend", animation)
	animation_player.add_animation_library("", library)
	animation_player.play("bend")
	_label(stage, "蓝色下端固定\n橙色上段弯折\n接点连续\n不是整物体旋转", Rect2(455, 20, 160, 250), 23)
	_button("pause_bones", "暂停骨骼 / 继续", func():
		if animation_player.is_playing(): animation_player.pause()
		else: animation_player.play()
		_emit("skeleton_playback_changed", {"playing": animation_player.is_playing(), "boneCount": skeleton.get_bone_count(), "skinBindCount": skeleton_mesh.skin.get_bind_count()}))
	state["skeletalSetup"] = {"boneCount": 2, "vertices": 8, "weightsPerVertex": 4, "animationTrack": "Skeleton3D:Tip", "source": "CPU constructed arrays; no mesh/GPU readback"}

func _build_multimesh() -> void:
	_new_root()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(.14, .14, .1)
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	mesh.material = material
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.use_colors = true
	multi.mesh = mesh
	multi.instance_count = 64
	grid = MultiMeshInstance3D.new()
	grid.multimesh = multi
	direct_model.add_child(grid)
	_update_grid()
	_label(stage, "八行 × 八列\n共64个小方块\n红蓝交错\n散开仍不缺块", Rect2(455, 20, 160, 250), 23)
	_button("spread_grid", "散开 / 合拢64个实例", func():
		grid_spread = not grid_spread
		_update_grid()
		_emit("multimesh_layout_changed", {"instanceCount": grid.multimesh.instance_count, "spread": grid_spread}))
	_button("pause_grid", "暂停 / 继续整体转动", func():
		grid_paused = not grid_paused
		_emit("multimesh_motion_changed", {"paused": grid_paused}))
	state["multimeshSetup"] = {"instances": 64, "rows": 8, "columns": 8, "colors": true, "instancing": "one MultiMesh, not64 MeshInstance nodes"}

func _update_grid() -> void:
	var spacing := .235 if grid_spread else .2
	for index in range(64):
		var column := index % 8
		var row := index / 8
		grid.multimesh.set_instance_transform(index, Transform3D(Basis.IDENTITY, Vector3((column - 3.5) * spacing, (row - 3.5) * spacing, 0)))
		grid.multimesh.set_instance_color(index, Color("e95a49") if (column + row) % 2 == 0 else Color("32bbed"))

func _build_shader() -> void:
	_new_root()
	var mesh := MeshInstance3D.new()
	mesh.mesh = BoxMesh.new()
	mesh.rotation_degrees = Vector3(-18, 25, 0)
	direct_model.add_child(mesh)
	cubes.append(mesh)
	custom_material = ShaderMaterial.new()
	custom_material.shader = load("res://opaque_test.gdshader")
	mesh.material_override = custom_material
	_label(stage, "红绿条纹方块\n按键后蓝黄条纹\n始终不透明\n不写ALPHA", Rect2(455, 20, 160, 250), 23)
	_button("shader_palette", "切换条纹颜色", func():
		shader_alternate = not shader_alternate
		custom_material.set_shader_parameter("alternate_palette", shader_alternate)
		_emit("opaque_shader_palette_changed", {"alternate": shader_alternate, "shaderWritesAlpha": false}))
	state["customShaderSetup"] = {"spatial": true, "unshaded": true, "alphaWritten": false, "textureDependency": false}

func _build_dynamic_texture() -> void:
	state["render_path"] = "ImageTexture.update_into_ordinary_2d"
	dynamic_image = Image.create(64, 64, false, Image.FORMAT_RGBA8)
	dynamic_image.fill(Color.RED)
	dynamic_texture = ImageTexture.create_from_image(dynamic_image)
	_view(dynamic_texture, Rect2(20, 25, 280, 230))
	_label(stage, "左图背景轮换\n白条不断移动\n暂停后应停住\n继续后应再变化", Rect2(350, 30, 250, 210), 24)
	case_note = _label(stage, "", Rect2(20, 275, 580, 55), 20)
	_update_dynamic_texture()
	_button("pause_texture", "暂停纹理更新 / 继续", func():
		dynamic_running = not dynamic_running
		_emit("texture_updates_paused", {"running": dynamic_running, "updateCount": dynamic_updates, "textureInstanceId": dynamic_texture.get_instance_id()}))
	_button("texture_palette", "换成蓝黄 / 恢复彩色", func():
		dynamic_alternate = not dynamic_alternate
		_update_dynamic_texture()
		_emit("texture_palette_changed", {"alternate": dynamic_alternate, "updateCount": dynamic_updates, "textureInstanceId": dynamic_texture.get_instance_id()}))
	state["dynamicTextureSetup"] = {"size": [64,64], "format": "RGBA8", "method": "ImageTexture.update", "recreateEachUpdate": false, "frameNumberIsNotFPS": true}

func _update_dynamic_texture() -> void:
	var phase := (dynamic_frame / 60) % 3
	var palette := [Color("d64242"), Color("249957"), Color("326dd0")]
	if dynamic_alternate: palette = [Color("215bcd"), Color("dabd26"), Color("215bcd")]
	dynamic_image.fill(palette[phase])
	var x := dynamic_frame % 56
	dynamic_image.fill_rect(Rect2i(x, 0, 8, 64), Color.WHITE)
	dynamic_texture.update(dynamic_image)
	dynamic_updates += 1
	case_note.text = "更新次数 %d；同一纹理对象；帧号不作为FPS" % dynamic_updates
	state["dynamicUpdateCount"] = dynamic_updates

func _process(delta: float) -> void:
	super._process(delta)
	if is_instance_valid(grid) and not grid_paused:
		grid_motion_time += delta
		grid.rotation.z = sin(grid_motion_time * .7) * .08
	if is_instance_valid(dynamic_texture) and dynamic_running:
		dynamic_frame += 1
		if dynamic_frame % 15 == 0: _update_dynamic_texture()

func get_state() -> Dictionary:
	var result := super.get_state()
	if is_instance_valid(front_sheet): result["redSheet"] = _red_state()
	if is_instance_valid(animation_player):
		result["bonePlaying"] = animation_player.is_playing()
		var rotation := skeleton.get_bone_pose_rotation(1)
		result["tipPoseQuaternion"] = [rotation.x, rotation.y, rotation.z, rotation.w]
	if is_instance_valid(grid): result["gridSpread"] = grid_spread
	if is_instance_valid(custom_material): result["shaderAlternate"] = shader_alternate
	if is_instance_valid(dynamic_texture):
		result["dynamicUpdates"] = dynamic_updates
		result["dynamicRunning"] = dynamic_running
		result["textureInstanceId"] = dynamic_texture.get_instance_id()
	return result
