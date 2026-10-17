extends Node3D
## 3D 打星星：透视相机、方向光、宝石感五角星（程序生成网格 + shader）从上方翻滚着掉下，
## 点中爆 3D 粒子、音效、震动，漏掉相机抖动。30 秒一局。不用物理引擎：点击用屏幕投影判断。

const ROUND_SECONDS := 30.0
const MODE := "3d"
const TOP_Y := 7.5
const BOTTOM_Y := -6.5

var cam := Camera3D.new()
var nebula_mat := ShaderMaterial.new()
var star_shader: Shader = preload("res://shaders/star3d.gdshader")
var star_mesh: ArrayMesh
var spark_mesh: SphereMesh
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
	_build_world()
	_build_hud()
	WxSplit.mark_first_frame("3d")
	_start_round()


func _build_world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.01, 0.01, 0.04)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.35, 0.3, 0.5)
	env.ambient_light_energy = 0.6
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, 30, 0)
	sun.light_energy = 1.3
	add_child(sun)
	var fill := OmniLight3D.new()
	fill.position = Vector3(0, 2, 6)
	fill.light_color = Color(0.6, 0.7, 1.0)
	fill.omni_range = 20.0
	add_child(fill)
	cam.position = Vector3(0, 0, 12)
	cam.fov = 60.0
	add_child(cam)
	cam.make_current()
	# 背景星云板
	var back := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(40, 60)
	back.mesh = quad
	nebula_mat.shader = load("res://shaders/nebula3d.gdshader")
	back.material_override = nebula_mat
	back.position = Vector3(0, 0, -14)
	add_child(back)
	# 地面网格
	var floor_mi := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	floor_mi.mesh = plane
	var grid := ShaderMaterial.new()
	grid.shader = load("res://shaders/grid3d.gdshader")
	floor_mi.material_override = grid
	floor_mi.position = Vector3(0, BOTTOM_Y - 1.0, -6)
	add_child(floor_mi)
	star_mesh = _make_star_mesh()
	spark_mesh = SphereMesh.new()
	spark_mesh.radius = 0.07
	spark_mesh.height = 0.14
	spark_mesh.radial_segments = 6
	spark_mesh.rings = 3
	var spark_mat := StandardMaterial3D.new()
	spark_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	spark_mat.vertex_color_use_as_albedo = true
	spark_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	spark_mesh.material = spark_mat


## 程序生成一个有厚度的五角星（正反两面向中心隆起，像宝石的切面）
func _make_star_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts: Array[Vector3] = []
	for i in 10:
		var a := PI / 2 + i * PI / 5
		var r := 1.0 if i % 2 == 0 else 0.45
		pts.append(Vector3(cos(a) * r, sin(a) * r, 0))
	var front := Vector3(0, 0, 0.38)
	var backc := Vector3(0, 0, -0.38)
	for i in 10:
		var p0 := pts[i]
		var p1 := pts[(i + 1) % 10]
		st.add_vertex(front); st.add_vertex(p1); st.add_vertex(p0)
		st.add_vertex(backc); st.add_vertex(p0); st.add_vertex(p1)
	st.generate_normals()
	return st.commit()


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)
	hud = UI.label("", 32)
	hud.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hud.position.y = 170
	root.add_child(hud)
	feed_label = UI.label("", 24)
	feed_label.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	feed_label.position.y = -80
	feed_label.add_theme_color_override("font_color", Color(0.7, 0.8, 1.0))
	root.add_child(feed_label)
	var back := UI.button("< TITLE", _to_title, 64)
	back.position = Vector2(24, 96)
	back.custom_minimum_size = Vector2(170, 64)
	back.add_theme_font_size_override("font_size", 24)
	root.add_child(back)
	result_box = UI.column(root, 560, -340)
	result_box.visible = false
	result_label = UI.label("", 34)
	result_box.add_child(result_label)
	result_box.add_child(UI.button("PLAY AGAIN", _start_round))
	result_box.add_child(UI.button("TITLE", _to_title))


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
	print("[DEMO] ROUND_START mode=3d")
	if WxSplit.has_qa_arg("qa-shot"):
		await get_tree().create_timer(6.0).timeout
		get_viewport().get_texture().get_image().save_png(WxSplit.qa_arg("qa-shot"))
		print("[DEMO] SHOT saved")


func _clear_stars() -> void:
	for s in stars:
		s.node.queue_free()
	stars.clear()


func _spawn_star() -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = star_mesh
	var m := ShaderMaterial.new()
	m.shader = star_shader
	var c := Color.from_hsv(randf(), 0.6, 1.0)
	m.set_shader_parameter("tint", Vector3(c.r, c.g, c.b))
	m.set_shader_parameter("pulse_speed", randf_range(3.0, 7.0))
	mi.material_override = m
	var sc := randf_range(0.75, 1.05)
	mi.scale = Vector3.ONE * sc
	mi.position = Vector3(randf_range(-3.6, 3.6), TOP_Y, randf_range(-2.5, 1.5))
	mi.rotation = Vector3(randf() * TAU, randf() * TAU, 0)
	add_child(mi)
	var spin := Vector3(randf_range(-2, 2), randf_range(-3, 3), randf_range(-1, 1))
	stars.append({"node": mi, "speed": randf_range(3.2, 5.0) + (ROUND_SECONDS - time_left) * 0.1, "spin": spin, "color": c, "scale": sc})


func _process(delta: float) -> void:
	shake = maxf(shake - delta * 3.0, 0.0)
	cam.h_offset = randf_range(-1, 1) * 0.25 * shake
	cam.v_offset = randf_range(-1, 1) * 0.25 * shake
	energy = move_toward(energy, 0.0, delta * 1.5)
	nebula_mat.set_shader_parameter("energy", energy)
	feed_label.text = Game.feed
	if not playing:
		return
	time_left -= delta
	spawn_left -= delta
	if spawn_left <= 0.0:
		spawn_left = maxf(0.75 - (ROUND_SECONDS - time_left) * 0.015, 0.35)
		_spawn_star()
	for s in stars.duplicate():
		var n: MeshInstance3D = s.node
		n.position.y -= s.speed * delta
		n.rotation += s.spin * delta
		if n.position.y < BOTTOM_Y:
			_miss(s)
	if WxSplit.qa_mode() != "":
		for s in stars:
			if s.node.position.y < 3.0:
				_pop(s)
				break
	hud.text = "3D   SCORE %d   TIME %d   x%d\n%s   best %d   online %d" % [score, ceili(time_left), combo, Game.net.username, Game.best[MODE], Game.online]
	if time_left <= 0.0:
		_end_round()


func _unhandled_input(e: InputEvent) -> void:
	if not playing or not (e is InputEventMouseButton and e.pressed):
		return
	# 把星星中心和它右边缘投到屏幕上，得到屏幕上的半径
	var best_s: Dictionary = {}
	var best_d := INF
	for s in stars:
		var n: MeshInstance3D = s.node
		if cam.is_position_behind(n.global_position):
			continue
		var c2 := cam.unproject_position(n.global_position)
		var edge := cam.unproject_position(n.global_position + cam.global_basis.x * s.scale)
		var d: float = e.position.distance_to(c2)
		if d < c2.distance_to(edge) * 1.3 and d < best_d:
			best_d = d
			best_s = s
	if not best_s.is_empty():
		_pop(best_s)


func _pop(s: Dictionary) -> void:
	var n: MeshInstance3D = s.node
	stars.erase(s)
	combo += 1
	score += 1 + combo / 5
	_burst(n.global_position, s.color)
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


func _burst(at: Vector3, c: Color) -> void:
	var p := CPUParticles3D.new()
	p.mesh = spark_mesh
	p.position = at
	p.one_shot = true
	p.explosiveness = 1.0
	p.amount = 32
	p.lifetime = 0.8
	p.direction = Vector3(0, 1, 0)
	p.spread = 180.0
	p.initial_velocity_min = 3.0
	p.initial_velocity_max = 7.0
	p.gravity = Vector3(0, -9.0, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.4
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1))
	g.set_color(1, Color(c.r, c.g, c.b, 0.0))
	p.color_ramp = g
	add_child(p)
	p.emitting = true
	p.finished.connect(p.queue_free)


func _end_round() -> void:
	playing = false
	_clear_stars()
	print("[DEMO] ROUND_DONE mode=3d score=%d" % score)
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
		result_label.text = "TIME UP!\nscore %d   best %d%s\n\nTOP 3D\n%s" % [score, r.data.best, "  NEW!" if r.data.record else "", "\n".join(lines)]
	if WxSplit.has_qa_arg("qa-quit"):
		await get_tree().create_timer(1.5).timeout
		get_tree().quit()
