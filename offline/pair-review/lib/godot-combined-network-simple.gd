extends "res://combined-network.gd"
## No request changes. The original port/run controls are behind details.
var _simple_status: Label
var _network_details: VBoxContainer
var _network_details_button: Button

func _ready() -> void:
	super._ready()
	_network_details = _port.get_parent() as VBoxContainer
	_network_details.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	_network_details.visible = false
	var margin := MarginContainer.new()
	add_child(margin)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	margin.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 24)
	scroll.add_child(box)
	var title := Label.new()
	title.text = "网络检查"
	title.add_theme_font_size_override("font_size", 32)
	box.add_child(title)
	_simple_status = Label.new()
	_simple_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_simple_status.add_theme_font_size_override("font_size", 28)
	box.add_child(_simple_status)
	_network_details_button = Button.new()
	_network_details_button.text = "详细设置（本轮不用）"
	_network_details_button.custom_minimum_size.y = 80
	_network_details_button.pressed.connect(_toggle_network_details)
	box.add_child(_network_details_button)
	_network_details.reparent(box)
	_update_simple_status()

func set_page_active(active: bool) -> bool:
	var accepted := super.set_page_active(active)
	if accepted and active and is_instance_valid(_simple_status):
		_update_simple_status()
	return accepted

func _update_simple_status() -> void:
	_simple_status.text = "本轮不用操作，点下一项即可。\n\n真实联网要先确定测试地址，不能把进入本页当作通过。"

func _toggle_network_details() -> void:
	_network_details.visible = not _network_details.visible
	_network_details_button.text = "收起详细设置" if _network_details.visible else "详细设置（本轮不用）"
