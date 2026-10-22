extends Control

var elapsed := 0.0


func _process(delta: float) -> void:
	elapsed += delta
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("182438"))
	var stripe_width := size.x / 6.0
	for index in range(6):
		var color := Color("30d5c8") if index % 2 == 0 else Color("e8aa47")
		draw_rect(Rect2(index * stripe_width, 0.0, stripe_width - 2.0, size.y * 0.28), color)
	var center := Vector2(size.x * (0.5 + 0.3 * sin(elapsed)), size.y * 0.64)
	draw_circle(center, minf(size.y * 0.2, 30.0), Color("ecf3ff"))
	draw_line(Vector2(0, size.y - 3), Vector2(size.x, size.y - 3), Color("ef6381"), 5.0)
