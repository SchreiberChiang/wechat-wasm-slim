extends RefCounted

# Values retain catalog keys, including the three distinct untested spellings.
# No automatic or persistent pass is inferred from rendering or button actions.
var results: Dictionary = {}
var defaults: Dictionary = {}
var choices: Dictionary = {}

func initialize(catalog: Dictionary, steps: Array) -> void:
	defaults = catalog.get("resultDefault", {}).duplicate(true)
	choices = {"visual": catalog.get("visualChoices", []), "interaction": catalog.get("interactionChoices", []), "smoothness": catalog.get("smoothnessChoices", [])}
	for step in steps:
		results[step.id] = defaults.duplicate(true)

func record(step_id: String, field: String, value: String) -> bool:
	if not results.has(step_id) or not choices.has(field) or not value in choices[field]:
		return false
	results[step_id][field] = value
	return true

func display_value(value: String) -> String:
	return "未测试" if value in ["未检查", "未操作", "没留意"] else value
