// In-memory source preparation only; no project/export/PCK written or engine run.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
export function createNetworkObservationFixture() {
  const file = new URL('./godot-network-observation.gd', import.meta.url);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024) throw Error('NETWORK_OBSERVATION_SOURCE');
  const bytes = fs.readFileSync(file), source = bytes.toString('utf8');
  if (!Buffer.from(source).equals(bytes)) throw Error('NETWORK_OBSERVATION_UTF8');
  const files = new Map([
    ['godot-network-observation.gd', source],
    ['project.godot', `config_version=5
[application]
config/name="WXSLIM Network Desktop Observation"
run/main_scene="res://network.tscn"
[display]
window/size/viewport_width=800
window/size/viewport_height=900
[editor]
export/convert_text_resources_to_binary=false
[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`],
    ['network.tscn', `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://godot-network-observation.gd" id="1"]
[node name="NetworkObservation" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1")
`],
  ]);
  return {schema: 'wxslim-network-observation-fixture-v1', files,
    sourcePins: {'godot-network-observation.gd': {source: './godot-network-observation.gd', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}},
    totalBytes: [...files.values()].reduce((n, s) => n + Buffer.byteLength(s), 0),
    sourceOnly: true, parser: 'NOT_RUN', import: 'NOT_RUN', export: 'NOT_RUN', wasm: 'NOT_RUN', phone: 'NOT_RUN',
    executionAuthorizedByFixture: false, autoConnect: false,
    prerequisites: ['Separately pinned actual JS/WASM/host and export configuration', 'Explicit manually supplied owned temporary loopback port', 'Authorized server implements declared bounded endpoint contract'],
    serverContract: {http: {echo: 'POST /echo returns exact request bytes with status 200', status: 'GET /status returns 503 and bytes [0,128,255]', empty: 'GET /empty returns 204', failure: 'GET /reset drops TCP', cancel: 'GET /slow stays pending until client aborts'}, websocket: {echo: '/echo returns text/binary frames and echoes close 1000/done', failure: '/reset accepts upgrade then drops TCP after first message'}},
    limitations: ['No GDScript parser executed', 'No server created by fixture', 'No automatic pass or phone claim', 'Local cancellation does not prove remote receipt or rollback', 'Timeout means unknown; externally identify native/fallback backend', 'No credentials, remote endpoints or SocketTask session interface']};
}
