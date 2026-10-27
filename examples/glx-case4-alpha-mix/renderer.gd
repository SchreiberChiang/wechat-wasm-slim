extends "res://renderer_round3.gd"

# Scene-only diagnostic extension; retained round3/base source and source viewport
# creation are inherited unchanged. Modes update two persistent materials only.
const CASE4_MODES := ["直通桥接", "已知 alpha 标定", "采样后 alpha 灰度", "保留 RGB，固定 alpha 1"]
var case4_mode := 0
var diag_views: Array[TextureRect] = []
var case4_materials: Array[ShaderMaterial] = []
var case4_backplates: Array[ColorRect] = []
var case4_mode_label: Label

func clear() -> void:
	# Base build calls clear virtually before creating the next page.
	super.clear()
	diag_views.clear()
	case4_materials.clear()
	case4_backplates.clear()
	case4_mode_label = null
	case4_mode = 0

func _build_alpha_comparison() -> void:
	super._build_alpha_comparison()
	stage.size = Vector2(620, 620)
	stage.modulate = Color.WHITE
	stage.self_modulate = Color.WHITE
	for index in range(2):
		var rect := Rect2(8 + index * 312, 374, 248, 150)
		var backplate := ColorRect.new()
		backplate.name = "Case4BlackBase%d" % index
		backplate.color = Color(0, 0, 0, 1)
		backplate.position = rect.position
		backplate.size = rect.size
		backplate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_own(backplate, stage)
		case4_backplates.append(backplate)
		var display := _view(views[0].texture, rect)
		display.name = "Case4Mix" if index == 0 else "Case4Disabled"
		display.modulate = Color.WHITE
		display.self_modulate = Color.WHITE
		var diagnostic_material := ShaderMaterial.new()
		diagnostic_material.shader = load("res://case4_mix.gdshader" if index == 0 else "res://case4_disabled.gdshader")
		diagnostic_material.set_shader_parameter("observation_mode", 0)
		diagnostic_material.set_shader_parameter("software_reference", index == 1)
		display.material = diagnostic_material
		diag_views.append(display)
		case4_materials.append(diagnostic_material)
		_label(stage, "诊断 MIX / 局部黑底" if index == 0 else "诊断 DISABLED / 局部黑底", Rect2(8 + index * 312, 334, 296, 36), 20)
		_label(stage, "标定从左到右：0 / .25 / .75 / 1", Rect2(8 + index * 312, 528, 296, 30), 17)
	case4_mode_label = _label(stage, "", Rect2(8, 566, 604, 30), 21)
	_button("case4_mode_next", "下一观察模式（共4种）", func():
		case4_mode = (case4_mode + 1) % CASE4_MODES.size()
		for diagnostic_material in case4_materials:
			diagnostic_material.set_shader_parameter("observation_mode", case4_mode)
		_case4_update_state()
		_emit("case4_observation_mode_changed", {"alphaMixDiagnostic": state["alphaMixDiagnostic"], "visualPass": false}))
	_case4_update_state()
	_emit("case4_diagnostic_created", {"alphaMixDiagnostic": state["alphaMixDiagnostic"], "automaticPass": false})

func update_layout(stage_rect: Rect2) -> void:
	if step_id != "D15-alpha":
		super.update_layout(stage_rect)
		return
	# The inherited build invokes this before and after alpha content creation.
	# Baseline views remain exactly two, with their original design coordinates.
	direct_rect = stage_rect
	if is_instance_valid(stage):
		stage.size = Vector2(620, 620)
		var factor := minf(stage_rect.size.x / 620.0, stage_rect.size.y / 620.0)
		stage.scale = Vector2.ONE * factor
		stage.position = (stage_rect.size - stage.size * factor) / 2
	if views.size() == 2:
		for index in range(2):
			views[index].position = Vector2(8 + index * 312, 32)
			views[index].size = Vector2(248, 202)
	if diag_views.size() == 2:
		_case4_update_state()

func _case4_color(color: Color) -> Array:
	return [color.r, color.g, color.b, color.a]

func _case4_view_state(display: TextureRect) -> Dictionary:
	return {"node": str(display.get_path()), "textureInstanceId": str(display.texture.get_instance_id()),
		"textureRid": str(display.texture.get_rid()), "sameTextureObjectAsBaseline": display.texture == views[0].texture,
		"sameTextureRidAsBaseline": display.texture.get_rid() == views[0].texture.get_rid(),
		"position": [display.position.x, display.position.y], "size": [display.size.x, display.size.y],
		"filter": display.texture_filter, "stretchMode": display.stretch_mode, "expandMode": display.expand_mode,
		"fullTextureUv": true, "flipH": display.flip_h, "flipV": display.flip_v,
		"modulate": _case4_color(display.modulate), "selfModulate": _case4_color(display.self_modulate)}

func _case4_update_state() -> void:
	if diag_views.size() != 2 or not is_instance_valid(stage): return
	case4_mode_label.text = "模式 %d/4：%s" % [case4_mode + 1, CASE4_MODES[case4_mode]]
	var material_states: Array = []
	for index in range(2):
		var diagnostic_material := case4_materials[index]
		material_states.append({"instanceId": str(diagnostic_material.get_instance_id()),
			"shaderId": str(diagnostic_material.shader.get_instance_id()), "shaderPath": diagnostic_material.shader.resource_path,
			"observationMode": diagnostic_material.get_shader_parameter("observation_mode"),
			"softwareReference": diagnostic_material.get_shader_parameter("software_reference")})
	var draw_order: Array = []
	for child in stage.get_children():
		if child is CanvasItem:
			draw_order.append({"siblingIndex": child.get_index(), "node": str(child.get_path()),
				"class": child.get_class(), "zIndex": child.z_index, "zAsRelative": child.z_as_relative,
				"ySortEnabled": child.y_sort_enabled})
	var ancestor_modulation: Array = []
	var ancestor: Node = stage
	while ancestor != null:
		if ancestor is CanvasItem:
			ancestor_modulation.append({"node": str(ancestor.get_path()), "modulate": _case4_color(ancestor.modulate),
				"selfModulate": _case4_color(ancestor.self_modulate)})
		ancestor = ancestor.get_parent()
	state["alphaMixDiagnostic"] = {"modeIndex": case4_mode, "modeName": CASE4_MODES[case4_mode],
		"materials": material_states, "materialRecreatedOnModeSwitch": false,
		"baselineViews": [_case4_view_state(views[0]), _case4_view_state(views[1])],
		"diagnosticViews": [_case4_view_state(diag_views[0]), _case4_view_state(diag_views[1])],
		"sourceViewportCount": worlds.size(), "sourceViewportSize": [worlds[0].size.x, worlds[0].size.y],
		"sourceViewportUpdateMode": worlds[0].render_target_update_mode,
		"sourceTransparentBackground": worlds[0].transparent_bg, "sourceHdr2D": worlds[0].use_hdr_2d,
		"softwareReferenceParameters": {"enabledOnDisabledOnly": true, "sourceRgb": [1, 1, 1],
			"alphasLeftToRight": [0.0, 0.25, 0.75, 1.0], "backplateRgba": [0, 0, 0, 1],
			"referenceRgb": "a,a,a", "referenceAlpha": 1.0, "scope": "white source RGB contribution over black only; not full destination or alpha factors"},
		"stageDesignSize": [620, 620], "stageScale": [stage.scale.x, stage.scale.y],
		"stagePosition": [stage.position.x, stage.position.y], "baselineOriginalDesignSize": [620, 340],
		"baselineRelativeRectanglesRetained": true, "baselineOriginalFitScale": minf(host_stage.size.x / 620.0, host_stage.size.y / 340.0),
		"baselineOverallScaleChanged": not is_equal_approx(stage.scale.x, minf(host_stage.size.x / 620.0, host_stage.size.y / 340.0)),
		"hostStageSize": [host_stage.size.x, host_stage.size.y], "ancestorModulation": ancestor_modulation,
		"canvasModulateAdded": false, "light2DAdded": false, "fragmentInput": "s=COLOR; no second texture sample",
		"drawOrderBasis": "CanvasItem sibling order with recorded zIndex; no y sorting added",
		"actualSceneDrawOrder": draw_order, "gpuExecutionOrderQueried": false,
		"sourceFormatClearLightLibraryChanged": false, "generalFixClaimed": false}

