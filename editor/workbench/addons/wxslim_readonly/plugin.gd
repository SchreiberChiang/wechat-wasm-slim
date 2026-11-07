@tool
extends EditorPlugin

const PanelScript = preload("panel.gd")
class EditorFilesOnly extends EditorExportPlugin:
	func _get_name() -> String:
		return "WxSlimEditorFilesOnly"

	func _export_file(file: String, _type: String, _features: PackedStringArray) -> void:
		if file.begins_with("res://addons/wxslim_readonly/"):
			skip()

var export_filter := EditorFilesOnly.new()
var panel: VBoxContainer
var dock: ScrollContainer

func _enter_tree() -> void:
	add_export_plugin(export_filter)
	panel = PanelScript.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dock = ScrollContainer.new()
	dock.name = "微信导出·本地开发"
	dock.add_child(panel)
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, dock)

func _exit_tree() -> void:
	remove_export_plugin(export_filter)
	if is_instance_valid(dock):
		remove_control_from_docks(dock)
		dock.queue_free()
