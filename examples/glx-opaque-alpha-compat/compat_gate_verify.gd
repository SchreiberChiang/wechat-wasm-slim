extends SceneTree
const Compat = preload("res://opaque_viewport_compat.gd")
var checks := 0
var failures: Array = []
var output := ""
func check(ok: bool, label: String) -> void:
    checks += 1
    if not ok: failures.append(label)
func _initialize() -> void:
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--out="): output=arg.substr(6)
    if output.is_empty() or FileAccess.file_exists(output):
        push_error("--out must name a new JSON file")
        quit(2)
        return
    call_deferred("run")
func run() -> void:
    var source := SubViewport.new()
    source.size = Vector2i(64,64)
    root.add_child(source)
    var clip := Control.new()
    clip.clip_contents = true
    clip.size = Vector2(100,100)
    clip.modulate = Color(0.2,0.4,0.6,0.5)
    root.add_child(clip)
    var target := TextureRect.new()
    target.texture = source.get_texture()
    target.size = Vector2(200,200)
    target.self_modulate = Color(0.5,0.5,0.5,0.25)
    clip.add_child(target)
    var controller := Compat.new()
    root.add_child(controller)
    var context := {"resultTrack":"unknown","device":{"system":"Android 10"},"actualMode":"glx","modeEvidence":"observed"}
    var saved := {"texture":target.texture,"size":target.size,"selfModulate":target.self_modulate,"clip":clip.clip_contents,"parentModulate":clip.modulate}
    controller.configure(target,source,true,context)
    check(target.material != null,"plain TextureRect installed")
    var custom_script := GDScript.new()
    custom_script.source_code = "extends TextureRect\n"
    check(custom_script.reload() == OK,"minimal GDScript subclass compiled")
    target.set_script(custom_script)
    check(target.get_class()=="TextureRect","script subclass native get_class remains TextureRect")
    controller.refresh()
    check(target.material==null,"script subclass revokes owned compat")
    check(controller.snapshot().reason=="scripted-texture-rect","script rejection reason explicit")
    controller.configure(target,source,true,context)
    check(target.material==null,"script subclass configure refused")
    target.set_script(null)
    controller.refresh()
    check(target.material!=null,"plain TextureRect restore accepted")
    controller.enabled=false
    controller.refresh()
    check(target.material==null,"disabled restores original empty material")
    check(target.texture==saved.texture and target.size==saved.size,"texture and geometry preserved")
    check(target.self_modulate==saved.selfModulate,"UI modulation preserved")
    check(clip.clip_contents==saved.clip and clip.modulate==saved.parentModulate,"parent clipping and modulation preserved")
    var custom := CanvasItemMaterial.new()
    target.material=custom
    controller.configure(target,source,true,context)
    check(target.material==custom,"existing material preserved during refusal")
    target.material=null
    controller.configure(target,source,true,context)
    target.material=custom
    controller.refresh()
    check(target.material==custom,"external replacement retained when own compat revoked")
    var nine := NinePatchRect.new()
    nine.texture=source.get_texture()
    nine.material=custom
    nine.patch_margin_left=8
    clip.add_child(nine)
    controller.configure(nine,source,true,context)
    check(nine.material==custom and nine.patch_margin_left==8,"NinePatch existing material and patch state preserved")
    check(controller.snapshot().reason=="not-plain-texture-rect","NinePatch refusal reason")
    var result := {"outcome":"PASS" if failures.is_empty() else "FAIL","checks":checks,"failures":failures,"engineVersion":Engine.get_version_info(),"scope":"targeted plain TextureRect/script subclass and state-preservation gates; previous native alpha/shader matrix unchanged","fullGraphicalMatrixRerun":false,"phoneTested":false}
    var file := FileAccess.open(output,FileAccess.WRITE)
    file.store_string(JSON.stringify(result,"\t"))
    file.close()
    print(JSON.stringify(result))
    quit(0 if failures.is_empty() else 2)
