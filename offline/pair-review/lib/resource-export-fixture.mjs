// Pure source preparation for a bounded export/partition verifier fixture.
// No FS, Godot invocation, export, import mapping guesses, GLX settings or defaults for games.
// Preset text follows examples/glx-ios-functional/export_presets.cfg and
// engine/alpha-preserve-lighting/delivery-exports.cfg; future export must use 4.7.2.
const entries = [
  ['project.godot', `config_version=5

[application]
config/name="Wxslim resource export verification fixture"
run/main_scene="res://boot.tscn"
config/features=PackedStringArray("4.7", "GL Compatibility")

[display]
window/size/viewport_width=128
window/size/viewport_height=128

[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`],
  ['export_presets.cfg', `[preset.0]
name="Web"
platform="Web"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter="*.md,*.log,*.json,source-only-marker.txt"
export_path=""
encrypt_pck=false
encrypt_directory=false
script_export_mode=0

[preset.0.options]
custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
`],
  ['boot.tscn', `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://boot.gd" id="1_boot"]

[node name="Boot" type="Node2D"]
script = ExtResource("1_boot")
`],
  ['boot.gd', `extends Node2D
## Verification fixture only. Boot never preloads or loads the level or shared texture.

func get_boot_proof() -> Dictionary:
\treturn {"marker": "wxslim-boot-v1", "scope": "fixture boot object only"}
`],
  ['level.tscn', `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://level.gd" id="1_level"]
[ext_resource type="Texture2D" path="res://shared/checker.svg" id="2_checker"]

[node name="Level" type="Node2D"]
script = ExtResource("1_level")

[node name="Sprite" type="Sprite2D" parent="."]
position = Vector2(64, 64)
texture = ExtResource("2_checker")
`],
  ['level.gd', `class_name WxslimResourceFixtureLevel
extends Node2D
## This method reports the instantiated object's actual properties, not a rendering pass.
@export var marker: String = "wxslim-level-v1"

func get_proof() -> Dictionary:
\tvar sprite: Sprite2D = get_node_or_null("Sprite") as Sprite2D
\tvar texture: Texture2D = sprite.texture if sprite != null else null
\treturn {
\t\t"marker": marker,
\t\t"texturePresent": texture != null,
\t\t"textureWidth": texture.get_width() if texture != null else 0,
\t\t"textureHeight": texture.get_height() if texture != null else 0,
\t\t"scope": "instantiated fixture properties only; visual output not verified"
\t}
`],
  ['shared/checker.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
<rect width="16" height="16" fill="#ffffff"/>
<rect width="8" height="8" fill="#2454a6"/>
<rect x="8" y="8" width="8" height="8" fill="#2454a6"/>
</svg>
`]
];
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }

/** Fresh Map<root-relative path, UTF8 string>; caller decides any later filesystem writes. */
export function createResourceExportFixture() {
  return Object.freeze({
    schema:'wxslim-resource-export-fixture-v1',
    purpose:'TEST_FIXTURE_ONLY_NOT_GAME_DEFAULT',
    requiredGodotVersion:'4.7.2',
    encoding:'utf8',
    files:new Map(entries),
    ownership:freeze({
      schema:'wxslim-resource-export-fixture-ownership-v1',
      packs:[
        {id:'boot',role:'boot',sourceRoots:['project.godot','boot.tscn','boot.gd','level.gd'],requires:[]},
        {id:'shared',role:'resource',sourceRoots:['shared/checker.svg'],requires:[]},
        {id:'level',role:'resource',sourceRoots:['level.tscn'],requires:['shared']}
      ],
      sourceToolingOnly:['export_presets.cfg'],
      forcedBoot:['project.binary','project.godot','UID metadata','global script class cache','extension list','every gd/gdc/gd.remap or gdc.remap artifact'],
      exportMapping:'Use actual exported remaps and import records to map each scene/texture to every emitted path; never synthesize imported file names or hashes',
      scriptPolicy:'All script payloads and script remaps belong to boot, including the level class; texture/scene closure rules never override this',
      sharedPolicy:'shared owns the checker SVG and its actually exported remap/import/generated texture payload closure, excluding forced-boot paths',
      levelPolicy:'level owns the actual exported level scene and its scene remap/generated scene payload; its script is boot and its texture dependency is shared',
      bootPolicy:'boot owns its actual exported scene/script closure and all project/global metadata; boot scene/script must not statically reference level or shared',
      finalPartition:'After real export, enumerate every actual final PCK path with exactly one owner; reject missing, unknown, alias, overlap and unclassified paths',
      dependencyCoverage:'DECLARED_FIXTURE_DEPENDENCIES_ONLY_NOT_COMPLETE_RESOURCE_UID_SCRIPT_OR_EXTENSION_SCAN'
    }),
    expectedProof:freeze({className:'WxslimResourceFixtureLevel',marker:'wxslim-level-v1',textureWidth:16,textureHeight:16,meaning:'Future verifier compares get_proof actual observations; these expected values alone prove nothing'}),
    importPaths:'UNKNOWN_UNTIL_ACTUAL_EXPORT',
    runtimeEligible:false,export:'NOT_RUN',mount:'NOT_RUN',sceneLoad:'NOT_RUN',visual:'NOT_VERIFIED'
  });
}
