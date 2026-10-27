extends Node

# Scene-local allow-list: a caller must supply the exact known source viewport.
# Do not infer opacity from ViewportTexture.has_alpha() (constant false in base).
const MIX_SHADER = preload("res://opaque_viewport_mix.gdshader")
var target: CanvasItem
var source: SubViewport
var enabled := false
var host_context: Dictionary = {}
var owned_material: ShaderMaterial
var last_reason := "unconfigured"
var android_system_pattern := RegEx.create_from_string("^Android(?:[ \\t]+|(?=[0-9]))[0-9]+(?:\\.[0-9]+)*(?:[ \\t].*)?$")

func platform_evidence() -> Dictionary:
    # Use only the existing cached wx.getSystemInfoSync device fields.
    # resultTrack may legitimately remain unknown; do not rewrite it.
    var device: Variant = host_context.get("device", {})
    if not device is Dictionary:
        return {"android": false, "source": "cached-host.device-missing"}
    if device.has("platform"):
        return {"android": device.platform is String and device.platform == "android", "source": "cached-host.device.platform"}
    var system: Variant = device.get("system", null)
    return {"android": system is String and android_system_pattern.search(system) != null,
        "source": "cached-host.device.system-android-version" if system is String else "cached-host.device.system-missing"}

func configure(display: CanvasItem, viewport: SubViewport, explicit_enable: bool, context: Dictionary) -> void:
    detach()
    target = display
    source = viewport
    enabled = explicit_enable
    host_context = context.duplicate(true)
    refresh()

func _ready() -> void:
    RenderingServer.frame_pre_draw.connect(refresh)

func _exit_tree() -> void:
    if RenderingServer.frame_pre_draw.is_connected(refresh):
        RenderingServer.frame_pre_draw.disconnect(refresh)
    detach()

func detach() -> void:
    if is_instance_valid(target) and owned_material != null and target.material == owned_material:
        target.material = null
    owned_material = null

func rejection_reason() -> String:
    if not enabled: return "explicit-switch-off"
    if not platform_evidence().android: return "cached-platform-not-android"
    if host_context.get("actualMode", "unknown") != "glx": return "not-actual-glx"
    if host_context.get("modeEvidence", "unknown") != "observed": return "mode-unverified"
    if not is_instance_valid(target) or not target is TextureRect or target.get_class() != "TextureRect": return "not-plain-texture-rect"
    if target.get_script() != null: return "scripted-texture-rect"
    if not is_instance_valid(source) or source.transparent_bg: return "source-not-explicitly-opaque"
    if target.use_parent_material: return "parent-material"
    if target.material != null and target.material != owned_material: return "existing-material"
    if target.texture == null or not target.texture is ViewportTexture or target.texture != source.get_texture(): return "source-texture-changed"
    return "eligible"

func refresh() -> void:
    last_reason = rejection_reason()
    if last_reason != "eligible":
        detach()
        return
    if owned_material == null:
        owned_material = ShaderMaterial.new()
        owned_material.shader = MIX_SHADER
    target.material = owned_material

func snapshot() -> Dictionary:
    return {"enabled": enabled, "applied": owned_material != null and is_instance_valid(target) and target.material == owned_material,
        "reason": last_reason, "platformEvidence": platform_evidence(), "resultTrack": host_context.get("resultTrack", "unknown"), "scope": "one explicitly registered opaque SubViewport TextureRect", "rootCauseFixed": false}


