# Source-only composition. Navigation never re-creates a page or changes engine,
# viewport, rendering, audio or network cancellation policy.
extends Control

const INPUT_AUDIO_PAGE = preload("res://combined-input-audio.gd")
const NETWORK_PAGE = preload("res://combined-network.gd")
const GAME := 0
const INPUT_AUDIO := 1
const NETWORK := 2
const STORAGE := 3
@export var storage_page_enabled := false
@export var simple_ui_enabled := false

var _game: Control
var _input_audio
var _network
var _storage: Control
var _status: Label
var _buttons: Array[Button] = []
var _page := -1


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_game = get_node("../../Game") as Control
	if simple_ui_enabled:
		var readable := Theme.new()
		readable.default_font = load("res://StorageCJK.otf")
		readable.default_font_size = 26
		theme = readable
	# Exactly one instance of each observation page for the whole scene lifetime.
	_input_audio = load("res://combined-input-simple.gd").new() if simple_ui_enabled else INPUT_AUDIO_PAGE.new()
	_input_audio.name = "InputAudio"
	add_child(_input_audio)
	_layout_page(_input_audio)
	_network = load("res://combined-network-simple.gd").new() if simple_ui_enabled else NETWORK_PAGE.new()
	_network.name = "NetworkDesktop"
	add_child(_network)
	_layout_page(_network)
	_build_navigation()
	_switch_page(GAME)


func _layout_page(page: Control) -> void:
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.offset_bottom = -172.0 if simple_ui_enabled else -104.0
	page.clip_contents = true


func _build_navigation() -> void:
	var panel := PanelContainer.new()
	panel.z_index = 200
	panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	panel.offset_left = 8.0
	panel.offset_right = -8.0
	panel.offset_top = -164.0 if simple_ui_enabled else -96.0
	panel.offset_bottom = -8.0
	if simple_ui_enabled:
		var solid := StyleBoxFlat.new()
		solid.bg_color = Color(0.08, 0.10, 0.13, 1.0)
		panel.add_theme_stylebox_override("panel", solid)
	add_child(panel)
	var column := VBoxContainer.new()
	panel.add_child(column)
	if simple_ui_enabled:
		_status = Label.new()
		_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_status.add_theme_font_size_override("font_size", 28)
		column.add_child(_status)
		var navigation := HBoxContainer.new()
		column.add_child(navigation)
		for direction: int in [-1, 1]:
			var action := Button.new()
			action.text = "上一项" if direction < 0 else "下一项"
			action.custom_minimum_size.y = 96
			action.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			action.add_theme_font_size_override("font_size", 32)
			action.pressed.connect(_move_page.bind(direction))
			navigation.add_child(action)
			_buttons.append(action)
		return
	var row := HBoxContainer.new()
	column.add_child(row)
	var titles := ["Game", "Input / Audio", "Network desktop"]
	if storage_page_enabled:
		titles.append("Storage")
	for index in range(titles.size()):
		var button := Button.new()
		button.text = titles[index]
		button.custom_minimum_size.y = 40.0
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.pressed.connect(_switch_page.bind(index))
		row.add_child(button)
		_buttons.append(button)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(_status)

func _move_page(direction: int) -> void:
	_switch_page(_page + direction)


func _switch_page(target: int) -> void:
	if target < GAME or target > (STORAGE if storage_page_enabled else NETWORK):
		return
	if _page == NETWORK and target != NETWORK and _network.is_observation_busy():
		_status.text = "网络请求尚未结束，请留在此页。" if simple_ui_enabled else "Network run busy: stay here until it finishes; no cancellation was requested."
		return
	if target == STORAGE and _storage == null:
		# First manual visit only; no storage check or locator read on startup.
		var script = load("res://combined-storage-simple.gd" if simple_ui_enabled else "res://godot-storage-validation-cn.gd")
		if script == null:
			_status.text = "Storage page unavailable. Keep the logs; no file check started."
			return
		_storage = script.new() as Control
		_storage.name = "Storage"
		add_child(_storage)
		_layout_page(_storage)
	_game.visible = target == GAME
	_input_audio.set_page_active(target == INPUT_AUDIO)
	_input_audio.visible = target == INPUT_AUDIO
	_network.set_page_active(target == NETWORK)
	if _storage != null:
		_storage.visible = target == STORAGE
	_page = target
	if simple_ui_enabled:
		_buttons[0].disabled = target == GAME
		_buttons[1].disabled = target == (STORAGE if storage_page_enabled else NETWORK)
		var titles := ["画面", "输入和声音", "网络", "存档"]
		_status.text = "%d / %d　%s" % [target + 1, 4 if storage_page_enabled else 3, titles[target]]
		return
	for index in range(_buttons.size()):
		_buttons[index].disabled = index == target
	_status.text = "Manual observations only. Switching pages does not replay audio or reconnect."
	if target == NETWORK:
		_status.text = "Network: only cached wx platform devtools with matching identity permits manual loopback."
	elif target == STORAGE:
		_status.text = "Storage: one write, then reopen and read. Switching pages is not a restart."
