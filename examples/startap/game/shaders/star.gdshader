// 星星：五角星 SDF + 外发光 + 脉动。hue 每颗星不同。
shader_type canvas_item;

uniform vec3 tint = vec3(1.0, 0.85, 0.3);
uniform float pulse_speed = 4.0;

float star_sdf(vec2 p, float r, float rf) {
	const vec2 k1 = vec2(0.809016994375, -0.587785252292);
	const vec2 k2 = vec2(-k1.x, k1.y);
	p.x = abs(p.x);
	p -= 2.0 * max(dot(k1, p), 0.0) * k1;
	p -= 2.0 * max(dot(k2, p), 0.0) * k2;
	p.x = abs(p.x);
	p.y -= r;
	vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
	float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
	return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	p.y = -p.y;
	float pulse = 0.5 + 0.5 * sin(TIME * pulse_speed);
	float d = star_sdf(p, 0.62, 0.45);
	float body = smoothstep(0.02, -0.02, d);
	float glow = exp(-max(d, 0.0) * (7.0 - 2.0 * pulse)) * 0.8;
	glow *= smoothstep(1.0, 0.75, length(p)); // 发光在贴图边缘前淡出，避免看出方框
	vec3 col = mix(tint * 1.4, vec3(1.0), body * 0.35);
	COLOR = vec4(col, clamp(body + glow, 0.0, 1.0));
}
