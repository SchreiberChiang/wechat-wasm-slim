uniform int observation_mode = 0;
uniform bool software_reference = false;

void fragment() {
	vec4 s = COLOR;
	if (observation_mode == 1) {
		float a = UV.x < 0.25 ? 0.0 : (UV.x < 0.5 ? 0.25 : (UV.x < 0.75 ? 0.75 : 1.0));
		COLOR = software_reference ? vec4(vec3(a), 1.0) : vec4(vec3(1.0), a);
	} else if (observation_mode == 2) {
		COLOR = vec4(vec3(s.a), 1.0);
	} else if (observation_mode == 3) {
		COLOR = vec4(s.rgb, 1.0);
	} else {
		COLOR = s;
	}
}
