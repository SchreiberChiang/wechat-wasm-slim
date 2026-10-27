extends SceneTree

# External desktop harness; excluded from PCK. Readback here is screenshot-only,
# never part of the candidate. Programmatic Button.pressed is not a real touch.
var destination := ""
var canvas_size := Vector2i(720, 1540)
var viewport: SubViewport
var scene: Control
var failures: Array = []
var entries: Array = []
var started := 0
var finished := false

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="): destination = arg.substr(6)
		if arg.begins_with("--size="):
			var parts := arg.substr(7).split("x")
			canvas_size = Vector2i(int(parts[0]), int(parts[1]))
	if destination.is_empty() or DirAccess.dir_exists_absolute(destination):
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(destination)
	started = Time.get_ticks_usec()
	call_deferred("_run")

func _process(_delta: float) -> bool:
	if not finished and started > 0 and Time.get_ticks_usec() - started > 120000000:
		failures.append("120-second native harness timeout")
		_finish()
	return false

func _check(condition: bool, label: String) -> void:
	if not condition: failures.append(label)

func _draws(count: int) -> void:
	for ignored in range(count): await RenderingServer.frame_post_draw

func _snapshot() -> Dictionary:
	return scene.renderer.get_state().duplicate(true)

func _act(id: String) -> void:
	var before: int = scene.renderer.event_count
	var target := scene.renderer.get_node_or_null(NodePath(scene.renderer.action_nodes[id])) as Button
	_check(is_instance_valid(target), "button exists " + id)
	if is_instance_valid(target): target.pressed.emit()
	_check(scene.renderer.event_count > before, "operation record " + id)

func _capture(name: String) -> String:
	var file := destination.path_join(name + ".png")
	_check(viewport.get_texture().get_image().save_png(file) == OK, "save screenshot " + name)
	return file

func _default_results() -> void:
	for value in scene.store.results.values(): _check(value == scene.store.defaults, "no automatic visual/response/smoothness verdict")

func _layout() -> void:
	var rect := Rect2(Vector2.ZERO, Vector2(canvas_size))
	for node in [scene.heading, scene.instruction, scene.expected, scene.status, scene.directory]:
		_check(rect.encloses(node.get_global_rect()), "layout inside viewport " + node.get_class())
	for field in scene.result_buttons:
		_check(rect.encloses(scene.result_buttons[field].get_global_rect()), "result control inside " + field)
	_check(scene.stage.size.y >= 160, "scene area usable")
	for button_path in scene.renderer.action_nodes.values():
		var button := scene.get_node_or_null(NodePath(button_path)) as Button
		if is_instance_valid(button): _check(rect.encloses(button.get_global_rect()), "action inside viewport " + button.name)

func _run() -> void:
	if DisplayServer.get_name() == "headless":
		failures.append("graphical runtime required")
		_finish()
		return
	viewport = SubViewport.new()
	viewport.size = canvas_size
	viewport.own_world_3d = true
	viewport.gui_embed_subwindows = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	scene = load("res://main.tscn").instantiate()
	viewport.add_child(scene)
	scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	while scene.transition_phase != "ready": await RenderingServer.frame_post_draw
	_check(scene.steps.size() == 8, "eight selected steps, no full old suite")
	for index in range(scene.steps.size()):
		await scene.select_step(index)
		await _draws(2)
		_check(scene.transition_phase == "ready", "ready " + str(index))
		_default_results()
		_layout()
		var id: String = scene.steps[index].id
		var entry := {"id": id, "built": _snapshot(), "images": [_capture("%02d-built" % (index + 1))], "actions": []}
		var timings: Dictionary = scene.get_test_state().currentTimings
		_check(timings.preparationFrameCallbackTicksUsec <= timings.constructionBeginTicksUsec, "preparation before resource creation")
		_check(timings.resourcesCreatedTicksUsec <= timings.firstFrameCallbackTicksUsec, "resource completion before draw callback")
		match id:
			"B01-image":
				_act("flip_reference")
				await _draws(2)
				entry.images.append(_capture("01-flipped"))
				_act("flip_reference")
			"B06-texture":
				_act("stop_front")
				_check(not scene.renderer.side_running[0], "direct cube pause")
			"B07-front":
				_check(not scene.renderer.front_sheet.visible, "red initially hidden")
				_act("add_front")
				await _draws(2)
				var semi: Dictionary = _snapshot().redSheet
				_check(semi.visible and semi.visibleInTree, "red enabled after original button")
				_check(semi.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA, "red original semi mode")
				entry.images.append(_capture("03-red-semi"))
				_act("red_material")
				await _draws(2)
				var opaque: Dictionary = _snapshot().redSheet
				_check(opaque.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED and opaque.albedo[3] == 1.0, "red opaque mode")
				for key in ["localPosition", "quadSize", "lightEnergy", "lightRotationDegrees", "cullMode", "depthDrawMode"]:
					_check(semi[key] == opaque[key], "red invariant " + key)
				entry["redModes"] = {"semi": semi, "opaque": opaque}
				entry.images.append(_capture("03-red-opaque"))
				_act("red_material")
				_check(_snapshot().redSheet == semi, "red material reversible")
			"D15-alpha":
				var compare: Dictionary = _snapshot().displayComparison
				_check(compare.sameTextureObject and compare.sameTextureRid, "same source for two final displays")
				_check(scene.renderer.worlds.size() == 1, "one source viewport")
				_check(scene.renderer.views[1].material.shader.code.contains("render_mode blend_disabled;"), "right display blending disabled")
				_act("pause_source")
				var position: Vector3 = scene.renderer.cubes[0].rotation
				await _draws(12)
				_check(scene.renderer.cubes[0].rotation == position, "shared source pause")
				_act("pause_source")
			"N01-skin":
				_check(scene.renderer.skeleton.get_bone_count() == 2, "two bones")
				_check(scene.renderer.skeleton_mesh.skin.get_bind_count() == 2, "two skin binds")
				_check(scene.renderer.skeleton.get_bone_global_pose(0).origin.is_equal_approx(Vector3(0, -.8, 0)), "root rest pose position")
				_check(scene.renderer.skeleton.get_bone_global_pose(1).origin.is_equal_approx(Vector3.ZERO), "tip hinge position")
				var pose: Array = _snapshot().tipPoseQuaternion
				await _draws(20)
				_check(_snapshot().tipPoseQuaternion != pose, "bone pose advances")
				entry.images.append(_capture("05-bent"))
				_act("pause_bones")
				await _draws(2)
				pose = _snapshot().tipPoseQuaternion
				await _draws(12)
				_check(_snapshot().tipPoseQuaternion == pose, "bone playback pauses")
				_act("pause_bones")
			"N02-multimesh":
				_check(scene.renderer.grid.multimesh.instance_count == 64, "64 instances")
				var first: Transform3D = scene.renderer.grid.multimesh.get_instance_transform(0)
				_act("spread_grid")
				_check(scene.renderer.grid.multimesh.get_instance_transform(0) != first, "instance layout updates")
				_act("pause_grid")
				await _draws(2)
				entry.images.append(_capture("06-spread"))
				_act("spread_grid")
				_act("pause_grid")
			"N03-shader":
				_act("shader_palette")
				_check(scene.renderer.custom_material.get_shader_parameter("alternate_palette") == true, "shader uniform changes")
				await _draws(2)
				entry.images.append(_capture("07-blue-yellow"))
			"N04-texture":
				var texture_id: int = _snapshot().textureInstanceId
				var updates: int = _snapshot().dynamicUpdates
				await _draws(35)
				_check(_snapshot().dynamicUpdates > updates, "texture update count advances")
				_act("pause_texture")
				updates = _snapshot().dynamicUpdates
				await _draws(20)
				_check(_snapshot().dynamicUpdates == updates, "texture updates pause")
				_act("texture_palette")
				_check(_snapshot().dynamicUpdates == updates + 1, "manual texture update while paused")
				_check(_snapshot().textureInstanceId == texture_id, "same ImageTexture object")
				await _draws(2)
				entry.images.append(_capture("08-blue-yellow"))
				_act("pause_texture")
		await _draws(2)
		_default_results()
		entry["afterActions"] = _snapshot()
		entries.append(entry)
	_finish()

func _finish() -> void:
	if finished: return
	finished = true
	var report := {"scope": "native Windows OpenGL source scene only", "outcome": "PASS" if failures.is_empty() else "FAIL", "failures": failures,
		"viewport": [canvas_size.x,canvas_size.y], "entries": entries, "input": "programmatic Button.pressed emit, not real touch",
		"webglPassed": false, "glxPassed": false, "phoneTested": false, "visualPassAutomatic": false,
		"engineRebuilt": false, "elapsedUsecIncludingHarness": Time.get_ticks_usec() - started}
	var file := FileAccess.open(destination.path_join("RESULT.json"), FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
	quit(0 if failures.is_empty() else 2)
