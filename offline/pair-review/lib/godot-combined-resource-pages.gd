extends "res://combined-pages.gd"
## Resource loading replaces current_scene, never this resident hub.
const RESOURCE := 4
const RESOURCE_PAGE = preload("res://combined-resource-page.gd")
var _resource

func _ready() -> void:
	super._ready()
	# The original four-page asset is unchanged. This added page has a wider subset.
	var readable: Theme = theme.duplicate()
	readable.default_font = load("res://ResourceCJK.otf")
	theme = readable

func _switch_page(target: int) -> void:
	if target < GAME or target > RESOURCE:
		return
	if _page == NETWORK and target != NETWORK and _network.is_observation_busy():
		_status.text = "网络请求尚未结束，请留在此页。"
		return
	if is_instance_valid(_resource) and target != RESOURCE and not _resource.can_leave_page():
		_status.text = "资源加载尚未结束或状态未知，请保留此页。"
		return
	if target != RESOURCE:
		super._switch_page(target)
		if _page != target:
			return
		if is_instance_valid(_resource):
			_resource.set_page_active(false)
	else:
		if not is_instance_valid(_resource):
			var root: Window = get_tree().root
			var hub: Node = get_parent().get_parent()
			if hub.get_parent() != root or hub == get_tree().current_scene or root.has_node("ResourceFixtureTrigger") or root.has_node("ResourceFixtureReceiver"):
				_status.text = "资源页关联失败，请保留日志。"
				push_error("COMBINED_RESOURCE_RESIDENT_COLLISION")
				return
			_resource = RESOURCE_PAGE.new()
			_resource.name = "ResourceFixtureTrigger"
			root.add_child(_resource)
			_resource.connect_runtime()
		_game.visible = false
		_input_audio.set_page_active(false)
		_input_audio.visible = false
		_network.set_page_active(false)
		if is_instance_valid(_storage):
			_storage.visible = false
		_page = RESOURCE
		_resource.set_page_active(true)
	var titles := ["画面", "输入和声音", "网络", "存档", "资源加载"]
	_buttons[0].disabled = target == GAME
	_buttons[1].disabled = target == RESOURCE
	_status.text = "%d / 5　%s" % [target + 1, titles[target]]

func _exit_tree() -> void:
	# Only the owned instance; no name-based freeing and no rollback claim.
	if is_instance_valid(_resource):
		_resource.queue_free()
