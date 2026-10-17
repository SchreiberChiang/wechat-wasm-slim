extends Control
## 标题：输入名字 → 点 LOG IN 才登录 → 选 2D / 3D。掉线回来时显示原因。

var name_edit: LineEdit
var status: Label
var login_btn: Button
var logged_box: VBoxContainer
var who: Label
var board: Label
var busy := false


func _ready() -> void:
	UI.background(self)
	var col := UI.column(self, 560, -460)
	var title := UI.label("STAR TAP", 92)
	title.add_theme_color_override("font_color", Color(1.0, 0.85, 0.35))
	col.add_child(title)
	col.add_child(UI.label("tap the falling stars - 2D or 3D", 26))
	col.add_child(UI.label("your name", 26))
	name_edit = LineEdit.new()
	name_edit.placeholder_text = "2-12 letters / digits"
	name_edit.max_length = 12
	name_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_edit.custom_minimum_size = Vector2(0, 90)
	name_edit.add_theme_font_size_override("font_size", UI.FONT)
	name_edit.text = Game.net.username if Game.logged_in else Game.saved_name()
	col.add_child(name_edit)
	login_btn = UI.button("LOG IN", _on_login)
	col.add_child(login_btn)
	logged_box = VBoxContainer.new()
	logged_box.add_theme_constant_override("separation", 22)
	col.add_child(logged_box)
	who = UI.label("", 28)
	logged_box.add_child(who)
	logged_box.add_child(UI.button("PLAY 2D", _on_play_2d))
	logged_box.add_child(UI.button("PLAY 3D", _on_play_3d))
	logged_box.add_child(UI.button("LOG OUT", _on_logout, 72))
	status = UI.label(Game.title_message, 28)
	status.add_theme_color_override("font_color", Color(1.0, 0.55, 0.5))
	col.add_child(status)
	board = UI.label("", 24)
	col.add_child(board)
	var server := UI.label(Game.net.server, 20)
	server.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	server.position.y = -60
	add_child(server)
	_refresh()
	WxSplit.mark_title_ready()
	var qa_mode := WxSplit.qa_mode()
	if qa_mode != "" and Game.title_message == "":
		if not Game.logged_in:
			await _on_login()
		if Game.logged_in and qa_mode == "3d":
			_on_play_3d()
		elif Game.logged_in:
			_on_play_2d()


func _refresh() -> void:
	login_btn.visible = not Game.logged_in
	logged_box.visible = Game.logged_in
	if Game.logged_in:
		who.text = "hi %s  (%s)\nbest 2D %d   3D %d" % [Game.net.username, Game.login_mode, Game.best["2d"], Game.best["3d"]]


func _on_login() -> void:
	if busy:
		return
	busy = true
	login_btn.disabled = true
	status.text = "logging in..."
	var r := await Game.login(name_edit.text)
	busy = false
	login_btn.disabled = false
	if not r.ok:
		status.text = str(r.data.get("error", "login failed"))
		Game.vibrate(80)
		return
	status.text = str(r.get("rename_error", ""))
	name_edit.text = Game.net.username
	_refresh()
	var t := await Game.net.top("2d")
	if t.ok:
		var lines := PackedStringArray()
		for e in t.data.top:
			lines.append("%s  %d" % [e.name, e.best])
		board.text = "TOP 2D\n" + "\n".join(lines)


## 名字改了就先改名，再进游戏
func _apply_name() -> bool:
	var n := name_edit.text.strip_edges()
	if n == "" or n == Game.net.username:
		return true
	status.text = "saving name..."
	var r := await Game.rename(n)
	if not r.ok:
		status.text = str(r.data.get("error", "rename failed"))
		return false
	status.text = ""
	return true


func _on_play_2d() -> void:
	if busy or not await _apply_name():
		return
	await _enter("2D", Game.enter_2d)


func _on_play_3d() -> void:
	if busy or not await _apply_name():
		return
	await _enter("3D", Game.enter_3d)


func _enter(label: String, entry: Callable) -> void:
	busy = true
	status.text = "loading %s..." % label
	var s: String = await entry.call()
	busy = false
	if s == WxSplit.TRAINING_DONE:
		status.text = "collection build: %s gate done (scene skipped)" % label
	elif s != WxSplit.READY:
		status.text = "%s not ready (%s), tap to retry" % [label, s]


func _on_logout() -> void:
	Game.logout()
	Game.title_message = ""
	status.text = ""
	board.text = ""
	_refresh()
