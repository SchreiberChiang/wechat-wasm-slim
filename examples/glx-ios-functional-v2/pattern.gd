extends Control

func _draw() -> void:
	var unit := 32.0
	for y in range(int(ceil(size.y / unit))):
		for x in range(int(ceil(size.x / unit))):
			draw_rect(Rect2(x * unit, y * unit, unit, unit), Color("20354b") if (x + y) % 2 else Color("405973"))
	draw_circle(size * Vector2(0.38, 0.5), 65, Color(1, 0.2, 0.1, 0.55))
	draw_circle(size * Vector2(0.58, 0.5), 65, Color(0.1, 0.9, 1, 0.55))
	draw_line(Vector2.ZERO, size, Color.WHITE, 4)

func _ready() -> void:
	resized.connect(queue_redraw)
