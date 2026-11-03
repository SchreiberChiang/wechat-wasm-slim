extends Control
var kind := "depth_ref"

func _ready() -> void:
	resized.connect(queue_redraw)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	draw_rect(Rect2(12, 24, size.x - 24, size.y - 36), Color("265cfc"))
	draw_rect(Rect2(size.x * .32, 12, size.x * .36, size.y - 24), Color("eeeecc"))
	draw_rect(Rect2(20, 38, size.x * .48, size.y - 60), Color(1, 0, 0, .5))
