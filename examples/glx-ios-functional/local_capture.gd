extends SceneTree

func _initialize() -> void:
	root.hide()
	_capture.call_deferred()

func _capture() -> void:
	var output := ""
	var page := 0
	var action := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-out="): output = arg.trim_prefix("--capture-out=")
		if arg.begins_with("--capture-page="): page = int(arg.trim_prefix("--capture-page="))
		if arg.begins_with("--capture-action="): action = arg.trim_prefix("--capture-action=")
	if not output.is_absolute_path() or FileAccess.file_exists(output) or page < 0 or page > 8:
		push_error("Use a new absolute --capture-out path and --capture-page=0..8")
		quit(2)
		return
	var target := SubViewport.new()
	target.size = Vector2i(720, 1558)
	target.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(target)
	var packed: PackedScene = load("res://main.tscn")
	var scene: Control = packed.instantiate()
	target.add_child(scene)
	scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scene.call("_open_page", page)
	match action:
		"resize": scene.call("_resize_nine")
		"texture": scene.call("_texture_nine")
		"switch": scene.call("_toggle_view")
		"exit": scene.call("_reenter")
		"reenter":
			scene.call("_reenter")
			await process_frame
			scene.call("_reenter")
	# Exercise operations while preserving manual acceptance boundaries.
	for state in scene.get("states"):
		assert(state == "未确认", "Capture operations must not auto-pass any page")
	for i in range(12): await process_frame
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(output.get_base_dir())
	var result := target.get_texture().get_image().save_png(output)
	print("[IOS_FUNCTIONAL_CAPTURE] " + JSON.stringify({"page": page, "action": action, "result": result, "scope": "native desktop only; no iOS acceptance"}))
	quit(0 if result == OK else 1)
