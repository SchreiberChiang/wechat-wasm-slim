extends Node


func _ready() -> void:
	WxSplit.mark_first_frame("2d")
	await get_tree().process_frame
	print("[WXSLIM_ADDON_TEST] done")
	get_tree().quit()
