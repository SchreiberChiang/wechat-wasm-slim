extends SceneTree

# Desktop-only structural/action harness. This file is excluded from exports.
# Programmatic signals and property assignments are never described as touches.
var out_dir := ""
var scene: Control
var viewport: SubViewport
var began_usec := 0
var step_draw_start := 0
var draw_count := 0
var step_pending := false
var finished := false
var current_index := -1
var failures: Array = []
var samples: Array = []
var viewport_size := Vector2i(720, 1558)
var check_details_open := false
var preparation_captures: Dictionary = {}
var routing_only := false
var report: Dictionary = {"kind": "native_graphical_harness", "phoneValidation": false, "webglValidation": false, "glxValidation": false, "humanJudgment": false, "inputMethod": "programmatic Button.pressed.emit / Slider.value / registered exercise_action", "limits": {"totalSeconds": 180, "drawsPerStep": 180}, "notTested": ["real mouse/touch", "real host hide/show", "120-second observation", "requested two-second manual recreation pause", "phone", "WebGL", "GLX", "subjective image or smoothness acceptance"]}

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			out_dir = arg.substr(6).replace("\\", "/")
		elif arg.begins_with("--size="):
			var dimensions := arg.substr(7).split("x")
			if dimensions.size() == 2:
				viewport_size = Vector2i(int(dimensions[0]), int(dimensions[1]))
		elif arg == "--details-open":
			check_details_open = true
		elif arg == "--routing-only":
			routing_only = true
	if out_dir.is_empty() or not out_dir.is_absolute_path() or DirAccess.dir_exists_absolute(out_dir) or FileAccess.file_exists(out_dir):
		printerr("HARNESS FAIL: --out must name a new absolute directory; no existing files will be overwritten")
		quit(2)
		return
	var error := DirAccess.make_dir_recursive_absolute(out_dir)
	if error != OK:
		printerr("HARNESS FAIL: cannot create new output directory: ", error)
		quit(2)
		return
	began_usec = Time.get_ticks_usec()
	RenderingServer.frame_post_draw.connect(_on_draw)
	call_deferred("_run")

func _process(_delta: float) -> bool:
	if not finished and began_usec > 0:
		if Time.get_ticks_usec() - began_usec > 180000000:
			_fail("global_timeout", {"phase": _phase()})
			_finish()
		elif step_pending and draw_count - step_draw_start > 180:
			_fail("step_draw_timeout", {"stepIndex": current_index, "phase": _phase(), "draws": draw_count - step_draw_start})
			_finish()
	return false

func _on_draw() -> void:
	draw_count += 1
	# Connected before main's awaits: this reads the actual preparation frame
	# before the production coroutine resumes construction. Adds no production wait.
	if not finished and is_instance_valid(scene) and is_instance_valid(viewport) and scene.transition_phase == "preparation" and not preparation_captures.has(scene.transition_id):
		var start := Time.get_ticks_usec()
		var transition: int = scene.transition_id
		preparation_captures[transition] = {"phaseAtReadback": scene.transition_phase, "transitionId": transition, "stepIndex": scene.selected_index, "draw": draw_count, "screenshot": _capture("prepare-transition-%03d" % transition), "readbackBeginTicksUsec": start, "readbackEndTicksUsec": Time.get_ticks_usec(), "instrumentationNote": "native screenshot readback inside preparation callback may increase observed preparation wait; not a performance baseline"}

func _phase() -> String:
	return str(scene.get_test_state().get("phase", "unavailable")) if is_instance_valid(scene) else "scene_unavailable"

func _run() -> void:
	if DisplayServer.get_name() == "headless":
		_fail("graphical_display_required", {"display": DisplayServer.get_name()})
		_finish()
		return
	root.hide()
	viewport = SubViewport.new()
	viewport.name = "NativeHarnessViewport"
	viewport.size = viewport_size
	viewport.own_world_3d = true
	viewport.gui_embed_subwindows = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	var packed: PackedScene = load("res://main.tscn")
	if packed == null:
		_fail("main_scene_load_failed", {})
		_finish()
		return
	scene = packed.instantiate()
	viewport.add_child(scene)
	scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	report["display"] = DisplayServer.get_name()
	report["renderingMethod"] = RenderingServer.get_current_rendering_method()
	report["viewport"] = [viewport_size.x, viewport_size.y]
	report["detailsOpenLayoutTest"] = check_details_open
	report["sceneViewportNote"] = "main uses this native harness viewport; its direct 3D is not redirected into a renderer-created offscreen viewport"
	step_pending = true
	step_draw_start = draw_count
	await _await_ready()
	if finished:
		return
	await _test_navigation_input_routing()
	await _test_directory_popup_layout()
	if finished:
		return
	step_pending = false
	if routing_only:
		_finish()
		return
	for index in scene.steps.size():
		if finished:
			return
		current_index = index
		step_draw_start = draw_count
		step_pending = true
		await scene.select_step(index)
		if finished:
			return
		_check(scene.transition_phase == "ready", "step_not_ready", {"index": index, "phase": scene.transition_phase})
		if scene.transition_phase != "ready":
			_finish()
			return
		await RenderingServer.frame_post_draw
		_check_timing(scene.get_test_state().currentTimings)
		_check_defaults("after_build")
		var entry := {"stepIndex": index, "stepId": scene.steps[index].id, "builtState": _snapshot(), "layoutRects": _check_layout(), "actions": []}
		entry["builtScreenshot"] = _capture("%02d-built" % (index + 1))
		_check(preparation_captures.has(scene.transition_id), "preparation_frame_not_captured", {"transitionId": scene.transition_id})
		if check_details_open:
			scene.detail_toggle.button_pressed = true
			await RenderingServer.frame_post_draw
			entry["detailsOpenLayoutRects"] = _check_layout()
			entry["detailsOpenScreenshot"] = _capture("%02d-details-open" % (index + 1))
			scene.detail_toggle.button_pressed = false
		var ids: Array = scene.renderer.get_state().action_ids.duplicate()
		if scene.steps[index].id == "S03-recreate":
			var old_transition: int = scene.transition_id
			_act("recreate_content")
			_check(scene.renderer.get_state().get("last_action") == "content_recreate_refused", "recreate_without_clear_not_refused", {})
			_check(scene.transition_id == old_transition, "refused_recreate_started_transition", {})
			entry["recreateBeforeClear"] = _snapshot()
			ids.erase("clear_content")
			ids.erase("recreate_content")
		for id in ids:
			var action_before: int = scene.renderer.event_count
			var method := _act(str(id))
			await RenderingServer.frame_post_draw
			_check(scene.renderer.event_count > action_before, "action_produced_no_operation", {"id": id})
			entry.actions.append({"actionId": id, "method": method, "state": _snapshot(), "screenshot": _capture("%02d-action-%s" % [index + 1, id])})
			_check_defaults("after_action_" + str(id))
		if scene.steps[index].id == "S03-recreate":
			_act("clear_content")
			await RenderingServer.frame_post_draw
			_check(scene.renderer.cleared, "clear_did_not_clear", {})
			entry.actions.append({"actionId": "clear_content", "state": _snapshot(), "screenshot": _capture("20-cleared")})
			var before: int = scene.transition_id
			_act("recreate_content")
			_check(scene.transition_id > before, "recreate_transition_missing", {})
			_check(scene.transition_phase == "preparation", "recreate_did_not_begin_with_preparation", {"phase": scene.transition_phase})
			# No fake two-second wait: this verifies rebuild mechanics only.
			await _await_ready()
			if finished:
				return
			_check_timing(scene.get_test_state().currentTimings)
			_check(scene.renderer.recreate_count == 1, "recreate_count_incorrect", {"count": scene.renderer.recreate_count})
			await RenderingServer.frame_post_draw
			entry.actions.append({"actionId": "recreate_content", "state": _snapshot(), "screenshot": _capture("20-recreated")})
			_check_defaults("after_recreate")
		entry["finalState"] = _snapshot()
		samples.append(entry)
		step_pending = false
	await _verify_result_isolation()
	_finish()

func _await_ready() -> void:
	while not finished and scene.transition_phase != "ready":
		if scene.transition_phase == "build_failed":
			_fail("rebuild_failed", {})
			_finish()
			return
		await process_frame

func _test_navigation_input_routing() -> void:
	var nav: HBoxContainer = scene.directory.get_parent()
	var next: Button = nav.get_child(nav.get_child_count() - 1)
	var previous: Button = nav.get_child(0)
	var results: Array = []
	for pair in [[next, 1, "next"], [previous, 0, "previous"]]:
		var button: Button = pair[0]
		var target_index: int = pair[1]
		var route_name: String = pair[2]
		var center := button.get_global_rect().get_center()
		var before: int = scene.selected_index
		var motion := InputEventMouseMotion.new()
		motion.position = center
		motion.global_position = center
		viewport.push_input(motion, true)
		await process_frame
		var hovered: Control = viewport.gui_get_hovered_control()
		var hover_path := str(hovered.get_path()) if hovered != null else "none"
		var press := InputEventMouseButton.new()
		press.position = center
		press.global_position = center
		press.button_index = MOUSE_BUTTON_LEFT
		press.button_mask = MOUSE_BUTTON_MASK_LEFT
		press.pressed = true
		viewport.push_input(press, true)
		await process_frame
		var release := InputEventMouseButton.new()
		release.position = center
		release.global_position = center
		release.button_index = MOUSE_BUTTON_LEFT
		release.button_mask = 0
		release.pressed = false
		viewport.push_input(release, true)
		await process_frame
		await _await_ready()
		if finished:
			return
		await RenderingServer.frame_post_draw
		var entry := {"name": route_name, "method": "InputEventMouseMotion + InputEventMouseButton press/release via SubViewport.push_input(event,true); no signal emission", "buttonPath": str(button.get_path()), "buttonRect": button.get_global_rect(), "center": center, "hoveredControl": hover_path, "beforeIndex": before, "afterIndex": scene.selected_index, "expectedIndex": target_index, "phase": scene.transition_phase, "screenshot": _capture("routing-" + route_name), "state": _snapshot()}
		results.append(entry)
		_check(scene.selected_index == target_index, "gui_navigation_input_route_failed", entry)
	report["nativeGuiInputRouting"] = results

func _test_directory_popup_layout() -> void:
	var center: Vector2 = scene.directory.get_global_rect().get_center()
	var index_before: int = scene.selected_index
	var press_state: Dictionary = {}
	var motion := InputEventMouseMotion.new()
	motion.position = center
	motion.global_position = center
	# Deliberately no preparatory mouse motion: match first-touch semantics,
	# including release outside the expanded popup's list area.
	for down in [true, false]:
		var click := InputEventMouseButton.new()
		click.position = center
		click.global_position = center
		click.button_index = MOUSE_BUTTON_LEFT
		click.button_mask = MOUSE_BUTTON_MASK_LEFT if down else 0
		click.pressed = down
		viewport.push_input(click, true)
		await process_frame
		if down:
			var pressed_popup: PopupMenu = scene.directory.get_popup()
			press_state = {"popupVisible": pressed_popup.visible, "selectedIndex": scene.selected_index, "popupRect": Rect2(pressed_popup.position, pressed_popup.size)}
	await RenderingServer.frame_post_draw
	var popup: PopupMenu = scene.directory.get_popup()
	_check(popup.visible, "directory_popup_input_did_not_open", {})
	if not popup.visible:
		report["directoryPopupLayout"] = {"openedBy": "MouseButton press/release via viewport.push_input, without preliminary MouseMotion", "pressState": press_state, "visibleAfterRelease": false, "indexBefore": index_before, "indexAfterRelease": scene.selected_index, "note": "Popup closing after release may mean immediate item selection; no later hidden-popup click is counted as selection evidence", "screenshot": _capture("directory-popup-after-release")}
		return
	var safe: Dictionary = scene.safe_layout
	var safe_rect := Rect2(float(safe.left), float(safe.top), viewport_size.x - float(safe.left) - float(safe.right), viewport_size.y - float(safe.top) - float(safe.bottom))
	var popup_rect := Rect2(popup.position, popup.size)
	var panel := popup.get_theme_stylebox("panel")
	var content_rect := Rect2(popup_rect.position + Vector2(panel.get_margin(SIDE_LEFT), panel.get_margin(SIDE_TOP)), popup_rect.size - Vector2(panel.get_margin(SIDE_LEFT) + panel.get_margin(SIDE_RIGHT), panel.get_margin(SIDE_TOP) + panel.get_margin(SIDE_BOTTOM)))
	_check(safe_rect.grow(1).encloses(content_rect), "directory_popup_content_outside_safe_area", {"popupRect": popup_rect, "interactiveContentRect": content_rect, "safeRect": safe_rect})
	popup.set_focused_item(popup.item_count - 1)
	popup.scroll_to_item(popup.item_count - 1)
	await RenderingServer.frame_post_draw
	report["directoryPopupLayout"] = {"openedBy": "MouseButton press/release via viewport.push_input, without preliminary MouseMotion", "popupRect": popup_rect, "interactiveContentRect": content_rect, "placementPolicy": "unchanged OptionButton placement; noninteractive bottom panel inset reserves unsafe area", "safeRect": safe_rect, "maxSize": popup.max_size, "itemCount": popup.item_count, "focusedLastItem": popup.get_focused_item(), "lastItemScrolledBy": "public scroll_to_item API; not proof of touch selection", "screenshot": _capture("directory-popup-last-item")}
	var font := popup.get_theme_font("font")
	var row_height := font.get_height(popup.get_theme_font_size("font_size")) + popup.get_theme_constant("v_separation")
	var last_center := Vector2(popup.position) + Vector2(popup.size.x / 2.0, popup.size.y - panel.get_margin(SIDE_BOTTOM) - row_height / 2.0)
	var mouse_move := InputEventMouseMotion.new()
	mouse_move.position = last_center
	mouse_move.global_position = last_center
	viewport.push_input(mouse_move, true)
	await process_frame
	for down in [true, false]:
		var click := InputEventMouseButton.new()
		click.position = last_center
		click.global_position = last_center
		click.button_index = MOUSE_BUTTON_LEFT
		click.button_mask = MOUSE_BUTTON_MASK_LEFT if down else 0
		click.pressed = down
		viewport.push_input(click, true)
		await process_frame
	await _await_ready()
	_check(scene.selected_index == scene.steps.size() - 1, "directory_last_item_mouse_selection_failed", {"center": last_center, "selectedIndex": scene.selected_index})
	report.directoryPopupLayout["lastItemMouseCenter"] = last_center
	report.directoryPopupLayout["lastItemMouseSelectedIndex"] = scene.selected_index
	report.directoryPopupLayout["lastItemMouseSelectionMethod"] = "MouseMotion + MouseButton press/release through viewport.push_input; not a phone touch"

func _act(id: String) -> String:
	var mapping: Dictionary = scene.renderer.get_state().action_nodes
	var node: Node = get_root().get_node_or_null(NodePath(str(mapping.get(id, "")))) if mapping.has(id) else null
	if node is Button:
		node.pressed.emit()
		return "programmatic_Button.pressed.emit"
	if node is Slider:
		node.value = node.max_value if node.value < (node.min_value + node.max_value) / 2.0 else node.min_value
		return "programmatic_Slider.value"
	scene.renderer.exercise_action(id)
	return "registered_exercise_action_no_pointer_event"

func _check_defaults(where: String) -> void:
	for id in scene.store.results:
		_check(scene.store.results[id] == scene.store.defaults, "manual_defaults_changed_automatically", {"stepId": id, "where": where, "actual": scene.store.results[id]})

func _check_timing(timing: Dictionary) -> void:
	var markers := ["step_switch_begin", "preparation_visible_requested", "preparation_frame_callback", "resources_created", "first_frame_callback", "ready_for_observation"]
	var observed: Array = []
	for record in scene.records:
		if record.transitionId == timing.get("transitionId") and record.event in markers:
			observed.append(record.event)
	_check(observed == markers, "transition_marker_order_incorrect", {"transitionId": timing.get("transitionId"), "observed": observed, "expected": markers})
	var fields := ["beginTicksUsec", "preparationVisibleRequestedTicksUsec", "preparationFrameCallbackTicksUsec", "constructionBeginTicksUsec", "resourcesCreatedTicksUsec", "firstFrameCallbackTicksUsec"]
	var previous := -1
	for field in fields:
		_check(timing.has(field), "missing_timing", {"field": field, "timing": timing})
		var tick := int(timing.get(field, -1))
		_check(tick >= previous, "timing_order_incorrect", {"field": field, "timing": timing})
		previous = tick
	_check(int(timing.get("firstCallbackWaitUsec", -1)) == int(timing.get("firstFrameCallbackTicksUsec", 0)) - int(timing.get("resourcesCreatedTicksUsec", 0)), "callback_wait_incorrect", timing)
	_check(int(timing.get("constructionDurationUsec", -1)) == int(timing.get("resourcesCreatedTicksUsec", 0)) - int(timing.get("constructionBeginTicksUsec", 0)), "construction_duration_incorrect", timing)
	_check(int(timing.get("overallDurationUsec", -1)) == int(timing.get("firstFrameCallbackTicksUsec", 0)) - int(timing.get("beginTicksUsec", 0)), "overall_duration_incorrect", timing)

func _check_layout() -> Dictionary:
	var safe: Dictionary = scene.safe_layout
	var safe_rect := Rect2(float(safe.left), float(safe.top), viewport_size.x - float(safe.left) - float(safe.right), viewport_size.y - float(safe.top) - float(safe.bottom))
	var nodes := {"heading": scene.heading, "instruction": scene.instruction, "expected": scene.expected, "stage": scene.stage, "actions": scene.actions, "navigation": scene.directory.get_parent()}
	if scene.detail_scroll.visible:
		nodes["expandedDetails"] = scene.detail_scroll
	var rects := {"safeContent": safe_rect, "viewport": Rect2(Vector2.ZERO, viewport_size)}
	for name in nodes:
		var rect: Rect2 = nodes[name].get_global_rect()
		rects[name] = rect
		_check(safe_rect.grow(1).encloses(rect), "layout_outside_safe_content", {"control": name, "rect": rect, "safeRect": safe_rect})
	var stage_rect: Rect2 = rects.stage
	var nav_rect: Rect2 = rects.navigation
	_check(stage_rect.end.y <= nav_rect.position.y, "stage_overlaps_navigation", rects)
	for field in scene.result_buttons:
		var rect: Rect2 = scene.result_buttons[field].get_global_rect()
		rects["result_" + field] = rect
		_check(safe_rect.grow(1).encloses(rect), "result_outside_safe_content", {"field": field, "rect": rect})
	return rects

func _verify_result_isolation() -> void:
	var failures_before := failures.size()
	var before: Dictionary = scene.store.results.duplicate(true)
	_check(scene.set_result("visual", "看不清", "harness"), "harness_visual_result_rejected", {})
	var id: String = scene.steps[scene.selected_index].id
	_check(scene.store.results[id].interaction == scene.store.defaults.interaction and scene.store.results[id].smoothness == scene.store.defaults.smoothness, "visual_result_changed_other_fields", {})
	_check(scene.set_result("interaction", "响应正常", "harness"), "harness_interaction_result_rejected", {})
	_check(scene.store.results[id].visual == "看不清" and scene.store.results[id].smoothness == scene.store.defaults.smoothness, "interaction_result_changed_other_fields", {})
	_check(scene.set_result("smoothness", "停了一下又恢复", "harness"), "harness_smoothness_result_rejected", {})
	_check(scene.store.results[id].visual == "看不清" and scene.store.results[id].interaction == "响应正常", "smoothness_result_changed_other_fields", {})
	report["harnessResultSelectionState"] = _snapshot()
	for field in ["visual", "interaction", "smoothness"]:
		_check(scene.set_result(field, "未测试", "harness"), "harness_untested_restore_rejected", {"field": field})
	_check(scene.store.results == before, "harness_results_not_restored", {})
	for record in scene.records:
		_check(record.event != "human_result", "harness_logged_as_human", record)
	report["resultIsolationVerified"] = failures.size() == failures_before
	await process_frame

func _snapshot() -> Dictionary:
	return {"main": _sanitize(scene.get_test_state()), "renderer": _sanitize(scene.renderer.get_state()) if is_instance_valid(scene.renderer) else {"unavailable": true}}

func _capture(stem: String) -> String:
	var path := out_dir.path_join(stem + ".png")
	if FileAccess.file_exists(path):
		_fail("screenshot_would_overwrite", {"path": path})
		return ""
	var image: Image = viewport.get_texture().get_image()
	if image == null or image.is_empty():
		_fail("native_screenshot_empty", {"path": path})
		return ""
	var error := image.save_png(path)
	_check(error == OK, "screenshot_write_failed", {"path": path, "error": error})
	return path

func _sanitize(value: Variant) -> Variant:
	if value is Dictionary:
		var clean := {}
		for key in value:
			clean[str(key)] = _sanitize(value[key])
		return clean
	if value is Array:
		var clean: Array = []
		for item in value:
			clean.append(_sanitize(item))
		return clean
	if value is Rect2:
		return {"x": value.position.x, "y": value.position.y, "width": value.size.x, "height": value.size.y}
	if value is Vector2 or value is Vector2i:
		return [value.x, value.y]
	if value is Vector3 or value is Vector3i:
		return [value.x, value.y, value.z]
	if value is Node:
		return str(value.get_path()) if is_instance_valid(value) else "freed_node"
	if value is Object:
		return str(value.get_class()) if is_instance_valid(value) else "freed_object"
	return value

func _check(condition: bool, code: String, details: Dictionary) -> void:
	if not condition:
		_fail(code, details)

func _fail(code: String, details: Dictionary) -> void:
	failures.append({"code": code, "stepIndex": current_index, "ticksUsec": Time.get_ticks_usec(), "details": _sanitize(details)})
	printerr("HARNESS FAIL: ", code, " step=", current_index)

func _finish() -> void:
	if finished:
		return
	finished = true
	report["outcome"] = "PASS" if failures.is_empty() else "FAIL"
	report["acceptanceMeaning"] = "native harness structure/action checks only; no visual/manual/phone/GLX pass"
	report["failures"] = failures
	report["steps"] = samples
	report["preparationFrameCaptures"] = preparation_captures
	report["totalDraws"] = draw_count
	report["durationUsec"] = Time.get_ticks_usec() - began_usec
	if is_instance_valid(scene):
		report["finalState"] = _snapshot()
	var path := out_dir.path_join("report.json")
	if not FileAccess.file_exists(path):
		var file := FileAccess.open(path, FileAccess.WRITE)
		if file:
			file.store_string(JSON.stringify(_sanitize(report), "  "))
		else:
			printerr("HARNESS FAIL: cannot write report ", FileAccess.get_open_error())
			quit(2)
			return
	print("HARNESS ", report.outcome, " report=", path)
	quit(0 if failures.is_empty() else 1)
