extends SceneTree
## Instantiate existing local Controls only; no task, export or conversion action.
func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var original := FileAccess.get_file_as_string("res://local-config.json")
	var panel: Control = load("res://addons/wxslim_readonly/panel.gd").new()
	root.add_child(panel)
	await process_frame
	var checks: Array = []
	checks.append(panel._official_skip_prewarm.disabled and not panel._official_skip_prewarm.button_pressed)
	checks.append(panel._official_prewarm_note.text.contains("PCK"))
	checks.append(panel._official_profile.get_selected_metadata() == "full-official-c050-dev")
	for i in range(panel._official_profile.item_count):
		panel._official_profile.select(i)
		panel._official_profile.item_selected.emit(i)
		checks.append(panel._official_skip_prewarm.disabled and not panel._official_skip_prewarm.button_pressed)
	checks.append(panel._job.is_empty() and panel._control_job.is_empty())
	checks.append(FileAccess.get_file_as_string("res://local-config.json") == original)
	panel.queue_free()
	await process_frame
	var ok := not checks.has(false)
	print(JSON.stringify({"status": "PASS_REAL_CONTROLS_ONLY" if ok else "FAILED", "checks": checks.size(), "passed": checks.count(true), "taskExecuted": false, "engineBuilt": false, "phone": "NOT_RUN"}))
	quit(0 if ok else 1)
