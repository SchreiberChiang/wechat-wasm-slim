extends SceneTree

# External native graphical harness only. Exclude this script from exports.
# All GPU readback is confined to the root screenshot here, never the candidate.
var destination := ""
var canvas_size := Vector2i(720, 1540)
var viewport: SubViewport
var scene: Control
var failures: Array = []
var entries: Array = []
var started := 0
var finished := false
var source_baseline: Dictionary = {}
var resource_baseline: Array = []
var initial_results: Dictionary = {}
var baseline_state: Dictionary = {}

func _initialize() -> void:
	started = Time.get_ticks_usec()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="): destination = arg.substr(6)
		if arg.begins_with("--size="):
			var parts := arg.substr(7).split("x")
			if parts.size() == 2: canvas_size = Vector2i(int(parts[0]), int(parts[1]))
	if destination.is_empty() or DirAccess.dir_exists_absolute(destination):
		push_error("--out must name a NEW directory")
		quit(2)
		return
	if DirAccess.make_dir_recursive_absolute(destination) != OK:
		push_error("Cannot create output directory")
		quit(2)
		return
	call_deferred("_run")

func _process(_delta: float) -> bool:
	if not finished and not destination.is_empty() and Time.get_ticks_usec() - started > 120000000:
		failures.append("120-second native graphical harness timeout")
		_finish()
	return false

func _check(condition: bool, label: String) -> void:
	if not condition: failures.append(label)

func _draws(count: int) -> void:
	for ignored in range(count):
		await RenderingServer.frame_post_draw
		if finished: return

func _snapshot() -> Dictionary:
	return scene.renderer.get_state().duplicate(true)

func _act(id: String) -> bool:
	var state := _snapshot()
	var paths: Dictionary = state.get("action_nodes", {})
	if not paths.has(id):
		_check(false, "missing public action " + id)
		return false
	var target := scene.renderer.get_node_or_null(NodePath(str(paths[id]))) as Button
	_check(is_instance_valid(target), "button exists " + id)
	if not is_instance_valid(target): return false
	var before := int(state.get("event_count", -1))
	target.pressed.emit()
	_check(int(_snapshot().get("event_count", -1)) > before, "operation recorded " + id)
	return true

func _id(object: Object) -> String:
	return str(object.get_instance_id()) if is_instance_valid(object) else "none"

func _rect(rect: Rect2) -> Array:
	return [rect.position.x, rect.position.y, rect.size.x, rect.size.y]

func _walk(node: Node, found: Array) -> void:
	found.append(node)
	for child in node.get_children(): _walk(child, found)

func _source() -> Dictionary:
	var worlds: Array = scene.renderer.get("worlds")
	_check(worlds.size() == 1, "exactly one source SubViewport")
	if worlds.size() != 1: return {}
	var source := worlds[0] as SubViewport
	var result := {"id": _id(source), "size": [source.size.x, source.size.y],
		"updateMode": source.render_target_update_mode, "transparentBg": source.transparent_bg,
		"hdr2D": source.use_hdr_2d, "ownWorld3D": source.own_world_3d,
		"world3D": _id(source.world_3d), "texture": _id(source.get_texture()),
		"textureRid": str(source.get_texture().get_rid()), "nodes": []}
	var nodes: Array = []
	_walk(source, nodes)
	for node in nodes:
		var record := {"id": _id(node), "class": node.get_class(), "path": str(source.get_path_to(node))}
		if node is Node3D:
			record["transform"] = str(node.transform)
			record["visible"] = node.visible
		if node is Camera3D:
			record.merge({"projection": node.projection, "fov": node.fov, "size": node.size,
				"near": node.near, "far": node.far, "current": node.current})
		if node is Light3D:
			record.merge({"energy": node.light_energy, "color": str(node.light_color),
				"shadow": node.shadow_enabled, "cullMask": node.light_cull_mask})
		if node is MeshInstance3D:
			record.merge({"meshId": _id(node.mesh), "meshRid": str(node.mesh.get_rid()),
				"materialOverride": _id(node.material_override), "surfaceMaterials": []})
			for surface in range(node.mesh.get_surface_count()):
				record.surfaceMaterials.append(_id(node.mesh.surface_get_material(surface)))
		if node is WorldEnvironment:
			record["environmentId"] = _id(node.environment)
			record["environment"] = {"backgroundMode": node.environment.background_mode,
				"backgroundColor": str(node.environment.background_color), "ambientColor": str(node.environment.ambient_light_color),
				"ambientEnergy": node.environment.ambient_light_energy, "ambientSource": node.environment.ambient_light_source}
		result.nodes.append(record)
	return result

func _all_views() -> Array:
	var base: Array = scene.renderer.get("views")
	var diagnostic: Variant = scene.renderer.get("diag_views")
	_check(base.size() == 2, "two original baseline views retained")
	_check(diagnostic is Array and diagnostic.size() == 2, "two diagnostic views exist")
	var result := base.duplicate()
	if diagnostic is Array: result.append_array(diagnostic)
	return result

func _resources(views: Array) -> Array:
	var result: Array = []
	for view in views:
		var material := view.material as ShaderMaterial
		result.append({"view": _id(view), "texture": _id(view.texture), "textureRid": str(view.texture.get_rid()),
			"material": _id(view.material), "shader": _id(material.shader) if material else "none"})
	return result

func _uniforms(views: Array) -> Array:
	var result: Array = []
	for index in range(2, views.size()):
		var material := views[index].material as ShaderMaterial
		var values: Dictionary = {}
		if material and material.shader:
			for uniform in material.shader.get_shader_uniform_list():
				values[str(uniform.name)] = material.get_shader_parameter(uniform.name)
		result.append(values)
	return result

func _defaults() -> void:
	var state: Dictionary = scene.get_test_state()
	_check(state.results == initial_results, "all manual result records unchanged")
	for value in state.results.values():
		_check(value == scene.store.defaults, "manual visual/interaction/smoothness remain untested")

func _layout() -> void:
	var bounds := Rect2(Vector2.ZERO, Vector2(canvas_size))
	var nodes: Array = []
	_walk(scene, nodes)
	for node in nodes:
		if node is BaseButton and node.is_visible_in_tree():
			_check(bounds.encloses(node.get_global_rect()), "button/menu box inside viewport: " + str(node.get_path()))
	for node in [scene.heading, scene.identity, scene.status, scene.instruction, scene.expected]:
		_check(bounds.encloses(node.get_global_rect()), "primary text inside viewport: " + str(node.get_path()))
	for view in _all_views():
		_check(bounds.encloses(view.get_global_rect()), "display window inside viewport: " + str(view.get_path()))

func _sample(image: Image, point: Vector2) -> Dictionary:
	var pixel := Vector2i(int(point.x), int(point.y))
	if pixel.x < 0 or pixel.y < 0 or pixel.x >= image.get_width() or pixel.y >= image.get_height():
		_check(false, "screenshot sample inside image")
		return {"pixel": [pixel.x, pixel.y], "outOfBounds": true}
	var color := image.get_pixelv(pixel)
	return {"pixel": [pixel.x, pixel.y], "rgba": [color.r, color.g, color.b, color.a]}

func _capture(mode: int, views: Array) -> Dictionary:
	# The only readback in this harness: external root screenshot, never source texture.
	var image := viewport.get_texture().get_image()
	var file := destination.path_join("mode-%d.png" % mode)
	_check(image != null and not image.is_empty(), "root screenshot available")
	if image == null or image.is_empty(): return {}
	_check(image.save_png(file) == OK, "saved root screenshot mode " + str(mode))
	var samples: Array = []
	for index in range(views.size()):
		var rect: Rect2 = views[index].get_global_rect()
		var bands: Array = []
		for band in range(4):
			bands.append(_sample(image, rect.position + rect.size * Vector2((float(band) + .5) / 4.0, .88)))
		samples.append({"index": index, "role": "baseline" if index < 2 else "diagnostic",
			"globalRect": _rect(rect), "center": _sample(image, rect.get_center()),
			"fourBandSamples": bands, "bandUVs": [[.125,.88],[.375,.88],[.625,.88],[.875,.88]]})
	return {"path": file, "windows": samples, "pixelMeaning": "root screenshot RGB only; no source-alpha or GLX verdict"}

func _run() -> void:
	var version := Engine.get_version_info()
	_check(int(version.major) == 4 and int(version.minor) == 7 and int(version.patch) == 2, "native Godot version exactly 4.7.2")
	_check(not OS.has_feature("web"), "native runtime required")
	_check(canvas_size == Vector2i(720,1540) or canvas_size == Vector2i(720,1160), "supported requested canvas size")
	if DisplayServer.get_name() == "headless":
		_check(false, "graphical runtime required; headless has no frame_post_draw evidence")
		_finish()
		return
	viewport = SubViewport.new()
	viewport.size = canvas_size
	viewport.own_world_3d = true
	viewport.gui_embed_subwindows = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	var packed := load("res://main.tscn") as PackedScene
	if packed == null:
		_check(false, "main scene loads")
		_finish()
		return
	scene = packed.instantiate()
	viewport.add_child(scene)
	scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	while scene.transition_phase != "ready":
		await _draws(1)
		if finished: return
	initial_results = scene.get_test_state().results.duplicate(true)
	_check(scene.steps.size() == 8, "eight-step catalog retained")
	_check(scene.steps.size() > 3 and scene.steps[3].id == "D15-alpha", "fourth step is D15-alpha")
	await scene.select_step(3)
	await _draws(3)
	if finished: return
	_check(scene.selected_index == 3 and scene.transition_phase == "ready", "only fourth step selected after startup")
	var timings: Dictionary = scene.get_test_state().currentTimings
	_check(timings.preparationFrameCallbackTicksUsec <= timings.constructionBeginTicksUsec, "real preparation frame precedes build")
	_check(timings.resourcesCreatedTicksUsec <= timings.firstFrameCallbackTicksUsec, "real frame callback follows resources")
	if not _act("pause_source"):
		_finish()
		return
	await _draws(2)
	baseline_state = _snapshot()
	_check(baseline_state.get("side_running", [true])[0] == false, "source rotation paused")
	source_baseline = _source()
	_check(source_baseline.get("size", []) == [320,260], "source size remains 320x260")
	_check(source_baseline.get("updateMode", -1) == SubViewport.UPDATE_ALWAYS, "paused source still UPDATE_ALWAYS")
	var views := _all_views()
	resource_baseline = _resources(views)
	_check(views.size() == 4, "four final displays")
	if views.size() != 4:
		_finish()
		return
	for view in views:
		_check(view.texture == views[0].texture and view.texture.get_rid() == views[0].texture.get_rid(), "all four views share same texture object and RID")
	_check(views[0].material == null, "left baseline retains default material")
	var right_material := views[1].material as ShaderMaterial
	_check(right_material != null and right_material.shader.code.contains("render_mode blend_disabled;"), "right baseline retains blend_disabled shader")
	var prior_uniforms: Array = []
	for mode in range(4):
		await _draws(3)
		if finished: return
		var state := _snapshot()
		var diagnostic: Dictionary = state.get("alphaMixDiagnostic", {})
		_check(int(diagnostic.get("modeIndex", -1)) == mode, "mode index " + str(mode))
		_check(not str(diagnostic.get("modeName", "")).is_empty(), "mode name present " + str(mode))
		_check(_source() == source_baseline, "source camera/model/light/viewport unchanged in mode " + str(mode))
		_check(state.get("cube_rotations", []) == baseline_state.get("cube_rotations", []), "rotation remains paused mode " + str(mode))
		_check(_resources(views) == resource_baseline, "all texture/material/shader instances stable mode " + str(mode))
		var uniforms := _uniforms(views)
		_check(uniforms.size() == 2 and not uniforms[0].is_empty() and not uniforms[1].is_empty(), "both diagnostic materials expose uniforms")
		for index in range(uniforms.size()):
			_check(int(uniforms[index].get("observation_mode", -1)) == mode, "public material mode uniform " + str(index))
			_check(uniforms[index].get("software_reference", null) == (index == 1), "software reference enabled on DISABLED only")
		var state_materials: Array = diagnostic.get("materials", [])
		_check(state_materials.size() == 2, "public diagnostic state records both materials")
		for index in range(mini(state_materials.size(), 2)):
			_check(state_materials[index].get("instanceId", null) is String, "material instance ID serialized as string")
			_check(state_materials[index].get("shaderId", null) is String, "shader instance ID serialized as string")
			_check(state_materials[index].get("instanceId", "") == _id(views[index + 2].material), "state material ID matches public object")
			_check(state_materials[index].get("shaderId", "") == _id(views[index + 2].material.shader), "state shader ID matches public object")
		if mode > 0: _check(uniforms != prior_uniforms, "diagnostic uniform values change mode " + str(mode))
		prior_uniforms = uniforms.duplicate(true)
		_defaults()
		_layout()
		entries.append({"mode": mode, "state": state, "uniforms": uniforms, "resources": _resources(views), "screenshot": _capture(mode, views)})
		if mode < 3 and not _act("case4_mode_next"): break
	# Check the directory popup's actual embedded Window bounds after opening.
	scene.directory.show_popup()
	await _draws(2)
	if finished: return
	var popup: PopupMenu = scene.directory.get_popup()
	_check(Rect2(Vector2.ZERO, Vector2(canvas_size)).encloses(Rect2(Vector2(popup.position), Vector2(popup.size))), "opened directory popup inside viewport")
	popup.hide()
	_defaults()
	# A fourth action must wrap to pass-through without replacing materials.
	if _act("case4_mode_next"):
		_check(int(_snapshot().get("alphaMixDiagnostic", {}).get("modeIndex", -1)) == 0, "mode action cycles back to zero")
		_check(_resources(views) == resource_baseline, "resources stable after complete mode cycle")
	_finish()

func _finish() -> void:
	if finished: return
	finished = true
	var report := {"scope": "external native Godot 4.7.2 graphical case4 harness only",
		"outcome": "PASS" if failures.is_empty() else "FAIL", "failures": failures,
		"engineVersion": Engine.get_version_info(), "displayServer": DisplayServer.get_name(),
		"viewport": [canvas_size.x, canvas_size.y], "entries": entries,
		"sourceBaseline": source_baseline, "resourceBaseline": resource_baseline,
		"elapsedUsecIncludingHarness": Time.get_ticks_usec() - started,
		"input": "public Button.pressed signal emission; not real touch",
		"screenshotPolicy": "external root screenshots only; production candidate performs no GPU readback",
		"webglPassed": false, "glxPassed": false, "phoneTested": false,
		"visualPassAutomatic": false, "sourceAlphaProven": false, "engineRebuilt": false,
		"calibrationScope": "known white source RGB contribution over local black only; destination RGB term and alpha factors are not verified",
		"interpretation": "mode0/1 samples are native screenshot evidence only; exact visual review is manual"}
	var file := FileAccess.open(destination.path_join("RESULT.json"), FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(report, "\t"))
		file.close()
	else:
		push_error("Cannot save RESULT.json")
	quit(0 if failures.is_empty() else 2)
