extends "res://renderer_round3.gd"

const Compat = preload("res://opaque_viewport_compat.gd")
const HostBridge = preload("res://bridge.gd")
# Dedicated candidate opt-in. Platform + actual-mode + observed gates remain mandatory.
const ENABLE_ANDROID_GLX_OPAQUE_COMPAT := true
var opaque_compat: Node

func clear() -> void:
    if is_instance_valid(opaque_compat):
        opaque_compat.detach()
        opaque_compat.queue_free()
    opaque_compat = null
    super.clear()

func _build_alpha_comparison() -> void:
    super._build_alpha_comparison()
    opaque_compat = Compat.new()
    add_child(opaque_compat)
    opaque_compat.configure(views[0], worlds[0], ENABLE_ANDROID_GLX_OPAQUE_COMPAT, HostBridge.initialize())
    state["opaqueViewportCompat"] = opaque_compat.snapshot()
    case_note.text = "局部候选：仅实际 Android GLX + 已知非透明源；保留 UI alpha。"
    _emit("opaque_viewport_compat_configured", {"compat": opaque_compat.snapshot(), "phonePass": false})
