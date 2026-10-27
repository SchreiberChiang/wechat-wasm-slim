shader_type spatial;
render_mode unshaded;

uniform bool alternate_palette = false;

void fragment() {
	float band = mod(floor(UV.x * 18.0), 2.0);
	vec3 a = alternate_palette ? vec3(0.08, 0.28, 0.95) : vec3(0.9, 0.08, 0.08);
	vec3 b = alternate_palette ? vec3(0.95, 0.8, 0.05) : vec3(0.05, 0.8, 0.16);
	ALBEDO = mix(a, b, band);
}
