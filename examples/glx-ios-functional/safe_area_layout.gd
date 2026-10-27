extends RefCounted

const MIN_TOP_CSS := 100.0
const MIN_BOTTOM_CSS := 80.0
const SIDE_CSS := 14.0


static func _number(object: Dictionary, key: String, fallback: float) -> float:
	var value: Variant = object.get(key, fallback)
	if value is int or value is float:
		var result := float(value)
		if is_finite(result):
			return result
	return fallback


static func compute(logical_size: Vector2, geometry: Dictionary) -> Dictionary:
	# wx safeArea/menu are screen coordinates. Normalize screenTop once, then
	# scale window CSS units to this actual Godot logical viewport. Never use DPR.
	var reasons: Array[String] = []
	var width := _number(geometry, "windowWidth", 0.0)
	var height := _number(geometry, "windowHeight", 0.0)
	if width <= 0.0 or height <= 0.0:
		reasons.append("missing-window-dimensions")
		width = maxf(logical_size.x, 1.0)
		height = maxf(logical_size.y, 1.0)
	var origin := str(geometry.get("coordinateOrigin", "window"))
	if str(geometry.get("source", "")).begins_with("wx.") == false:
		reasons.append("non-wx-or-preview-geometry")
	if origin != "screen" and origin != "window":
		reasons.append("unknown-coordinate-origin")
	if origin == "screen" and not _has_number(geometry, "screenTop"):
		reasons.append("missing-screen-top")
	if not _has_number(geometry, "screenWidth") or not _has_number(geometry, "screenHeight"):
		reasons.append("missing-screen-dimensions")
	var portrait_supported := width <= height and width >= 240.0 and height >= 360.0
	if width > height:
		reasons.append("landscape-not-accepted-in-this-round")
	if width < 240.0 or height < 360.0:
		reasons.append("tiny-window-not-accepted-in-this-round")
	var screen_top := _number(geometry, "screenTop", 0.0) if origin == "screen" else 0.0
	var left_css := SIDE_CSS
	var right_css := SIDE_CSS
	var top_css := MIN_TOP_CSS
	var bottom_css := MIN_BOTTOM_CSS
	var safe_value: Variant = geometry.get("safeArea", {})
	if safe_value is Dictionary and _valid_rect(safe_value):
		var safe: Dictionary = safe_value
		left_css = maxf(left_css, _number(safe, "left", 0.0))
		right_css = maxf(right_css, width - _number(safe, "right", width))
		top_css = maxf(top_css, _number(safe, "top", screen_top) - screen_top + 12.0)
		bottom_css = maxf(bottom_css, height - (_number(safe, "bottom", height + screen_top) - screen_top) + 12.0)
	else:
		reasons.append("missing-or-invalid-safe-area")
	var menu_value: Variant = geometry.get("menu", {})
	if menu_value is Dictionary and _valid_rect(menu_value):
		top_css = maxf(top_css, _number(menu_value, "bottom", screen_top) - screen_top + 12.0)
	else:
		reasons.append("missing-or-invalid-menu-rect")
	# Malformed/stale geometry cannot collapse the controls. This is an explicit
	# fallback, not a guessed orientation or a swapped-width/height correction.
	if left_css + right_css >= width or top_css + bottom_css >= height:
		left_css = SIDE_CSS
		right_css = SIDE_CSS
		top_css = MIN_TOP_CSS
		bottom_css = MIN_BOTTOM_CSS
		reasons.append("insets-outside-window")
	# Scalar floats retain precision; a float32 Vector2 would ceil 160 into 161.
	var scale_x: float = float(logical_size.x) / width
	var scale_y: float = float(logical_size.y) / height
	var left := int(ceil(left_css * scale_x))
	var right := int(ceil(right_css * scale_x))
	var top := int(ceil(top_css * scale_y))
	var bottom := int(ceil(bottom_css * scale_y))
	# Tiny/unaccepted windows still leave controls a usable logical region. Do not
	# pretend the clamped result is verified safe or swap orientation to make it fit.
	var horizontal_budget := maxi(0, int(floor(logical_size.x * 0.5)))
	var vertical_budget := maxi(0, int(floor(logical_size.y * 0.5)))
	if left + right > horizontal_budget:
		var ratio := float(left) / maxf(float(left + right), 1.0)
		left = int(floor(horizontal_budget * ratio))
		right = horizontal_budget - left
		reasons.append("horizontal-insets-clamped")
	if top + bottom > vertical_budget:
		var ratio := float(top) / maxf(float(top + bottom), 1.0)
		top = int(floor(vertical_budget * ratio))
		bottom = vertical_budget - top
		reasons.append("vertical-insets-clamped")
	return {
		"left": left, "right": right, "top": top, "bottom": bottom,
		"fallback": not reasons.is_empty(), "reasons": reasons,
		"geometry_verified": false, "portrait_supported": portrait_supported,
		"coordinate_origin_evidence": str(geometry.get("coordinateOriginEvidence", "not-supplied")),
		"coordinate_origin": origin,
		"source": str(geometry.get("source", "fallback")),
		"raw_geometry": geometry.duplicate(true),
		"window_css": Vector2(width, height),
		"logical_size": logical_size,
	}


static func _has_number(object: Dictionary, key: String) -> bool:
	var value: Variant = object.get(key)
	return (value is int or value is float) and is_finite(float(value))


static func _valid_rect(object: Dictionary) -> bool:
	for key in ["left", "right", "top", "bottom"]:
		if not _has_number(object, key):
			return false
	return float(object.right) >= float(object.left) and float(object.bottom) >= float(object.top)
