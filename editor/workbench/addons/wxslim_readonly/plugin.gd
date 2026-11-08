@tool
extends EditorPlugin

const PanelScript = preload("preview_panel.gd")
const ADDON_DIR := "res://addons/wxslim_readonly"
# 发布版把工具包放在 kit/（带 .gdignore，Godot 不扫描、不导出）。源码工作台里没有 kit/，不做本机准备。
const KIT := ADDON_DIR + "/kit"
const LOCATOR := ADDON_DIR + "/workbench.path"
const RECEIPT := "res://.godot/wxslim/installation.json"
const NODE_HELP := "https://nodejs.org"

class EditorFilesOnly extends EditorExportPlugin:
	func _get_name() -> String:
		return "WxSlimEditorFilesOnly"

	func _export_file(file: String, _type: String, _features: PackedStringArray) -> void:
		# 插件本身、随项目提交的面板设置和快速流程命令行设置都不进游戏 PCK。
		if file.begins_with("res://addons/wxslim_readonly/") or file in ["res://wxslim.json", "res://wxslim-export.json"]:
			skip()

var export_filter := EditorFilesOnly.new()
var dock: VBoxContainer
var _setup_thread: Thread
var _notice: AcceptDialog

func _enter_tree() -> void:
	add_export_plugin(export_filter)
	_add_dock()
	# 复制进游戏、启用插件后自动完成本机准备：核对工具包、记录 Godot 和 Node、建立游戏外的任务目录。
	# 换了新版本文件夹、换了 Godot 或移动了工程时也会重新准备。
	if _needs_setup():
		_start_setup()

func _exit_tree() -> void:
	remove_export_plugin(export_filter)
	if _setup_thread != null and _setup_thread.is_started():
		_setup_thread.wait_to_finish()
	if is_instance_valid(_notice):
		_notice.queue_free()
	_remove_dock()

func _add_dock() -> void:
	# 面板自带滚动区和固定底栏，因此直接作为停靠栏，不再外包一层滚动容器。
	dock = PanelScript.new()
	dock.name = "微信导出"
	dock.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dock.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, dock)

func _remove_dock() -> void:
	if is_instance_valid(dock):
		remove_control_from_docks(dock)
		dock.queue_free()

static func _same_path(a: String, b: String) -> bool:
	var x := a.strip_edges().replace("\\", "/").trim_suffix("/")
	var y := b.strip_edges().replace("\\", "/").trim_suffix("/")
	return x.to_lower() == y.to_lower() if OS.get_name() == "Windows" else x == y

func _needs_setup() -> bool:
	if not FileAccess.file_exists(KIT + "/install.mjs"):
		return false
	var workbench := ProjectSettings.globalize_path(KIT).path_join("runtime/editor/workbench")
	if not FileAccess.file_exists(LOCATOR) or not _same_path(FileAccess.get_file_as_string(LOCATOR), workbench):
		return true
	if not FileAccess.file_exists(RECEIPT) or not FileAccess.file_exists("res://.godot/wxslim/state.path"):
		return true
	var receipt = JSON.parse_string(FileAccess.get_file_as_string(RECEIPT))
	if not receipt is Dictionary:
		return true
	if str(receipt.get("releaseManifest", "")) != FileAccess.get_sha256(KIT + "/RELEASE.json"):
		return true
	if not _same_path(str(receipt.get("editor", "")), OS.get_executable_path()):
		return true
	return not FileAccess.file_exists(str(receipt.get("node", "")))

func _find_node() -> String:
	# 插件自带 Node.js（kit/tools/node/），用户不必另外安装；源码工作台等没有自带时再找本机安装的。
	var bundled := ProjectSettings.globalize_path(KIT + "/tools/node/node.exe")
	if OS.get_name() == "Windows" and FileAccess.file_exists(bundled):
		return bundled
	var out := []
	if OS.get_name() == "Windows":
		if OS.execute("where.exe", ["node"], out) == 0 and out.size() > 0:
			for line in str(out[0]).split("\n"):
				var candidate := line.strip_edges()
				if candidate.to_lower().ends_with("node.exe") and FileAccess.file_exists(candidate):
					return candidate
		for candidate in [OS.get_environment("ProgramFiles").path_join("nodejs/node.exe"), OS.get_environment("LOCALAPPDATA").path_join("Programs/nodejs/node.exe")]:
			if FileAccess.file_exists(candidate):
				return candidate
	elif OS.execute("/bin/sh", ["-lc", "command -v node"], out) == 0 and out.size() > 0:
		var candidate := str(out[0]).strip_edges()
		if FileAccess.file_exists(candidate):
			return candidate
	if FileAccess.file_exists(RECEIPT):
		var receipt = JSON.parse_string(FileAccess.get_file_as_string(RECEIPT))
		if receipt is Dictionary and FileAccess.file_exists(str(receipt.get("node", ""))):
			return str(receipt.node)
	return ""

func _start_setup() -> void:
	var node := _find_node()
	if node.is_empty():
		_tell("微信导出插件还差一步", "插件自带的 Node.js（addons/wxslim_readonly/kit/tools/node/node.exe）不见了，本机也没有找到 Node.js。请重新复制整个插件文件夹，或安装 Node.js 24 或更新版本（%s），然后重新打开 Godot。" % NODE_HELP)
		return
	print("[微信导出] 正在准备插件（核对工具包、记录本机 Godot 和 Node）……")
	_setup_thread = Thread.new()
	_setup_thread.start(_run_setup.bind(node, ProjectSettings.globalize_path(KIT + "/install.mjs"), OS.get_executable_path()))

func _run_setup(node: String, script: String, editor: String) -> void:
	var out := []
	var code := OS.execute(node, PackedStringArray([script, editor]), out, true)
	call_deferred("_setup_done", code, str(out[0]) if out.size() > 0 else "")

func _setup_done(code: int, output: String) -> void:
	if _setup_thread != null and _setup_thread.is_started():
		_setup_thread.wait_to_finish()
	var result = null
	for line in output.split("\n"):
		if line.strip_edges().begins_with("{"):
			result = JSON.parse_string(line.strip_edges())
	if code == 0 and result is Dictionary and result.get("status", "") == "SUCCESS":
		print("[微信导出] 插件已准备好（版本 %s）。" % str(result.get("pluginVersion", "")))
		# 重新建面板，让它读到刚写好的本机配置。
		_remove_dock()
		_add_dock()
		return
	var message := str(result.get("message", "")) if result is Dictionary else ""
	if message.is_empty():
		message = "准备过程没有成功：\n" + output.strip_edges().right(1200)
	_tell("微信导出插件没能准备好", message + "\n\n处理后，在「项目 → 项目设置 → 插件」里把它关掉再打开，就会重新准备。")

func _tell(title: String, text: String) -> void:
	push_warning("[微信导出] " + text)
	if is_instance_valid(_notice):
		_notice.queue_free()
	_notice = AcceptDialog.new()
	_notice.title = title
	_notice.dialog_text = text
	_notice.dialog_autowrap = true
	_notice.min_size = Vector2i(460, 0)
	EditorInterface.get_base_control().add_child(_notice)
	_notice.popup_centered()
