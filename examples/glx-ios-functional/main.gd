extends Control

const Pattern = preload("res://pattern.gd")
const SafeLayout = preload("res://safe_area_layout.gd")
const SafeQuery = preload("res://safe_area_query.gd")
const AcceptanceFont = preload("res://fonts/AcceptanceCJK.otf")
const HostBridge = preload("res://bridge.gd")
const PAGES := [
	["2D 图片与中文", "图片清晰；中文完整；透明叠加处能见底色。"],
	["2D 裁剪", "白框内有移动图形；框外没有溢出像素。"],
	["九宫格 拉伸", "左右尺寸不同；四角不变形；中心随尺寸变化。"],
	["九宫格 平铺", "左右比较 TILE 与 TILE_FIT；边缘图案重复。"],
	["九宫格 透明中心", "中心透出棋盘；透明边缘自然；切换仍正确。"],
	["3D 网格与灯光", "彩色贴图随网格转动；各面明暗不同。"],
	["3D 透明遮挡", "半透明红片在方块前；蓝片在方块后。"],
	["双离屏视口", "两个独立视角同时更新；切换显示内容正确。"],
	["退出与重入", "退出后内容消失；重入后画面恢复且可操作。"]
]
var page := 0
var states: Array[String] = []
var margins: MarginContainer
var content: VBoxContainer
var main_scroll: ScrollContainer
var stage: Control
var heading: Label
var expected: Label
var status: Label
var operation: Label
var identity: Label
var panels: Array[NinePatchRect] = []
var worlds: Array[SubViewport] = []
var spins: Array[MeshInstance3D] = []
var views: Array[TextureRect] = []
var clip_sprite: TextureRect
var compact := false
var alternate := false
var mode_2d := false
var exited := false
var elapsed := 0.0
var operation_count := 0
var active_page := false

func _ready() -> void:
	theme = Theme.new()
	theme.default_font = AcceptanceFont
	theme.default_font_size = 30
	theme.set_color("font_color", "Label", Color("f0f5ff"))
	for item in PAGES:
		states.append("未确认")
	_build_ui()
	var host := HostBridge.initialize()
	if host.get("source", "") != "native-preview":
		var device: Dictionary = host.get("device", {})
		identity.text = "会话：%s　SDK：%s　后端：%s" % [host.get("sessionTag", "未读取"), device.get("SDKVersion", "未读取"), host.get("actualMode", "未读取")]
	get_viewport().size_changed.connect(_layout)
	_layout()
	_open_page(0)
	_log("scene_ready", {"visualAcceptance": "unconfirmed"})

func _style(color: String) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = Color(color)
	s.set_corner_radius_all(12)
	s.content_margin_left = 12
	s.content_margin_right = 12
	s.content_margin_top = 9
	s.content_margin_bottom = 9
	return s

func _label(parent: Node, text: String, font_size: int = 30) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.add_theme_font_size_override("font_size", font_size)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l

func _button(parent: Node, text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 76)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.add_theme_font_size_override("font_size", 30)
	b.add_theme_stylebox_override("normal", _style("24445d"))
	b.add_theme_stylebox_override("pressed", _style("156b72"))
	b.pressed.connect(action)
	parent.add_child(b)
	return b

func _row(parent: Node) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	parent.add_child(row)
	return row

func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = Color("0b1727")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margins = MarginContainer.new()
	add_child(margins)
	margins.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 12)
	margins.add_child(root)
	heading = _label(root, "iOS 功能验收", 40)
	identity = _label(root, "包／会话／SDK／后端：以宿主记录为准", 24)
	var scroll := ScrollContainer.new()
	main_scroll = scroll
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	root.add_child(scroll)
	content = VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 12)
	scroll.add_child(content)
	expected = _label(content, "", 30)
	stage = Control.new()
	stage.custom_minimum_size = Vector2(0, 310)
	stage.clip_contents = true
	content.add_child(stage)
	operation = _label(content, "", 26)
	var actions := VBoxContainer.new()
	actions.name = "PageActions"
	content.add_child(actions)
	status = _label(root, "人工状态：未确认", 32)
	var verdict := _row(root)
	_button(verdict, "通过", func(): _verdict("通过"))
	_button(verdict, "异常", func(): _verdict("异常"))
	_button(verdict, "未测", func(): _verdict("未测"))
	var nav := _row(root)
	_button(nav, "◀ 上一项", func(): _open_page((page + PAGES.size() - 1) % PAGES.size()))
	_button(nav, "下一项 ▶", func(): _open_page((page + 1) % PAGES.size()))
	_label(root, "执行操作不会自动判定画面通过", 24)

func _layout() -> void:
	var geometry := {"source": "native-window", "windowWidth": DisplayServer.window_get_size().x, "windowHeight": DisplayServer.window_get_size().y}
	if OS.has_feature("web"):
		var raw: Variant = JavaScriptBridge.eval(SafeQuery.CODE, true)
		# The mini-game JS evaluator may return undefined. Never parse that value.
		if raw is String and raw.strip_edges().begins_with("{"):
			var parsed: Variant = JSON.parse_string(raw)
			if parsed is Dictionary:
				geometry.merge(parsed, true)
	var layout := SafeLayout.compute(get_viewport_rect().size, geometry)
	for side in ["left", "right", "top", "bottom"]:
		margins.add_theme_constant_override("margin_" + side, layout[side])

func _clear_stage() -> void:
	panels.clear()
	worlds.clear()
	spins.clear()
	views.clear()
	clip_sprite = null
	for node in stage.get_children():
		stage.remove_child(node)
		node.queue_free()

func _open_page(index: int) -> void:
	if active_page:
		_log("page_exit", {"from": page})
	active_page = true
	page = index
	main_scroll.set_deferred("scroll_vertical", 0)
	compact = false
	alternate = false
	mode_2d = false
	exited = false
	_clear_stage()
	var actions := content.get_node("PageActions")
	for child in actions.get_children():
		actions.remove_child(child)
		child.queue_free()
	heading.text = "%d / %d  %s" % [page + 1, PAGES.size(), PAGES[page][0]]
	expected.text = "预期：" + PAGES[page][1]
	operation.text = "观察画面后选择人工状态。"
	status.text = "人工状态：" + states[page]
	match page:
		0: _build_2d()
		1: _build_clip()
		2, 3, 4:
			_build_nine()
			_button(actions, "切换尺寸", _resize_nine)
			_button(actions, "切换纹理", _texture_nine)
		5, 6: _build_3d_views(false)
		7:
			_build_3d_views(true)
			_button(actions, "切换 2D / 3D", _toggle_view)
		8:
			_build_3d_views(false)
			_button(actions, "退出场景 / 重新进入", _reenter)
	_log("page_enter", {"title": PAGES[page][0], "manualState": states[page]})

func _verdict(value: String) -> void:
	states[page] = value
	status.text = "人工状态：" + value
	_log("manual_verdict", {"state": value, "source": "explicit_button"})

func _texture(second: bool = false) -> Texture2D:
	var image := Image.create(96, 96, false, Image.FORMAT_RGBA8)
	image.fill(Color.TRANSPARENT)
	for y in range(4, 92):
		for x in range(4, 92):
			var color := Color("6479b4") if second else Color("267e91")
			if x < 24 and y < 24: color = Color("ff6655")
			elif x >= 72 and y < 24: color = Color("65e580")
			elif x < 24 and y >= 72: color = Color("638aff")
			elif x >= 72 and y >= 72: color = Color("ffd35c")
			elif x < 24 or x >= 72 or y < 24 or y >= 72:
				color = Color("ffffff") if (x / 8 + y / 8) % 2 == 0 else Color("33465d")
			elif abs(x - 48) < 4 or abs(y - 48) < 4: color = Color("f5a4ed")
			if second: color = Color(color.b, color.r, color.g, color.a)
			var edge := mini(mini(x, y), mini(95 - x, 95 - y))
			if edge == 4: color.a = 0.35
			elif edge == 5: color.a = 0.7
			image.set_pixel(x, y, color)
	return ImageTexture.create_from_image(image)

func _view(parent: Node, texture: Texture2D, rect: Rect2) -> TextureRect:
	var v := TextureRect.new()
	v.texture = texture
	v.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	v.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	v.position = rect.position
	v.size = rect.size
	v.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(v)
	return v

func _build_2d() -> void:
	var p := Pattern.new()
	stage.add_child(p)
	p.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_view(stage, _texture(), Rect2(30, 35, 150, 150))
	var l := _label(stage, "中文清晰\n透明叠加", 42)
	l.position = Vector2(230, 70)
	l.size = Vector2(330, 150)
	operation.text = "红色＋青色圆形交叠；斜线连续；四角色块完整。"

func _build_clip() -> void:
	var border := Panel.new()
	border.position = Vector2(50, 30)
	border.size = Vector2(460, 230)
	var s := _style("20354b")
	s.border_color = Color.WHITE
	s.set_border_width_all(4)
	border.add_theme_stylebox_override("panel", s)
	stage.add_child(border)
	var clipped := Control.new()
	clipped.position = Vector2(5, 5)
	clipped.size = Vector2(450, 220)
	clipped.clip_contents = true
	border.add_child(clipped)
	clip_sprite = _view(clipped, _texture(), Rect2(0, 20, 190, 190))
	operation.text = "图形会自动左右移动；只判定白框内外的裁剪结果。"

func _build_nine() -> void:
	var background := Pattern.new()
	stage.add_child(background)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for i in range(2):
		var n := NinePatchRect.new()
		n.texture = _texture()
		n.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		n.patch_margin_left = 24
		n.patch_margin_right = 24
		n.patch_margin_top = 24
		n.patch_margin_bottom = 24
		n.position = Vector2(14 + i * 300, 36)
		n.size = Vector2(220 if i == 0 else 280, 180 if i == 0 else 240)
		n.draw_center = page != 4
		if page == 3:
			n.axis_stretch_horizontal = NinePatchRect.AXIS_STRETCH_MODE_TILE if i == 0 else NinePatchRect.AXIS_STRETCH_MODE_TILE_FIT
			n.axis_stretch_vertical = n.axis_stretch_horizontal
		stage.add_child(n)
		panels.append(n)
	operation.text = "左：TILE　右：TILE_FIT" if page == 3 else ("中心不绘制；外侧四像素为透明边缘。" if page == 4 else "STRETCH；红绿蓝黄四角，虚线边缘，紫色十字中心。")

func _resize_nine() -> void:
	compact = not compact
	for i in range(panels.size()):
		panels[i].size = Vector2(160 + i * 50, 125 + i * 35) if compact else Vector2(220 + i * 60, 180 + i * 60)
	_log("nine_resize", {"compact": compact})

func _texture_nine() -> void:
	alternate = not alternate
	for panel in panels: panel.texture = _texture(alternate)
	_log("nine_texture", {"alternate": alternate})

func _material(color: Color, textured: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.6
	if textured: m.albedo_texture = _texture()
	if color.a < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

func _world(index: int, transparent_test: bool) -> SubViewport:
	var vp := SubViewport.new()
	vp.size = Vector2i(480, 280)
	vp.own_world_3d = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	stage.add_child(vp)
	worlds.append(vp)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color("173a50") if index == 0 else Color("453553")
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color.WHITE
	env.environment.ambient_light_energy = 0.3
	vp.add_child(env)
	var camera := Camera3D.new()
	camera.position = Vector3(0, 0.7 if index == 0 else -0.4, 3.4)
	camera.fov = 36
	vp.add_child(camera)
	camera.look_at(Vector3.ZERO)
	camera.current = true
	var cube := MeshInstance3D.new()
	# Use BoxMesh directly to avoid the extra GPU buffer readback.
	cube.mesh = BoxMesh.new()
	cube.rotation_degrees = Vector3(-15, 25, 0)
	cube.material_override = _material(Color.WHITE, true)
	vp.add_child(cube)
	spins.append(cube)
	var lamp := DirectionalLight3D.new()
	lamp.rotation_degrees = Vector3(-30, -40, 0)
	lamp.light_energy = 1.4
	vp.add_child(lamp)
	if transparent_test:
		for j in range(2):
			var sheet := MeshInstance3D.new()
			var quad := QuadMesh.new()
			quad.size = Vector2(1.35, 1.35)
			sheet.mesh = quad
			sheet.position = Vector3(-0.45 if j == 0 else 0.45, 0, 0.9 if j == 0 else -0.9)
			sheet.material_override = _material(Color(1, 0.1, 0.1, 0.5) if j == 0 else Color(0.1, 0.4, 1, 0.6))
			vp.add_child(sheet)
	return vp

func _build_3d_views(two: bool) -> void:
	for i in range(2 if two else 1):
		var vp := _world(i, page == 6)
		var v := _view(stage, vp.get_texture(), Rect2(8 + i * 300, 10, 288 if two else 590, 290))
		views.append(v)
	operation.text = "两个视口具有独立世界、背景色及摄像机角度。" if two else "这是 SubViewport 的 3D 输出，贴图由本场景生成。"

func _toggle_view() -> void:
	mode_2d = not mode_2d
	for i in range(views.size()):
		views[i].texture = _texture(i == 1) if mode_2d else worlds[i].get_texture()
		worlds[i].render_target_update_mode = SubViewport.UPDATE_DISABLED if mode_2d else SubViewport.UPDATE_ALWAYS
	_log("viewport_switch", {"content": "2d" if mode_2d else "3d"})

func _reenter() -> void:
	exited = not exited
	_clear_stage()
	if exited:
		var exit_label := _label(stage, "场景已退出\n点击按钮重新进入", 38)
		exit_label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		exit_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		exit_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	else:
		_build_3d_views(false)
	_log("scene_exit" if exited else "scene_reenter", {"manualState": states[page]})

func _process(delta: float) -> void:
	elapsed += delta
	for cube in spins: cube.rotate_y(delta * 0.5)
	if is_instance_valid(clip_sprite): clip_sprite.position.x = 160 + sin(elapsed) * 260

func _log(action: String, details: Dictionary = {}) -> void:
	operation_count += 1
	var record := {"schema": "ios-functional-v1", "event": action, "page": page, "sequence": operation_count, "ticksMs": Time.get_ticks_msec(), "details": details}
	HostBridge.emit_record(record)
