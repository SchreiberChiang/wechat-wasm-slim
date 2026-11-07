extends "res://combined-input-audio.gd"
## Presentation only. Input, PCM, lifecycle and logging remain inherited.
var _simple_input: Label
var _simple_audio: Label
var _details: VBoxContainer
var _details_button: Button

func _build_panel() -> void:
	super._build_panel()
	_toggle.visible = false
	_expanded = true
	_scroll.visible = true
	_details = VBoxContainer.new()
	# Keep every original diagnostic control and callback, but put them away.
	for child: Node in _body.get_children():
		child.reparent(_details)
	_details.visible = false
	var primary := VBoxContainer.new()
	primary.add_theme_constant_override("separation", 12)
	_body.add_child(primary)
	_simple_label(primary, "输入和声音", 32)
	_simple_label(primary, "在方框内按住并拖动一次，再点播放短音。", 26)
	_area.reparent(primary)
	_area.custom_minimum_size.y = 136
	_simple_input = _simple_label(primary, "还没有拖动记录。", 24)
	var play := Button.new()
	play.name = "PlayShortTone"
	play.text = "播放短音"
	play.custom_minimum_size.y = 88
	play.add_theme_font_size_override("font_size", 32)
	play.pressed.connect(_play_tone)
	primary.add_child(play)
	_simple_audio = _simple_label(primary, "听到声音后告诉我；日志不自动判断听感。", 24)
	_details_button = Button.new()
	_details_button.text = "更多检查（本轮不用）"
	_details_button.custom_minimum_size.y = 64
	_details_button.add_theme_font_size_override("font_size", 24)
	_details_button.pressed.connect(_toggle_details)
	primary.add_child(_details_button)
	_body.add_child(_details)
	_refresh_input_labels()
	_refresh_audio_label()

func _simple_label(parent: Node, text: String, font_size: int) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _layout_panel() -> void:
	if not is_instance_valid(_panel):
		return
	_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_panel.offset_left = 20
	_panel.offset_right = -20
	_panel.offset_top = 20
	_panel.offset_bottom = -12

func _toggle_details() -> void:
	_details.visible = not _details.visible
	_details_button.text = "收起更多检查" if _details.visible else "更多检查（本轮不用）"

func _refresh_input_labels() -> void:
	super._refresh_input_labels()
	if is_instance_valid(_simple_input):
		_simple_input.text = "鼠标：按下 %d／移动 %d／松开 %d\n触摸：按下 %d／移动 %d／松开 %d" % [_mouse_presses, _mouse_moves, _mouse_releases, _presses, _moves, _releases]

func _refresh_audio_label() -> void:
	super._refresh_audio_label()
	if is_instance_valid(_simple_audio):
		_simple_audio.text = "已请求 %d 次；结束信号 %d 次。\n是否听到声音，请告诉我。" % [_audio_requests, _audio_finished]
