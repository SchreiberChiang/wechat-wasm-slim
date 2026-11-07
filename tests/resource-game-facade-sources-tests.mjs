// Source and in-memory wiring models only: no temporary project, directory,
// Godot process, export, engine, converter, Web/phone operation or installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createResourceGameFacadeSources,preflightResourceGameFacadeBootSource,preflightResourceGameFacadeBoot} from '../lib/resource-game-facade-sources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function model(){
  const bundle=createResourceGameFacadeSources(),files=new Map(bundle.files),main='boot/menu.tscn';
  files.set(main,'[gd_scene format=3]\n\n[node name="Menu" type="Node"]\n');
  const project='config_version=5\n\n[application]\nrun/main_scene="res://'+main+'"\n\n[autoload]\n'+bundle.requiredAutoload.line+'\n';
  const input={projectSource:project,sourceFiles:files,bootSourcePaths:[...bundle.requiredBootSourcePaths,main]};
  return {bundle,files,project,main,input,preflight:()=>preflightResourceGameFacadeBootSource(input)};
}
function gdFunction(source,name){const start=source.indexOf('func '+name+'(');assert(start>=0,name);const next=source.indexOf('\nfunc ',start+1);return source.slice(start,next<0?source.length:next);}
function gd(){return createResourceGameFacadeSources().files.get('godot-resource-game-facade.gd');}
const codes=preflight=>preflight.blockers.map(b=>b.code);

test('source bundle has four bounded current scripts; three existing components remain byte-identical',()=>{
  const a=createResourceGameFacadeSources(),b=createResourceGameFacadeSources();assert.equal(a.files.size,4);assert.deepEqual(a,b);let bytes=0;
  for(const item of a.snapshots){const original=fs.readFileSync(new URL('../lib/'+item.path,import.meta.url));assert.equal(a.files.get(item.path),original.toString('utf8'));assert.equal(item.bytes,original.length);assert.equal(item.sha256,sha(original));bytes+=item.bytes;}
  assert.equal(a.bytes,bytes);assert(bytes<128*1024);assert.equal(a.sourceSha256.length,64);assert.equal(a.multiLevelSupported,true);assert.equal(a.runtimeEligible,false);
  assert.equal(a.runtimeProtocol.resourceAppSchema,'wxslim-resource-interfaces-v2');assert.equal(a.runtimeProtocol.sessionSchema,'wxslim-resource-executor-session-v1');
  assert.equal(a.resultRetention.summaryLimit,8);assert.equal(a.resultRetention.rawPolicy,'LATEST_SETTLED_LOAD_ONLY');assert.equal(a.schema,'wxslim-resource-game-facade-sources-v2');
  assert.equal(a.sourceValidation,'STATIC_TEXT_CHECKS_ONLY_NO_GODOT_PARSE');assert.equal(a.installationPerformed,false);assert.equal(a.godotRun,'NOT_RUN');assert.equal(a.export,'NOT_RUN');assert.equal(a.phone,'NOT_RUN');
  a.files.set('godot-resource-game-facade.gd','caller edit');assert.notEqual(b.files.get('godot-resource-game-facade.gd'),'caller edit');assert(Object.isFrozen(a.snapshots));
});
test('complete in-memory boot wiring passes only the source gate and binds bytes and declared ownership',()=>{
  const f=model(),a=f.preflight(),b=f.preflight();assert.deepEqual(a,b);assert.equal(a.status,'PASS_SOURCE_WIRING_ONLY');assert.equal(a.files.length,5);assert.deepEqual(a.blockers,[]);
  assert.equal(a.project.sha256,sha(f.project));assert.equal(a.sourceSha256,f.bundle.sourceSha256);assert.equal(a.mainScene,'res://'+f.main);assert.equal(a.exportedBootCoverage,'NOT_PROVEN');assert.equal(a.dependencyClosure,'NOT_SCANNED');
  assert.equal(a.runtimeEligible,false);assert.equal(a.loadPolicy,'SERIAL_SESSION_LOADS_WHILE_IDLE_HEALTHY');assert.equal(a.shutdownScope,'LOCAL_FACADE_DRAIN_NOT_JS_HOST_DISPOSAL');assert(Object.isFrozen(a.blockers));
  assert.deepEqual(a.runtimeProtocol,f.bundle.runtimeProtocol);assert.equal(a.existingExportCompatibility,'NOT_PROVEN_REQUIRES_FRESH_SOURCE_MATCHED_EXPORT');
});
test('missing autoload and duplicate runtime autoloads are explicit blockers without project edits',()=>{
  const f=model();f.input.projectSource=f.project.replace(f.bundle.requiredAutoload.line,'');assert(codes(f.preflight()).includes('RESOURCE_FACADE_AUTOLOAD_REQUIRED'));
  for(const line of ['Other="*res://godot-resource-game-facade.gd"','ResidentReceiver="*res://godot-resource-command-receiver.gd"','WxResourceReceiver="*res://unrelated.gd"']){
    f.input.projectSource=f.project+line+'\n';const result=f.preflight();assert.equal(result.status,'BLOCKED');assert(codes(result).some(c=>c==='RESOURCE_FACADE_DUPLICATE_RUNTIME_AUTOLOAD'||c==='RESOURCE_FACADE_RECEIVER_ROOT_RESERVED'));
  }
  assert.equal(f.project,model().project);
});
test('legacy WxSplit may coexist but is never adopted as the resource scene transition',()=>{
  const f=model();f.input.projectSource+='WxSplit="*res://addons/wx_split/wx_split.gd"\n';const r=f.preflight();assert.equal(r.status,'PASS_SOURCE_WIRING_ONLY');assert.equal(r.legacyWxSplitPresent,true);assert.equal(r.legacyEntryPolicy,'CALL_FACADE_DIRECTLY_DO_NOT_CHAIN_WXSPLIT_ENTER');
});
test('each missing, changed or undeclared boot runtime script fails its precise source gate',()=>{
  for(const item of createResourceGameFacadeSources().snapshots){
    const missing=model();missing.files.delete(item.path);assert(codes(missing.preflight()).includes('RESOURCE_FACADE_BOOT_SOURCE_MISSING'));
    const changed=model();changed.files.set(item.path,changed.files.get(item.path)+'\n');assert(codes(changed.preflight()).includes('RESOURCE_FACADE_BOOT_SOURCE_CHANGED'));
    const undeclared=model();undeclared.input.bootSourcePaths=undeclared.input.bootSourcePaths.filter(p=>p!==item.path);assert(codes(undeclared.preflight()).includes('RESOURCE_FACADE_BOOT_SOURCE_NOT_DECLARED'));
  }
});
test('main scene must be explicitly resolvable, present and owned in boot; runtime must not attach there',()=>{
  const f=model();for(const selected of ['uid://unresolved','res://../outside.tscn','res://godot-resource-game-facade.gd','']){
    f.input.projectSource=f.project.replace('res://'+f.main,selected);assert(codes(f.preflight()).includes('RESOURCE_FACADE_EXPLICIT_MAIN_SCENE_REQUIRED'));
  }
  f.input.projectSource=f.project;f.files.delete(f.main);assert(codes(f.preflight()).includes('RESOURCE_FACADE_BOOT_MAIN_MISSING'));
  f.files.set(f.main,'[ext_resource type="Script" path="res://godot-resource-game-facade.gd" id="1"]');assert(codes(f.preflight()).includes('RESOURCE_FACADE_RUNTIME_ON_MAIN_SCENE'));
  f.files.set(f.main,'[gd_scene format=3]');f.input.bootSourcePaths=f.bundle.requiredBootSourcePaths;assert(codes(f.preflight()).includes('RESOURCE_FACADE_BOOT_MAIN_NOT_DECLARED'));
});
test('ambiguous/duplicate relevant project fields are refused rather than guessed',()=>{
  const f=model();for(const project of [f.project+'[autoload]\n',f.project+f.bundle.requiredAutoload.line+'\n',f.project.replace('[autoload]','run/main_scene="res://other.tscn"\n[autoload]'),f.project.replace(f.bundle.requiredAutoload.line,'WxResource=unquoted'),f.project.replace(f.bundle.requiredAutoload.line,f.bundle.requiredAutoload.line+' ; ambiguous')]){
    f.input.projectSource=project;assert.equal(f.preflight().status,'BLOCKED');
  }
});
test('source models enforce UTF8/size/ownership path bounds and expose file errors',()=>{
  const f=model();assert.throws(()=>preflightResourceGameFacadeBootSource({...f.input,projectSource:' '.repeat(1024*1024+1)}),{code:'RESOURCE_FACADE_SOURCE_LIMIT'});
  assert.throws(()=>preflightResourceGameFacadeBootSource({...f.input,projectSource:Buffer.from([0xff])}),{code:'RESOURCE_FACADE_SOURCE_UTF8'});
  for(const paths of [['../escape.gd'],['/absolute.gd'],['same.gd','same.gd'],['res://file.gd']])assert.throws(()=>preflightResourceGameFacadeBootSource({...f.input,bootSourcePaths:paths}),{code:'RESOURCE_FACADE_BOOT_PATHS'});
  assert.throws(()=>preflightResourceGameFacadeBoot({projectFile:'bad\u0000',bootSourcePaths:[]}),{code:'RESOURCE_FACADE_PROJECT_PATH'});
  assert.throws(()=>preflightResourceGameFacadeBoot({projectFile:fileURLToPath(new URL('../lib/does-not-exist-facade-model.godot',import.meta.url)),bootSourcePaths:[]}),{code:'ENOENT'});
});
test('facade connects deferred as a root autoload and creates receiver as root sibling with no automatic load',()=>{
  const source=gd(),ready=gdFunction(source,'_ready'),connect=gdFunction(source,'connect_runtime');assert(ready.includes('_connect_deferred.call_deferred()'));
  assert(connect.includes('get_tree().root.add_child(_receiver)'));assert(connect.includes('name != AUTOLOAD_NAME'));assert(connect.includes('get_tree().root.has_node(RECEIVER_NAME)'));
  assert(connect.indexOf('not OS.has_feature("web")')<connect.indexOf('JavaScriptBridge.get_interface'));assert(connect.includes('"UNSUPPORTED"'));
  assert(!/\.load\(|change_scene|load_resource_pack|verify_bytes|stage_verified/.test(connect));
  assert(!/CanvasLayer|Button|Label|Control\.new|Fixture|get_proof|res:\/\/level|_RENDER_DIAGNOSTIC|JavaScriptBridge\.eval|\.enter_scene\(/.test(source));
  assert.equal((source.match(/_app\.load\(pack_id\)/g)||[]).length,1);assert(!source.includes('__WXSLIM_RESOURCE_STARTUP__'));
});
test('facade uses APP v2 and session schemas and checks IDLE health before admitting every load',()=>{
  const source=gd(),load=gdFunction(source,'load_pack'),initial=gdFunction(source,'_initial_binding');
  for(const schema of ['wxslim-resource-interfaces-v2','wxslim-resource-command-config-v1','wxslim-resource-executor-session-v1','wxslim-resource-executor-v1'])assert(source.includes(schema));
  assert(initial.includes('app_status.get("installed") != true'));assert(initial.includes('app_status.get("closed") != false'));assert(initial.includes('session.get("phase") == "IDLE"'));assert(initial.includes('session.get("closedReason") == null'));
  assert(initial.includes('transport.get("attached") != false'));assert(initial.includes('lifecycle.get("stage") != "INSTALLED"'));
  assert(load.indexOf('if _busy or _pending:')<load.indexOf('_app.load(pack_id)'));assert(!source.includes('LOAD_ONCE'));assert(load.includes('typeof(_entries[pack_id]) != TYPE_STRING'));
  assert(load.indexOf('if not _session_ready(session):')<load.indexOf('_generation += 1'));assert(load.indexOf('_pending = true')<load.indexOf('_app.load(pack_id)'));assert(load.indexOf('_busy = true')<load.indexOf('_app.load(pack_id)'));
  assert(load.includes('JavaScriptBridge.create_callback(_on_resolved.bind(_generation))'));assert(load.includes('JavaScriptBridge.create_callback(_on_rejected.bind(_generation))'));assert(load.includes('_promise.then(_resolve_callback, _reject_callback)'));
  const ready=gdFunction(source,'_session_ready');for(const check of ['value.get("phase") == "IDLE"','value.get("closed") == false','value.get("closedReason") == null','value.get("busy") == false','value.get("activeLoadId") == null'])assert(ready.includes(check));
});
test('resolved Promise alone cannot be success: identity/boot/target/current exact scene and memory receipt are required',()=>{
  const source=gd(),resolve=gdFunction(source,'_on_resolved'),proof=gdFunction(source,'_scene_proof');
  assert(resolve.includes('_executor_binding(raw)'));assert(resolve.includes('raw.get("finished") == true'));assert(resolve.includes('raw.get("targetPackId") == _target'));assert(resolve.includes('raw.get("manifest") == _manifest'));assert(resolve.includes('outcome == "SUCCESS" and not _scene_proof(raw)'));
  assert(resolve.includes('"wxslim-resource-executor-session-load-v1"'));assert(resolve.includes('envelope.get("loadId") == _active_load_id'));assert(resolve.includes('raw = envelope["result"]'));
  for(const check of ['"wxslim-resource-executor-memory-receipt-v1"','receipt.get("persisted") != false','target_state["terminal"].get("status") != "SUCCESS"','scene.scene_file_path == _entries[_target]','evidence.get("targetInstanceId") == str(scene.get_instance_id())','evidence.get("currentSceneId") == str(scene.get_instance_id())','evidence.get("visualVerified") == false'])assert(proof.includes(check),check);
  assert(proof.includes('target_state.get("schema") != "wxslim-resource-load-state-v2"'));assert(proof.includes('"engineSessionId": _identity["engineSession"]'));
  assert(gdFunction(source,'_on_rejected').includes('"outcome": "UNKNOWN"'));assert(!source.includes('"visualVerified": true'));assert(!source.includes('"runtimeVerified": true'));
});
test('cancel is loadId-bound and retains pending observations on exceptions, mismatch or UNKNOWN',()=>{
  const source=gd(),cancel=gdFunction(source,'cancel');assert(cancel.indexOf('_cancel_observation = "UNCONFIRMED"')<cancel.indexOf('_app.cancel(_active_load_id)'));
  assert(cancel.includes('"wxslim-resource-executor-session-cancel-v1"'));assert(cancel.includes('observed.get("matched") != true'));assert(cancel.includes('observed.get("loadId") != _active_load_id'));assert(cancel.includes('"RESOURCE_FACADE_CANCEL_UNCONFIRMED"'));
  assert(!/_pending = false|_promise = null|_resolve_callback = null|_reject_callback = null|\.abort\(|\bawait\b/.test(cancel));
  assert(cancel.includes('not _pending'));assert(!cancel.includes('_generation ='));assert(!cancel.includes('"READY"'));
});
test('pending shutdown does not invalidate or release callbacks and waits for actual original settlement',()=>{
  const source=gd(),shutdown=gdFunction(source,'shutdown'),after=gdFunction(source,'_after_settlement'),finish=gdFunction(source,'_finish_shutdown');
  assert(shutdown.indexOf('_closing = true')<shutdown.indexOf('_app.close()'));assert(shutdown.includes('if _busy or _pending:'));assert(shutdown.includes('"RESOURCE_FACADE_DRAIN_PENDING"'));assert(shutdown.includes('"RESOURCE_FACADE_CLOSE_UNCONFIRMED"'));
  assert(!/\.invalidate\(|_promise = null|_resolve_callback = null|create_timer|\bawait\b/.test(shutdown));
  assert(after.indexOf('generation != _generation or not _promise_settled or _pending or _exited')<after.indexOf('_resolve_callback = null'));
  assert(finish.indexOf('if _busy or _pending or _closed or _exited')<finish.indexOf('_receiver.invalidate()'));assert(finish.includes('"hostDisposed": false'));assert(finish.includes('"mountedResourcesReleased": false'));assert(finish.includes('session.get("busy") != false'));
  for(const name of ['_on_resolved','_on_rejected'])assert(gdFunction(source,name).includes('_publish_completion(generation)'));
  assert(gdFunction(source,'_publish_completion').includes('_after_settlement.call_deferred(generation)'));
});
test('forced exit is explicitly undrained and cannot publish shutdown success or clear pending callback refs',()=>{
  const source=gd(),exit=gdFunction(source,'_exit_tree');assert(exit.includes('"EXITED_PENDING_UNKNOWN"'));assert(exit.includes('"RESOURCE_FACADE_FORCED_EXIT_UNDRAINED"'));
  assert(!/_pending = false|_promise = null|_resolve_callback = null|_reject_callback = null|shutdown_completed\.emit|\bawait\b/.test(exit));
  const metadata=createResourceGameFacadeSources();assert(metadata.limitations.some(s=>s.includes('Foreign JS exceptions')));assert(metadata.limitations.some(s=>s.includes('indefinitely')));assert(metadata.limitations.some(s=>s.includes('Forced removal')));
});
test('snapshot/original queries expose bounded retention and do not call host or mutate files',()=>{
  const source=gd();for(const name of ['snapshot','get_original_result_json','get_original_result_info'])assert(!/\.load\(|\.cancel\(|\.status\(|JavaScriptBridge|FileAccess|DirAccess|print\(/.test(gdFunction(source,name)));
  assert(gdFunction(source,'snapshot').includes('"multiLevelSupported": true'));assert(gdFunction(source,'snapshot').includes('"persistentReceiptWritten": false'));
  assert(gdFunction(source,'get_original_result_json').includes('load_id == _latest_raw_load_id else ""'));assert(gdFunction(source,'get_original_result_info').includes('"NOT_RETAINED"'));
  assert(gdFunction(source,'snapshot').includes('"historyDropped": _history_dropped'));
});
test('callback generations and busy deferred tail prevent old callbacks, cleanup and completed reentry from claiming a newer load',()=>{
  const source=gd(),load=gdFunction(source,'load_pack'),publish=gdFunction(source,'_publish_completion'),after=gdFunction(source,'_after_settlement');
  for(const name of ['_on_resolved','_on_rejected']){const fn=gdFunction(source,name);assert(fn.indexOf('generation != _generation or _promise_settled or _exited')<fn.indexOf('_pending = false'));assert(!fn.includes('_busy = false'));}
  assert(!publish.includes('_busy = false'));assert(after.indexOf('_promise_chain = null')<after.indexOf('_busy = false'));
  assert(after.indexOf('_session_ready(session)')<after.lastIndexOf('_busy = false'));
  assert(after.includes('_session_ready(session)'));assert(!after.includes('outcome == "SUCCESS"'));assert(load.includes('claimed.get("activeLoadId")'));assert(load.includes('_greater(claimed["activeLoadId"], _last_claimed_load_id)'));
});
test('history is a ring rather than a load limit, while raw result retention explicitly keeps only the latest settled envelope',()=>{
  const source=gd(),publish=gdFunction(source,'_publish_completion'),retain=gdFunction(source,'_retain_raw'),load=gdFunction(source,'load_pack');
  assert(source.includes('const HISTORY_LIMIT: int = 8'));assert(publish.includes('_history.pop_front()'));assert(publish.includes('_history_dropped += 1'));
  assert(!load.includes('HISTORY_LIMIT'));assert(!load.includes('_history.size()'));assert(!load.includes('_raw_result_json = ""'));
  assert(retain.includes('_latest_raw_load_id = _active_load_id'));assert(retain.includes('_latest_raw_observed_load_id = value["loadId"]'));assert(retain.includes('"UNAVAILABLE_OR_LIMIT"'));
});
test('can_load observes current session admission after all local gates and never substitutes cached READY or starts native work',()=>{
  const source=gd(),query=gdFunction(source,'can_load'),load=gdFunction(source,'load_pack');
  for(const gate of ['not _connected','_busy','_pending','_closing','_closed','_exited','_protocol_failed','not _resident()'])assert(query.includes(gate));
  assert(query.indexOf('return false')<query.indexOf('return _session_ready(_live_session())'));assert(!query.includes('_state == "READY"'));
  assert(!/\.load\(|\.cancel\(|\.close\(|JavaScriptBridge|load_resource_pack|verify_bytes|stage_verified|ResourceLoader|change_scene|_busy =|_pending =/.test(query));
  assert(load.includes('var session: Variant = _live_session()'));assert(load.includes('if not _session_ready(session):'));
});
