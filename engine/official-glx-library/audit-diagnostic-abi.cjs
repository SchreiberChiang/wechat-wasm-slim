'use strict';
// New-library audit only. Original audit-abi.cjs and all original diagnostic checks remain unchanged.
// Static bytes/Acorn only: never evaluate target JS, compile/instantiate WASM, or call imports.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const EXPECTED_LIBRARY_SHA256 = '026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8';
const DECLARED_LIBRARY_MARKERS = ['0.1.0', '2026.09.02'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function parseOptions(args) {
 const options={}; const values=[...args];
 if(values.length===3 && values.every(x=>typeof x==='string'&&!x.startsWith('--'))) return {'--build-dir':path.resolve(values[0]),'--sdk':path.resolve(values[1]),'--out':path.resolve(values[2])};
 if(values.length && !values[0].startsWith('--')) options['--build-dir']=path.resolve(values.shift());
 for(let i=0;i<values.length;i+=2){const key=values[i],value=values[i+1];if(!['--build-dir','--sdk','--out'].includes(key)||!value||value.startsWith('--')||key in options)throw Error('Expected unique --build-dir BUILD --sdk EMSDK --out NEW_DIRECTORY, or BUILD EMSDK NEW_DIRECTORY'); options[key]=path.resolve(value);}
 if(Object.keys(options).length!==3)throw Error('Required build directory, SDK and new output directory');
 return options;
}
function libraryIdentity(build) {
 const record=build.identity?.glxLibrary;
 let bytes=null,readError=null;
 try { if(!record?.path || !fs.statSync(record.path).isFile()) throw Error('Regular library file required'); bytes=fs.readFileSync(record.path); } catch(e) {readError=e.message;}
 const actual=bytes?{bytes:bytes.length,sha256:hash(bytes)}:null;
 const libraryArgs=Array.isArray(build.sconsArgs)?build.sconsArgs.filter(x=>typeof x==='string'&&x.split('=')[0]==='wx_glx_lib'):[];
 return {expectedSha256:EXPECTED_LIBRARY_SHA256,recorded:record??null,actual,readError,recordMatches:record?.sha256===EXPECTED_LIBRARY_SHA256,actualMatches:!!actual&&actual.sha256===EXPECTED_LIBRARY_SHA256&&record?.bytes===actual.bytes&&record?.sha256===actual.sha256,sconsMatches:libraryArgs.length===1&&libraryArgs[0]==='wx_glx_lib='+record?.path,libraryArgs};
}
function main(args=process.argv.slice(2)) {
const options=parseOptions(args);
const buildDir=options['--build-dir'],sdk=options['--sdk'],out=options['--out'];
if(fs.existsSync(out))throw Error('Audit output already exists; refusing overwrite');
function contains(a,b){const r=path.relative(a,b);return !r||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));}
for(const input of [buildDir,sdk])if(contains(input,out)||contains(out,input))throw Error('Audit output overlaps input');
const acorn=require(path.join(sdk,'upstream/emscripten/node_modules/acorn'));
const count = (s, t) => s.split(t).length - 1;
const checks = [], check = (name, okay, detail) => checks.push({name, pass: !!okay, detail});
const build = JSON.parse(fs.readFileSync(path.join(buildDir, 'BUILD.json'), 'utf8'));
if (!build.finishedAt || !build.outputs || build.initialization?.status !== 'complete') { console.log('PENDING: BUILD.json not finished'); process.exitCode=3; return null; }
const library=libraryIdentity(build);
check('026e library identity in BUILD',library.recordMatches,library);
check('026e library actual bytes and SHA256',library.actualMatches,library);
check('026e library unique SCons argument',library.sconsMatches,library.libraryArgs);
check('BUILD source pin',build.identity?.pin==='df3cdd9bc9941a20cb5575d781cde6f937637bcb');
check('BUILD exact pair set',JSON.stringify(Object.keys(build.outputs).sort())===JSON.stringify(['godot.js','godot.wasm','godot.wasm.br']));
check('BUILD pair metadata',build.pairing?.brotliDecodesToWasm===true&&build.pairing?.sha256===hash(JSON.stringify(build.outputs))&&JSON.stringify([...(build.pairing?.files||[])].sort())===JSON.stringify(['godot.js','godot.wasm','godot.wasm.br']));
const artifactDir = path.join(buildDir, 'artifacts');
const jsBytes = fs.readFileSync(path.join(artifactDir, 'godot.js')), js = jsBytes.toString('utf8');
const wasm = fs.readFileSync(path.join(artifactDir, 'godot.wasm'));
const compressed = fs.readFileSync(path.join(artifactDir, 'godot.wasm.br'));
for (const [name, bytes] of Object.entries({'godot.js': jsBytes, 'godot.wasm': wasm, 'godot.wasm.br': compressed})) check('BUILD identity '+name, build.outputs[name]?.sha256 === hash(bytes) && build.outputs[name]?.bytes === bytes.length, {sha256:hash(bytes), bytes:bytes.length});
check('Brotli/raw pair', zlib.brotliDecompressSync(compressed).equals(wasm));
const symbolProvenance = {buildRootSymbols:build.symbols??null,buildIdentitySymbols:build.identity?.symbols??null,files:[]};
check('BUILD symbols flag true',build.symbols===true||build.identity?.symbols===true,symbolProvenance);
for(const name of ['godot.js.symbols','symbols.json']) {const file=path.join(artifactDir,name), exists=fs.existsSync(file);const bytes=exists?fs.readFileSync(file):null;const fact={name,path:file,present:exists,bytes:bytes?.length??null,sha256:bytes?hash(bytes):null,inBuildOutputs:Object.prototype.hasOwnProperty.call(build.outputs,name)};symbolProvenance.files.push(fact);check('symbol provenance '+name,exists&&bytes.length>0,fact);}

let at=0,sectionEnd=wasm.length;
function byte(){if(at>=sectionEnd)throw Error('WASM truncated or section overrun');return wasm[at++];}
function leb(){let value=0;for(let i=0;i<5;i++){const next=byte();if(i===4&&(next&0xf0))throw Error('Oversized WASM u32 LEB');value+=(next&127)*2**(i*7);if(!(next&128))return value;}throw Error('Oversized WASM u32 LEB');}
function vectorCount(){const n=leb();if(n>sectionEnd-at)throw Error('Impossible WASM vector count');return n;}
function string(){const n=leb(),start=at;at+=n;if(at>sectionEnd)throw Error('WASM string truncated');return new TextDecoder('utf-8',{fatal:true}).decode(wasm.subarray(start,at));}
function valueType(){const v=byte();if(![0x7f,0x7e,0x7d,0x7c,0x7b,0x70,0x6f].includes(v))throw Error('Unsupported WASM value type');return v;}
function limits(){const flags=leb();if(flags>3)throw Error('Unsupported WASM limits flags');const min=leb();if(flags&1){if(leb()<min)throw Error('Invalid WASM limits');}else if(flags&2)throw Error('Shared limits require maximum');}
if(wasm.subarray(0,8).toString('hex')!=='0061736d01000000')throw Error('Unexpected WASM header');
at=8;const imports=[],moduleExports=[],types=[],functionTypes=[],seenSections=new Set();
while(at<wasm.length){
 sectionEnd=wasm.length;const id=byte(),length=leb(),end=at+length;
 if(id>13||end>wasm.length)throw Error('Unsupported/truncated WASM section');
 if(id!==0){if(seenSections.has(id))throw Error('Duplicate WASM section');seenSections.add(id);}
 sectionEnd=end;
 if(id===1){const n=vectorCount();for(let i=0;i<n;i++){if(byte()!==0x60)throw Error('Unsupported nonfunction WASM type');const p=vectorCount(),params=[];for(let j=0;j<p;j++)params.push(valueType());const r=vectorCount(),results=[];for(let j=0;j<r;j++)results.push(valueType());types.push({params,results});}}
 else if(id===2){const n=vectorCount();for(let i=0;i<n;i++){const module=string(),name=string(),kind=byte();let typeIndex;
  if(kind===0)typeIndex=leb();else if(kind===1){const element=byte();if(![0x70,0x6f].includes(element))throw Error('Unsupported table element type');limits();}else if(kind===2)limits();else if(kind===3){valueType();if(byte()>1)throw Error('Invalid global mutability');}else if(kind===4){if(byte()!==0)throw Error('Invalid tag attribute');typeIndex=leb();}else throw Error('Unknown import kind');imports.push({module,name,kind,typeIndex});}}
 else if(id===3){const n=vectorCount();for(let i=0;i<n;i++)functionTypes.push(leb());}
 else if(id===7){const n=vectorCount();for(let i=0;i<n;i++){const name=string(),kind=byte(),index=leb();if(kind>4)throw Error('Unknown export kind');moduleExports.push({name,kind,index});}}
 else at=end;
 if(at!==end)throw Error('WASM section trailing bytes');
}
for(const item of imports)if(item.typeIndex!==undefined&&!types[item.typeIndex])throw Error('Import type index out of range');
for(const index of functionTypes)if(!types[index])throw Error('Function type index out of range');
const allFunctionTypes=imports.filter(x=>x.kind===0).map(x=>x.typeIndex).concat(functionTypes);
if(new Set(moduleExports.map(x=>x.name)).size!==moduleExports.length)throw Error('Duplicate WASM export name');
for(const item of moduleExports)if(item.kind===0&&!types[allFunctionTypes[item.index]])throw Error('Export function index out of range');
const ast=acorn.parse(js,{ecmaVersion:'latest',sourceType:'script'}), pending=[ast], defs=new Map(), importObjects=[];
while(pending.length) { const node=pending.pop(); if(!node||typeof node!=='object')continue;
  if(node.type==='FunctionDeclaration'&&node.id) { const a=defs.get(node.id.name)||[];a.push(node);defs.set(node.id.name,a); }
  if(node.type==='VariableDeclarator'&&node.id.type==='Identifier') { if(node.id.name==='wasmImports')importObjects.push(node.init); if(node.init&&['ArrowFunctionExpression','FunctionExpression'].includes(node.init.type)){const a=defs.get(node.id.name)||[];a.push(node.init);defs.set(node.id.name,a);} }
  for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))pending.push(...value.filter(x=>x&&typeof x==='object'));else if(value&&typeof value==='object')pending.push(value);}
}
check('single wasmImports object',importObjects.length===1&&importObjects[0].type==='ObjectExpression',importObjects.length);
const importMap={};if(importObjects.length===1&&importObjects[0].type==='ObjectExpression')for(const p of importObjects[0].properties){
 if(p.type!=='Property'||p.computed||p.kind!=='init'||p.method||p.value.type!=='Identifier')throw Error('Unsupported wasmImports mapping');
 const key=p.key.name??p.key.value;if(typeof key!=='string'||Object.prototype.hasOwnProperty.call(importMap,key))throw Error('Ambiguous wasmImports mapping');importMap[key]=p.value.name;
}
const resolvedImports=imports.map(x=>({...x,resolved:importMap[x.name]??null}));
const namespaceDef=defs.get('getWasmImports')||[], namespaceText=namespaceDef.length===1?js.slice(namespaceDef[0].start,namespaceDef[0].end):'';
check('actual namespace routes a to wasmImports',imports.every(x=>x.module==='a')&&namespaceDef.length===1&&/return\s*\{\s*a\s*:\s*wasmImports\s*\}/.test(namespaceText),namespaceText);
check('all function imports resolve',resolvedImports.filter(x=>x.kind===0).every(x=>x.resolved),resolvedImports.filter(x=>x.kind===0&&!x.resolved));
const headerPath=path.join(buildDir,'engine/drivers/gles3/wxslim_shader_failure.h'), header=fs.readFileSync(headerPath,'utf8');
const nativeNames=[...new Set([...header.matchAll(/\b(?:int|void)\s+(wxslim_shader_failure_[A-Za-z0-9_]+)\s*\(/g)].map(x=>x[1]).concat([...header.matchAll(/EM_JS\s*\(\s*int\s*,\s*(wxslim_shader_failure_[A-Za-z0-9_]+)/g)].map(x=>x[1])))];
const expectedABI = {};
for (const m of header.matchAll(/\b(int|void)\s+(wxslim_shader_failure_[A-Za-z0-9_]+)\s*\(([^;]*)\);/g)) expectedABI[m[2]] = {params: m[3].trim() ? m[3].split(',').length : 0, results: m[1] === 'int' ? 1 : 0};
for (const m of header.matchAll(/EM_JS\s*\(\s*(int|void)\s*,\s*(wxslim_shader_failure_[A-Za-z0-9_]+)\s*,\s*\(([^)]*)\)/g)) expectedABI[m[2]] = {params: m[3].trim() ? m[3].split(',').length : 0, results: m[1] === 'int' ? 1 : 0};
check('header exactly seven diagnostic imports including guard',Object.keys(expectedABI).length===7,Object.keys(expectedABI));
check('header new arm_type ABI zero args void',expectedABI.wxslim_shader_failure_arm_type?.params===0&&expectedABI.wxslim_shader_failure_arm_type?.results===0,expectedABI.wxslim_shader_failure_arm_type);
check('header original guard ABI retained',expectedABI.wxslim_shader_failure_guard?.params===3&&expectedABI.wxslim_shader_failure_guard?.results===1,expectedABI.wxslim_shader_failure_guard);
const diagnosticMapping=[];
for(const name of nativeNames){const matches=resolvedImports.filter(x=>x.resolved===name||x.resolved==='_'+name); const definitionCount=matches.length===1?(defs.get(matches[0].resolved)||[]).length:0;diagnosticMapping.push({name,mappings:matches,definitionCount});check('diagnostic import '+name,matches.length===1&&definitionCount===1,{mappings:matches,definitionCount}); const actualType = matches.length===1?types[matches[0].typeIndex]:null, expected = expectedABI[name]; check('diagnostic ABI '+name,actualType&&expected&&actualType.params.length===expected.params&&actualType.results.length===expected.results&&actualType.params.concat(actualType.results).every(x=>x===0x7f),{expected,actual:actualType});}
const actualDiagnostics=resolvedImports.filter(x=>/wxslim_shader_failure_/.test(x.resolved||''));
check('diagnostics exactly match staged source enumeration',actualDiagnostics.length===nativeNames.length&&actualDiagnostics.every(x=>nativeNames.includes(x.resolved.replace(/^_/,''))),{expected:nativeNames,actual:actualDiagnostics});
const guard=defs.get('wxslim_shader_failure_guard')||[], guardText=guard.length===1?js.slice(guard[0].start,guard[0].end):'';
check('guard runtime calls',/dynCall\(["']vi["'],query,\[state\]\)/.test(guardText)&&/dynCall\(["']vi["'],cleanup,\[state\]\)/.test(guardText)&&guardText.includes('stackSave()')&&guardText.includes('stackRestore(savedStack)'),guardText);
check('guard no unexpanded macros',!guardText.includes('{{{')&&!guardText.includes('makeDynCall')&&guardText.length>0);
for(const name of ['dynCall','stackSave','stackRestore'])check('guard runtime definition '+name,(defs.get(name)||[]).length===1,(defs.get(name)||[]).length);
check('string-import marker exactly one',count(js,'WXSLIM_SHADER_FAILURE_GLUE_V1')===1,count(js,'WXSLIM_SHADER_FAILURE_GLUE_V1'));
const stringImport=resolvedImports.filter(x=>x.resolved==='evalBatchRenderSyncString'), stringDef=defs.get('evalBatchRenderSyncString')||[];
check('string import mapping',stringImport.length===1&&stringDef.length===1,stringImport);
check('string marker inside actual function',stringDef.length===1&&count(js.slice(stringDef[0].start,stringDef[0].end),'WXSLIM_SHADER_FAILURE_GLUE_V1')===1);
check('int-import marker exactly one',count(js,'WXSLIM_SHADER_TYPE_RETURN_GLUE_V1')===1,count(js,'WXSLIM_SHADER_TYPE_RETURN_GLUE_V1'));
const intImport=resolvedImports.filter(x=>x.resolved==='evalBatchRenderSyncInt'),intDef=defs.get('evalBatchRenderSyncInt')||[];
const intType=intImport.length===1?types[intImport[0].typeIndex]:null;
check('int import mapping',intImport.length===1&&intDef.length===1,intImport);
check('int import ABI i32 i32 to i32',intType&&JSON.stringify(intType.params)==='[127,127]'&&JSON.stringify(intType.results)==='[127]',intType);
const intText=intDef.length===1?js.slice(intDef[0].start,intDef[0].end):'';
check('int marker inside actual function',intDef.length===1&&count(intText,'WXSLIM_SHADER_TYPE_RETURN_GLUE_V1')===1);
const frameMarkers={commitWrapper:js.includes('__godotMinigameOriginalCommitFrame'),modePin:js.includes('__godotMinigameWXGLXEnabled'),nativeContextInit:js.includes('wxGLXInitContext'),afterFrameFlush:js.includes('registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})'),asyncBatch:js.includes('Module.wxContextGlobal.batchRenderAsync('),swapWindow:js.includes('Module.wxContextGlobal.swapWindow(')};
for(const [name,value]of Object.entries(frameMarkers))check('frame marker '+name,value);
const commitImports=resolvedImports.filter(x=>/commit_frame/.test(x.resolved||''));check('original commit import retained',commitImports.length===1,commitImports);
const glxNames=['_glxInit','_glxInitBufferDataAndGlState','_glxUpdateContextId','_glxCommandBufferFlush','_glxShowOpenData','_glxHideOpenData','_glxGetVideoTempBuffer','_glxVideoUpdateToTexture','_glxVideoDestroy'],glxMapping=[];
for(const name of glxNames){const re=new RegExp('Module\\["'+name+'"\\]='+name+'=wasmExports\\["([^"\\n]+)"\\]','g'),matches=[...js.matchAll(re)].map(m=>m[1]);const okay=matches.length===1&&moduleExports.some(x=>x.name===matches[0]&&x.kind===0);glxMapping.push({name,wasmName:matches[0]||null,present:okay});check('GLX native export '+name,okay);}
const libraryMarkers=Object.fromEntries(DECLARED_LIBRARY_MARKERS.map(marker=>[marker,wasm.includes(Buffer.from(marker))]));for(const [name,value]of Object.entries(libraryMarkers))check('GLX library marker '+name,value);
const report={schema:'wxslim-official-glx-026e-diagnostic-abi-static-v1',buildRecordSha256:hash(fs.readFileSync(path.join(buildDir,'BUILD.json'))),library,libraryMarkerMeaning:'Embedded library declarations only; not independent confirmation of an official semantic version or release date',inspectedAt:new Date().toISOString(),pass:checks.every(x=>x.pass),scope:'Static bytes, custom WASM import/export parser, and Acorn AST only. No target JS evaluation, WASM compile/instantiation, GPU, phone, network or engine execution.',sourcePin:build.identity?.pin,buildFinishedAt:build.finishedAt,header:{path:headerPath,sha256:hash(Buffer.from(header)),names:nativeNames},artifacts:{js:{bytes:jsBytes.length,sha256:hash(jsBytes)},wasm:{bytes:wasm.length,sha256:hash(wasm)},br:{bytes:compressed.length,sha256:hash(compressed)}},importCount:imports.length,exportCount:moduleExports.length,diagnosticMapping,guardText,stringImport,intImport,intType,frameMarkers,commitImports,glxMapping,libraryMarkers,symbolProvenance,checks};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.mkdirSync(out);
fs.writeFileSync(path.join(out,'abi-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(out,'abi-audit.md'),'# 026e diagnostic ABI static audit\n\nEmbedded 0.1.0 / 2026.09.02 strings are library declarations, not independent official version confirmation.\n\nResult: '+(report.pass?'PASS':'FAIL')+'\n\n'+report.scope+'\n\n'+checks.map(x=>'- '+(x.pass?'PASS':'FAIL')+' '+x.name).join('\n')+'\n\nSymbols (outside three-file BUILD.outputs pairing):\n'+symbolProvenance.files.map(x=>'- '+x.name+' bytes='+x.bytes+' SHA256='+x.sha256).join('\n')+'\n\nBUILD.identity.symbols='+symbolProvenance.buildIdentitySymbols+'; BUILD.symbols='+symbolProvenance.buildRootSymbols+'\n\nSee abi-audit.json for exact mappings, hashes and details.\n',{flag:'wx'});
console.log(JSON.stringify({pass:report.pass,checks:checks.length,diagnosticNames:nativeNames,diagnosticMapping,failed:checks.filter(x=>!x.pass),out},null,2));process.exitCode=report.pass?0:1;

return report;
}
module.exports={parseOptions,libraryIdentity,main,EXPECTED_LIBRARY_SHA256,DECLARED_LIBRARY_MARKERS};
if(require.main===module){try{main();}catch(error){console.error('026e diagnostic ABI audit refused: '+error.message);process.exitCode=1;}}
