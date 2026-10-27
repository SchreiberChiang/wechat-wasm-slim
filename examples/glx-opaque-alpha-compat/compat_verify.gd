extends SceneTree
const Compat = preload("res://opaque_viewport_compat.gd")
var failures: Array = []
var checks := 0
var evidence: Array = []
var output := ""
var scene: Control
var native_context := {"resultTrack": "unknown", "actualMode": "glx", "modeEvidence": "observed", "device": {"system": "Android 10", "model": "VCE-AL00"}}

func _initialize() -> void:
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--out="): output = arg.substr(6)
    if output.is_empty() or DirAccess.dir_exists_absolute(output):
        push_error("--out must name a new directory")
        quit(2)
        return
    DirAccess.make_dir_recursive_absolute(output)
    call_deferred("run")

func check(ok: bool, label: String) -> void:
    checks += 1
    if not ok: failures.append(label)

func draws() -> void:
    for i in range(3): await RenderingServer.frame_post_draw

func run() -> void:
    root.size = Vector2i(720, 480)
    var screen := SubViewport.new()
    screen.size = Vector2i(720, 480)
    screen.render_target_update_mode = SubViewport.UPDATE_ALWAYS
    root.add_child(screen)
    var bg := ColorRect.new()
    bg.color = Color(0.1, 0.2, 0.05, 1)
    bg.size = Vector2(720, 480)
    screen.add_child(bg)
    var source := SubViewport.new()
    source.size = Vector2i(64, 64)
    source.transparent_bg = false
    source.render_target_update_mode = SubViewport.UPDATE_ALWAYS
    root.add_child(source)
    var fill := ColorRect.new()
    fill.color = Color(0.8, 0.4, 0.2, 1)
    fill.size = Vector2(64,64)
    source.add_child(fill)
    var parent := Control.new()
    parent.position = Vector2(40,40)
    parent.size = Vector2(480,240)
    parent.clip_contents = true
    screen.add_child(parent)
    var original := TextureRect.new()
    original.texture = source.get_texture()
    original.size = Vector2(200,240)
    parent.add_child(original)
    var candidate := TextureRect.new()
    candidate.texture = source.get_texture()
    candidate.position = Vector2(240,0)
    candidate.size = Vector2(300,300)
    parent.add_child(candidate)
    var controller := Compat.new()
    root.add_child(controller)
    controller.configure(candidate, source, true, native_context)
    check(controller.snapshot().applied, "explicit test Android GLX applied")
    for parent_alpha in [0.0,0.25,0.5,1.0]:
        for ui_alpha in [0.0,0.25,0.5,1.0]:
            parent.modulate.a = parent_alpha
            original.self_modulate.a = ui_alpha
            candidate.self_modulate.a = ui_alpha
            await draws()
            var image := screen.get_texture().get_image()
            var a := image.get_pixel(100,100)
            var b := image.get_pixel(340,100)
            check(a.is_equal_approx(b), "opaque baseline parity parent=%s UI=%s" % [parent_alpha,ui_alpha])
            check(image.get_pixel(540,100).is_equal_approx(image.get_pixel(650,100)), "right clip parent=%s UI=%s" % [parent_alpha,ui_alpha])
            check(image.get_pixel(340,300).is_equal_approx(image.get_pixel(650,300)), "bottom clip parent=%s UI=%s" % [parent_alpha,ui_alpha])
            image.save_png(output.path_join("alpha-p%s-u%s.png" % [parent_alpha,ui_alpha]))
            evidence.append({"parentAlpha":parent_alpha,"uiAlpha":ui_alpha,"baseline":str(a),"compat":str(b)})
    parent.modulate = Color(0.5,0.75,0.8,0.5)
    original.modulate = Color(0.75,0.5,0.9,0.5)
    candidate.modulate = original.modulate
    original.self_modulate = Color(0.8,0.7,0.6,0.5)
    candidate.self_modulate = original.self_modulate
    await draws()
    var colored := screen.get_texture().get_image()
    check(colored.get_pixel(100,100).is_equal_approx(colored.get_pixel(340,100)), "RGB and combined modulate/self/parent alpha parity")
    colored.save_png(output.path_join("colored-modulation.png"))
    # Synthetic low-alpha attachment fixture, not a reproduction of phone writes.
    # blend_disabled writes known RGBA into an explicitly nontransparent viewport.
    parent.modulate = Color.WHITE
    candidate.modulate = Color.WHITE
    original.hide()
    var reference := ColorRect.new()
    reference.color = fill.color
    reference.size = Vector2(200,240)
    parent.add_child(reference)
    var injected := ShaderMaterial.new()
    injected.shader = Shader.new()
    injected.shader.code = "shader_type canvas_item; render_mode blend_disabled; uniform float fixture_alpha = 0.0; void fragment(){ COLOR = vec4(0.8,0.4,0.2,fixture_alpha); }"
    fill.material = injected
    for sampled_alpha in [0.0,0.25,1.0]:
        injected.set_shader_parameter("fixture_alpha",sampled_alpha)
        for parent_alpha in [0.0,0.25,0.5,1.0]:
            for ui_alpha in [0.0,0.25,0.5,1.0]:
                parent.modulate.a = parent_alpha
                candidate.self_modulate = Color(1,1,1,ui_alpha)
                reference.self_modulate = candidate.self_modulate
                await draws()
                var fixture := screen.get_texture().get_image()
                check(fixture.get_pixel(100,100).is_equal_approx(fixture.get_pixel(340,100)), "synthetic source alpha=%s parent=%s UI=%s" % [sampled_alpha,parent_alpha,ui_alpha])
                if parent_alpha == 1.0 and ui_alpha == 0.5:
                    fixture.save_png(output.path_join("synthetic-source-alpha-%s.png" % sampled_alpha))
    injected.set_shader_parameter("fixture_alpha",0.0)
    parent.modulate = Color.WHITE
    candidate.self_modulate = Color.WHITE
    original.self_modulate = Color.WHITE
    original.modulate = Color.WHITE
    original.show()
    reference.hide()
    await draws()
    var low_alpha := screen.get_texture().get_image()
    check(not low_alpha.get_pixel(100,100).is_equal_approx(low_alpha.get_pixel(340,100)), "synthetic source alpha0 actually affects uncorrected MIX")
    low_alpha.save_png(output.path_join("synthetic-low-alpha-original-vs-compat.png"))
    for context in [{"resultTrack":"ios","actualMode":"glx","modeEvidence":"observed"}, {"resultTrack":"android","actualMode":"webgl","modeEvidence":"observed"}, {"resultTrack":"android","actualMode":"glx","modeEvidence":"unknown"}, {}]:
        controller.configure(candidate,source,true,context)
        check(candidate.material == null,"platform/evidence rejection " + str(context))
    var platform_cases := [
        {"device":{"system":"Android 10","model":"VCE-AL00"},"allow":true,"evidence":"cached-host.device.system-android-version"},
        {"device":{"platform":"android","system":"Android 10"},"allow":true,"evidence":"cached-host.device.platform"},
        {"device":{"system":"Android10"},"allow":true,"evidence":"cached-host.device.system-android-version"},
        {"device":{"system":"iOS 18.3.1"},"allow":false},
        {"device":{},"allow":false},
        {"device":{"system":"Fake Android 10"},"allow":false},
        {"device":{"system":"AndroidFake 10"},"allow":false},
        {"device":{"system":"Android 10fake"},"allow":false},
        {"device":{"system":"Android"},"allow":false},
        {"device":{"platform":"ios","system":"Android 10"},"allow":false},
        {"device":{"platform":"devtools","system":"Android 10"},"allow":false},
        {"device":{"platform":null,"system":"Android 10"},"allow":false},
        {"device":{"platform":"Android","system":"Android 10"},"allow":false}
    ]
    for entry in platform_cases:
        var logged_host := {"resultTrack":"unknown","actualMode":"glx","modeEvidence":"observed","device":entry.device}
        controller.configure(candidate,source,true,logged_host)
        var snapshot: Dictionary = controller.snapshot()
        evidence.append({"kind":"cached-platform-gate","deviceFixture":entry.device,"expectedAllowed":entry.allow,"snapshot":snapshot})
        check(snapshot.applied == entry.allow,"cached platform gate " + str(entry.device))
        check(snapshot.resultTrack == "unknown","original resultTrack unknown retained")
        if entry.allow:
            check(snapshot.platformEvidence.source == entry.evidence,"platform evidence source recorded")
            for mode in ["webgl","unknown"]:
                logged_host.actualMode = mode
                controller.configure(candidate,source,true,logged_host)
                check(candidate.material == null,"Android cached system cannot admit " + mode)
    controller.configure(candidate,source,true,native_context)
    var unobserved := native_context.duplicate(true)
    unobserved.modeEvidence = "unknown"
    controller.configure(candidate,source,true,unobserved)
    check(candidate.material == null,"cached Android with unobserved mode refused")
    controller.configure(candidate,source,false,native_context)
    check(candidate.material == null,"default-off rejection")
    var custom := ShaderMaterial.new()
    custom.shader = load("res://display_ignore_alpha.gdshader")
    candidate.material = custom
    controller.configure(candidate,source,true,native_context)
    check(candidate.material == custom,"existing custom material preserved")
    candidate.material = null
    candidate.use_parent_material = true
    controller.refresh()
    check(candidate.material == null,"parent material rejected")
    candidate.use_parent_material = false
    controller.refresh()
    check(candidate.material != null,"eligible source reenabled")
    var other := SubViewport.new()
    other.size = Vector2i(64,64)
    root.add_child(other)
    candidate.texture = other.get_texture()
    await draws()
    check(candidate.material == null,"texture switch auto revoke before draw")
    candidate.texture = source.get_texture()
    await draws()
    check(candidate.material != null,"registered source restored")
    source.transparent_bg = true
    await draws()
    check(candidate.material == null,"transparent source auto revoke")
    controller.configure(candidate,source,true,native_context)
    check(candidate.material == null,"transparent source configure refused")
    source.transparent_bg = false
    candidate.texture = ImageTexture.create_from_image(Image.create(2,2,false,Image.FORMAT_RGBA8))
    controller.refresh()
    check(candidate.material == null,"ordinary/transparent image source rejected")
    candidate.texture = source.get_texture()
    controller.refresh()
    candidate.material = custom
    await draws()
    check(candidate.material == custom,"externally replaced material preserved on revoke")
    var nine := NinePatchRect.new()
    screen.add_child(nine)
    controller.configure(nine,source,true,native_context)
    check(nine.material == null,"NinePatch refused")
    # Also parse/build the actual retained source and assert native default stays off.
    parent.hide()
    bg.hide()
    nine.hide()
    root.size = Vector2i(720,1160)
    screen.size = Vector2i(720,1160)
    scene = load("res://main.tscn").instantiate()
    screen.add_child(scene)
    await draws()
    for index in range(scene.steps.size()):
        if scene.steps[index].id == "D15-alpha": scene.select_step(index)
    await draws()
    check(scene.renderer.worlds.size()==1,"actual baseline source remains single viewport")
    check(scene.renderer.views[0].material==null,"actual native scene gate is off")
    check(scene.renderer.views[1].material != null,"original right DISABLED reference retained")
    scene.renderer.side_running[0] = false
    screen.get_texture().get_image().save_png(output.path_join("actual-native-page.png"))
    scene.renderer.opaque_compat.configure(scene.renderer.views[0],scene.renderer.worlds[0],true,native_context)
    await draws()
    check(scene.renderer.views[0].material != null, "actual 3D source accepts injected native fixture context")
    screen.get_texture().get_image().save_png(output.path_join("actual-native-compat-fixture.png"))
    var result := {"outcome":"PASS" if failures.is_empty() else "FAIL","checks":checks,"failures":failures,
        "engineVersion":Engine.get_version_info(),"displayServer":DisplayServer.get_name(),"evidence":evidence,
        "scope":"native graphical reference with injected test context only; not observed Android GLX",
        "phoneTested":false,"actualWebGLTested":false,"rootCauseFixed":false}
    var file := FileAccess.open(output.path_join("RESULT.json"), FileAccess.WRITE)
    file.store_string(JSON.stringify(result,"\t"))
    file.close()
    print(JSON.stringify(result))
    quit(0 if failures.is_empty() else 2)





