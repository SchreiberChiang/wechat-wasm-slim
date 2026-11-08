@tool
extends EditorPlugin

const PanelScript = preload("preview_panel.gd")
class EditorFilesOnly extends EditorExportPlugin:
	func _get_name() -> String:
		return "WxSlimEditorFilesOnly"

	func _export_file(file: String, _type: String, _features: PackedStringArray) -> void:
		# 插件本身、随项目提交的面板设置和快速流程命令行设置都不进游戏 PCK。
		if file.begins_with("res://addons/wxslim_readonly/") or file in ["res://wxslim.json", "res://wxslim-export.json"]:
			skip()

var export_filter := EditorFilesOnly.new()
var dock: VBoxContainer

func _enter_tree() -> void:
	add_export_plugin(export_filter)
	# 面板自带滚动区和固定底栏，因此直接作为停靠栏，不再外包一层滚动容器。
	# 旧版「微信导出·旧版（待并入）」停靠栏已并入；自建引擎和按请求文件打开任务只在命令行提供。
	dock = PanelScript.new()
	dock.name = "微信导出"
	dock.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dock.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, dock)

func _exit_tree() -> void:
	remove_export_plugin(export_filter)
	if is_instance_valid(dock):
		remove_control_from_docks(dock)
		dock.queue_free()
