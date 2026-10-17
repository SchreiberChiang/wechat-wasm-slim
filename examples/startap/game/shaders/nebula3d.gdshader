// 3D 背景板：缓慢流动的星云 + 闪烁星点（不受光照）。energy 由游戏控制（得分时变亮）。
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform float energy = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV;
	float t = TIME * 0.05;
	float n = noise(uv * 4.0 + vec2(t, -t)) * 0.6 + noise(uv * 9.0 - vec2(t * 2.0, t)) * 0.4;
	vec3 col = mix(vec3(0.01, 0.02, 0.08), vec3(0.18, 0.06, 0.30), n * (1.0 - uv.y * 0.6));
	col += vec3(0.05, 0.10, 0.25) * smoothstep(0.55, 0.9, n);
	vec2 cell = floor(uv * vec2(60.0, 100.0));
	float h = hash(cell);
	vec2 f = fract(uv * vec2(60.0, 100.0)) - 0.5;
	col += vec3(0.9) * step(0.97, h) * smoothstep(0.15, 0.0, length(f)) * (0.5 + 0.5 * sin(TIME * (1.0 + h * 3.0) + h * 40.0));
	col += vec3(0.3, 0.12, 0.4) * energy;
	ALBEDO = col;
}
