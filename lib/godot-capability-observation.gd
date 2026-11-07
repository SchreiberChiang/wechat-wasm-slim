# Source-only capability observation overlay. Add as a Control child of the
# existing simple scene; do not replace its viewport/material/render setup.
# No autoplay, filesystem, network, user text, GL queries, eval, or pause policy.
# Counters are observations, never device/visual/audio acceptance receipts.
extends Control

const HOST_NAME := "WxslimCapabilityObservation"
const HOST_SCHEMA := "wxslim-capability-observation-v1"
const POLL_SECONDS := 0.25
const MAX_HOST_BYTES := 8192
const MAX_COUNT := 2147483647
const MAX_POINTS := 32
const MAX_LOG_LINES := 128 # 127 event lines + at most one TRUNCATED line.

var _panel: PanelContainer
var _body: VBoxContainer
var _scroll: ScrollContainer
var _toggle: Button
var _area: Control
var _touch_label: Label
var _mouse_label: Label
var _audio_label: Label
var _godot_label: Label
var _host_label: Label
var _log_label: Label
var _audio: AudioStreamPlayer
var _expanded := false
var _points: Dictionary = {}
var _mouse_down := false
var _mouse_position := Vector2.ZERO
var _last_release := Vector2.ZERO
var _has_release := false
var _presses := 0
var _moves := 0
var _releases := 0
var _mouse_presses := 0
var _mouse_moves := 0
var _mouse_releases := 0
var _emulated_events := 0
var _audio_requests := 0
var _audio_finished := 0
var _overflow := false
var _notifications: Dictionary = {"focus_in": 0, "focus_out": 0, "paused": 0, "resumed": 0}
var _recent_notifications: Array[String] = []
var _poll_elapsed := 0.0
var _last_host_projection := ""
var _host_identity: Dictionary = {"packageId": "UNKNOWN", "session": "UNKNOWN"}
var _last_host_sequence := "UNREAD"
var _log_lines := 0
var _log_dropped := 0
var _log_truncated := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	z_index = 100
	_build_panel()
	_refresh_log_label()
	resized.connect(_layout_panel)
	_layout_panel()
	_refresh_input_labels()
	_refresh_audio_label()
	_refresh_notifications()
	if OS.has_feature("web"):
		_set_host_text("Host: UNKNOWN / not read yet. wx events are separate from Godot notifications.")
	else:
		_set_host_text("Host: NATIVE / NOT HOST. No wx lifecycle observations.")
	# First host read also waits 250 ms. No catch-up loop or per-frame logging.


func _build_panel() -> void:
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_panel)
	var column := VBoxContainer.new()
	_panel.add_child(column)
	_toggle = Button.new()
	_toggle.text = "Capability observations [+] (not acceptance)"
	_toggle.custom_minimum_size.y = 38
	_toggle.pressed.connect(_toggle_panel)
	column.add_child(_toggle)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.visible = false
	column.add_child(_scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_body)
	_label(_body, "Touch events only: start inside the box; drag/release outside still counted.\nMouse/emulated events are separate and DO NOT prove touch.")
	_area = Control.new()
	_area.custom_minimum_size = Vector2(0, 104)
	_area.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_area.clip_contents = true
	_area.draw.connect(_draw_touch_area)
	_body.add_child(_area)
	_touch_label = _label(_body, "")
	_mouse_label = _label(_body, "")
	var play := Button.new()
	play.text = "Play quiet tone: 0.3 s / 440 Hz (manual)"
	play.custom_minimum_size.y = 38
	play.pressed.connect(_play_tone)
	_body.add_child(play)
	_audio_label = _label(_body, "")
	_godot_label = _label(_body, "")
	_host_label = _label(_body, "")
	_log_label = _label(_body, "Event log: 0 lines / 0 dropped (128-line cap; no move logs).")
	_audio = AudioStreamPlayer.new()
	_audio.finished.connect(_tone_finished)
	add_child(_audio)


func _label(parent: Node, text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", 14)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label


func _layout_panel() -> void:
	if not is_instance_valid(_panel):
		return
	var width := maxf(80.0, minf(600.0, size.x - 24.0))
	_panel.custom_minimum_size.x = width
	_panel.size.x = width
	_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	_panel.offset_left = 12.0
	_panel.offset_right = 12.0 + width
	_panel.offset_bottom = -12.0
	# Hidden autowrap labels can report enormous temporary minimum heights.
	# Keep panel geometry bounded; scroll content never determines its top edge.
	var height := minf(460.0, maxf(38.0, size.y - 24.0)) if _expanded else 38.0
	_panel.offset_top = -12.0 - height


func _toggle_panel() -> void:
	_expanded = not _expanded
	_scroll.visible = _expanded
	_toggle.text = "Capability observations [-] (not acceptance)" if _expanded else "Capability observations [+] (not acceptance)"
	_record("PANEL_EXPANDED" if _expanded else "PANEL_COLLAPSED")
	# Container minimum sizes settle deferred; no viewport changes.
	_layout_panel.call_deferred()


func _increment(value: int) -> int:
	if value >= MAX_COUNT:
		if not _overflow:
			_record("LOCAL_COUNTER_LIMIT", {"overflow": true})
		_overflow = true
		return MAX_COUNT
	return value + 1


func _local_point(viewport_point: Vector2) -> Vector2:
	return _area.get_global_transform_with_canvas().affine_inverse() * viewport_point


func _inside(point: Vector2) -> bool:
	return _expanded and Rect2(Vector2.ZERO, _area.size).has_point(point)


func _input(event: InputEvent) -> void:
	if not is_instance_valid(_area):
		return
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		# Fixed input.cpp marks mouse->touch emulation with device -1.
		# This excludes engine-marked emulation, not synthetic upstream events.
		if event.device == InputEvent.DEVICE_ID_EMULATION:
			if _inside(_local_point(event.position)):
				_emulated_events = _increment(_emulated_events)
				_refresh_input_labels()
			return
		var point := _local_point(event.position)
		if event is InputEventScreenTouch:
			if event.pressed and _inside(point):
				if _points.size() >= MAX_POINTS and not _points.has(event.index):
					_overflow = true
					_record("TOUCH_POINT_LIMIT", {"index": event.index, "activeCount": _points.size(), "inside": true})
				else:
					_points[event.index] = point
					_presses = _increment(_presses)
					_record("TOUCH_DOWN", {"index": event.index, "count": _presses, "activeCount": _points.size(), "inside": true})
			elif not event.pressed and _points.has(event.index):
				_points.erase(event.index)
				_last_release = point
				_has_release = true
				_releases = _increment(_releases)
				_record("TOUCH_UP", {"index": event.index, "count": _releases, "activeCount": _points.size(), "inside": _inside(point)})
		elif _points.has(event.index):
			_points[event.index] = point
			_moves = _increment(_moves)
		_refresh_input_labels()
		_area.queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.device == InputEvent.DEVICE_ID_EMULATION:
			return # Do not double-count touch->mouse emulation as physical mouse.
		var point := _local_point(event.position)
		if event.pressed and _inside(point):
			_mouse_down = true
			_mouse_position = point
			_mouse_presses = _increment(_mouse_presses)
		elif not event.pressed and _mouse_down:
			_mouse_down = false
			_mouse_releases = _increment(_mouse_releases)
		_refresh_input_labels()
		_area.queue_redraw()
	elif event is InputEventMouseMotion and _mouse_down and event.device != InputEvent.DEVICE_ID_EMULATION:
		_mouse_position = _local_point(event.position)
		_mouse_moves = _increment(_mouse_moves)
		_refresh_input_labels()
		_area.queue_redraw()
	# Do not mark input handled or alter Input's emulation flags.


func _draw_touch_area() -> void:
	_area.draw_rect(Rect2(Vector2.ZERO, _area.size), Color(0.05, 0.09, 0.14, 0.95))
	_area.draw_rect(Rect2(Vector2.ONE, _area.size - Vector2(2, 2)), Color.CYAN, false, 1.0)
	for id in _points:
		var point: Vector2 = _points[id]
		_area.draw_circle(point, 11.0, Color.CYAN)
		_area.draw_string(_area.get_theme_default_font(), point + Vector2(14, 0), "touch %d" % id, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)
	if _has_release:
		_area.draw_circle(_last_release, 7.0, Color(0.4, 0.8, 0.5), false, 2.0)
	if _mouse_down:
		_area.draw_circle(_mouse_position, 9.0, Color.ORANGE)
		_area.draw_string(_area.get_theme_default_font(), _mouse_position + Vector2(12, 0), "MOUSE (not touch)", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.ORANGE)


func _refresh_input_labels() -> void:
	_touch_label.text = "ScreenTouch/Drag: down %d / move %d / up %d / active %d / overflow %s" % [_presses, _moves, _releases, _points.size(), str(_overflow)]
	_mouse_label.text = "MOUSE ONLY: down %d / move %d / up %d; emulated screen events excluded %d" % [_mouse_presses, _mouse_moves, _mouse_releases, _emulated_events]


func _play_tone() -> void:
	# Same bounded PCM recipe as glx-smoke: manual request, not audible proof.
	var sample_rate := 22050
	var frames := int(sample_rate * 0.3)
	var samples := PackedByteArray()
	samples.resize(frames * 2)
	for frame in range(frames):
		var envelope := minf(1.0, minf(float(frame) / 220.0, float(frames - 1 - frame) / 220.0))
		var value := int(sin(TAU * 440.0 * frame / sample_rate) * 32767.0 * 0.08 * envelope)
		samples.encode_s16(frame * 2, value)
	var tone := AudioStreamWAV.new()
	tone.format = AudioStreamWAV.FORMAT_16_BITS
	tone.mix_rate = sample_rate
	tone.stereo = false
	tone.data = samples
	_audio_requests = _increment(_audio_requests)
	_record("MANUAL_TONE_REQUEST", {"count": _audio_requests, "finishedCount": _audio_finished})
	_audio.stream = tone
	_audio.play()
	_refresh_audio_label()


func _tone_finished() -> void:
	_audio_finished = _increment(_audio_finished)
	_record("TONE_FINISHED_SIGNAL", {"count": _audio_finished, "requestCount": _audio_requests})
	_refresh_audio_label()


func _refresh_audio_label() -> void:
	_audio_label.text = "Audio: requested %d / finished signals %d. NOT proof of sound. Re-tap can replace a tone." % [_audio_requests, _audio_finished]


func _notification(what: int) -> void:
	var event := ""
	match what:
		NOTIFICATION_APPLICATION_FOCUS_IN: event = "focus_in"
		NOTIFICATION_APPLICATION_FOCUS_OUT: event = "focus_out"
		NOTIFICATION_APPLICATION_PAUSED: event = "paused"
		NOTIFICATION_APPLICATION_RESUMED: event = "resumed"
	if event.is_empty() or _notifications.is_empty():
		return
	_notifications[event] = _increment(_notifications[event])
	_record("GODOT_NOTIFICATION", {"notification": event, "count": _notifications[event]})
	_recent_notifications.append(event)
	if _recent_notifications.size() > 4:
		_recent_notifications.pop_front()
	if is_instance_valid(_godot_label):
		_refresh_notifications()
	# Preserve actual notifications only: do not pause/unpause or release touches.


func _refresh_notifications() -> void:
	_godot_label.text = "Godot notifications: focus in/out %d/%d; pause/resume %d/%d. Recent: %s" % [_notifications.focus_in, _notifications.focus_out, _notifications.paused, _notifications.resumed, ", ".join(_recent_notifications)]


func _process(delta: float) -> void:
	if not OS.has_feature("web"):
		return
	_poll_elapsed += delta
	if _poll_elapsed < POLL_SECONDS:
		return
	_poll_elapsed = 0.0
	_poll_host()


func _count_text(value: Variant) -> String:
	if (value is int or value is float) and is_finite(float(value)) and value >= 0 and value <= MAX_COUNT and float(value) == floorf(float(value)):
		return str(int(value))
	return "UNKNOWN"


func _poll_host() -> void:
	# A failed/missing current snapshot must not borrow an old identity.
	_host_identity = {"packageId": "UNKNOWN", "session": "UNKNOWN"}
	var host = JavaScriptBridge.get_interface(HOST_NAME)
	if host == null:
		_set_host_text("wx host: UNKNOWN / interface unavailable. Godot notifications are separate.")
		return
	var raw = host.getSnapshot()
	if not raw is String or raw.length() > MAX_HOST_BYTES or raw.to_utf8_buffer().size() > MAX_HOST_BYTES:
		_set_host_text("wx host: UNKNOWN / snapshot type or size rejected.")
		return
	var snapshot = JSON.parse_string(raw)
	if not snapshot is Dictionary or snapshot.get("schema") != HOST_SCHEMA:
		_set_host_text("wx host: UNKNOWN / snapshot schema rejected.")
		return
	var identity = snapshot.get("identity")
	if identity is Dictionary:
		_host_identity.packageId = _identity_token(identity.get("packageId"))
		_host_identity.session = _identity_token(identity.get("session"))
	var sequence := _count_text(snapshot.get("sequence"))
	var dropped := _count_text(snapshot.get("droppedEvents"))
	if sequence != _last_host_sequence:
		_last_host_sequence = sequence
		_record("WX_SEQUENCE_CHANGED", {"sequence": sequence, "hostDroppedEvents": dropped})
	var host_name := "wechat" if snapshot.get("host") == "wechat" else "UNKNOWN"
	var lifecycle = snapshot.get("lifecycle")
	if not lifecycle is Dictionary:
		_set_host_text("wx host: %s / lifecycle UNKNOWN (not zero)." % host_name)
		return
	var status: String = lifecycle.get("status", "unknown") if lifecycle.get("status", "unknown") in ["observing", "unknown", "failed", "unavailable"] else "unknown"
	var last: String = lifecycle.get("lastEvent", "UNKNOWN") if lifecycle.get("lastEvent") in ["none", "hide", "show"] else "UNKNOWN"
	var overflow = snapshot.get("overflow", lifecycle.get("overflow"))
	var overflow_text := str(overflow) if overflow is bool else "UNKNOWN"
	var warning_text := _warning_summary(snapshot.get("warnings"))
	_set_host_text("wx host: %s / wiring %s; hide/show %s/%s; last %s; seq %s / dropped %s; overflow %s. Warnings: %s (dropped %s). No pause policy inferred." % [host_name, status, _count_text(lifecycle.get("hideCount")), _count_text(lifecycle.get("showCount")), last, sequence, dropped, overflow_text, warning_text, _count_text(snapshot.get("droppedWarnings"))])


func _warning_summary(value: Variant) -> String:
	if not value is Array or value.size() > 32:
		return "UNKNOWN"
	var codes := PackedStringArray()
	for code in value:
		var token := _identity_token(code)
		codes.append(token if token.length() <= 64 else "UNKNOWN")
	return "none reported" if codes.is_empty() else ", ".join(codes)


func _set_host_text(text: String) -> void:
	if text == _last_host_projection:
		return
	_last_host_projection = text
	_record("HOST_PROJECTION_CHANGED", {"observation": text})
	if is_instance_valid(_host_label):
		_host_label.text = text
	if _expanded:
		_layout_panel.call_deferred()


func _identity_token(value: Variant) -> String:
	if not value is String or value.is_empty() or value.length() > 128:
		return "UNKNOWN"
	# IDs only, not arbitrary host text, paths, or newline injection.
	for character in value:
		var code: int = str(character).unicode_at(0)
		if not ((code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) or character in ["-", "_", ".", ":"]):
			return "UNKNOWN"
	return value


func _record(event: String, details: Dictionary = {}) -> void:
	# Every caller passes a locally constructed scalar projection, never a host
	# object, coordinates, mouse position, text input, URL, or pointer identifier.
	if _log_lines < MAX_LOG_LINES - 1:
		_log_lines += 1
		print("[CAPABILITY_OBSERVATION] " + JSON.stringify({"event": event, "logIndex": _log_lines, "packageId": _host_identity.packageId, "session": _host_identity.session, "details": details, "audio": "NOT_INFERRED", "touch": "NOT_INFERRED", "visual": "NOT_INFERRED"}))
	else:
		_log_dropped = mini(MAX_COUNT, _log_dropped + 1)
		if not _log_truncated:
			_log_truncated = true
			_log_lines += 1
			print("[CAPABILITY_OBSERVATION] " + JSON.stringify({"event": "TRUNCATED", "logIndex": _log_lines, "packageId": _host_identity.packageId, "session": _host_identity.session, "droppedEvents": _log_dropped, "audio": "NOT_INFERRED", "touch": "NOT_INFERRED", "visual": "NOT_INFERRED"}))
	if is_instance_valid(_log_label):
		_refresh_log_label()


func _refresh_log_label() -> void:
	if is_instance_valid(_log_label):
		_log_label.text = "Event log: %d lines / %d dropped / truncated %s (no move logs)." % [_log_lines, _log_dropped, str(_log_truncated)]
