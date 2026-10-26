'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {parseOptions,libraryIdentity,EXPECTED_LIBRARY_SHA256,DECLARED_LIBRARY_MARKERS}=require('./audit-diagnostic-abi.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function temporary(fn){const prefix=path.join(os.tmpdir(),'official-glx-abi-test-'),dir=fs.mkdtempSync(prefix);try{return fn(dir);}finally{const target=path.resolve(dir);assert(target.startsWith(path.resolve(prefix))&&target!==path.resolve(os.tmpdir()));fs.rmSync(target,{recursive:true,force:true});}}
test('named and both positional CLI forms resolve the same inputs',()=>{
 const want=parseOptions(['--build-dir','build','--sdk','sdk','--out','out']);
 assert.deepEqual(parseOptions(['build','sdk','out']),want);
 assert.deepEqual(parseOptions(['build','--sdk','sdk','--out','out']),want);
});
test('ambiguous, incomplete and unknown CLI options reject',()=>{
 for(const args of [[],['build'],['--build-dir','a','--build-dir','b','--sdk','s','--out','o'],['build','--build-dir','b','--sdk','s','--out','o'],['--build-dir','b','--sdk','s','--out','o','--library','arbitrary']])assert.throws(()=>parseOptions(args));
});
test('library record alone cannot authorize missing or unrelated actual bytes',()=>temporary(dir=>{
 const file=path.join(dir,'owned-not-library.a');fs.writeFileSync(file,'owned fixture only');
 const build={identity:{glxLibrary:{path:file,sha256:EXPECTED_LIBRARY_SHA256,bytes:18}},sconsArgs:['wx_glx_lib='+file]};
 const facts=libraryIdentity(build);assert(facts.recordMatches);assert(!facts.actualMatches);assert(facts.sconsMatches);
 fs.unlinkSync(file);assert(!libraryIdentity(build).actualMatches);assert(libraryIdentity(build).readError);
}));
test('new-library binding checks unique SCons argument and keeps marker claims separate',()=>{
 assert.equal(EXPECTED_LIBRARY_SHA256,'026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8');
 assert.deepEqual(DECLARED_LIBRARY_MARKERS,['0.1.0','2026.09.02']);
 for(const sconsArgs of [[],['wx_glx_lib=x','wx_glx_lib=x'],['wx_glx_lib=y']])assert(!libraryIdentity({identity:{glxLibrary:{path:'x',sha256:EXPECTED_LIBRARY_SHA256}},sconsArgs}).sconsMatches);
});
const baseline=process.env.GLX_DIAGNOSTIC_OLD_BASELINE||'E:/AI/wechat-wasm-slim/.local/glx-shader-type-return-20261024-01/build';
const sdk=process.env.GLX_DIAGNOSTIC_SDK||'E:/AI/wechat-wasm-slim/.local/glx-shader-failure-20261023-01/emsdk';
test('static old-baseline replay preserves every original non-version ABI check and rejects old library',{skip:!fs.existsSync(path.join(baseline,'artifacts/godot.wasm'))||!fs.existsSync(sdk)},()=>temporary(dir=>{
 const original=path.resolve(__dirname,'../shader-type-return/audit-abi.cjs'),audit=path.join(__dirname,'audit-diagnostic-abi.cjs');
 const originalBefore=sha(fs.readFileSync(original));
 const run=(script,out)=>spawnSync(process.execPath,[script,'--build-dir',baseline,'--sdk',sdk,'--out',out],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
 const oldOut=path.join(dir,'old'),newOut=path.join(dir,'new');const old=run(original,oldOut),fresh=run(audit,newOut);
 assert.equal(old.status,0,old.stderr);assert.equal(fresh.status,1,fresh.stderr);
 const oldReport=JSON.parse(fs.readFileSync(path.join(oldOut,'abi-audit.json'))),newReport=JSON.parse(fs.readFileSync(path.join(newOut,'abi-audit.json')));
 const retained=oldReport.checks.filter(x=>!x.name.startsWith('GLX library marker '));
 for(const oldCheck of retained){const matches=newReport.checks.filter(x=>x.name===oldCheck.name);assert.equal(matches.length,1,oldCheck.name);assert.deepEqual(matches[0],oldCheck,oldCheck.name);}
 assert.equal(newReport.checks.length,oldReport.checks.length+3);
 assert.equal(newReport.checks.filter(x=>x.name.startsWith('diagnostic ABI ')).length,7);
 assert(!newReport.pass);assert(!newReport.library.recordMatches);assert(!newReport.library.actualMatches);
 assert.equal(sha(fs.readFileSync(original)),originalBefore);
 console.log('Retained original ABI checks: '+retained.length+'; old/new total: '+oldReport.checks.length+'/'+newReport.checks.length+'; target JS/WASM not executed.');
}));
const input='E:/AI/wechat-wasm-slim/.local/gin26-newlib-01/input/libemscriptenglx.a';
test('frozen 026e actual library bytes match the exact rule',{skip:!fs.existsSync(input)},()=>{
 const bytes=fs.readFileSync(input);const build={identity:{glxLibrary:{path:input,bytes:bytes.length,sha256:sha(bytes)}},sconsArgs:['wx_glx_lib='+input]};
 const fact=libraryIdentity(build);assert(fact.recordMatches&&fact.actualMatches&&fact.sconsMatches);assert.equal(bytes.length,3866614);
});
