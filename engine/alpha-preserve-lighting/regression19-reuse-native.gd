# Desktop-only screenshot/structure check. Never copied into the phone PCK.
extends SceneTree
var failures: Array[String] = []
var output := ""
var references := false
var baseline: Dictionary = {}
var repeated: Array = []
var prior_ids: Dictionary = {}
var prior_state: Dictionary = {}
var visual_comparisons: Array = []
var report: Array = []

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--reg19-output="): output = arg.trim_prefix("--reg19-output=")
		if arg == "--reg19-references": references = true
	run.call_deferred()

func require(value: bool, reason: String) -> void:
	if not value: failures.append(reason)

func baseline_parameters(key: String) -> Dictionary:
	for row in baseline.states:
		if row.key == key: return row.parameters
	return {}

func resource_ids(r: Node) -> Dictionary:
	return {"cubeNodes":r.cubes.map(func(c): return c.get_instance_id()),"cubeMaterials":r.cubes.map(func(c): return c.material_override.get_instance_id()),"worlds":r.worlds.map(func(v): return v.get_instance_id()),"views":r.views.map(func(v): return v.get_instance_id()),"textures":r.views.map(func(v): return v.texture.get_instance_id()),"front":r.front_sheet.get_instance_id() if is_instance_valid(r.front_sheet) else 0}

func check_transition(main: Node, key: String) -> void:
	var r = main.renderer
	var values: Dictionary = r.inspect_scene()
	# Serialized properties are compared exactly by the Node audit. Comparing a live
	# float with a previously JSON-rounded float here incorrectly flags unchanged lights.
	var ids := resource_ids(r)
	var state: Dictionary = main.states[main.current_index]
	if main.last_transition.resourceAction == "parameter_update":
		require(ids == prior_ids, "mesh/material/viewport/texture recreated: "+key)
		require(prior_state.group == state.group and prior_state.kind == state.kind, "cross-page/topology reuse: "+key)
	if r.light_pool.size():
		for light in r.light_pool.values():
			if not light in r.active_lights: require(not light.visible and not light.shadow_enabled, "inactive light affects scene: "+key)
	require(r.light_pool.size() <= 4 and r.red_materials.size() <= 2, "resource bound: "+key)
	require(not main.last_transition.startupPrewarm, "no eager startup creation")
	prior_ids = ids
	prior_state = state

func compare_reference(actual: Image, key: String) -> void:
	var expected := Image.load_from_file(ProjectSettings.globalize_path("res://references/"+key.replace("/", "-")+".png"))
	require(expected != null and expected.get_size() == actual.get_size(), "reference size "+key)
	if expected == null or expected.get_size() != actual.get_size(): return
	expected.convert(Image.FORMAT_RGBA8)
	actual.convert(Image.FORMAT_RGBA8)
	var a := actual.get_data()
	var b := expected.get_data()
	var total := 0
	var changed := 0
	var maximum := 0
	for i in range(a.size()):
		var difference: int = absi(int(a[i])-int(b[i]))
		total += difference
		if difference: changed += 1
		maximum = maxi(maximum, difference)
	var mae := float(total)/a.size()
	visual_comparisons.append({"key":key,"rgbaMeanAbsoluteByteDifference":mae,"changedChannelFraction":float(changed)/a.size(),"maximumByteDifference":maximum,"exactPixels":a==b,"source":"previous native same-state live-area reference; not phone evidence"})
	require(a == b, "native live pixels differ: "+key+" MAE="+str(mae))

func run() -> void:
	if output.is_empty():
		push_error("Missing --reg19-output")
		quit(2)
		return
	var packed = load("res://regression19-main.tscn")
	if packed == null:
		quit(2)
		return
	var main = packed.instantiate()
	root.add_child(main)
	await process_frame
	require(main.states.size() == 19, "expected 19 states")
	require(main.catalog.groups.size() == 8, "expected 8 pages")
	var buttons: Array = []
	for child in main.get_children():
		if child is Button and child.visible: buttons.append(child)
	require(buttons.size() == 3, "exactly 3 visible buttons")
	var previous_shadow: Dictionary = {}
	baseline = JSON.parse_string(FileAccess.get_file_as_string(output.path_join("native-verify.json")))
	for i in range(main.states.size()):
		await main.select_state(i)
		await RenderingServer.frame_post_draw
		var state: Dictionary = main.states[i]
		var key: String = state.key
		require(main.state_ready and not main.switching, "ready "+key)
		require(main.current_index == i, "selected "+key)
		var r = main.renderer
		var values: Dictionary = r.inspect_scene()
		check_transition(main, key)
		require(r.worlds.size() <= 1, "one source viewport "+key)
		if state.kind == "red":
			require(is_equal_approx(r.front_sheet.material_override.albedo_color.a,1.0 if state.opaque else .48), "red alpha "+key)
			require(r.front_sheet.material_override.transparency == (0 if state.opaque else 1), "red queue "+key)
		if state.kind == "gradient":
			require(r.samples.size() == 5, "five gradient samples")
			for j in range(5):
				require(is_equal_approx(r.samples[j].material_override.albedo_color.a,[0.0,.25,.48,.75,1.0][j]), "gradient value "+str(j))
				require(r.samples[j].material_override.transparency == 1, "gradient queue "+str(j))
		if state.kind in ["offscreen","shadow","lights","background"]:
			require(r.views.size() == 2 and values.sameTextureObject, "same source texture "+key)
			require(r.views[0].material == null, "original MIX "+key)
			require(r.views[1].material.shader.resource_path == "res://display_ignore_alpha.gdshader", "no-blend reference "+key)
		if state.kind == "shadow":
			require(r.active_lights[0].shadow_enabled == state.shadow, "shadow switch "+key)
			var shape := {"camera":str(r.worlds[0].get_camera_3d().transform),"cube":str(r.cubes[0].transform),"light":str(r.active_lights[0].transform),"size":str(r.worlds[0].size)}
			if state.shadow: require(shape == previous_shadow, "shadow stage geometry/camera changed")
			else: previous_shadow = shape
		if state.kind == "background": require(r.worlds[0].transparent_bg == state.transparent, "transparent background "+key)
		if state.kind == "fade":
			require(r.views.size() == 3 and values.sameTextureObject, "fade same texture")
			for j in range(3):
				var alpha: float = [1.0,.5,0.0][j]
				require(is_equal_approx(r.views[j].self_modulate.a,alpha if state.target == "self" else 1.0), "fade self "+key+str(j))
				require(is_equal_approx(r.fade_groups[j].modulate.a,alpha if state.target == "parent" else 1.0), "fade parent "+key+str(j))
		if state.kind == "scissor": require(is_equal_approx(r.front_sheet.material_override.alpha_scissor_threshold,state.threshold), "scissor threshold "+key)
		if state.kind == "custom":
			require(r.cubes.size() == 2, "two custom material samples")
			require(not "ALPHA =" in r.cubes[0].material_override.shader.code, "opaque shader does not use ALPHA")
			require("ALPHA = 0.48;" in r.cubes[1].material_override.shader.code, "transparent shader uses .48")
			require(r.active_lights.size() == (1 if state.light == "directional1" else 2), "custom light count "+key)
			for light in r.active_lights: require(light.shadow_enabled == state.shadow, "custom shadow "+key)
		if not references: require(main.reference.texture != null, "exact reference exists "+key)
		var image := root.get_texture().get_image()
		var ratio: Vector2 = Vector2(image.get_size()) / root.get_visible_rect().size
		var rect: Rect2 = main.stage.get_global_rect()
		var crop := Rect2i(Vector2i(rect.position*ratio),Vector2i(rect.size*ratio))
		require(Rect2i(Vector2i.ZERO,image.get_size()).encloses(crop), "reference crop within actual screenshot "+key)
		var name: String = key.replace("/","-")
		compare_reference(image.get_region(crop), key)
		require(image.get_region(crop).save_png(output.path_join("reuse-live-"+name+".png")) == OK, "save live crop "+key)
		require(image.save_png(output.path_join(("reference-" if references else "reuse-layout-")+name+".png")) == OK, "save screenshot "+key)
		if references:
			require(image.get_region(crop).save_png("res://references/"+name+".png") == OK, "save reference "+key)
		require(main.status_label.get_global_rect().end.y <= main.previous_button.get_global_rect().position.y, "status/button overlap "+key)
		for control in [main.title_label,main.phase_label,main.goal_label,main.reference,main.previous_button,main.phase_button,main.next_button]:
			require(root.get_visible_rect().encloses(control.get_global_rect()), "control outside screen "+key)
		report.append({"key":key,"parameters":values,"transition":main.last_transition.duplicate(true),"constructionUsec":main.construction_usec,"firstCallbackUsec":main.first_callback_usec,"referenceCrop":[crop.position.x,crop.position.y,crop.size.x,crop.size.y],"nativeVisual":"requires image review","phoneGLX":"NOT_RUN"})
	# Revisit all pages, reverse each page, then wrap using the actual phase button.
	# This checks reset symmetry, resource retention and bounded cleanup, not phone speed.
	for page_index in range(8):
		var indices: Array[int] = []
		for i in range(main.states.size()):
			if main.states[i].page == page_index: indices.append(i)
		indices.reverse()
		for index in indices:
			await main.select_state(index)
			await RenderingServer.frame_post_draw
			check_transition(main, main.states[index].key)
			var repeat_image := root.get_texture().get_image()
			var repeat_ratio: Vector2 = Vector2(repeat_image.get_size()) / root.get_visible_rect().size
			var repeat_rect: Rect2 = main.stage.get_global_rect()
			compare_reference(repeat_image.get_region(Rect2i(Vector2i(repeat_rect.position*repeat_ratio),Vector2i(repeat_rect.size*repeat_ratio))), main.states[index].key)
			require(not main.last_transition.firstStateVisit, "repeat logged as first visit")
			repeated.append({"key":main.states[index].key,"parameters":main.renderer.inspect_scene(),"transition":main.last_transition.duplicate(true)})
		main.phase_button.pressed.emit()
		while main.switching: await process_frame
		check_transition(main, main.states[main.current_index].key)
		repeated.append({"key":main.states[main.current_index].key,"parameters":main.renderer.inspect_scene(),"button":"phase","transition":main.last_transition.duplicate(true)})
	await main.select_state(0)
	main.phase_button.pressed.emit()
	while main.switching: await process_frame
	require(main.states[main.current_index].key == "R01/transparent48", "phase button connection")
	main.next_button.pressed.emit()
	while main.switching: await process_frame
	require(main.states[main.current_index].key == "R02/gradient", "next button connection")
	main.previous_button.pressed.emit()
	while main.switching: await process_frame
	require(main.states[main.current_index].key == "R01/opaque", "previous button connection")
	var held: int = main.current_index
	for unused in range(30): await process_frame
	require(main.current_index == held, "manual hold")
	var result := {"schema":"regression19-native-check-v1","toolMode":"resource-reuse-verify","engine":Engine.get_version_info().string,"renderingMethod":RenderingServer.get_current_rendering_method(),"states":report,"repeatedTransitions":repeated,"visualComparisons":visual_comparisons,"failures":failures,"visualPassNotInferred":true,"phone":"NOT_RUN"}
	var file := FileAccess.open(output.path_join("native-reuse-verify.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(result,"  "))
	print("[REG19_NATIVE_RESULT] "+JSON.stringify({"states":report.size(),"failures":failures,"phone":"NOT_RUN"}))
	main.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)
