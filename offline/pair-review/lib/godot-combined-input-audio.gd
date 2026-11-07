# Source-only extension of the existing bounded observation panel.
# No autoplay, filesystem, network, JS eval, host mutation or recovery policy.
extends "res://capability-observation.gd"

const LONG_SECONDS := 3.2
const DEFAULT_NATIVE_SECONDS := 3.0 # Fixed GodotAudio.WX default; runtime override may differ.
const AUDIO_STAT_FIELDS := ["streams", "activePlaybacks", "pooledContexts", "cacheBytes", "cacheLimitBytes", "cacheEntries"]

var _page_active := false
var _ime: LineEdit
var _ime_label: Label
var _extra_input_label: Label
var _long_label: Label
var _native_label: Label
var _long_player: AudioStreamPlayer
var _long_finished_callback: Callable
var _ime_changes := 0
var _ime_submits := 0
var _ime_focus_in := 0
var _ime_focus_out := 0
var _wheel_count := 0
var _wheel_last_button := 0
var _wheel_factor := "UNKNOWN"
var _cancel_true := 0
var _cancel_false := 0
var _cancel_unknown := 0
var _tracking_resets := 0
var _long_requests := 0
var _long_stops := 0
var _long_finished := 0
var _long_generation := 0
var _long_active_generation := 0
var _last_hearing := "NOT_REPORTED"


func _ready() -> void:
	super._ready()
	set_page_active(_page_active)


func _build_panel() -> void:
	super._build_panel()
	_label(_body, "IME: manually type Chinese or other text, delete, submit and close. Logs contain lengths/counts only; preedit and platform keyboard closure remain UNKNOWN.")
	_ime = LineEdit.new()
	_ime.placeholder_text = "Type text manually; contents are never logged"
	_ime.max_length = 128
	_ime.custom_minimum_size.y = 38
	_ime.text_changed.connect(_ime_changed)
	_ime.text_submitted.connect(_ime_submitted)
	_ime.focus_entered.connect(_ime_focus_entered)
	_ime.focus_exited.connect(_ime_focus_exited)
	_body.add_child(_ime)
	_ime_label = _label(_body, "")
	_add_manual_button("Release text focus (not keyboard-close proof)", _release_ime_focus)
	_extra_input_label = _label(_body, "")
	_add_manual_button("Record input summary", _record_input_summary)
	_label(_body, "Long tone: 3.2 s / 330 Hz, quiet. The fixed default native threshold is 3 s; a runtime override may differ. Duration, finished signals and hearing do not identify the backend.")
	_add_manual_button("Play long tone once (manual)", _play_long)
	_add_manual_button("Stop long tone (manual)", _stop_long)
	_add_manual_button("I heard the requested long tone", _report_hearing.bind("YES"))
	_add_manual_button("I did not hear the requested long tone", _report_hearing.bind("NO"))
	_long_label = _label(_body, "")
	_add_manual_button("Read native audio counters / threshold", _read_native_audio)
	_native_label = _label(_body, "Native audio: UNKNOWN / not read. No route inferred from duration.")
	_long_player = AudioStreamPlayer.new()
	_long_player.max_polyphony = 1
	_long_player.playback_type = AudioServer.PLAYBACK_TYPE_SAMPLE
	add_child(_long_player)
	_refresh_ime()
	_refresh_extra_input()
	_refresh_long()


func _add_manual_button(caption: String, action: Callable) -> void:
	var button := Button.new()
	button.text = caption
	button.custom_minimum_size.y = 38
	button.pressed.connect(action)
	_body.add_child(button)


func set_page_active(active: bool) -> void:
	var was_active := _page_active
	_page_active = active
	set_process_input(active)
	if was_active and not active and (not _points.is_empty() or _mouse_down):
		# Up events are unobserved while this page is inactive. Invalidate only
		# tracking state; neither release nor canceled counters are fabricated.
		var tracked_touches := _points.size()
		var tracked_mouse := _mouse_down
		_points.clear()
		_mouse_down = false
		_has_release = false
		_tracking_resets = _increment(_tracking_resets)
		_record("PAGE_HIDE_INPUT_TRACKING_INVALIDATED", {"trackedTouches": tracked_touches, "trackedMouse": tracked_mouse, "resets": _tracking_resets, "releaseInferred": false, "cancelInferred": false, "touchLifecycleCompleteness": "UNKNOWN"})
		if is_instance_valid(_area):
			_refresh_input_labels()
			_refresh_extra_input()
			_area.queue_redraw()
	if is_instance_valid(_panel):
		_panel.visible = active
	if is_instance_valid(_ime):
		_ime.editable = active
		if not active:
			_ime.release_focus()
	# Hidden Controls cannot receive GUI actions. Do not stop process/lifecycle,
	# stop/replay audio or invent touch-release events.
	if not active:
		var focused := get_viewport().gui_get_focus_owner()
		if focused != null and is_ancestor_of(focused):
			focused.release_focus()


func _ime_changed(value: String) -> void:
	_ime_changes = _increment(_ime_changes)
	_record("IME_TEXT_CHANGED", {"length": value.length(), "changes": _ime_changes})
	_refresh_ime()


func _ime_submitted(value: String) -> void:
	_ime_submits = _increment(_ime_submits)
	_record("IME_TEXT_SUBMITTED", {"length": value.length(), "submits": _ime_submits})
	_refresh_ime()


func _ime_focus_entered() -> void:
	_ime_focus_in = _increment(_ime_focus_in)
	_record("IME_FOCUS_IN", {"count": _ime_focus_in})
	_refresh_ime()


func _ime_focus_exited() -> void:
	_ime_focus_out = _increment(_ime_focus_out)
	_record("IME_FOCUS_OUT", {"count": _ime_focus_out, "platformKeyboardClosed": "UNKNOWN"})
	_refresh_ime()


func _release_ime_focus() -> void:
	if _page_active:
		_ime.release_focus()


func _refresh_ime() -> void:
	_ime_label.text = "IME: length %d / changes %d / submits %d / focus in-out %d-%d. User text omitted." % [_ime.text.length(), _ime_changes, _ime_submits, _ime_focus_in, _ime_focus_out]


func _input(event: InputEvent) -> void:
	if not _page_active or not is_instance_valid(_area):
		return
	if event is InputEventScreenTouch and event.device != InputEvent.DEVICE_ID_EMULATION:
		var point := _local_point(event.position)
		if _inside(point) or _points.has(event.index):
			var has_canceled := false
			for property in event.get_property_list():
				if property.get("name") == "canceled":
					has_canceled = true
					break
			var canceled: Variant = event.get("canceled") if has_canceled else null
			if canceled is bool:
				if canceled:
					_cancel_true = _increment(_cancel_true)
					_record("TOUCH_CANCELED_PROPERTY_TRUE", {"count": _cancel_true, "pressed": event.pressed})
				else:
					_cancel_false = _increment(_cancel_false)
			else:
				_cancel_unknown = _increment(_cancel_unknown)
			_refresh_extra_input()
	elif event is InputEventMouseButton and event.pressed and event.device != InputEvent.DEVICE_ID_EMULATION:
		if event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT] and _inside(_local_point(event.position)):
			_wheel_count = _increment(_wheel_count)
			_wheel_last_button = event.button_index
			_wheel_factor = str(event.factor) if is_finite(event.factor) else "UNKNOWN"
			_refresh_extra_input()
	# Preserve the original multi-touch/mouse/emulation handling and log budget.
	super._input(event)


func _refresh_extra_input() -> void:
	_extra_input_label.text = "Wheel: %d / last button %d / factor %s (no deltaMode inferred). Touch canceled property true-false-unknown: %d-%d-%d. Page-hide tracking resets: %d (interrupted lifecycle UNKNOWN; no release/cancel inferred)." % [_wheel_count, _wheel_last_button, _wheel_factor, _cancel_true, _cancel_false, _cancel_unknown, _tracking_resets]


func _record_input_summary() -> void:
	if _page_active:
		_record("INPUT_EXTRA_SUMMARY", {"wheelCount": _wheel_count, "lastWheelButton": _wheel_last_button, "wheelFactor": _wheel_factor, "canceledTrue": _cancel_true, "canceledFalse": _cancel_false, "canceledUnknown": _cancel_unknown})


func _play_long() -> void:
	if not _page_active or _long_active_generation != 0 or _long_generation >= MAX_COUNT:
		return
	var sample_rate := 22050
	var frames := int(sample_rate * LONG_SECONDS)
	var samples := PackedByteArray()
	samples.resize(frames * 2)
	for frame in range(frames):
		var envelope := minf(1.0, minf(float(frame) / 220.0, float(frames - 1 - frame) / 220.0))
		samples.encode_s16(frame * 2, int(sin(TAU * 330.0 * frame / sample_rate) * 32767.0 * 0.05 * envelope))
	var tone := AudioStreamWAV.new()
	tone.format = AudioStreamWAV.FORMAT_16_BITS
	tone.mix_rate = sample_rate
	tone.stereo = false
	tone.data = samples
	_disconnect_long_finished()
	_long_generation += 1
	_long_active_generation = _long_generation
	_long_requests = _increment(_long_requests)
	_last_hearing = "NOT_REPORTED"
	_long_finished_callback = _long_did_finish.bind(_long_generation)
	_long_player.finished.connect(_long_finished_callback)
	_long_player.stream = tone
	_record("LONG_TONE_REQUEST", {"generation": _long_generation, "requests": _long_requests, "seconds": LONG_SECONDS, "nativeRoute": "UNKNOWN"})
	_long_player.play()
	_refresh_long()


func _stop_long() -> void:
	if not _page_active or _long_active_generation == 0:
		return
	var stopped_generation := _long_active_generation
	_long_active_generation = 0 # Invalidate before stop, including synchronous callbacks.
	_long_stops = _increment(_long_stops)
	_disconnect_long_finished()
	_long_player.stop()
	_record("LONG_TONE_STOP_REQUEST", {"generation": stopped_generation, "stops": _long_stops})
	_refresh_long()


func _disconnect_long_finished() -> void:
	if _long_finished_callback.is_valid() and _long_player.finished.is_connected(_long_finished_callback):
		_long_player.finished.disconnect(_long_finished_callback)
	_long_finished_callback = Callable()


func _long_did_finish(generation: int) -> void:
	if generation != _long_active_generation or _long_active_generation == 0:
		return
	_long_active_generation = 0
	_long_finished = _increment(_long_finished)
	_disconnect_long_finished()
	# Native finished may also report terminal errors. Do not label it audible or
	# successful natural playback; explicit stop never increments this counter.
	_record("LONG_FINISHED_WITHOUT_STOP", {"generation": generation, "finishedSignals": _long_finished, "naturalPlaybackSuccess": "UNKNOWN"})
	_refresh_long()


func _report_hearing(answer: String) -> void:
	if not _page_active or _long_generation == 0:
		return
	_last_hearing = answer
	_record("LONG_HEARING_REPORT", {"generation": _long_generation, "heard": answer, "source": "MANUAL_REPORT"})
	_refresh_long()


func _refresh_long() -> void:
	_long_label.text = "Long tone: requests %d / stop requests %d / finished without stop %d / active generation %d. Heard: %s. Natural playback success UNKNOWN; signals are not sound." % [_long_requests, _long_stops, _long_finished, _long_active_generation, _last_hearing]


func _read_native_audio() -> void:
	if not _page_active:
		return
	var summary: Dictionary = {"nativeRoute": "UNKNOWN", "thresholdSeconds": "UNKNOWN", "stats": "UNKNOWN"}
	if OS.has_feature("web"):
		var root = JavaScriptBridge.get_interface("GameGlobal")
		var reflect = JavaScriptBridge.get_interface("Reflect")
		if root != null and reflect != null and reflect.has != null:
			# Reflect.has also observes inherited overrides used by the engine.
			var has_override = reflect.has(root, "__godotMinigameNativeAudioMinDurationSeconds")
			if has_override is bool and not has_override:
				summary.thresholdSeconds = DEFAULT_NATIVE_SECONDS
			elif has_override is bool and has_override:
				var configured = root.__godotMinigameNativeAudioMinDurationSeconds
				if (configured is int or configured is float) and is_finite(float(configured)) and float(configured) >= 0.0:
					summary.thresholdSeconds = float(configured)
				# Engine applies JS Number() coercion. Other types stay UNKNOWN here.
		var debug = JavaScriptBridge.get_interface("GodotAudioDebug")
		if debug != null and debug.getStats != null:
			var stats = debug.getStats()
			if stats is JavaScriptObject:
				var counts: Dictionary = {}
				for field in AUDIO_STAT_FIELDS:
					counts[field] = _count_text(stats[field])
				summary.stats = counts
	_record("NATIVE_AUDIO_COUNTERS", summary)
	_native_label.text = "Native audio read: " + JSON.stringify(summary) + ". Counters and threshold alone do not identify this player/backend."
