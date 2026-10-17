// 背景：缓慢流动的渐变 + 闪烁星点。energy 由游戏控制（得分时变亮）。
shader_type canvas_item;

uniform float energy : hint_range(0.0, 2.0) = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	float t = TIME * 0.15;
	vec3 top = vec3(0.10, 0.05, 0.25) + 0.05 * vec3(sin(t), sin(t + 2.0), sin(t + 4.0));
	vec3 bottom = vec3(0.01, 0.03, 0.10);
	float wave = 0.04 * sin(uv.x * 6.0 + TIME * 0.7) + 0.03 * sin(uv.x * 11.0 - TIME * 0.4);
	vec3 col = mix(top, bottom, clamp(uv.y + wave, 0.0, 1.0));
	vec2 cell = floor(uv * vec2(36.0, 64.0));
	float h = hash(cell);
	float twinkle = 0.5 + 0.5 * sin(TIME * (1.0 + h * 3.0) + h * 40.0);
	vec2 f = fract(uv * vec2(36.0, 64.0)) - 0.5;
	float star = step(0.965, h) * smoothstep(0.12, 0.0, length(f)) * twinkle;
	col += vec3(0.8, 0.85, 1.0) * star;
	col += vec3(0.25, 0.1, 0.35) * energy * (1.0 - uv.y);
	COLOR = vec4(col, 1.0);
}
