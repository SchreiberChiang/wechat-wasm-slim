// Read-only evidence inventory, NOT an engine admission or transformation API.
// The only evaluated code is Node's bundled Acorn, never the target input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import linkage from './official-glx-library/audit-linkage.cjs';

let acorn;
function parser() {
  if (!acorn) {
    const module = {exports: {}};
    vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], {module, exports: module.exports});
    acorn = module.exports;
  }
  return acorn;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({bytes: bytes.length, sha256: hash(bytes)});
const isFunction = node => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
const key = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' && ['string', 'number'].includes(typeof node.value) ? String(node.value) : null;
const property = node => node?.type === 'MemberExpression' && (!node.computed || node.property.type === 'Literal') ? key(node.property) : null;
function children(node) {
  const out = [];
  for (const [name, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'range'].includes(name)) continue;
    if (Array.isArray(value)) { for (const child of value) if (child?.type) out.push(child); }
    else if (value?.type) out.push(value);
  }
  return out;
}
function expressionName(node) {
  if (node?.type === 'Identifier') return node.name;
  const part = property(node), object = part === null ? null : expressionName(node.object);
  return object === null ? null : object + '.' + part;
}
// Symbol evidence only: computed string keys may be URLs, paths or credentials.
const safeName = value => typeof value === 'string' && value.length <= 160 &&
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(value) ? value : null;

export function inspectOfficialGlue(options) {
  assert(options && Object.getPrototypeOf(options) === Object.prototype, 'GLUE_INSPECTION_OPTIONS');
  assert.deepEqual(Reflect.ownKeys(options).sort(), ['js', 'wasm'], 'GLUE_INSPECTION_EXACT_INPUTS');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  assert(Object.hasOwn(descriptors.js, 'value') && Object.hasOwn(descriptors.wasm, 'value'), 'GLUE_INSPECTION_DATA_INPUTS');
  const {js, wasm} = options;
  assert(Buffer.isBuffer(js) && Buffer.isBuffer(wasm), 'GLUE_INSPECTION_BUFFERS');
  const source = js.toString('utf8');
  assert(Buffer.from(source).equals(js), 'GLUE_INSPECTION_UTF8');
  let ast, binary;
  try { ast = parser().parse(source, {ecmaVersion: 'latest', sourceType: 'script', locations: true}); }
  catch (_) { throw Error('GLUE_INSPECTION_INVALID_JS'); }
  try { binary = linkage.parseWasm(wasm); }
  catch (_) { throw Error('GLUE_INSPECTION_INVALID_OR_UNSUPPORTED_WASM'); }
  let indexed = null;
  try { indexed = linkage.indexJs(source, {parse() { return ast; }}); }
  catch (_) { /* Unsupported/duplicate map is evidence, never a successful link. */ }

  const parents = new WeakMap(), enclosing = new WeakMap(), nodes = [], functions = [];
  function walk(node, parent, owner) {
    if (parent) parents.set(node, parent);
    enclosing.set(node, owner);
    nodes.push(node);
    if (isFunction(node)) functions.push(node), owner = node;
    for (const child of children(node)) walk(child, node, owner);
  }
  walk(ast, null, null);
  function catchAffected(node) {
    for (let current = node; current; current = parents.get(current)) if (current.type === 'CatchClause') return true;
    return false;
  }
  const spans = new WeakMap(), offsets = new Map([[0, 0], [source.length, js.length]]);
  function byteOffset(position) {
    if (!offsets.has(position)) offsets.set(position, Buffer.byteLength(source.slice(0, position)));
    return offsets.get(position);
  }
  function span(node) {
    if (!spans.has(node)) spans.set(node, {
      type: node.type, utf16Start: node.start, utf16End: node.end,
      byteStart: byteOffset(node.start), byteEnd: byteOffset(node.end),
      line: node.loc.start.line, column: node.loc.start.column,
      sha256: hash(Buffer.from(source.slice(node.start, node.end)))
    });
    return spans.get(node);
  }
  function functionName(node) {
    if (node.id) return node.id.name;
    const parent = parents.get(node);
    if (parent?.type === 'VariableDeclarator') return key(parent.id);
    if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') return key(parent.key);
    if (parent?.type === 'AssignmentExpression') return expressionName(parent.left);
    return null;
  }
  function owner(node) {
    const fn = enclosing.get(node);
    return fn ? {name: safeName(functionName(fn)), scope: indexed?.scopeOf.get(fn.body)?.id ?? null, ...span(fn)} : null;
  }
  function binding(node, name) {
    if (catchAffected(node)) return {status: 'UNKNOWN_CATCH_SCOPE_UNSUPPORTED'};
    if (!indexed) return {status: 'UNKNOWN_INDEX_UNAVAILABLE'};
    const bindings = indexed.lookup(indexed.scopeOf.get(node), name);
    if (!bindings) return {status: 'UNBOUND_NOT_HOST_PROOF'};
    return {status: bindings.length === 1 ? 'LEXICAL_BINDING' : 'AMBIGUOUS_BINDINGS',
      definitions: bindings.map(item => ({kind: item.kind, scope: item.scope.id, ...span(item.node)}))};
  }
  function context(node) {
    const result = [];
    for (let current = parents.get(node); current && !isFunction(current); current = parents.get(current)) {
      if (['IfStatement', 'ConditionalExpression', 'TryStatement', 'CatchClause', 'ThrowStatement', 'ReturnStatement'].includes(current.type)) result.push(span(current));
    }
    return result;
  }
  const clocks = [], runtimeErrors = [], inode = [];
  function evidence(node, kind) { return {kind, ...span(node), owner: owner(node), context: context(node)}; }
  function rootName(node) { while (node?.type === 'MemberExpression') node = node.object; return node?.type === 'Identifier' ? node.name : null; }
  function targetShape(node) {
    return {type: node.type, symbol: safeName(expressionName(node)),
      computed: node.type === 'MemberExpression' ? node.computed : null,
      objectType: node.object?.type || null, objectSymbol: safeName(expressionName(node.object)),
      propertyType: node.property?.type || null};
  }
  for (const node of nodes) {
    const parent = parents.get(node), path = expressionName(node);
    if (node.type === 'MemberExpression' && ['performance.now', 'globalThis.performance.now', 'window.performance.now', 'GameGlobal.performance.now'].includes(path)) {
      clocks.push({...evidence(node, 'PERFORMANCE_NOW'), role: parent?.type === 'CallExpression' && parent.callee === node ? 'CALL' : 'REFERENCE',
        expression: path, binding: binding(node, rootName(node))});
    }
    if (node.type === 'MemberExpression' && property(node) === 'nowPolyfill') {
      clocks.push({...evidence(node, 'NOW_POLYFILL_MEMBER'), expression: safeName(path), binding: rootName(node) ? binding(node, rootName(node)) : {status: 'UNSUPPORTED_OBJECT'}});
    } else if (node.type === 'Identifier' && node.name === 'nowPolyfill' &&
      !(parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) &&
      !(parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand)) {
      clocks.push({...evidence(node, 'NOW_POLYFILL_IDENTIFIER'), binding: binding(node, node.name)});
    }
    const constructor = node.type === 'NewExpression' || node.type === 'CallExpression' ? node.callee :
      node.type === 'BinaryExpression' && node.operator === 'instanceof' ? node.right : null;
    if (constructor && (constructor.type === 'Identifier' && constructor.name === 'RuntimeError' || property(constructor) === 'RuntimeError')) {
      const root = rootName(constructor);
      runtimeErrors.push({...evidence(node, node.type === 'BinaryExpression' ? 'INSTANCEOF' : node.type === 'NewExpression' ? 'CONSTRUCTION' : 'CALL'),
        constructor: safeName(expressionName(constructor)), binding: root ? binding(constructor, root) : {status: 'UNSUPPORTED_OBJECT'}});
    }
    if (node.type === 'MemberExpression' && property(node) === 'ino') {
      let role = 'READ';
      if (parent?.type === 'AssignmentExpression' && parent.left === node) role = 'WRITE_' + parent.operator;
      if (parent?.type === 'UpdateExpression' && parent.argument === node) role = 'UPDATE_' + parent.operator;
      if (parent?.type === 'UnaryExpression' && parent.operator === 'delete') role = 'DELETE';
      const guards = [];
      let enclosingOperation = null;
      for (let current = parent; current && !isFunction(current); current = parents.get(current)) {
        if (!enclosingOperation && (current.type === 'AssignmentExpression' || current.type === 'CallExpression')) {
          enclosingOperation = {position: span(current),
            kind: current.type === 'AssignmentExpression' ? 'ASSIGNMENT' : 'CALL',
            operator: current.type === 'AssignmentExpression' ? current.operator : null,
            target: targetShape(current.type === 'AssignmentExpression' ? current.left : current.callee),
            relationship: 'ENCLOSING_AST_ONLY_NOT_DATAFLOW'};
        }
        if (current.type === 'IfStatement' || current.type === 'ConditionalExpression') {
          guards.push({position: span(current), test: span(current.test),
            memberInTest: node.start >= current.test.start && node.end <= current.test.end,
            memberInConsequent: node.start >= current.consequent.start && node.end <= current.consequent.end});
        }
      }
      inode.push({...evidence(node, 'INODE_MEMBER'), expression: safeName(path), exactStatIdentifier: node.object.type === 'Identifier' && node.object.name === 'stat',
        role, operation: parent && role !== 'READ' ? span(parent) : null, enclosingOperation, guards, guardSemantics: 'NOT_PROVEN'});
    }
  }

  // Keep all object declarations/properties, even when the existing indexer
  // deliberately rejects duplicate or dynamic mapping syntax.
  const objects = nodes.filter(node => node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'wasmImports');
  const properties = [];
  for (const declaration of objects) if (declaration.init?.type === 'ObjectExpression') {
    const counts = new Map();
    for (const item of declaration.init.properties) {
      const name = item.type === 'Property' && (!item.computed || item.key.type === 'Literal') ? key(item.key) : null;
      if (name !== null) counts.set(name, (counts.get(name) || 0) + 1);
    }
    for (const item of declaration.init.properties) {
      const name = item.type === 'Property' && (!item.computed || item.key.type === 'Literal') ? key(item.key) : null;
      properties.push({name: safeName(name), position: span(item), declaration: span(declaration),
        catchScopeUnsupported: catchAffected(item),
        duplicate: name !== null && counts.get(name) > 1,
        supported: item.type === 'Property' && !item.computed && item.kind === 'init',
        expression: item.type === 'Property' ? span(item.value) : null});
    }
  }
  const routes = [];
  for (const node of nodes) if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression' && functionName(enclosing.get(node) || {}) === 'getWasmImports') {
    for (const item of node.argument.properties) if (item.type === 'Property' && item.kind === 'init' && !item.computed && item.value.type === 'Identifier' && item.value.name === 'wasmImports') {
      const bindings = indexed?.lookup(indexed.scopeOf.get(item.value), 'wasmImports');
      routes.push({name: safeName(key(item.key)), position: span(item), owner: owner(node),
        catchScopeUnsupported: catchAffected(item),
        declaration: bindings?.length === 1 && objects.includes(bindings[0].node) ? span(bindings[0].node) : null});
    }
  }
  const mutations = nodes.filter(node =>
    node.type === 'AssignmentExpression' && rootName(node.left) === 'wasmImports' ||
    node.type === 'UpdateExpression' && rootName(node.argument) === 'wasmImports').map(span);
  const links = [];
  for (const item of binary.imports) {
    const mapped = indexed?.mapping.get(item.name);
    const eligibleRoutes = routes.filter(route => route.name === item.module);
    const prop = properties.filter(entry => entry.name === item.name);
    let reason = null, resolved = null;
    if (!indexed) reason = 'UNSUPPORTED_JS_INDEX';
    else if (objects.length !== 1 || objects[0].init?.type !== 'ObjectExpression') reason = 'AMBIGUOUS_OR_UNSUPPORTED_IMPORT_OBJECT';
    else if (catchAffected(objects[0]) || mapped && catchAffected(mapped.expr) || prop.some(entry => entry.catchScopeUnsupported) || eligibleRoutes.some(route => route.catchScopeUnsupported)) reason = 'CATCH_SCOPE_UNSUPPORTED';
    else if (mutations.length) reason = 'IMPORT_OBJECT_MUTATED';
    else if (eligibleRoutes.length !== 1 || eligibleRoutes[0].declaration?.utf16Start !== objects[0].start) reason = 'UNKNOWN_OR_AMBIGUOUS_NAMESPACE_ROUTE';
    else if (!mapped || prop.length !== 1 || prop[0].duplicate || !prop[0].supported) reason = 'MISSING_OR_UNSUPPORTED_PROPERTY';
    else if (item.kind !== 0) reason = 'UNSUPPORTED_NONFUNCTION_IMPORT';
    else {
      resolved = indexed.resolve(mapped.expr, mapped.scope);
      if (!resolved.okay) reason = 'UNRESOLVED_BINDING';
      else if (resolved.kind !== 'function') reason = 'UNSUPPORTED_RESOLVED_KIND';
      else if (indexed.assignments.some(assignment => assignment.left.type === 'Identifier' && (resolved.chain || []).includes(assignment.left.name))) reason = 'MUTATED_ALIAS_REQUIRES_REVIEW';
      else if (nodes.some(node => node.type === 'UpdateExpression' && node.argument.type === 'Identifier' && (resolved.chain || []).includes(node.argument.name))) reason = 'UPDATED_ALIAS_REQUIRES_REVIEW';
      else if (catchAffected(resolved.node) || (resolved.chain || []).some(name =>
        indexed.lookup(mapped.scope, name)?.some(item => catchAffected(item.node)))) reason = 'CATCH_SCOPE_UNSUPPORTED';
    }
    links.push({module: safeName(item.module), name: safeName(item.name), kind: item.kind, signature: item.signature || null,
      status: reason ? 'UNKNOWN_OR_UNSUPPORTED' : 'DECLARATIVE_FUNCTION_LINK_OBSERVED', reason,
      property: prop.length === 1 ? prop[0].position : null,
      definition: resolved?.okay && resolved.kind === 'function' ? span(resolved.node) : null,
      functionName: resolved?.node ? safeName(functionName(resolved.node)) : null,
      aliasChain: (resolved?.chain || []).map(safeName),
      invocationAndInstantiation: 'NOT_PROVEN'});
  }
  const invokeFunctions = functions.filter(fn => /^invoke_/.test(functionName(fn) || '')).map(fn => ({
    name: safeName(functionName(fn)), definition: span(fn), owner: owner(fn), parameters: fn.params.length,
    linkedImports: links.filter(link => link.definition?.utf16Start === fn.start).map(link => ({module: link.module, name: link.name, status: link.status})),
    nameAloneProvesLinkage: false
  }));
  return {schema: 'wxslim-official-glue-inspection-v1', status: 'INSPECTION_ONLY_NOT_ADMISSION',
    js: identity(js), wasm: identity(wasm), parser: {name: 'Node bundled Acorn', version: parser().version},
    clocks, runtimeErrors, inode,
    linkage: {indexStatus: indexed ? 'INDEXED_NOT_ADMITTED' : 'UNSUPPORTED_INDEX', importObjects: objects.map(span),
      properties, namespaceRoutes: routes, mutations, wasmImports: links, invokeFunctions,
      wasmExportCount: binary.exports.length, wasmDefinedFunctionCount: binary.definedFunctionCount},
    boundaries: {targetJsEvaluated: false, wasmCompiled: false, wasmInstantiated: false, transformed: false,
      wasmValidation: 'EXISTING_PARSEWASM_STRUCTURAL_SUBSET_NOT_FULL_VALIDATION',
      lexicalResolution: 'EXISTING_INDEXJS_SUBSET_NOT_GENERAL_JS_SEMANTICS',
      hostBindings: 'NOT_PROVEN', guardCorrectness: 'NOT_PROVEN', runtime: 'NOT_RUN'}};
}
