// Read-only source snapshot generator. Never creates/imports/exports a project.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createResourceExportFixture} from './resource-export-fixture.mjs';
const runtimeNames=['godot-resource-command-receiver.gd','godot-resource-pack-session.gd','godot-resource-scene-loader.gd'];
const bootScene=`[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://boot.gd" id="1_boot"]

[node name="Boot" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_boot")

[node name="BootNotice" type="Label" parent="."]
offset_left = 24.0
offset_top = 32.0
offset_right = 456.0
offset_bottom = 160.0
theme_override_font_sizes/font_size = 24
text = "Preparing resource fixture..."
autowrap_mode = 2
`;
const bootScript=`extends Control
## Fixture glue only. No level/shared preload and no automatic load request.
const Trigger = preload("res://runtime_trigger.gd")
var _trigger: Node

func _ready() -> void:
	_install.call_deferred()

func _install() -> void:
	var root: Window = get_tree().root
	if root.has_node("ResourceFixtureTrigger") or root.has_node("ResourceFixtureReceiver"):
		$BootNotice.text = "Fixture name collision; restart required."
		return
	_trigger = Trigger.new()
	_trigger.name = "ResourceFixtureTrigger"
	root.add_child(_trigger)
	# add_child has returned; receiver installation is outside root's ready stack.
	_trigger.connect_runtime()
	visible = false
`;
const triggerScript=`extends Node
## Root-resident fixture glue. Receiver and executor own all resource operations.
## Normal logs are compact. Retained original JSON is queried explicitly only.
const Receiver = preload("res://godot-resource-command-receiver.gd")
var _receiver: Node
var _app: JavaScriptObject
var _json: JavaScriptObject
var _render: JavaScriptObject
var _render_diagnostic: JavaScriptObject
var _resolve_callback: JavaScriptObject
var _reject_callback: JavaScriptObject
var _promise: JavaScriptObject
var _promise_chain: JavaScriptObject
var _ready_to_request: bool = false
var _requested: bool = false
var _settled: bool = false
var _cancel_requested: bool = false
var _load_id: String = ""
var _identity: Dictionary = {}
var _boot: Dictionary = {}
var _state: String = "CONNECTING"
var _raw_result_json: String = ""
var _raw_result_origin: String = "NONE"
var _raw_printed: bool = false
var _status_label: Label
var _detail_label: Label
var _identity_label: Label
var _load_button: Button
var _cancel_button: Button
var _print_button: Button

func _label(parent: Node, text: String, font_size: int, height: float) -> Label:
	var label: Label = Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.custom_minimum_size = Vector2(416, height)
	label.add_theme_font_size_override("font_size", font_size)
	parent.add_child(label)
	return label

func _build_ui() -> void:
	var layer: CanvasLayer = CanvasLayer.new()
	layer.layer = 20
	add_child(layer)
	var panel: PanelContainer = PanelContainer.new()
	panel.position = Vector2(16, 16)
	panel.size = Vector2(448, 560)
	layer.add_child(panel)
	var margin: MarginContainer = MarginContainer.new()
	for side: String in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16)
	panel.add_child(margin)
	var box: VBoxContainer = VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)
	_label(box, "RESOURCE PACK FIXTURE", 26, 34)
	_status_label = _label(box, "CONNECTING", 24, 52)
	_detail_label = _label(box, "Waiting for the actual host bridge.", 19, 76)
	_identity_label = _label(box, "Package/session not observed yet.", 15, 58)
	var buttons: HBoxContainer = HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	box.add_child(buttons)
	_load_button = Button.new()
	_load_button.text = "Load level"
	_load_button.custom_minimum_size = Vector2(200, 64)
	_load_button.add_theme_font_size_override("font_size", 24)
	buttons.add_child(_load_button)
	_load_button.pressed.connect(request_level)
	_cancel_button = Button.new()
	_cancel_button.text = "Cancel"
	_cancel_button.custom_minimum_size = Vector2(200, 64)
	_cancel_button.add_theme_font_size_override("font_size", 24)
	buttons.add_child(_cancel_button)
	_cancel_button.pressed.connect(request_cancel)
	_print_button = Button.new()
	_print_button.text = "Print original result (once)"
	_print_button.custom_minimum_size = Vector2(416, 52)
	_print_button.add_theme_font_size_override("font_size", 18)
	box.add_child(_print_button)
	_print_button.pressed.connect(print_original_result)
	_label(box, "One request only. Restart for another test. Visual appearance requires human observation.", 17, 58)
	_set_state("CONNECTING", "No download or scene request has been made.")

func _set_state(value: String, detail: String) -> void:
	_state = value
	if is_instance_valid(_status_label):
		_status_label.text = value
		_detail_label.text = detail.left(260)
		_load_button.disabled = not _ready_to_request or _requested or _settled
		_cancel_button.disabled = not _ready_to_request or _settled or _cancel_requested
		_print_button.disabled = _raw_result_json.is_empty() or _raw_printed

func connect_runtime() -> Dictionary:
	if _receiver != null or not is_inside_tree() or get_parent() != get_tree().root:
		return {"ok": false, "code": "FIXTURE_WEB_ROOT_REQUIRED"}
	_build_ui()
	if not OS.has_feature("web"):
		_set_state("UNAVAILABLE", "This fixture requires the Web host; no load requested.")
		return {"ok": false, "code": "FIXTURE_WEB_ROOT_REQUIRED"}
	_app = JavaScriptBridge.get_interface("__WXSLIM_RESOURCE_APP__")
	_json = JavaScriptBridge.get_interface("JSON")
	_render = JavaScriptBridge.get_interface("__WXSLIM_RENDER_CONFIG__")
	_render_diagnostic = JavaScriptBridge.get_interface("__WXSLIM_RENDER_DIAGNOSTIC__")
	if _app == null or _json == null or _render == null or _render_diagnostic == null:
		_set_state("FAILED TO CONNECT", "Required host interfaces are missing.")
		return {"ok": false, "code": "FIXTURE_INTERFACES_MISSING"}
	var app_status: Variant = _json_value(_app.status())
	if not app_status is Dictionary or app_status.get("schema") != "wxslim-resource-interfaces-v2" or app_status.get("installed") != true or app_status.get("closed") != false or not app_status.get("identity") is Dictionary or not app_status.get("boot") is Dictionary:
		_set_state("UNKNOWN", "Host status could not be decoded; no load requested.")
		return {"ok": false, "code": "FIXTURE_STATUS_INVALID"}
	_identity = app_status["identity"].duplicate(true)
	_boot = app_status["boot"].duplicate(true)
	var session: Variant = app_status.get("executor")
	if not _session_binding(session) or session.get("phase") != "IDLE" or session.get("busy") != false or session.get("activeLoadId") != null or session.get("activeJob") != null:
		_set_state("UNKNOWN", "Session is not idle; no load requested.")
		return {"ok": false, "code": "FIXTURE_SESSION_NOT_IDLE"}
	_identity_label.text = "Package: " + String(_boot.get("packageId", "UNKNOWN")) + "\\nSession: " + String(_identity.get("engineSession", "UNKNOWN"))
	if get_tree().root.has_node("ResourceFixtureReceiver"):
		_set_state("FAILED TO CONNECT", "Receiver name collision; restart required.")
		return {"ok": false, "code": "FIXTURE_RECEIVER_COLLISION"}
	_receiver = Receiver.new()
	_receiver.name = "ResourceFixtureReceiver"
	get_tree().root.add_child(_receiver)
	var attached: Dictionary = _receiver.connect_interface("__WXSLIM_RESOURCE_BRIDGE__")
	_ready_to_request = attached.get("ok", false) == true and attached.get("code", "") == "ATTACH_ACCEPTED"
	_set_state("READY" if _ready_to_request else "FAILED TO CONNECT", "Press Load level once, or Cancel before loading. Neither action is automatic." if _ready_to_request else _safe_code(attached.get("code")))
	_record("ATTACH_OBSERVED", {"code": attached.get("code"), "ready": _ready_to_request})
	return attached

func request_level() -> void:
	if not _ready_to_request or _requested or _settled or not is_inside_tree():
		_record("LOAD_NOT_REQUESTED", {"ready": _ready_to_request, "alreadyRequested": _requested})
		return
	_requested = true
	_resolve_callback = JavaScriptBridge.create_callback(_on_resolved)
	_reject_callback = JavaScriptBridge.create_callback(_on_rejected)
	if _resolve_callback == null or _reject_callback == null:
		_settled = true
		_set_state("FAILED", "FIXTURE_CALLBACK_UNAVAILABLE; restart required.")
		_record("FIXTURE_CALLBACK_UNAVAILABLE", {})
		return
	_set_state("LOADING", "Reading, verifying and mounting shared + level. Waiting for an actual result.")
	_record("LOAD_REQUESTED", {})
	var returned: Variant = _app.load("level")
	# load claims synchronously. Bind this UI to that claim before observing it.
	var claimed: Variant = _json_value(_app.status())
	if claimed is Dictionary and claimed.get("schema") == "wxslim-resource-interfaces-v2" and claimed.get("identity") == _identity and claimed.get("boot") == _boot:
		var session: Variant = claimed.get("executor")
		if _session_binding(session) and session.get("phase") == "RUNNING" and session.get("busy") == true and typeof(session.get("activeLoadId")) == TYPE_STRING and not session["activeLoadId"].is_empty():
			_load_id = session["activeLoadId"]
	if _load_id.is_empty():
		_set_state("UNKNOWN", "Load claim identity is unconfirmed. Retaining the original observer; no retry.")
		_record("FIXTURE_LOAD_CLAIM_INVALID", {})
	if not returned is JavaScriptObject:
		_settled = true
		_set_state("UNKNOWN", "Load did not return a Promise object. Do not retry.")
		_record("FIXTURE_LOAD_RETURN_NOT_PROMISE_OBJECT", {})
		return
	_promise = returned
	# Standard Promise.then receives retained Godot callbacks. Their return is ignored.
	var chained: Variant = _promise.then(_resolve_callback, _reject_callback)
	if chained is JavaScriptObject:
		_promise_chain = chained
	else:
		_set_state("UNKNOWN", "Promise observer attachment is unconfirmed. No retry.")
		_record("FIXTURE_THEN_RETURN_NOT_PROMISE_OBJECT", {})

func request_cancel() -> void:
	if not _ready_to_request or _settled or _cancel_requested:
		return
	_cancel_requested = true
	if not _requested:
		_settled = true
		_set_state("UI CLOSED BEFORE LOAD", "No load or native cancellation was dispatched. Restart fixture for another test.")
		_record("CANCEL_BEFORE_LOAD_UI_ONLY", {"loadDispatched": false, "nativeCancelDispatched": false})
		return
	if _load_id.is_empty():
		_set_state("UNKNOWN", "Cancel has no confirmed load ID; wait for the original result. No cancellation dispatched.")
		_record("CANCEL_UNCONFIRMED", {"nativeCancelDispatched": false})
		return
	# APP.cancel(loadId) returns a matched synchronous envelope, never an abort.
	var observed: Variant = _json_value(_app.cancel(_load_id))
	if not observed is Dictionary or observed.get("schema") != "wxslim-resource-executor-session-cancel-v1" or observed.get("loadId") != _load_id or observed.get("matched") != true or not _session_binding(observed.get("session")):
		_set_state("UNKNOWN", "Cancel was not confirmed; wait for the original result. No rollback claimed.")
		_record("CANCEL_UNCONFIRMED", {"loadId": _load_id})
		return
	_set_state("CANCEL REQUESTED", "Waiting for native/engine completion. Download may continue; no abort or rollback is claimed.")
	_record("CANCEL_REQUESTED", {"loadId": _load_id})

func _on_resolved(args: Array) -> void:
	if _settled or not is_inside_tree():
		return
	_settled = true
	if args.size() != 1:
		_set_state("UNKNOWN", "Unexpected Promise arguments.")
		_record("FIXTURE_RESOLVE_ARGUMENTS_INVALID", {})
		return
	_capture_original(args[0], "LOAD_PROMISE_RESOLVED")
	var envelope: Variant = _parse_json(_raw_result_json)
	if _load_id.is_empty() or not envelope is Dictionary or envelope.get("schema") != "wxslim-resource-executor-session-load-v1" or envelope.get("loadId") != _load_id or not envelope.get("result") is Dictionary:
		_set_state("UNKNOWN", "Result load envelope/ID mismatch; inspect the original envelope.")
		_record("FIXTURE_RESULT_LOAD_ID_INVALID", {})
		return
	var raw: Variant = envelope["result"]
	if not raw is Dictionary or raw.get("schema") != "wxslim-resource-executor-v1" or raw.get("identity") != _identity or raw.get("boot") != _boot:
		_set_state("UNKNOWN", "Result identity/schema mismatch; inspect original result.")
		_record("FIXTURE_RESULT_IDENTITY_INVALID", {})
		return
	var outcome: String = String(raw.get("outcome", "UNKNOWN"))
	var summary: Dictionary = {"outcome": outcome, "mounted": raw.get("mountedPacks", []), "failureCode": _failure_code(raw), "rawBytes": _raw_result_json.to_utf8_buffer().size()}
	match outcome:
		"SUCCESS":
			var proof: Dictionary = _verify_current_level(raw)
			summary["contentProof"] = proof
			_set_state("SUCCESS" if proof["ok"] else "CONTENT PROOF MISMATCH", "Scene + content proof matched. Inspect the enlarged checker below; visual appearance still requires human observation." if proof["ok"] else "Executor reported SUCCESS, but fixture content/instance proof did not match. Inspect diagnostics.")
		"FAILED":
			_set_state("FAILED", _failure_code(raw) + ". Effects are retained; restart fixture to test again.")
		"CANCELLED":
			_set_state("CANCELLED", "Cancellation settled. Mounted files or scene changes may remain. No rollback; restart for another test.")
		_:
			_set_state("UNKNOWN", "No confirmed terminal success. Inspect original result; do not retry this session.")
	_record("LOAD_PROMISE_RESOLVED", summary)

func _verify_current_level(raw: Dictionary) -> Dictionary:
	var state: Variant = raw.get("targetState")
	if raw.get("finished") != true or raw.get("targetPackId") != "level" or raw.get("sceneTreeConfirmationObserved") != true or raw.get("failure") != null or not state is Dictionary or state.get("phase") != "ENDED" or not state.get("terminal") is Dictionary or state["terminal"].get("status") != "SUCCESS":
		return {"ok": false, "code": "FIXTURE_EXECUTOR_PROOF_MISMATCH"}
	var adapters: Variant = raw.get("adapters")
	if not adapters is Array:
		return {"ok": false, "code": "FIXTURE_SCENE_REPORT_MISSING"}
	var evidence: Dictionary = {}
	var count: int = 0
	for adapter: Variant in adapters:
		if not adapter is Dictionary:
			continue
		var report: Variant = adapter.get("report")
		if report is Dictionary and report.get("op") == "LOAD_SCENE" and report.get("packId") == "level":
			count += 1
			var result: Variant = report.get("result")
			if report.get("identity") == _identity and result is Dictionary and result.get("ok") == true and result.get("code") == "SCENE_TREE_CONFIRMED" and result.get("evidence") is Dictionary:
				evidence = result["evidence"]
	var scene: Node = get_tree().current_scene
	if count != 1 or evidence.is_empty() or not is_instance_valid(scene) or scene.scene_file_path != "res://level.tscn" or scene.get_parent() != get_tree().root or not scene.is_inside_tree() or not scene.is_node_ready() or scene.is_queued_for_deletion() or evidence.get("targetInstanceId") != str(scene.get_instance_id()) or evidence.get("currentSceneId") != str(scene.get_instance_id()) or evidence.get("exactInstance") != true or evidence.get("state") != "TREE_CONFIRMED":
		return {"ok": false, "code": "FIXTURE_ACTUAL_SCENE_MISMATCH"}
	if not scene.has_method("get_proof"):
		return {"ok": false, "code": "FIXTURE_LEVEL_PROOF_MISSING"}
	var proof: Variant = scene.call("get_proof")
	var matched: bool = proof is Dictionary and proof.get("marker") == "wxslim-level-v1" and proof.get("texturePresent") == true and proof.get("textureWidth") == 16 and proof.get("textureHeight") == 16
	return {"ok": matched, "code": "FIXTURE_CONTENT_MATCHED" if matched else "FIXTURE_CONTENT_MISMATCH", "instanceId": str(scene.get_instance_id()), "path": scene.scene_file_path, "marker": proof.get("marker") if proof is Dictionary else null, "textureWidth": proof.get("textureWidth") if proof is Dictionary else null, "textureHeight": proof.get("textureHeight") if proof is Dictionary else null, "visualVerified": false}

func _session_binding(value: Variant) -> bool:
	return value is Dictionary and value.get("schema") == "wxslim-resource-executor-session-v1" and value.get("identity") == _identity and value.get("boot") == _boot

func _on_rejected(args: Array) -> void:
	if _settled or not is_inside_tree():
		return
	_settled = true
	var code: Variant = null
	if args.size() == 1 and args[0] is JavaScriptObject:
		_capture_original(args[0], "LOAD_PROMISE_REJECTED")
		code = args[0].code
	_set_state("PROMISE REJECTED", _safe_code(code) + ". Side effects may be unknown; no retry.")
	_record("LOAD_PROMISE_REJECTED", {"observedCode": _safe_code(code)})

func _capture_original(value: Variant, origin: String) -> void:
	if not _raw_result_json.is_empty():
		return
	var text: Variant = _json.stringify(value)
	if typeof(text) == TYPE_STRING and text.to_utf8_buffer().size() <= 1024 * 1024:
		_raw_result_json = text
		_raw_result_origin = origin

## Pure read-only retained snapshot, not a fresh APP.status call or engine work.
func get_original_result_json() -> String:
	return _raw_result_json

func get_observation_summary() -> Dictionary:
	return {"state": _state, "requested": _requested, "settled": _settled, "cancelRequested": _cancel_requested, "loadId": _load_id, "origin": _raw_result_origin, "rawBytes": _raw_result_json.to_utf8_buffer().size(), "identity": _identity.duplicate(true), "boot": _boot.duplicate(true), "visualVerified": false}

func print_original_result() -> void:
	# Explicit local diagnostic action only; never print automatically or repeat.
	if _raw_printed or _raw_result_json.is_empty():
		return
	_raw_printed = true
	_print_button.disabled = true
	print("RESOURCE_RUNTIME_FIXTURE_RAW ", _raw_result_json)

func _parse_json(text: String) -> Variant:
	var parser: JSON = JSON.new()
	return parser.data if parser.parse(text) == OK else null

func _json_value(value: Variant) -> Variant:
	var text: Variant = _json.stringify(value)
	if typeof(text) != TYPE_STRING or text.to_utf8_buffer().size() > 1024 * 1024:
		return {"fixtureObservationError": "FIXTURE_JSON_UNAVAILABLE_OR_LIMIT"}
	return _parse_json(text)

func _safe_code(value: Variant) -> String:
	if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 96:
		return "UNKNOWN"
	for index: int in value.length():
		var c: int = value.unicode_at(index)
		if not ((c >= 65 and c <= 90) or (c >= 48 and c <= 57) or c == 95):
			return "UNKNOWN"
	return value

func _failure_code(raw: Dictionary) -> Variant:
	var failure: Variant = raw.get("failure")
	if raw.get("outcome") == "SUCCESS" and raw.has("failure") and failure == null:
		return null
	return _safe_code(failure.get("code")) if failure is Dictionary else "UNKNOWN"

func _record(event: String, data: Dictionary) -> void:
	print("RESOURCE_RUNTIME_FIXTURE ", JSON.stringify({"schema": "wxslim-resource-runtime-fixture-event-v1", "event": event, "state": _state, "packageId": _boot.get("packageId"), "engineSession": _identity.get("engineSession"), "data": data,
		"scope": "Fixture observations only; Promise resolution is not success and visual appearance requires human observation", "visualVerified": false, "persistentReceiptWritten": false}))

func _exit_tree() -> void:
	_ready_to_request = false
	if is_instance_valid(_receiver):
		_receiver.invalidate()
	_resolve_callback = null
	_reject_callback = null
	_promise = null
	_promise_chain = null
	_app = null
	_json = null
	_render = null
	_render_diagnostic = null
`;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function replaceOnce(text,from,to){if(text.split(from).length!==2)throw Object.assign(Error('RESOURCE_RUNTIME_FIXTURE_ANCHOR'),{code:'RESOURCE_RUNTIME_FIXTURE_ANCHOR'});return text.replace(from,to);}

/** Returns UTF8 text in memory plus raw snapshot pins. Caller owns future disk writes. */
export function createResourceRuntimeFixture(){
  const base=createResourceExportFixture(),files=new Map(base.files),snapshots=[];
  let project=replaceOnce(files.get('project.godot'),'window/size/viewport_width=128','window/size/viewport_width=480');
  project=replaceOnce(project,'window/size/viewport_height=128','window/size/viewport_height=960\nwindow/stretch/mode="canvas_items"');
  files.set('project.godot',project);
  const level=replaceOnce(files.get('level.tscn'),'position = Vector2(64, 64)','position = Vector2(240, 790)\nscale = Vector2(12, 12)');
  files.set('level.tscn',level+`\n[node name="ContentTitle" type="Label" parent="."]
offset_left = 40.0
offset_top = 636.0
offset_right = 440.0
offset_bottom = 682.0
theme_override_font_sizes/font_size = 26
text = "LOADED RESOURCE LEVEL"
horizontal_alignment = 1

[node name="VisualNote" type="Label" parent="."]
offset_left = 24.0
offset_top = 918.0
offset_right = 456.0
offset_bottom = 958.0
theme_override_font_sizes/font_size = 18
text = "Checker appearance: inspect manually"
horizontal_alignment = 1
`);
  files.set('boot.tscn',bootScene);files.set('boot.gd',bootScript);files.set('runtime_trigger.gd',triggerScript);
  for(const name of runtimeNames){
    const raw=fs.readFileSync(new URL('./'+name,import.meta.url)),text=raw.toString('utf8');
    if(!Buffer.from(text,'utf8').equals(raw))throw Object.assign(Error('RESOURCE_RUNTIME_FIXTURE_UTF8'),{code:'RESOURCE_RUNTIME_FIXTURE_UTF8'});
    files.set(name,text);snapshots.push({path:name,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
  }
  const bytes=[...files.values()].reduce((sum,text)=>sum+Buffer.byteLength(text,'utf8'),0);
  if(bytes>128*1024)throw Object.assign(Error('RESOURCE_RUNTIME_FIXTURE_BUDGET'),{code:'RESOURCE_RUNTIME_FIXTURE_BUDGET'});
  const ownership=JSON.parse(JSON.stringify(base.ownership));
  ownership.schema='wxslim-resource-runtime-fixture-ownership-v1';
  ownership.packs[0].sourceRoots.push('runtime_trigger.gd',...runtimeNames);
  ownership.bootPolicy+=' Resident trigger/CanvasLayer and receiver survive scene replacement. Explicit buttons request load/cancel; a cancelled one-shot requires restart.';
  return Object.freeze({schema:'wxslim-resource-runtime-fixture-v1',purpose:'SOURCE_FIXTURE_ONLY_NOT_GAME_DEFAULT',requiredGodotVersion:base.requiredGodotVersion,encoding:'utf8',files,
    bytes,snapshots:freeze(snapshots),ownership:freeze(ownership),expectedProof:base.expectedProof,
    identityScope:'Record actual __WXSLIM_RENDER_CONFIG__, __WXSLIM_RENDER_DIAGNOSTIC__.read() and APP.status; future export and fixed-pair conversion must create and verify a new PCK/package identity. No renderer or engine patch is changed.',
    resultScope:'Compact automatic logs, retained original JSON and actual current-scene/get_proof comparison. Promise resolution alone is not SUCCESS; visual appearance requires human observation.',
    readOnlyQueries:freeze({original:'/root/ResourceFixtureTrigger.get_original_result_json()',summary:'/root/ResourceFixtureTrigger.get_observation_summary()',currentJS:'__WXSLIM_RESOURCE_APP__.status().executor',note:'GD getter retains the original JSON; JS status is a fresh complete snapshot. Diagnostic print is explicit, local and once-only.'}),
    sourceValidation:'STATIC_TEXT_CHECKS_ONLY_NO_GODOT_PARSE',importPaths:'UNKNOWN_UNTIL_ACTUAL_EXPORT',runtimeEligible:false,export:'NOT_RUN',mount:'NOT_RUN',sceneLoad:'NOT_RUN',visual:'NOT_VERIFIED'});
}
