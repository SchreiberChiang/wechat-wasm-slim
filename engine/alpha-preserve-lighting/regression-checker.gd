extends Control

func _draw() -> void:
	for y in range(0, int(size.y), 16):
		for x in range(0, int(size.x), 16):
			var color := Color("e0d8ad") if (x / 16 + y / 16) % 2 == 0 else Color("55505d")
			draw_rect(Rect2(x, y, minf(16, size.x-x), minf(16, size.y-y)), color)
