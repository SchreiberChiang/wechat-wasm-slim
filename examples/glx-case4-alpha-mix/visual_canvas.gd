extends Control

# Independent Canvas reference and input surface; never samples a rendered viewport.
signal dragged(point: Vector2)
var kind := "checker"
var dragging := false
var marker := Vector2(80, 80)

func _ready() -> void:
	resized.connect(queue_redraw)
	if kind in ["alpha", "drag"]:
		mouse_filter = Control.MOUSE_FILTER_STOP
	else:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

func _gui_input(event: InputEvent) -> void:
	if kind not in ["alpha", "drag"]: return
	if event is InputEventMouseButton:
		dragging = event.pressed
		if dragging: _move(event.position)
	elif event is InputEventMouseMotion and dragging:
		_move(event.position)
	elif event is InputEventScreenTouch:
		dragging = event.pressed
		if dragging: _move(event.position)
	elif event is InputEventScreenDrag:
		_move(event.position)

func _move(point: Vector2) -> void:
	marker = point.clamp(Vector2.ZERO, size)
	queue_redraw()
	dragged.emit(marker)

func _draw() -> void:
	if kind in ["checker", "alpha"]:
		for y in range(int(ceil(size.y / 24.0))):
			for x in range(int(ceil(size.x / 24.0))):
				draw_rect(Rect2(x * 24, y * 24, 24, 24), Color.WHITE if (x + y) % 2 == 0 else Color("17202b"))
		if kind == "alpha": draw_circle(marker, 52, Color(1, 0.05, 0.05, 0.5))
	elif kind == "stripes":
		for x in range(0, int(size.x), 22):
			draw_rect(Rect2(x, 0, 12, size.y), Color("36e4dd") if x % 44 == 0 else Color("f0a33a"))
	elif kind == "clip_border":
		draw_rect(Rect2(Vector2.ZERO, size), Color.WHITE, false, 4)
	elif kind == "dot":
		draw_circle(size / 2, 12, Color.YELLOW)
	elif kind == "reference":
		draw_rect(Rect2(Vector2.ZERO, size), Color("153549"))
		draw_line(Vector2(size.x * .5, size.y * .78), Vector2(size.x * .5, size.y * .2), Color.WHITE, 5)
		draw_colored_polygon(PackedVector2Array([Vector2(size.x * .5, size.y * .12), Vector2(size.x * .35, size.y * .38), Vector2(size.x * .65, size.y * .38)]), Color.WHITE)
	elif kind == "depth_ref":
		draw_rect(Rect2(12, 24, size.x - 24, size.y - 36), Color("265cfc"))
		draw_rect(Rect2(size.x * .32, 12, size.x * .36, size.y - 24), Color("eeeecc"))
		draw_rect(Rect2(20, 38, size.x * .48, size.y - 60), Color(1, 0, 0, .5))
	elif kind == "drag":
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0), false)
