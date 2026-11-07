extends "res://combined-input-simple-base.gd"
## Manual ordinary-PCK resource probe; parent IME, short tone and dynamic 3.2 s tone remain.
const PCK_LONG_TONE: AudioStream = preload("res://functional-long-tone.wav")
var _pck_player: AudioStreamPlayer
var _pck_label: Label
var _pck_play_button: Button
var _pck_pause_button: Button
var _pck_resume_button: Button
var _pck_stop_button: Button
var _pck_registration_reads := 0
var _pck_exiting := false
var _pck_generation := 0
var _pck_active_generation := 0
var _pck_intent := "NONE"
var _pck_last_event := "NOT_REQUESTED"
var _pck_finished_count := 0
var _pck_finished_callback: Callable


func _build_panel() -> void:
	super._build_panel()
	var primary := _details_button.get_parent() as VBoxContainer
	var controls := VBoxContainer.new()
	controls.add_theme_constant_override("separation", 10)
	primary.add_child(controls)
	primary.move_child(controls, _details_button.get_index())
	_simple_label(controls, "长音检查（八秒）", 30)
	_simple_label(controls, "先播放，再手动暂停和继续，最后停止。原短音和更多检查保留。", 24)
	var first_row := HBoxContainer.new()
	controls.add_child(first_row)
	_pck_play_button = _pck_button(first_row, "播放长音", _request_pck_play)
	_pck_pause_button = _pck_button(first_row, "暂停长音", _request_pck_pause)
	var second_row := HBoxContainer.new()
	controls.add_child(second_row)
	_pck_resume_button = _pck_button(second_row, "继续长音", _request_pck_resume)
	_pck_stop_button = _pck_button(second_row, "停止长音", _request_pck_stop)
	_pck_label = _simple_label(controls, "", 24)
	_simple_label(controls, "按钮只记录请求；结束信号也可能来自错误。是否听见、是否真的暂停或继续，请手动观察。", 24)
	_pck_player = AudioStreamPlayer.new()
	_pck_player.max_polyphony = 1
	_pck_player.playback_type = AudioServer.PLAYBACK_TYPE_SAMPLE
	_pck_player.stream = PCK_LONG_TONE
	add_child(_pck_player)
	_refresh_pck_audio()


func _pck_button(parent: Node, caption: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = caption
	button.custom_minimum_size = Vector2(240, 88)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.add_theme_font_size_override("font_size", 30)
	button.pressed.connect(action)
	parent.add_child(button)
	return button


func set_page_active(active: bool) -> void:
	super.set_page_active(active)
	_refresh_pck_audio()
	# Navigation changes only UI/input availability; no automatic audio action.


func _request_pck_play() -> void:
	if not _page_active or _pck_active_generation != 0 or _pck_generation >= MAX_COUNT:
		return
	_pck_generation += 1
	_pck_active_generation = _pck_generation
	_pck_intent = "PLAY"
	_pck_finished_callback = _pck_did_finish.bind(_pck_generation)
	_pck_player.finished.connect(_pck_finished_callback)
	_pck_last_event = "PLAY_REQUEST"
	_record("PCK_LONG_PLAY_REQUEST", {"generation": _pck_generation, "seconds": 8, "resourceKind": "ORDINARY_PCK_WAV", "nativeRoute": "UNKNOWN", "audibleResult": "UNKNOWN"})
	_pck_player.stream_paused = false
	_pck_player.play()
	_read_pck_registration.call_deferred(_pck_generation)
	_refresh_pck_audio()


func _request_pck_pause() -> void:
	if not _page_active or _pck_active_generation == 0 or _pck_intent != "PLAY":
		return
	_pck_intent = "PAUSE"
	_pck_last_event = "PAUSE_REQUEST"
	_record("PCK_LONG_PAUSE_REQUEST", {"generation": _pck_active_generation, "pauseObserved": "UNKNOWN"})
	_pck_player.stream_paused = true
	_read_pck_registration(_pck_active_generation)
	_refresh_pck_audio()


func _request_pck_resume() -> void:
	if not _page_active or _pck_active_generation == 0 or _pck_intent != "PAUSE":
		return
	_pck_intent = "PLAY"
	_pck_last_event = "RESUME_REQUEST"
	_record("PCK_LONG_RESUME_REQUEST", {"generation": _pck_active_generation, "resumeObserved": "UNKNOWN"})
	_pck_player.stream_paused = false
	_read_pck_registration(_pck_active_generation)
	_refresh_pck_audio()


func _request_pck_stop() -> void:
	if not _page_active or _pck_active_generation == 0:
		return
	var generation := _pck_active_generation
	_pck_active_generation = 0
	_pck_intent = "NONE"
	_disconnect_pck_finished()
	_pck_last_event = "STOP_REQUEST"
	_record("PCK_LONG_STOP_REQUEST", {"generation": generation, "finishedInferred": false, "stopObserved": "UNKNOWN"})
	_pck_player.stop()
	_refresh_pck_audio()


func _disconnect_pck_finished() -> void:
	if _pck_finished_callback.is_valid() and _pck_player.finished.is_connected(_pck_finished_callback):
		_pck_player.finished.disconnect(_pck_finished_callback)
	_pck_finished_callback = Callable()


func _pck_did_finish(generation: int) -> void:
	if _pck_active_generation == 0 or generation != _pck_active_generation:
		return
	_pck_active_generation = 0
	_pck_intent = "NONE"
	_pck_finished_count = _increment(_pck_finished_count)
	_disconnect_pck_finished()
	_pck_last_event = "FINISHED_SIGNAL_WITHOUT_EXPLICIT_STOP"
	_record("PCK_LONG_FINISHED_SIGNAL", {"generation": generation, "finishedSignals": _pck_finished_count, "naturalPlaybackSuccess": "UNKNOWN", "audibleResult": "UNKNOWN", "nativeRoute": "UNKNOWN"})
	_refresh_pck_audio()


func _refresh_pck_audio() -> void:
	if not is_instance_valid(_pck_label):
		return
	_pck_label.text = "请求状态：%s\n当前轮次：%d；结束信号：%d。\n这些记录不判断听感或播放后端。" % [_pck_last_event, _pck_active_generation, _pck_finished_count]
	_pck_play_button.disabled = not _page_active or _pck_active_generation != 0
	_pck_pause_button.disabled = not _page_active or _pck_active_generation == 0 or _pck_intent != "PLAY"
	_pck_resume_button.disabled = not _page_active or _pck_active_generation == 0 or _pck_intent != "PAUSE"
	_pck_stop_button.disabled = not _page_active or _pck_active_generation == 0


func _read_pck_registration(generation: int) -> void:
	if _pck_exiting or not _page_active or generation == 0 or generation != _pck_active_generation or _pck_registration_reads >= 4:
		return
	_pck_registration_reads += 1
	var summary := {"matched": "UNKNOWN", "scope": "REGISTRATION_ONLY"}
	if OS.has_feature("web"):
		var debug = JavaScriptBridge.get_interface("GodotAudioDebug")
		if debug != null and debug.listStreams != null:
			var entries = debug.listStreams()
			if entries is JavaScriptObject:
				var size = entries.length
				if (size is int or size is float) and is_finite(float(size)) and size >= 0 and size <= 128 and size == floorf(float(size)):
					var target := str(PCK_LONG_TONE.get_instance_id())
					for index in range(int(size)):
						var entry = entries[index]
						if not entry is JavaScriptObject or entry.length != 2:
							continue
						var stream_id = entry[0]
						if not stream_id is String or stream_id != target:
							continue
						summary.matched = "YES"
						break
	_record("PCK_LONG_REGISTRATION", summary)


func _exit_tree() -> void:
	_pck_exiting = true
	_pck_active_generation = 0
	if is_instance_valid(_pck_player):
		_disconnect_pck_finished()
