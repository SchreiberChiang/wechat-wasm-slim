extends "res://godot-storage-validation-cn.gd"
## Only visual sizing and detail folding. FileAccess/flow are unchanged.
var _storage_details_button: Button

func _ready() -> void:
	super._ready()
	var margin := get_child(0) as MarginContainer
	margin.add_theme_constant_override("margin_top", 24)
	_status.add_theme_font_size_override("font_size", 30)
	for button: Button in [_button, _previous_button]:
		button.custom_minimum_size.y = 100
		button.add_theme_font_size_override("font_size", 28)
	_output.visible = false
	_output.custom_minimum_size.y = 180
	_storage_details_button = Button.new()
	_storage_details_button.text = "查看详细记录"
	_storage_details_button.custom_minimum_size.y = 64
	_storage_details_button.pressed.connect(_toggle_storage_details)
	var box := _output.get_parent()
	box.add_child(_storage_details_button)
	box.move_child(_storage_details_button, _output.get_index())

func _toggle_storage_details() -> void:
	_output.visible = not _output.visible
	_storage_details_button.text = "收起详细记录" if _output.visible else "查看详细记录"
