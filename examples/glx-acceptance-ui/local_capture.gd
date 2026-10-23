extends SceneTree


func _initialize() -> void:
	root.hide()
	_capture.call_deferred()


func _rect(control: Control) -> Dictionary:
	var area := control.get_global_rect()
	return {"x": area.position.x, "y": area.position.y, "width": area.size.x, "height": area.size.y}


func _capture() -> void:
	var output := ""
	var width := 720
	var height := 1558
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-out="):
			output = argument.trim_prefix("--capture-out=")
		elif argument.begins_with("--capture-width="):
			width = int(argument.trim_prefix("--capture-width="))
		elif argument.begins_with("--capture-height="):
			height = int(argument.trim_prefix("--capture-height="))
	if not output.is_absolute_path() or FileAccess.file_exists(output) or FileAccess.file_exists(output + ".json") or width <= 0 or height <= 0:
		push_error("Use a new absolute --capture-out=PNG path and positive dimensions")
		quit(2)
		return
	var target := SubViewport.new()
	target.size = Vector2i(width, height)
	target.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(target)
	var packed: PackedScene = load("res://main.tscn")
	var scene: Control = packed.instantiate()
	target.add_child(scene)
	scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for index in range(12):
		await process_frame
	await RenderingServer.frame_post_draw
	var image := target.get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(output.get_base_dir())
	var saved := image.save_png(output)
	var diagnostics := scene.find_child("ReadDiagnostic", true, false) as Control
	var direct := scene.find_child("DirectPattern", true, false) as Control
	var offscreen := scene.find_child("OffscreenTexture", true, false) as Control
	var scroll := scene.find_child("ContentScroll", true, false) as Control
	var report := {"scope": "native local UI layout only; no WeChat/GLX acceptance", "saved": saved,
		"size": [width, height], "safe_layout": scene.get("last_layout"), "diagnostic_button": _rect(diagnostics),
		"direct_pattern": _rect(direct), "offscreen_pattern": _rect(offscreen), "content_scroll": _rect(scroll)}
	var report_file := FileAccess.open(output + ".json", FileAccess.WRITE)
	if report_file != null:
		report_file.store_string(JSON.stringify(report, "  "))
	print("[ACCEPTANCE_LOCAL_CAPTURE] " + JSON.stringify(report))
	quit(0 if saved == OK else 1)
