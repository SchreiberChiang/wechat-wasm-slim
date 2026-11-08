extends Node
## Only this launcher is current_scene. The hub is a sibling under /root.
## No resource pack is requested by startup or page creation.
const HUB = preload("res://combined-resource-hub.tscn")

func _ready() -> void:
	_install.call_deferred()

func _install() -> void:
	var tree: SceneTree = get_tree()
	if tree.current_scene != self or get_parent() != tree.root:
		push_error("COMBINED_RESOURCE_BOOT_PLACEMENT")
		return
	for reserved: String in ["CombinedResourceHub", "ResourceFixtureTrigger", "ResourceFixtureReceiver"]:
		if tree.root.has_node(reserved):
			push_error("COMBINED_RESOURCE_ROOT_COLLISION: " + reserved)
			return
	var hub: Node = HUB.instantiate()
	hub.name = "CombinedResourceHub"
	tree.root.add_child(hub)
	if hub.get_parent() != tree.root or tree.current_scene != self:
		push_error("COMBINED_RESOURCE_RESIDENCY_FAILED")
		return
	print("[COMBINED_RESOURCE_UI] ", JSON.stringify({"event": "hub_resident", "hubId": str(hub.get_instance_id()), "currentSceneId": str(get_instance_id()), "parentIsRoot": true, "hubIsCurrentScene": false, "resourceRequest": false, "visualVerified": false}))
