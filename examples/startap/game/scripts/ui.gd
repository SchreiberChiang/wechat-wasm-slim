class_name UI
## 各场景共用的小控件（字体大小、按钮音效）。只用 2D 控件，不碰 3D。

const FONT := 34


static func label(text: String, size := FONT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func button(text: String, cb: Callable, height := 96) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, height)
	b.add_theme_font_size_override("font_size", FONT)
	b.pressed.connect(func() -> void: Game.play_sfx("click"); cb.call())
	return b


## 居中的竖排容器
static func column(parent: Node, width := 560, y := -360) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.custom_minimum_size = Vector2(width, 0)
	v.position = Vector2(-width / 2.0, y)
	v.add_theme_constant_override("separation", 22)
	parent.add_child(v)
	return v


## 全屏背景 shader（2D）
static func background(parent: Node) -> ShaderMaterial:
	var bg := ColorRect.new()
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/background.gdshader")
	bg.material = m
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(bg)
	return m
