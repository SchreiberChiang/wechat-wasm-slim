'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {auditPair,parseWasm,difference,readBuild,auditHostSources,readHost,withHostClosure,coreCallbacks,textureCallbacks}=require('./audit-linkage.cjs');
const sdk=process.argv[2];if(!sdk)throw Error('Usage: fixed-sdk-node audit-linkage.test.cjs SDK [OLD_BUILD]');
const acorn=require(path.join(path.resolve(sdk),'upstream/emscripten/node_modules/acorn'));
function leb(n){const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;}
const str=s=>[...leb(Buffer.byteLength(s)),...Buffer.from(s)];
const sec=(id,b)=>[id,...leb(b.length),...b];
const wasm=Buffer.from([0,97,115,109,1,0,0,0,...sec(1,[1,96,0,0]),...sec(2,[1,...str('a'),...str('x'),0,0]),...sec(7,[1,...str('f'),0,0])]);
const exportsJs=[...coreCallbacks,...textureCallbacks].map(n=>`Module[${JSON.stringify(n)}]=wasmExports.f;`).join('\n');
function js(body='function real(){};var alias=real;',map='alias'){return `var Module={},wasmExports={};function factory(){${body}var wasmImports={x:${map}};function getWasmImports(){return {a:wasmImports}};${exportsJs}}`;}
const audit=(src,logs=[])=>auditPair({js:src,wasm,acorn,logs});
assert.equal(parseWasm(wasm).imports.length,1);
const good=audit(js());assert(good.pass);assert.deepEqual(good.resolvedImports[0].aliasChain,['alias','real']);
assert(!audit(js('var alias=doesNotExist;')).pass);
assert(!audit(js('var alias=alias;')).pass);
assert(!audit(js('function real(){};function nested(){function hidden(){}};var alias=hidden;')).pass,'nested function must not resolve out of scope');
assert(!audit(js('function real(){};function nested(){function real(){abort("missing function: shadow")}};var alias=real;')).missingLinkPlaceholders.length,'unused nested shadow is not actual import');
assert.equal(audit(js('function real(){};function unused(){abort("missing function: unused")}var alias=real;')).allPlaceholderDefinitions.length,1,'Full-source placeholders must remain visible even if not the current import');
const missing=audit(js('function real(){abort("missing function: actual")}var alias=real;'));assert(!missing.pass);assert.equal(missing.missingLinkPlaceholders.length,1);
assert(!audit(js('function real(){missingFunction()}var alias=real;')).pass);
const functional=audit(js('function real(){throw new Error("feature not supported")}var alias=real;'));assert(functional.pass);assert.equal(functional.functionalStubs.length,1);assert.equal(functional.missingLinkPlaceholders.length,0);
assert(!audit(js(),[{file:'link.log',text:'warning: undefined symbol: xyz'}]).pass);
assert(!audit(js().replace('return {a:wasmImports}','return {wrong:wasmImports}')).pass);
assert(!audit(js().replace('Module["_glxPushBindTexture"]=wasmExports.f;','')).pass);
assert.throws(()=>parseWasm(Buffer.from([0,97,115,109,1,0,0,0,2,100])),/section/);
const delta=difference(functional,functional);assert.equal(delta.functionalStubs[0].baselineClassification,'pre-existing-identical');
const hostFixture={sdkCode:'let p,f=Date.now();p=function(){return Date.now()-f},GameGlobal.nowPolyfill=window.nowPolyfill=p;',entryCode:'import "./godot-sdk";import "./godot";GODOTSDK.startGame("x","y");',gameCode:'import "./weapp-adapter";import "./godot-loader";new GodotLoader();',loaderCode:'class GodotLoader{constructor(){this.loadGameEngine()}loadGameEngine(){wx.loadSubpackage({name:"engine"})}}',adapterCode:'const global=GameGlobal;window=global;',config:{subpackages:[{name:'engine',root:'engine/'}]}};
assert(auditHostSources(hostFixture,acorn).staticContractPass);
assert(!auditHostSources({...hostFixture,sdkCode:hostFixture.sdkCode.replace('return Date.now()-f','return arbitraryGlobal()')},acorn).staticContractPass);
assert(!auditHostSources({...hostFixture,entryCode:'import "./godot";import "./godot-sdk";GODOTSDK.startGame();'},acorn).staticContractPass);
const external=audit(js('var alias=nowPolyfill;'));const closure=withHostClosure(external,auditHostSources(hostFixture,acorn));assert(!closure.pureEnginePass);assert(closure.staticSpecifiedHostPass);assert(!withHostClosure(external,null).staticSpecifiedHostPass);
console.log('PASS: static linkage fixtures: aliases, lexical scope, cycles, missing-link placeholders, functional stubs, logs, namespaces, callback exports and malformed WASM.');
if(process.argv[3]){const b=readBuild(path.resolve(process.argv[3]),acorn,{legacyBaseline:true}),r=b.audit;console.log(JSON.stringify({baseline:path.resolve(process.argv[3]),metadataPairing:b.metadataPairing,pass:r.pass,imports:r.importCount,exports:r.exportCount,unresolved:r.resolvedImports.filter(x=>!x.resolved).map(({definitionText,...r})=>r),missingLinkPlaceholders:r.missingLinkPlaceholders.map(({text,...r})=>r),functionalStubCount:r.functionalStubs.length,missingCallbacks:r.callbacks.filter(c=>!c.pass),warnings:r.linkWarnings},null,2));const unresolved=r.resolvedImports.filter(x=>!x.resolved);assert.equal(unresolved.length,1,'Known old baseline has exactly one unproven external alias');assert.equal(unresolved[0].mappedExpression,'_emscripten_get_now');assert.equal(unresolved[0].reason,'unbound nowPolyfill');assert.equal(r.missingLinkPlaceholders.length,0);assert.equal(r.callbacks.filter(c=>!c.pass).length,9);}
if(process.argv[4]){const h=readHost(path.resolve(process.argv[4]),acorn);console.log(JSON.stringify({host:h.path,verifiedFiles:h.verifiedFiles.length,staticContractPass:h.staticContractPass,checks:h.checks},null,2));assert(h.staticContractPass,'Real sealed parent host definition/order contract failed');}
