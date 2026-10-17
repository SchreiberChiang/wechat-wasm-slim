extends Control
## 2D 打星星：星星从上往下掉（shader 画的五角星），点中爆粒子、音效、震动，漏掉屏幕抖动。30 秒一局。

const ROUND_SECONDS := 30.0
const MODE := "2d"

var bg_mat: ShaderMaterial
var star_shader: Shader = preload("res://shaders/star.gdshader")
var field: Control
var hud: Label
var feed_label: Label
var result_box: VBoxContainer
var result_label: Label

var stars: Array[Dictionary] = []
var score := 0
var combo := 0
var time_left := 0.0
var spawn_left := 0.0
var playing := false
var shake := 0.0
var energy := 0.0


func _ready() -> void:
	bg_mat = UI.background(self)
	field = Control.new()
	field.set_anchors_preset(Control.PRESET_FULL_RECT)
	field.gui_input.connect(_on_input)
	add_child(field)
	hud = UI.label("", 32)
	hud.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hud.position.y = 170 # 避开手机刘海和小游戏右上角胶囊按钮
	add_child(hud)
	feed_label = UI.label("", 24)
	feed_label.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	feed_label.position.y = -80
	feed_label.add_theme_color_override("font_color", Color(0.7, 0.8, 1.0))
	add_child(feed_label)
	var back := UI.button("< TITLE", _to_title, 64)
	back.position = Vector2(24, 96)
	back.custom_minimum_size = Vector2(170, 64)
	back.add_theme_font_size_override("font_size", 24)
	add_child(back)
	result_box = UI.column(self, 560, -340)
	result_box.visible = false
	result_label = UI.label("", 34)
	result_box.add_child(result_label)
	result_box.add_child(UI.button("PLAY AGAIN", _start_round))
	result_box.add_child(UI.button("TITLE", _to_title))
	print("[STARTUP_3D_FLOW] {\"event\":\"scene_first_frame\",\"scene\":\"2d\"}")
	_start_round()


func _to_title() -> void:
	get_tree().change_scene_to_file(Game.TITLE)


func _start_round() -> void:
	_clear_stars()
	result_box.visible = false
	score = 0
	combo = 0
	time_left = ROUND_SECONDS
	spawn_left = 0.3
	playing = true
	Game.play_sfx("start")
	Game.vibrate(30)
	print("[DEMO] ROUND_START mode=2d")
	if Game.qa.has("qa-shot"):
		await get_tree().create_timer(6.0).timeout
		get_viewport().get_texture().get_image().save_png(str(Game.qa["qa-shot"]))
		print("[DEMO] SHOT saved")


func _clear_stars() -> void:
	for s in stars:
		s.node.queue_free()
	stars.clear()


func _spawn_star() -> void:
	var size := randf_range(100.0, 140.0)
	var r := ColorRect.new()
	r.size = Vector2(size, size)
	r.pivot_offset = r.size / 2
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = star_shader
	var c := Color.from_hsv(randf(), 0.55, 1.0)
	m.set_shader_parameter("tint", Vector3(c.r, c.g, c.b))
	m.set_shader_parameter("pulse_speed", randf_range(3.0, 7.0))
	r.material = m
	var w := get_viewport_rect().size.x
	r.position = Vector2(randf_range(20.0, w - size - 20.0), -size)
	field.add_child(r)
	stars.append({"node": r, "speed": randf_range(260.0, 420.0) + (ROUND_SECONDS - time_left) * 8.0, "spin": randf_range(-2.0, 2.0), "color": c})


func _process(delta: float) -> void:
	shake = maxf(shake - delta * 3.0, 0.0)
	position = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * 18.0 * shake
	energy = move_toward(energy, 0.0, delta * 1.5)
	bg_mat.set_shader_parameter("energy", energy)
	feed_label.text = Game.feed
	if not playing:
		return
	time_left -= delta
	spawn_left -= delta
	if spawn_left <= 0.0:
		spawn_left = maxf(0.75 - (ROUND_SECONDS - time_left) * 0.015, 0.35)
		_spawn_star()
	var h := get_viewport_rect().size.y
	for s in stars.duplicate():
		var n: ColorRect = s.node
		n.position.y += s.speed * delta
		n.rotation += s.spin * delta
		if n.position.y > h:
			_miss(s)
	if Game.qa.has("qa-play"):
		for s in stars:
			if s.node.position.y > 300:
				_pop(s)
				break
	hud.text = "2D   SCORE %d   TIME %d   x%d\n%s   best %d   online %d" % [score, ceili(time_left), combo, Game.net.username, Game.best[MODE], Game.online]
	if time_left <= 0.0:
		_end_round()


func _on_input(e: InputEvent) -> void:
	if not playing or not (e is InputEventMouseButton and e.pressed):
		return
	for s in stars:
		var n: ColorRect = s.node
		if e.position.distance_to(n.position + n.size / 2) < n.size.x * 0.6:
			_pop(s)
			return


func _pop(s: Dictionary) -> void:
	var n: ColorRect = s.node
	stars.erase(s)
	combo += 1
	score += 1 + combo / 5
	_burst(n.position + n.size / 2, s.color)
	Game.play_sfx("pop", 1.0 + minf(combo, 12) * 0.05)
	Game.vibrate(15)
	energy = minf(energy + 0.35, 1.6)
	n.queue_free()


func _miss(s: Dictionary) -> void:
	stars.erase(s)
	s.node.queue_free()
	combo = 0
	shake = 1.0
	Game.play_sfx("miss")
	Game.vibrate(60)


func _burst(at: Vector2, c: Color) -> void:
	var p := CPUParticles2D.new()
	p.position = at
	p.one_shot = true
	p.explosiveness = 1.0
	p.amount = 28
	p.lifetime = 0.7
	p.spread = 180.0
	p.initial_velocity_min = 180.0
	p.initial_velocity_max = 460.0
	p.gravity = Vector2(0, 700)
	p.scale_amount_min = 6.0
	p.scale_amount_max = 12.0
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1))
	g.set_color(1, Color(c.r, c.g, c.b, 0.0))
	p.color_ramp = g
	field.add_child(p)
	p.emitting = true
	p.finished.connect(p.queue_free)


func _end_round() -> void:
	playing = false
	_clear_stars()
	print("[DEMO] ROUND_DONE mode=2d score=%d" % score)
	result_label.text = "TIME UP!\nscore %d\nsubmitting..." % score
	result_box.visible = true
	Game.vibrate(200)
	var r := await Game.submit_score(score, MODE)
	if not is_inside_tree():
		return
	if not r.ok:
		result_label.text = "TIME UP!\nscore %d\n%s" % [score, r.data.get("error", "submit failed")]
	else:
		var lines := PackedStringArray()
		for t in r.data.top:
			lines.append("%s  %d" % [t.name, t.best])
		result_label.text = "TIME UP!\nscore %d   best %d%s\n\nTOP 2D\n%s" % [score, r.data.best, "  NEW!" if r.data.record else "", "\n".join(lines)]
	if Game.qa.has("qa-quit"):
		await get_tree().create_timer(1.5).timeout
		get_tree().quit()
