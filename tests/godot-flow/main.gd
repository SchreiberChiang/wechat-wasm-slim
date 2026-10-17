extends Node
## 走一遍插件在电脑上的全部分支，打印结果给 tests/run.mjs 核对：
## 标题就绪 → 进不存在的场景（LOAD_FAILED）→ 进 next.tscn（READY，切场景后 next.gd 打首帧并退出）。


func _ready() -> void:
	print("[WXSLIM_ADDON_TEST] qa_mode=%s qa_quit=%s qa_shot=%s wechat=%s collect=%s" % [WxSplit.qa_mode(), WxSplit.has_qa_arg("qa-quit"), WxSplit.qa_arg("qa-shot", "none"), WxSplit.is_wechat(), WxSplit.is_collect_build()])
	WxSplit.mark_title_ready()
	await get_tree().process_frame
	var missing: String = await WxSplit.enter_scene("res://missing.tscn", "3d", true)
	print("[WXSLIM_ADDON_TEST] missing=%s" % missing)
	var first: String = await WxSplit.enter_scene("res://next.tscn", "2d", false)
	print("[WXSLIM_ADDON_TEST] enter=%s" % first)
