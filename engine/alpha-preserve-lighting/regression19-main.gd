extends Control

const Renderer = preload("res://regression19-renderer.gd")
var catalog: Dictionary
var states: Array[Dictionary] = []
var renderer: Node
var stage: Control
var actions: VBoxContainer
var title_label: Label
var phase_label: Label
var goal_label: Label
var live_caption: Label
var reference_caption: Label
var reference: TextureRect
var status_label: Label
var previous_button: Button
var phase_button: Button
var next_button: Button
var current_index := -1
var page := 0
var phase := 0
var switching := false
var state_ready := false
var operation_sequence := 0
var state_sequence := 0
var construction_usec := 0
var first_callback_usec := 0
var reference_path := ""
var state_visits: Dictionary = {}
var last_transition: Dictionary = {}

func _ready() -> void:
	catalog = JSON.parse_string(FileAccess.get_file_as_string("res://regression19-cases.json"))
	for group in catalog.groups:
		for i in range(group.states.size()):
			var item: Dictionary = group.states[i].duplicate(true)
			item.merge({"key":group.id+"/"+item.id,"group":group.id,"groupTitle":group.title,"page":int(group.id.trim_prefix("R"))-1,"phase":i,"phaseCount":group.states.size()})
			states.append(item)
	theme = Theme.new()
	theme.default_font = load("res://fonts/AcceptanceCJK.otf")
	theme.default_font_size = 24
	_build_ui()
	renderer = Renderer.new()
	add_child(renderer)
	get_viewport().size_changed.connect(_layout)
	_layout()
	_log("plan", {"pages":8,"phases":states.size(),"manualHold":true,"automaticAdvance":false,"queryDoesNotEnableAutoplay":true,"visual":"NOT_TESTED","resourcePolicy":"lazy active-page reuse; no startup prewarm; page/topology changes rebuild","timingPolicy":"first state visit and repeat visit recorded separately; callback is not screen presentation"})
	if not OS.get_cmdline_user_args().has("--reg19-check"): select_state.call_deferred(0)

func _label(text: String, font_size: int) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(label)
	return label

func _button(text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.add_theme_font_size_override("font_size", 24)
	button.pressed.connect(callback)
	add_child(button)
	return button

func _build_ui() -> void:
	title_label = _label("八项回归 · 正在准备", 31)
	phase_label = _label("", 26)
	goal_label = _label("", 24)
	live_caption = _label("实时画面：请检查这里", 22)
	stage = Control.new()
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(stage)
	reference_caption = _label("同阶段原生参考（Windows OpenGL，非手机GLX）", 19)
	reference = TextureRect.new()
	reference.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	reference.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	reference.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(reference)
	status_label = _label("只记录到达和耗时；画面结果需人工判断。", 18)
	previous_button = _button("上一项", func(): navigate(-1))
	phase_button = _button("切换阶段", change_phase)
	next_button = _button("下一项", func(): navigate(1))
	actions = VBoxContainer.new()
	actions.visible = false
	add_child(actions)

func _place(control: Control, x: float, y: float, width: float, height: float) -> void:
	control.position = Vector2(x, y)
	control.size = Vector2(width, height)

func _layout() -> void:
	if not is_instance_valid(stage): return
	var screen := get_viewport_rect().size
	var width: float = screen.x-40
	var top := 110.0
	_place(title_label, 20, top, width, 44)
	_place(phase_label, 20, top+48, width, 40)
	_place(goal_label, 20, top+97, width, 84)
	_place(live_caption, 20, top+188, width, 30)
	var stage_height: float = minf(width*340.0/620.0, maxf(240, screen.y-710))
	_place(stage, 20, top+225, width, stage_height)
	var ref_y: float = stage.position.y+stage.size.y+8
	_place(reference_caption, 20, ref_y, width, 48)
	var ref_height: float = minf(190, maxf(100, screen.y-190-ref_y-48))
	_place(reference, 20, ref_y+48, width, ref_height)
	_place(status_label, 20, ref_y+48+ref_height+5, width, 74)
	var button_width: float = (width-16)/3.0
	for i in range(3): _place([previous_button,phase_button,next_button][i],20+i*(button_width+8),screen.y-96,button_width,64)
	if is_instance_valid(renderer): renderer.update_layout(stage.get_global_rect())

func _navigation(enabled: bool) -> void:
	previous_button.disabled = not enabled or page == 0
	next_button.disabled = not enabled or page == 7
	phase_button.disabled = not enabled

func select_state(index: int) -> void:
	if switching or index < 0 or index >= states.size(): return
	var previous_index := current_index
	var item: Dictionary = states[index]
	var reuse: bool = renderer.can_reuse_state(item)
	var action := "parameter_update" if reuse else ("initial_build" if previous_index < 0 else ("page_rebuild" if states[previous_index].page != item.page else "topology_rebuild"))
	var visit := int(state_visits.get(item.key, 0)) + 1
	state_visits[item.key] = visit
	last_transition = {"stateVisit":visit,"firstStateVisit":visit==1,"resourceAction":action,"reuseScope":"active page only","startupPrewarm":false}
	switching = true
	state_ready = false
	current_index = index
	state_sequence += 1
	page = item.page
	phase = item.phase
	title_label.text = "%d/8  %s" % [page+1,item.groupTitle]
	phase_label.text = "阶段 %d/%d · %s" % [phase+1,item.phaseCount,item.title]
	goal_label.text = item.goal
	status_label.text = "正在准备本阶段，请稍候；就绪后一直停留。"
	reference.texture = null
	reference_caption.text = "同阶段原生参考：准备中"
	stage.visible = false
	_navigation(false)
	var begin := Time.get_ticks_usec()
	_log("switch_begin", {"page":page+1,"phase":phase+1,"goal":item.goal,"transition":last_transition.duplicate(true)})
	if not reuse: renderer.clear()
	await RenderingServer.frame_post_draw
	var prep_callback := Time.get_ticks_usec()-begin
	_log("preparation_callback", {"elapsedUsec":prep_callback,"screenPresentationProven":false})
	var create_begin := Time.get_ticks_usec()
	if reuse:
		if not renderer.apply_state(item):
			switching = false
			status_label.text = "停止：资源复用检查失败，请保留日志。"
			_log("stopped", {"reason":"reuse_failed","transition":last_transition})
			return
	else: renderer.build_state(item, stage, actions)
	construction_usec = Time.get_ticks_usec()-create_begin
	if not renderer.last_build_success:
		switching = false
		status_label.text = "停止：创建失败。保存画面与日志，不记为通过。"
		_log("stopped", {"reason":"scene_build_failed"})
		return
	stage.visible = true
	await get_tree().process_frame
	_layout()
	_log("resources_updated" if reuse else "resources_created", {"constructionUsec":construction_usec,"elapsedUsec":Time.get_ticks_usec()-begin,"transition":last_transition.duplicate(true),"resources":renderer.reuse_info()})
	await RenderingServer.frame_post_draw
	first_callback_usec = Time.get_ticks_usec()-begin
	var reference_begin := Time.get_ticks_usec()
	reference_path = "res://references/"+str(item.key).replace("/","-")+".png"
	if ResourceLoader.exists(reference_path):
		reference.texture = load(reference_path)
		reference_caption.text = "同阶段原生参考（Windows OpenGL，非手机GLX）"
	else: reference_caption.text = "同阶段参考图未取得；不能以其他阶段替代"
	var reference_load_usec := Time.get_ticks_usec()-reference_begin
	state_ready = true
	switching = false
	_navigation(true)
	phase_button.text = "切换阶段 %d/%d" % [phase+1,item.phaseCount]
	status_label.text = "%s · %s · 手动停留\n操作 %.2f秒 / 回调 %.2f秒（非屏幕呈现）" % ["首次到达" if visit == 1 else "再次到达","参数切换" if reuse else "资源重建",construction_usec/1000000.0,first_callback_usec/1000000.0]
	last_transition.merge({"constructionUsec":construction_usec,"preparationCallbackUsec":prep_callback,"firstCallbackElapsedUsec":first_callback_usec,"referenceLoadUsec":reference_load_usec,"readyLogElapsedUsec":Time.get_ticks_usec()-begin,"resources":renderer.reuse_info()}, true)
	_log("state_ready", {"page":page+1,"phase":phase+1,"reference":reference_path,"referenceAvailable":reference.texture!=null,"constructionUsec":construction_usec,"preparationCallbackUsec":prep_callback,"firstCallbackElapsedUsec":first_callback_usec,"screenPresentationProven":false,"visual":"NOT_TESTED","transition":last_transition.duplicate(true),"parameters":renderer.inspect_scene()})

func navigate(offset: int) -> void:
	if switching: return
	var target := clampi(page+offset,0,7)
	_log("manual_page", {"from":page+1,"to":target+1})
	for i in range(states.size()):
		if states[i].page == target and states[i].phase == 0:
			select_state(i)
			return

func change_phase() -> void:
	if switching or current_index < 0: return
	var count: int = states[current_index].phaseCount
	var target: int = (phase+1)%count
	_log("manual_phase", {"page":page+1,"from":phase+1,"to":target+1})
	for i in range(states.size()):
		if states[i].page == page and states[i].phase == target:
			select_state(i)
			return

func _log(event: String, details: Dictionary) -> void:
	operation_sequence += 1
	print("[GLX_REGRESSION] "+JSON.stringify({"schema":"alpha-regression19-v1","event":event,"seq":operation_sequence,"stateSequence":state_sequence,"state":states[current_index].key if current_index>=0 else "none","ticksUsec":Time.get_ticks_usec(),"details":details}))
