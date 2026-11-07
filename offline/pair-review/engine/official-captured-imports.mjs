// Source inspection only. Never evaluates target JS or constructs a WASM module.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import linkage from './official-glx-library/audit-linkage.cjs';
import {identifyOfficialRawPair} from './official-raw-identities.mjs';

let acorn;
function parser() {
  if (!acorn) {
    const module = {exports: {}};
    vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], {module, exports: module.exports});
    acorn = module.exports;
  }
  return acorn;
}
const names = ['glBindTexture', 'glCompressedTexImage2D', 'glCompressedTexSubImage2D', 'glIsTexture', 'glTexImage2D', 'glTexSubImage2D', 'glTexStorage2D'];
const fn = n => n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
const hash = b => createHash('sha256').update(b).digest('hex');
function canonical(n) {
  if (Array.isArray(n)) return n.map(canonical);
  if (!n || typeof n !== 'object') return n;
  return Object.fromEntries(Object.entries(n).filter(([k]) => !['start', 'end', 'loc', 'raw'].includes(k)).map(([k, v]) => [k, canonical(v)]));
}
const shape = source => canonical(parser().parse(source, {ecmaVersion: 'latest'}).body[0]);
// Deliberately narrow Emscripten topology. Changes require an independent review.
const createShape = route => shape(`async function createWasm(){function receiveInstance(instance,module){wasmExports=instance.exports;wasmMemory=wasmExports[${JSON.stringify(route.memory)}];updateMemoryViews();wasmTable=wasmExports[${JSON.stringify(route.table)}];assignWasmExports(wasmExports);removeRunDependency("wasm-instantiate");return wasmExports}addRunDependency("wasm-instantiate");function receiveInstantiationResult(result){return receiveInstance(result["instance"])}var info=getWasmImports();if(Module["instantiateWasm"]){return new Promise((resolve,reject)=>{Module["instantiateWasm"](info,(mod,inst)=>{resolve(receiveInstance(mod,inst))})})}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}`);

export function inspectCapturedImports({js, wasm}) {
  return inspect({js,wasm},false);
}
export function inspectConservativeCapturedImports(options) {
  assert.deepEqual(Reflect.ownKeys(options).sort(),['js','wasm'],'CONSERVATIVE_CAPTURE_EXACT_INPUTS');
  assert.equal(identifyOfficialRawPair(options).profile,'conservative','CONSERVATIVE_CAPTURE_FIXED_PAIR');
  return inspect(options,true);
}
// For new builds, derive only memory/table spelling from the actual WASM.
// This does not identify an approved recipe or grant conversion admission.
export function inspectUnregisteredCapturedImports(options){
  assert.equal(arguments.length,1,'UNREGISTERED_CAPTURE_ONE_ARGUMENT');
  assert(options&&Object.getPrototypeOf(options)===Object.prototype,'UNREGISTERED_CAPTURE_OPTIONS');
  assert.deepEqual(Reflect.ownKeys(options).sort(),['js','wasm'],'UNREGISTERED_CAPTURE_EXACT_INPUTS');
  for(const k of ['js','wasm'])assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,k),'value')&&Buffer.isBuffer(options[k]),'UNREGISTERED_CAPTURE_DATA_BUFFERS');
  assert(options.js.length>0&&options.js.length<=4*1024*1024&&options.wasm.length>0&&options.wasm.length<=256*1024*1024,'UNREGISTERED_CAPTURE_INPUT_BOUND');
  const inspection=inspect(options,false,true);
  return {schema:'wxslim-unregistered-captured-imports-v1',status:inspection.status==='SOURCE_VALUE_CAPTURE_PROVEN'?'CAPTURE_ROUTE_INSPECTED_NOT_ADMITTED':'UNKNOWN_OR_UNSUPPORTED',
    inspection,admission:'NOT_ADMITTED',sourceRecipe:'NOT_PROVEN',library:'NOT_PROVEN',allImports:'NOT_PROVEN',runtime:'NOT_RUN',
    targetJsEvaluated:false,wasmInstantiated:false,outputsWritten:false};
}
function inspect({js, wasm}, conservative, deriveRoute=false) {
  assert(Buffer.isBuffer(js) && Buffer.isBuffer(wasm), 'CAPTURE_BUFFERS_REQUIRED');
  const source = js.toString('utf8');
  const result = {schema: 'official-captured-imports-v1', status: 'UNKNOWN_OR_UNSUPPORTED',
    inputs: {js: {bytes: js.length, sha256: hash(js)}, wasm: {bytes: wasm.length, sha256: hash(wasm)}},
    issues: [], captures: [], boundaries: {targetJsEvaluated: false, wasmCompiled: false, wasmInstantiated: false,
      originalUnknownModified: false, wasmValidation: 'STRUCTURAL_PARSE_ONLY_NOT_FULL_VALIDATION',
      hostCorrectness: 'NOT_PROVEN', importsAfterHostHandoff: 'NOT_PROVEN', runtime: 'NOT_RUN'}};
  const fail = code => { throw Object.assign(new Error(code), {inspectionCode: code}); };
  const need = (value, code) => { if (!value) fail(code); };
  try {
    need(Buffer.from(source).equals(js), 'INVALID_UTF8');
    if(deriveRoute){need(WebAssembly.validate(wasm),'INVALID_WASM');result.boundaries.wasmValidation='WEBASSEMBLY_VALIDATE_AND_STRUCTURAL_PARSE';}
    const j = linkage.indexJs(source, parser()), binary = linkage.parseWasm(wasm);
    const route={memory:conservative?'Xm':'vn',table:conservative?'yn':'Zn'};
    if(deriveRoute){
      for(const [name,kind] of [['memory',2],['table',1]]){
        const entries=binary.exports.filter(e=>e.kind===kind);
        need(entries.length===1&&entries[0].index===0&&!binary.imports.some(e=>e.kind===kind),'UNREGISTERED_MEMORY_TABLE_TOPOLOGY');
        need(/^[A-Za-z_$][A-Za-z0-9_$]{0,159}$/.test(entries[0].name),'UNREGISTERED_EXPORT_NAME');
        route[name]=entries[0].name;
      }
      result.resolvedExports={...route,source:'ACTUAL_WASM_EXPORT_KIND_AND_INDEX'};
    }
    if(conservative||deriveRoute) {
      for(const [name,kind] of [[route.memory,2],[route.table,1]]) {
        const entries=binary.exports.filter(e=>e.name===name);
        need(entries.length===1&&entries[0].kind===kind&&entries[0].index===0,'CONSERVATIVE_MEMORY_TABLE_EXPORT_KIND');
      }
    }
    const nodes = [], parents = new WeakMap(), owners = new WeakMap();
    function walk(n, p, owner) {
      if (p) parents.set(n, p);
      owners.set(n, owner); nodes.push(n);
      for (const [key, value] of Object.entries(n)) {
        if (['start', 'end', 'loc'].includes(key)) continue;
        for (const child of Array.isArray(value) ? value : [value]) if (child?.type) walk(child, n, fn(n) ? n : owner);
      }
    }
    walk(j.ast);
    const span = n => ({type: n.type, start: n.start, end: n.end, sha256: hash(Buffer.from(source.slice(n.start, n.end)))});
    const scope = n => j.scopeOf.get(n) || j.scopeOf.get(parents.get(n));
    const lookup = (n, name) => j.lookup(scope(n), name);
    function refs(name) {
      return nodes.filter(n => n.type === 'Identifier' && n.name === name &&
        !(parents.get(n)?.type === 'MemberExpression' && parents.get(n).property === n && !parents.get(n).computed) &&
        !(parents.get(n)?.type === 'Property' && parents.get(n).key === n && !parents.get(n).computed && !parents.get(n).shorthand));
    }
    need(!nodes.some(n => n.type === 'WithStatement' || ['CallExpression', 'NewExpression'].includes(n.type) &&
      n.callee?.type === 'Identifier' && ['eval', 'Function'].includes(n.callee.name)), 'DYNAMIC_LEXICAL_ACCESS');
    need(j.imports.length === 1 && j.imports[0].init?.type === 'ObjectExpression', 'IMPORT_OBJECT_SHAPE');
    const imports = j.imports[0], factory = owners.get(imports);
    need(fn(factory) && factory.async && !factory.generator && parents.get(parents.get(imports)) === factory.body, 'FACTORY_SHAPE');
    const body = factory.body.body;
    const direct = name => {
      const defs = j.allFunctions.filter(f => f.id?.name === name);
      need(defs.length === 1 && parents.get(defs[0]) === factory.body, 'HELPER_DEFINITION_' + name);
      return defs[0];
    };
    const create = direct('createWasm'), assign = direct('assignWasmExports'), get = direct('getWasmImports');
    need(JSON.stringify(canonical(create)) === JSON.stringify(createShape(route)), 'CREATE_WASM_TOPOLOGY');
    need(JSON.stringify(canonical(get)) === JSON.stringify(shape('function getWasmImports(){return {a:wasmImports}}')), 'IMPORT_NAMESPACE_ROUTE');
    need(assign.params.length === 1 && assign.params[0].type === 'Identifier' && assign.params[0].name === 'wasmExports' && !assign.async && !assign.generator, 'ASSIGN_PARAMETERS');
    const exportBindings = new Map();
    for (const st of assign.body.body) {
      need(st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' && st.expression.operator === '=', 'ASSIGN_BODY');
      let a = st.expression;
      if (a.left.type === 'MemberExpression') {
        need(a.left.object.name === 'Module' && a.left.computed && a.left.property.type === 'Literal', 'ASSIGN_MODULE_PROPERTY');
        a = a.right;
      }
      need(a.type === 'AssignmentExpression' && a.operator === '=' && a.left.type === 'Identifier' &&
        a.right.type === 'MemberExpression' && a.right.object.name === 'wasmExports' && a.right.computed &&
        a.right.property.type === 'Literal' && typeof a.right.property.value === 'string', 'ASSIGN_EXPORT_SHAPE');
      need(!exportBindings.has(a.left.name), 'DUPLICATE_EXPORT_ASSIGNMENT');
      exportBindings.set(a.left.name, a.right.property.value);
    }
    const createRefs = refs('createWasm'), assignRefs = refs('assignWasmExports'), getRefs = refs('getWasmImports');
    const calls = createRefs.filter(n => parents.get(n)?.type === 'CallExpression' && parents.get(n).callee === n);
    need(createRefs.length === 2 && calls.length === 1, 'CREATE_REFERENCE_ESCAPE');
    const call = parents.get(calls[0]), awaited = parents.get(call), exportDecl = parents.get(awaited);
    need(awaited.type === 'AwaitExpression' && exportDecl.type === 'VariableDeclarator' && exportDecl.id.name === 'wasmExports' &&
      parents.get(parents.get(exportDecl)) === factory.body && call.arguments.length === 0 &&
      body.indexOf(parents.get(exportDecl)) > body.indexOf(parents.get(imports)), 'CREATE_CALL_ORDER');
    need(assignRefs.length === 2 && getRefs.length === 2 &&
      assignRefs.some(n => owners.get(n)?.id?.name === 'receiveInstance' && parents.get(n)?.type === 'CallExpression') &&
      getRefs.some(n => owners.get(n) === create && parents.get(n)?.type === 'CallExpression'), 'HELPER_REFERENCE_ESCAPE');
    for (const [name, def, references] of [['createWasm', create, createRefs], ['assignWasmExports', assign, assignRefs], ['getWasmImports', get, getRefs]]) {
      const bs = lookup(factory.body, name);
      need(bs?.length === 1 && bs[0].node === def && references.filter(n => n !== def.id).every(n => lookup(n, name) === bs), 'HELPER_BINDING_' + name);
    }
    need(refs('wasmImports').length === 2 && refs('wasmImports').every(n => n === imports.id ||
      owners.get(n) === get && parents.get(n)?.type === 'Property'), 'IMPORT_OBJECT_ESCAPE');
    need(imports.init.properties.every(p => p.type === 'Property' && !p.computed && !p.method && !p.shorthand && p.kind === 'init'), 'IMPORT_DATA_PROPERTIES');
    need(!nodes.some(n => n.type === 'AwaitExpression' && owners.get(n) === factory && n !== awaited), 'EARLY_FACTORY_AWAIT');
    for (const name of names) {
      const original = '_' + name, alias = '_emscripten_' + name;
      const ob = lookup(factory.body, original), ab = lookup(factory.body, alias);
      need(ab?.length === 1 && ob?.length && ab[0].kind === 'var' && ob.every(b => b.kind === 'var' && b.scope === ab[0].scope), 'CAPTURE_VAR_ENVIRONMENT');
      const initialized = ob.filter(b => b.value);
      need(initialized.length === 1, 'ORIGINAL_INITIALIZER_COUNT');
      const od = initialized[0].node, ad = ab[0].node, os = parents.get(od), as = parents.get(ad);
      need(od.init.type === 'ArrowFunctionExpression' && !od.init.async && !od.init.generator, 'ORIGINAL_FUNCTION_VALUE');
      need(ad.init?.type === 'Identifier' && ad.init.name === original && lookup(ad.init, original) === ob, 'CAPTURE_IDENTIFIER_BINDING');
      need(os.type === 'VariableDeclaration' && as.type === 'VariableDeclaration' && os.declarations.length === 1 && as.declarations.length === 1 &&
        parents.get(os) === factory.body && parents.get(as) === factory.body && body.indexOf(as) === body.indexOf(os) + 1 &&
        body.indexOf(as) < body.indexOf(parents.get(imports)), 'ADJACENT_FACTORY_CAPTURE');
      const ar = refs(alias), mapped = [...j.mapping.entries()].filter(([, v]) => v.expr.type === 'Identifier' && v.expr.name === alias);
      need(ar.length === 2 && mapped.length === 1 && ar.includes(ad.id) && ar.includes(mapped[0][1].expr) && lookup(mapped[0][1].expr, alias) === ab, 'ALIAS_REFERENCE_OR_WRITE');
      const imported = binary.imports.filter(i => i.module === 'a' && i.name === mapped[0][0]);
      need(imported.length === 1 && imported[0].kind === 0, 'WASM_FUNCTION_IMPORT');
      const ex = binary.exports.find(e => e.name === exportBindings.get(original) && e.kind === 0);
      need(ex && JSON.stringify(ex.signature) === JSON.stringify(imported[0].signature), 'REBOUND_EXPORT_SIGNATURE');
      const writes = refs(original).filter(n => parents.get(n)?.type === 'AssignmentExpression' && parents.get(n).left === n);
      need(writes.length === 1 && owners.get(writes[0]) === assign && lookup(writes[0], original) === ob, 'ORIGINAL_REBIND');
      for (const n of refs(original)) {
        const p = parents.get(n);
        const declared = ob.some(b => b.node.id === n);
        const exportedRead = p?.type === 'AssignmentExpression' && p.right === n && p.left.type === 'MemberExpression' && p.left.object.name === 'Module';
        need(declared || n === ad.init || writes.includes(n) || exportedRead, 'ORIGINAL_UNSUPPORTED_REFERENCE');
      }
      need(!nodes.some(n => n.type === 'Identifier' && n.start >= od.init.start && n.end <= od.init.end &&
        names.some(v => n.name === '_' + v)), 'CAPTURED_CLOSURE_REBOUND_REFERENCE');
      need(!nodes.some(n => n.type === 'CatchClause' && [od, ad, mapped[0][1].expr, ...writes].some(v => v.start >= n.start && v.end <= n.end)), 'CATCH_SCOPE_UNSUPPORTED');
      result.captures.push({original, alias, module: 'a', import: mapped[0][0], definition: span(od.init), capture: span(ad),
        originalDeclarations: ob.map(b => span(b.node)), reboundExport: ex.name, signature: imported[0].signature});
    }
    result.status = 'SOURCE_VALUE_CAPTURE_PROVEN';
    result.scope = 'Seven captured function values and import properties before createWasm host handoff; subsequent host mutation and function behavior are not proven.';
    result.topology = {factory: span(factory), createWasm: span(create), assignWasmExports: span(assign), getWasmImports: span(get), awaitCreateWasm: span(awaited)};
  } catch (e) {
    result.issues.push({code: e.inspectionCode || 'PARSER_OR_INDEX_UNSUPPORTED'});
  }
  return result;
}
