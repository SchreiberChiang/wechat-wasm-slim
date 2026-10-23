extends SceneTree

const Layout = preload("res://safe_area_layout.gd")
var failures := 0


func _check(condition: bool) -> void:
	if not condition:
		failures += 1
		push_error("Layout contract failure: " + str(get_stack()))


func _initialize() -> void:
	var island := {"source": "fixture", "coordinateOrigin": "screen", "coordinateOriginEvidence": "explicit-fixture", "windowWidth": 390.0, "windowHeight": 844.0, "screenWidth": 390, "screenHeight": 844, "screenTop": 0.0, "deviceOrientation": "portrait",
		"safeArea": {"left": 0, "top": 59, "right": 390, "bottom": 810}, "menu": {"left": 290, "right": 380, "top": 59, "bottom": 91}}
	var result := Layout.compute(Vector2(720, 1558), island)
	_check(result.top == int(ceil(103.0 * 1558.0 / 844.0)))
	_check(result.bottom == int(ceil(80.0 * 1558.0 / 844.0)))
	# Same window geometry expressed in screen coordinates with screenTop=47.
	var shifted := island.duplicate(true)
	shifted.screenTop = 47.0
	shifted.safeArea.top += 47
	shifted.safeArea.bottom += 47
	shifted.menu.bottom += 47
	var normalized := Layout.compute(Vector2(720, 1558), shifted)
	for key in ["left", "right", "top", "bottom"]:
		_check(normalized[key] == result[key])
	# A native/browser fallback has no wx and uses its actual CSS window size.
	var fallback := Layout.compute(Vector2(720, 1160), {"windowWidth": 450, "windowHeight": 725})
	_check(fallback.top == 160)
	_check(fallback.bottom == 128)
	# Preserve non-720 logical width and do not infer a swapped orientation.
	var wide := Layout.compute(Vector2(960, 1280), {"windowWidth": 480, "windowHeight": 640})
	_check(wide.left == 28 and wide.top == 200 and wide.bottom == 160)
	var invalid := Layout.compute(Vector2(720, 1160), {"windowWidth": 390, "windowHeight": 844, "menu": {"left": 290, "right": 380, "top": 59, "bottom": 9000}})
	_check(invalid.fallback)
	_check("insets-outside-window" in invalid.reasons)
	for incomplete in [
		{},
		{"source": "browser-no-wx", "windowWidth": 390, "windowHeight": 844},
		{"source": "wx.getWindowInfo", "coordinateOrigin": "screen", "windowWidth": 390, "windowHeight": 844, "safeArea": null, "menu": null},
	]:
		var incomplete_result := Layout.compute(Vector2(720, 1160), incomplete)
		_check(incomplete_result.fallback)
		_check(not incomplete_result.geometry_verified)
		_check(not incomplete_result.reasons.is_empty())
	var complete := island.duplicate(true)
	complete.source = "wx.getWindowInfo"
	var complete_result := Layout.compute(Vector2(720, 1558), complete)
	_check(not complete_result.fallback)
	_check(not complete_result.geometry_verified)
	for field in ["safeArea", "menu", "screenTop", "windowWidth"]:
		var missing := complete.duplicate(true)
		missing.erase(field)
		var missing_result := Layout.compute(Vector2(720, 1558), missing)
		var expected_reason := {"safeArea": "missing-or-invalid-safe-area", "menu": "missing-or-invalid-menu-rect", "screenTop": "missing-screen-top", "windowWidth": "missing-window-dimensions"}
		_check(expected_reason[field] in missing_result.reasons)
	var tiny := Layout.compute(Vector2(720, 1160), {"windowWidth": 20, "windowHeight": 140})
	_check(not tiny.portrait_supported and tiny.fallback)
	_check("tiny-window-not-accepted-in-this-round" in tiny.reasons)
	_check(tiny.left + tiny.right <= 360 and tiny.top + tiny.bottom <= 580)
	var landscape := Layout.compute(Vector2(1280, 720), {"windowWidth": 640, "windowHeight": 360})
	_check(not landscape.portrait_supported and landscape.fallback)
	_check("landscape-not-accepted-in-this-round" in landscape.reasons)
	_check(landscape.window_css == Vector2(640, 360))
	if failures > 0:
		quit(1)
		return
	print("[ACCEPTANCE_LAYOUT_CONTRACT] PASS: geometry only; no rendering, wx, or diagnostic calls")
	quit(0)
