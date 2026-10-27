shader_type canvas_item;
render_mode blend_mix;
// Preserve CanvasItem/ancestor modulation before the default texture sample.
varying float opaque_ui_alpha;
void vertex() {
    opaque_ui_alpha = COLOR.a;
}
void fragment() {
    // RGB already contains the default sample and modulation. No second sample.
    COLOR.a = opaque_ui_alpha;
}
