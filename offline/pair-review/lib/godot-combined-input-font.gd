extends "res://combined-input-font-base.gd"
## Presentation/font only. Keep the original field, callbacks and keyboard path.
const INPUT_TEXT_FONT: Font = preload("res://InputTextCJK.otf")


func _build_panel() -> void:
	super._build_panel()
	var primary := _details_button.get_parent() as VBoxContainer
	var input_section := VBoxContainer.new()
	input_section.name = "VisibleTextInput"
	input_section.add_theme_constant_override("separation", 12)
	var readable := Theme.new()
	readable.default_font = INPUT_TEXT_FONT
	input_section.theme = readable
	primary.add_child(input_section)
	primary.move_child(input_section, 0)
	_simple_label(input_section, "中文输入", 32)
	_simple_label(input_section, "点输入框，输入：哈 米 A1。再删除一个字，点键盘确认。", 26)
	_ime.reparent(input_section)
	_ime.name = "ManualChineseInput"
	_ime.placeholder_text = "请在这里输入，不记录文字内容"
	_ime.custom_minimum_size.y = 88
	_ime.add_theme_font_override("font", INPUT_TEXT_FONT)
	_ime.add_theme_font_size_override("font_size", 32)
	_ime_label.reparent(input_section)
	_ime_label.add_theme_font_size_override("font_size", 24)
	var release_button := Button.new()
	release_button.name = "ReleaseTextFocus"
	release_button.text = "结束本次编辑"
	release_button.custom_minimum_size.y = 80
	release_button.add_theme_font_size_override("font_size", 28)
	release_button.pressed.connect(_release_ime_focus)
	input_section.add_child(release_button)
	_simple_label(input_section, "之后再点输入框，观察文字是否保留。按钮只释放焦点，键盘是否收起要人工确认。", 24)
	_simple_label(input_section, "不自动判定输入通过；请分别反馈缺字、删除、确认和再次打开。", 24)
	_refresh_ime()


func _refresh_ime() -> void:
	# Parent construction and existing events call this same display method.
	if not is_instance_valid(_ime) or not is_instance_valid(_ime_label):
		return
	_ime_label.text = "字数 %d／文字变化 %d／提交 %d\n获得焦点 %d／离开焦点 %d（不记录内容）" % [_ime.text.length(), _ime_changes, _ime_submits, _ime_focus_in, _ime_focus_out]
