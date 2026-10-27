extends RefCounted

static var context: Dictionary = {"source": "native-preview", "resultTrack": "desktop-native", "identity": {}, "sessionTag": "unavailable", "actualMode": "unavailable", "device": {}}
static var initialized := false

static func initialize() -> Dictionary:
	if initialized:
		return context
	initialized = true
	if not OS.has_feature("web"):
		return context
	context = {"source": "host-bridge-unavailable", "identity": {}, "sessionTag": "unavailable", "actualMode": "unavailable", "device": {}}
	var api := JavaScriptBridge.get_interface("AuthorReleaseAcceptance")
	if api == null:
		return context
	# This exact host API emits SCENE once. Diagnostic read emits MANUAL once.
	var identity_text: Variant = api.readIdentityText()
	if identity_text is String:
		context["identityText"] = identity_text
	var raw: Variant = api.readDiagnosticJson()
	# Some mini-game bridges return null/undefined. Do not stringify and parse it.
	if raw is String and raw.strip_edges().begins_with("{"):
		var parsed: Variant = JSON.parse_string(raw)
		if parsed is Dictionary:
			context = parsed
	var platform: Variant = JavaScriptBridge.eval("(function(){try{return typeof wx !== 'undefined' ? wx.getSystemInfoSync().platform : 'unknown';}catch(e){return 'unknown';}})()", true)
	var actual := str(context.get("actualMode", "unavailable")).to_lower()
	context["resultTrack"] = "desktop-webgl" if platform == "devtools" and actual.contains("webgl") else (str(platform) if platform in ["ios", "android"] else "unknown")
	return context

static func emit_record(record: Dictionary) -> void:
	# The current observer is read-only and exposes no operation-write API.
	# Structured stdout is collected by the original host's normal console path.
	# Keep the cached original host record attached, rather than inventing IDs.
	var host := initialize()
	var identity: Dictionary = host.get("identity", {})
	record["host"] = {
		"packageId": identity.get("packageId", "unavailable"),
		"sessionTag": host.get("sessionTag", "unavailable"),
		"requestedMode": host.get("requestedMode", "unavailable"),
		"selectedMode": host.get("selectedMode", "unavailable"),
		"actualMode": host.get("actualMode", "unavailable"),
		"device": host.get("device", {}).duplicate(true),
		"modeEvidence": host.get("modeEvidence", "unavailable"),
		"contextMatches": {"canvas": host.get("canvasMatches"), "loader": host.get("loaderContextMatches"), "nativeId": host.get("nativeContextIdMatches")},
		"source": host.get("source", "unavailable")
	}
	record["resultTrack"] = host.get("resultTrack", "unknown")
	print("[GLX_ACCEPTANCE_R3] " + JSON.stringify(record))
