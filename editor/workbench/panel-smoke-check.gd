extends SceneTree
## 只实例化面板控件并检查初始状态，不启动任何任务、不导出、不转换。
## 用法：godot --headless --path editor/workbench --script res://panel-smoke-check.gd
func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var panel: Control = load("res://addons/wxslim_readonly/preview_panel.gd").new()
	root.add_child(panel)
	await process_frame
	var checks := {}
	checks.templates = panel._template_buttons.keys() == ["full", "conservative", "2d"]
	checks.idle = panel._job.is_empty() and panel._task_line.text.begins_with("任务：")
	checks.footer_wraps = [panel._engine_line, panel._input_line, panel._output_line, panel._task_line].all(func(l): return l.autowrap_mode != TextServer.AUTOWRAP_OFF)
	checks.locale_choices = panel._locale.item_count == 2
	# 选保守模板：出现确认框，确认字段是 confirmRemovedModules，登录 code 被关掉。
	panel._draft.template = "conservative"
	panel._draft.loginCode = true
	panel._refresh()
	checks.conservative_confirm = panel._confirm_box.visible and panel._confirm_field("conservative") == "confirmRemovedModules" and panel._confirm_note.text.contains("enet")
	checks.login_full_only = panel._draft.loginCode == false and panel._login_code.disabled
	# 按 field 定位：拦截写到对应组的第一行。
	panel._show_problems("测试", [{"code": "QUICK_SCENES_EMPTY", "field": "scenes", "message": "还没有添加场景"}, {"code": "QUICK_LOCALE_FORMAT", "field": "locale", "message": "语言写法不对"}])
	checks.field_errors = panel._group_errors.packing.visible and panel._group_errors.runtime.visible and not panel._group_errors.publish.visible and panel._pending_focus == "scenes"
	panel._notice.hide()
	var failed := []
	for key in checks.keys():
		if not checks[key]:
			failed.append(key)
	print(JSON.stringify({"checks": checks, "failed": failed}))
	quit(0 if failed.is_empty() else 1)
