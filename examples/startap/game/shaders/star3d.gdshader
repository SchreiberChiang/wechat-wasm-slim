// 3D 星星：有光照的宝石感五角星，自发光随时间脉动，边缘有轮廓光。
shader_type spatial;
render_mode cull_disabled;

uniform vec3 tint = vec3(1.0, 0.85, 0.3);
uniform float pulse_speed = 4.0;

void fragment() {
	float pulse = 0.5 + 0.5 * sin(TIME * pulse_speed);
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0);
	ALBEDO = tint * 0.7;
	METALLIC = 0.3;
	ROUGHNESS = 0.35;
	EMISSION = tint * (0.35 + 0.45 * pulse) + vec3(1.0) * rim * 0.6;
}
