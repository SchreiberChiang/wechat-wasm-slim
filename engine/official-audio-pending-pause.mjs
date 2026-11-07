// Pure pinned source preparation; no filesystem, platform, factory or WASM calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
export const AUDIO_PENDING_PAUSE_FILE='platform/web/js/libs/library_godot_audio.js';
export const AUDIO_PENDING_PAUSE_INPUT=Object.freeze({bytes:123483,sha256:'d990e5d6dbbb860883812009b303c1e950ee7c59c8902ad34db7e301f623ba5e'});
export const audioPendingPausePin=b=>({bytes:Buffer.byteLength(b),sha256:createHash('sha256').update(b).digest('hex')});
let parser;
export function audioPendingPauseMembers(text){
  if(!parser){const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:m,exports:m.exports});parser=m.exports;}
  const ast=parser.parse(text,{ecmaVersion:2022}),out=new Map(),key=n=>n.key.name??n.key.value;
  function add(nodes,p){for(const n of nodes){const name=p+'.'+key(n);assert(!out.has(name),'AUDIO_PAUSE_DUPLICATE_MEMBER');out.set(name,n);if(n.type==='Property'&&n.value.type==='ObjectExpression')add(n.value.properties,name);}}
  for(const n of ast.body){if(n.type==='ClassDeclaration')add(n.body.body,n.id.name);else if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.init?.type==='ObjectExpression')add(d.init.properties,d.id.name);}
  return out;
}
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw','loc','range'].includes(k)?undefined:v);
function once(text,from,to){assert.equal(text.split(from).length,2,'AUDIO_PAUSE_UNIQUE_ANCHOR');return text.replace(from,()=>to);}
export function prepareOfficialAudioPendingPause(source){
  assert(Buffer.isBuffer(source),'AUDIO_PAUSE_BUFFER');assert.deepEqual(audioPendingPausePin(source),AUDIO_PENDING_PAUSE_INPUT,'AUDIO_PAUSE_FIXED_SOURCE');
  const text=source.toString('utf8');assert(Buffer.from(text).equals(source),'AUDIO_PAUSE_UTF8');const before=audioPendingPauseMembers(text),edits=[];
  const prefix='_GodotAudio.$GodotAudio.WX.',changedMethods=[prefix+'startSample',prefix+'setPause'];
  for(const name of changedMethods){const n=before.get(name);assert(n?.value?.body,'AUDIO_PAUSE_METHOD_REQUIRED');let body=text.slice(n.value.body.start+1,n.value.body.end-1);
    if(name.endsWith('.startSample')){
      body=once(body,'\t\t\t\t\tctx: null,','\t\t\t\t\tctx: null,\n                    desiredPaused: false,\n                    readyToPlay: false,');
      body=once(body,'                    GodotAudio.WX.invokePlatform(() => ctx.play(), (error) => {','                    playback.readyToPlay = true;\n                    if (!alive() || playback.desiredPaused) return;\n                    GodotAudio.WX.invokePlatform(() => ctx.play(), (error) => {');
    }else{
      body=once(body,'\t\t\t\tif (playback.ctx) {','                // Save intent even while subpackage loading or context setup is pending.\n                playback.desiredPaused = Boolean(paused);\n\t\t\t\tif (playback.ctx && playback.readyToPlay) {');
    }
    edits.push({start:n.value.body.start+1,end:n.value.body.end-1,text:body});
  }
  edits.sort((a,b)=>a.start-b.start);let output='',cursor=0;for(const e of edits){assert(e.start>=cursor);output+=text.slice(cursor,e.start)+e.text;cursor=e.end;}output+=text.slice(cursor);
  const after=audioPendingPauseMembers(output),allowed=new Set(changedMethods);assert.deepEqual([...after.keys()],[...before.keys()]);
  for(const [name,n]of before){if(n.value?.type==='ObjectExpression'||allowed.has(name))continue;assert.equal(canonical(after.get(name)),canonical(n),'AUDIO_PAUSE_UNRELATED_CHANGED '+name);}
  const result=Buffer.from(output);return {source:result,receipt:{schema:'wxslim-official-audio-pending-pause-v1',status:'SOURCE_ONLY_NOT_APPLIED',input:audioPendingPausePin(source),output:audioPendingPausePin(result),changedMethods,unrelatedMembersUnchanged:true,backendSelectionUnchanged:true,poolPolicyUnchanged:true,errorContractsUnchanged:true,productionABIUnchanged:true,hideShowWiring:'NOT_ADDED',engineExecuted:false,platformExecuted:false,build:'NOT_RUN',runtime:'NOT_RUN'}};
}
