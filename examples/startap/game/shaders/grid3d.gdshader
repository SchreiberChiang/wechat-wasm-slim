// 3D 地面网格：发光线条向远处淡出，给场景一点纵深感。
shader_type spatial;
render_mode unshaded, cull_disabled, blend_add;

void fragment() {
	vec2 g = abs(fract(UV * 24.0 + vec2(0.0, -TIME * 0.4)) - 0.5);
	float line = smoothstep(0.47, 0.5, max(g.x, g.y));
	float fade = smoothstep(0.0, 0.6, UV.y);
	ALBEDO = vec3(0.35, 0.25, 0.9) * line * fade;
}
