// Pure fixed-source followup. No files, platform calls or target execution.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const inputPin=Object.freeze({bytes:119843,sha256:'32639f0b66998182f95e34bbec772fe2bfa8270634f2ce31d686cef74ee0e524'});
const pin=b=>({bytes:Buffer.byteLength(b),sha256:createHash('sha256').update(b).digest('hex')});
let parser;
function parse(s){if(!parser){const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:m,exports:m.exports});parser=m.exports;}return parser.parse(s,{ecmaVersion:2022});}
const key=n=>n.key.name??n.key.value;
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw','loc','range'].includes(k)?undefined:v);
function inventory(ast){const out=new Map();function add(list,parent){for(const n of list){const p=parent+'.'+key(n);assert(!out.has(p),'AUDIO_START_DUPLICATE_MEMBER');out.set(p,n);if(n.type==='Property'&&n.value.type==='ObjectExpression')add(n.value.properties,p);}}
  for(const n of ast.body){if(n.type==='ClassDeclaration')add(n.body.body,n.id.name);else if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.init?.type==='ObjectExpression')add(d.init.properties,d.id.name);}return out;}
function once(text,from,to){assert.equal(text.split(from).length,2,'AUDIO_START_UNIQUE_ANCHOR');return text.replace(from,()=>to);}

export function prepareOfficialAudioStartContract(source){
  assert(Buffer.isBuffer(source),'AUDIO_START_BUFFER');const bytes=Buffer.from(source);
  assert.deepEqual(pin(bytes),inputPin,'AUDIO_START_FIXED_PARENT');const text=bytes.toString('utf8');assert(Buffer.from(text).equals(bytes),'AUDIO_START_UTF8');
  const before=inventory(parse(text)),edits=[],changed=[];
  const node=name=>{const n=before.get('_GodotAudio.'+name);assert(n,'AUDIO_START_REQUIRED_MEMBER');return n;};
  function body(name,next){const n=node(name).value.body;edits.push({start:n.start+1,end:n.end-1,text:next});changed.push('_GodotAudio.'+name);}
  const wx=node('$GodotAudio.WX').value;
  edits.push({start:wx.start+1,end:wx.start+1,text:`
            failureCount: 0,
            failureLogErrors: 0,
            lastFailure: null,
            recordFailure: function (stage, code) {
                // Callers below supply only these owned tokens. Never inspect an Error.
                const allowed = {
                    RESOURCE: "AUDIO_SAMPLE_UNREGISTERED", CACHE: "AUDIO_CACHE_UNAVAILABLE",
                    SETUP: "AUDIO_SETUP_FAILED", PLAY: "AUDIO_PLAY_FAILED",
                    PLAYBACK: "AUDIO_PLAYBACK_ERROR", SUBPACKAGE: "AUDIO_SUBPACKAGE_FAILED",
                    ASYNC_START: "AUDIO_ASYNC_START_EXCEPTION"
                };
                if (!Object.prototype.hasOwnProperty.call(allowed, stage) || allowed[stage] !== code) return;
                GodotAudio.WX.failureCount = Math.min(65535, GodotAudio.WX.failureCount + 1);
                const value = Object.freeze({ kind: "FAILURE_DIAGNOSTIC", stage, code,
                    count: GodotAudio.WX.failureCount, countLimit: 65535,
                    cppErrorReturned: false, naturalCompletion: "NOT_CLAIMED" });
                GodotAudio.WX.lastFailure = value;
                try { console.error("[GODOT_AUDIO_FAILURE] " + JSON.stringify(value)); }
                catch (_) { GodotAudio.WX.failureLogErrors = Math.min(65535, GodotAudio.WX.failureLogErrors + 1); }
            },
            observeStartPromise: function (pending) {
                if (!pending || typeof pending.then !== "function") return pending;
                return pending.then(undefined, (error) => {
                    GodotAudio.WX.recordFailure("ASYNC_START", "AUDIO_ASYNC_START_EXCEPTION");
                    // The void production import drops this returned child Promise.
                    // Rethrow preserves its original rejection, NOT a C++ error return.
                    // SDK/unhandled-rejection visibility still requires actual validation.
                    throw error;
                });
            },
            finishFailedStart: function (playbackObjectId, playback) {
                // AudioServer inserts its C++ playback AFTER the synchronous driver call.
                // Defer this existing termination notification until that call has returned.
                // No new failure callback or natural-finish success is synthesized.
                return Promise.resolve().then(() => {
                    if (GodotAudio.WX.closed || GodotAudio.WX.activePlaybacks.get(playbackObjectId) !== playback) return;
                    if (GodotAudio.WX.cleanupPlayback(playbackObjectId, null, false, playback)) {
                        GodotAudio.WX.notifyFinished(playbackObjectId);
                    }
                });
            },
`});
  const getBody=name=>{const n=node(name).value.body;return text.slice(n.start+1,n.end-1);};
  let start=getBody('$GodotAudio.WX.startSample');
  start=once(start,'if (!streamInfo) {\n\t\t\t\t\tGodotAudio.WX.error(`Native stream ${streamObjectId} is not registered`);\n\t\t\t\t\treturn;\n\t\t\t\t}','');
  const active='GodotAudio.WX.activePlaybacks.set(playbackObjectId, playback);';
  assert.equal(start.split(active).length,2,'AUDIO_START_ONE_ACTIVE_INSERT');start=start.replace(active,'');
  start=once(start,'if (streamInfo.kind === "cache") {',`${active}
                if (!streamInfo) {
                    GodotAudio.WX.recordFailure("RESOURCE", "AUDIO_SAMPLE_UNREGISTERED");
                    return GodotAudio.WX.finishFailedStart(playbackObjectId, playback);
                }
                if (streamInfo.kind === "cache") {`);
  start=once(start,'GodotAudio.WX.notifyFinished(playbackObjectId);\n\t\t\t\t\t\treturn;',
    'GodotAudio.WX.recordFailure("CACHE", "AUDIO_CACHE_UNAVAILABLE");\n                        return GodotAudio.WX.finishFailedStart(playbackObjectId, playback);');
  start=once(start,'const setupFailed = (error) => {','const setupFailed = (error) => {\n                        GodotAudio.WX.recordFailure("SETUP", "AUDIO_SETUP_FAILED");');
  start=once(start,'GodotAudio.WX.error(`Playback error for ${playbackObjectId}`, error);','GodotAudio.WX.recordFailure("PLAYBACK", "AUDIO_PLAYBACK_ERROR");\n                        GodotAudio.WX.error(`Playback error for ${playbackObjectId}`, error);');
  start=once(start,'GodotAudio.WX.error("Playback start failed", error);','GodotAudio.WX.recordFailure("PLAY", "AUDIO_PLAY_FAILED");\n                        GodotAudio.WX.error("Playback start failed", error);');
  const loadGuard='if (GodotAudio.WX.closed || GodotAudio.WX.activePlaybacks.get(playbackObjectId) !== playback) return;';
  // This guard occurs in the load-failure handler only; setup uses its alive closure.
  start=once(start,loadGuard,loadGuard+'\n                        GodotAudio.WX.recordFailure("SUBPACKAGE", "AUDIO_SUBPACKAGE_FAILED");');
  body('$GodotAudio.WX.startSample',start);
  let abi=getBody('godot_audio_sample_start');
  abi=once(abi,'if (GodotAudio.isWeChat() && GodotAudio.WX.isStreamRegistered(streamObjectId)) {\n\t\t\tGodotAudio.WX.startSample(playbackObjectId, streamObjectId, busIndex, offset, pitchScale, volumePtr);',
    'if (GodotAudio.isWeChat() && (GodotAudio.WX.isStreamRegistered(streamObjectId) || GodotAudio.Sample.getSampleOrNull(streamObjectId) === null)) {\n            GodotAudio.WX.observeStartPromise(GodotAudio.WX.startSample(playbackObjectId, streamObjectId, busIndex, offset, pitchScale, volumePtr));');
  body('godot_audio_sample_start',abi);
  let init=getBody('$GodotAudio.WX.init');
  init=once(init,'cacheEntries: GodotAudio.WX.cacheRecords.size,','cacheEntries: GodotAudio.WX.cacheRecords.size,\n                        failureCount: GodotAudio.WX.failureCount,\n                        failureCountLimit: 65535,\n                        failureLogErrors: GodotAudio.WX.failureLogErrors,\n                        lastFailure: GodotAudio.WX.lastFailure,');
  body('$GodotAudio.WX.init',init);
  edits.sort((a,b)=>a.start-b.start||a.end-b.end);let result='',cursor=0;
  for(const e of edits){assert(e.start>=cursor,'AUDIO_START_OVERLAP');result+=text.slice(cursor,e.start)+e.text;cursor=e.end;}result+=text.slice(cursor);
  const after=inventory(parse(result)),allowed=new Set(changed);
  for(const [name,n]of before){if(n.value?.type==='ObjectExpression'||allowed.has(name))continue;assert.equal(canonical(after.get(name)),canonical(n),'AUDIO_START_UNRELATED_MEMBER_CHANGED '+name);}
  for(const name of ['godot_audio_sample_start','$GodotAudio.WX.init']){
    const old=node(name).value.body.body[0],now=after.get('_GodotAudio.'+name).value.body.body[0];
    // init here is WX.init, not the common init. Its first statement is unchanged;
    // production start's complete non-WeChat early branch is unchanged.
    assert.equal(canonical(now),canonical(old),'AUDIO_START_ORIGINAL_ENTRY_GUARD');
  }
  const output=Buffer.from(result);
  return {source:output,receipt:{schema:'wxslim-official-audio-start-contract-v1',status:'SOURCE_ONLY_MODELS_NOT_RUN',before:pin(bytes),after:pin(output),
    changedMethods:changed,addedMembers:['failureCount','failureLogErrors','lastFailure','recordFailure','observeStartPromise','finishFailedStart'],
    unrelatedMembersUnchanged:true,nonWechatStartBranchUnchanged:true,registrationABI:'viiiiiiiiii',sampleStartABIUnchanged:true,
    defaultNativeMinSeconds:3,defaultCacheBytes:8388608,failureCountLimit:65535,
    cppTiming:'Failure termination microtask runs after synchronous driver call/ordered insertion; existing exact-active identity reused.',
    asyncBoundary:'Diagnostic observer rethrows original rejection into a child Promise ignored by void ABI. Not a C++ error result; actual SDK visibility unverified.',
    manifestBinding:'NOT_IMPLEMENTED_BY_THIS_PATCH',newPlayer:false,newWasmImports:false,engineExecuted:false,platformExecuted:false,build:'NOT_RUN',runtime:'NOT_RUN'}};
}
