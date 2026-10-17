@tool
extends EditorPlugin
## 启用插件时注册 autoload "WxSplit"，停用时移除。也可以不启用插件，直接在 project.godot 的 [autoload] 里写
## WxSplit="*res://addons/wx_split/wx_split.gd"


func _enable_plugin() -> void:
	add_autoload_singleton("WxSplit", "res://addons/wx_split/wx_split.gd")


func _disable_plugin() -> void:
	remove_autoload_singleton("WxSplit")
