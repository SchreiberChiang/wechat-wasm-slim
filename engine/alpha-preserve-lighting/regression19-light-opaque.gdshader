shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled;
uniform sampler2D albedo_texture : source_color, filter_nearest, repeat_enable;
void fragment() {
	ALBEDO = texture(albedo_texture, UV * vec2(3.0, 2.0)).rgb;
	ROUGHNESS = 0.8;
}
void light() {
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * ATTENUATION * LIGHT_COLOR / PI;
}
