# Desktop-only screenshot/structure check. Never copied into the phone PCK.
extends SceneTree
var failures: Array[String] = []
var output := ""
var references := false
var report: Array = []

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--reg19-output="): output = arg.trim_prefix("--reg19-output=")
		if arg == "--reg19-references": references = true
	run.call_deferred()

func require(value: bool, reason: String) -> void:
	if not value: failures.append(reason)

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
	for i in range(main.states.size()):
		await main.select_state(i)
		await RenderingServer.frame_post_draw
		var state: Dictionary = main.states[i]
		var key: String = state.key
		require(main.state_ready and not main.switching, "ready "+key)
		require(main.current_index == i, "selected "+key)
		var r = main.renderer
		var values: Dictionary = r.inspect_scene()
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
		require(image.save_png(output.path_join(("reference-" if references else "layout-")+name+".png")) == OK, "save screenshot "+key)
		if references:
			require(image.get_region(crop).save_png("res://references/"+name+".png") == OK, "save reference "+key)
		require(main.status_label.get_global_rect().end.y <= main.previous_button.get_global_rect().position.y, "status/button overlap "+key)
		for control in [main.title_label,main.phase_label,main.goal_label,main.reference,main.previous_button,main.phase_button,main.next_button]:
			require(root.get_visible_rect().encloses(control.get_global_rect()), "control outside screen "+key)
		report.append({"key":key,"parameters":values,"constructionUsec":main.construction_usec,"firstCallbackUsec":main.first_callback_usec,"referenceCrop":[crop.position.x,crop.position.y,crop.size.x,crop.size.y],"nativeVisual":"requires image review","phoneGLX":"NOT_RUN"})
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
	var result := {"schema":"regression19-native-check-v1","toolMode":"references" if references else "verify","engine":Engine.get_version_info().string,"renderingMethod":RenderingServer.get_current_rendering_method(),"states":report,"failures":failures,"visualPassNotInferred":true,"phone":"NOT_RUN"}
	var file := FileAccess.open(output.path_join("native-"+("references" if references else "verify")+".json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(result,"  "))
	print("[REG19_NATIVE_RESULT] "+JSON.stringify({"states":report.size(),"failures":failures,"phone":"NOT_RUN"}))
	main.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)
