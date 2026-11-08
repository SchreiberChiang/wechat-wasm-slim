// Pure source rendering: reads owned component bytes; never writes generated
// output, imports/executes the components, evaluates code, or touches the SDK.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const components = Object.freeze([
  {path: 'convert/assets/persistent-file-transport.js', name: 'createPersistentFileTransport', parameter: null, dependency: null},
  {path: 'convert/assets/persistent-memfs.js', name: 'createPersistentMemfs', parameter: '__wxslimTransport', dependency: "require('./persistent-file-transport.js')"},
  {path: 'convert/assets/persistent-session.js', name: 'createPersistentSession', parameter: '__wxslimBackend', dependency: "require('./persistent-memfs.js')"},
]);
const supportedConstants = new Set([
  'EACCES', 'EBUSY', 'EEXIST', 'EFBIG', 'EINVAL', 'EIO', 'EISDIR', 'ENODEV',
  'ENOENT', 'ENOSPC', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSUP', 'EPERM',
  'S_IFDIR', 'S_IFMT', 'S_IFREG',
]);
const optionFields = Object.freeze([
  'sessionId', 'identity', 'fileSystem', 'userDataPath', 'directoryName',
  'nativeDirectoryPolicy', 'createMountpoint', 'maxFileBytes', 'maxTotalBytes',
  'maxEntries', 'maxDepth', 'maxRequests',
]);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const dataValue = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  assert(descriptor && Object.hasOwn(descriptor, 'value'), 'SOURCE_CONFIGURATION_DATA_FIELDS_REQUIRED: ' + key);
  return descriptor.value;
};

function configurationMap(value, label) {
  if (value === undefined) return Object.create(null);
  assert(value && typeof value === 'object' && !Array.isArray(value), label + '_OBJECT_REQUIRED');
  const allowed = new Set(components.map(component => component.path));
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    assert(typeof key === 'string' && allowed.has(key), label + '_UNKNOWN_SOURCE_PATH');
    result[key] = dataValue(value, key);
  }
  return result;
}

function componentText(buffer, component) {
  assert(Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= 256 * 1024, 'SOURCE_BUFFER_BOUND');
  const text = buffer.toString('utf8');
  assert(Buffer.from(text).equals(buffer), 'SOURCE_UTF8_REQUIRED: ' + component.path);
  assert(!text.includes('\0') && !text.startsWith('\uFEFF'), 'SOURCE_TEXT_ENCODING');
  const normalized = text.replaceAll('\r\n', '\n');
  assert.equal(normalized.split("(function () { 'use strict';").length, 2, 'OWNED_COMPONENT_IIFE_ANCHOR');
  assert(normalized.trimEnd().endsWith('}());'), 'OWNED_COMPONENT_IIFE_END');
  assert(new RegExp('function ' + component.name + '\\(options\\)').test(normalized), 'OWNED_FACTORY_DECLARATION');
  // Keep the source's IIFE and CJS export statement intact. The enclosing local
  // module container below receives the export, without using host CommonJS.
  const exports = [...normalized.matchAll(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)];
  assert.equal(exports.length, 1, 'OWNED_COMPONENT_EXPORT_COUNT');
  assert.equal(exports[0][1], component.name, 'OWNED_COMPONENT_EXPORT_FACTORY');
  let transformed = normalized;
  if (component.dependency) {
    assert.equal(transformed.split(component.dependency).length, 2, 'OWNED_REQUIRE_ANCHOR_NOT_UNIQUE');
    transformed = transformed.replace(component.dependency, () => component.parameter);
  }
  // Deliberately conservative text admission in addition to the two exact
  // dependency replacements. This is not a general JavaScript security parser.
  // Components are owned/reviewed inputs; their full byte identities are returned.
  assert(!/\brequire\s*\(|\beval\s*\(|\b(?:new\s+)?Function\s*\(|\bimport\s*(?:\(|['"{*])|\bexport\s+(?:default|function|const|let|var|class|\{)/.test(transformed), 'DYNAMIC_OR_MODULE_CODE_REMAINS');
  assert(!/\b(?:globalThis|GameGlobal|window|self|global)\s*(?:\.|\[)/.test(transformed), 'GLOBAL_ROOT_REFERENCE_FORBIDDEN');
  assert(!transformed.includes('{{{') && !transformed.includes('}}}'), 'COMPONENT_MACRO_FORBIDDEN');
  return {normalized, transformed};
}

/**
 * Render one Emscripten JS library, without writing or executing it.
 * sourceBuffers/expectedHashes are optional own-data maps keyed by the three
 * repository-relative component paths above. Values are Buffer and SHA256,
 * respectively. Omitted buffers are read from this repository, never cwd.
 * inputs always reports complete raw identities, including supplied buffers;
 * callers can pin a reviewed snapshot with expectedHashes or sourceBuffers.
 */
export function renderPersistentLibrary({sourceBuffers, expectedHashes} = {}) {
  const supplied = configurationMap(sourceBuffers, 'SOURCE_BUFFERS');
  const expected = configurationMap(expectedHashes, 'EXPECTED_HASHES');
  const inputs = [], loaded = [], defaults = [];
  for (const component of components) {
    let buffer;
    if (Object.hasOwn(supplied, component.path)) {
      assert(Buffer.isBuffer(supplied[component.path]), 'SOURCE_BUFFER_REQUIRED: ' + component.path);
      buffer = Buffer.from(supplied[component.path]);
    } else {
      const file = fileURLToPath(new URL('../' + component.path, import.meta.url));
      const stat = fs.lstatSync(file);
      assert(stat.isFile() && !stat.isSymbolicLink(), 'SOURCE_REGULAR_FILE_REQUIRED');
      buffer = fs.readFileSync(file);
      defaults.push({file, hash: hash(buffer)});
    }
    const identity = {path: component.path, bytes: buffer.length, sha256: hash(buffer)};
    if (Object.hasOwn(expected, component.path)) {
      assert(typeof expected[component.path] === 'string' && /^[a-f0-9]{64}$/.test(expected[component.path]), 'EXPECTED_SHA256_REQUIRED');
      assert.equal(identity.sha256, expected[component.path], 'SOURCE_HASH_MISMATCH: ' + component.path);
    }
    inputs.push(identity);
    loaded.push({...component, ...componentText(buffer, component)});
  }
  const names = new Set(['EACCES', 'EPERM']);
  for (const item of loaded) {
    // The owned backend uses C.X, C[error-name], and an explicit required-key
    // list. Capture both direct references and quoted errno/mode names.
    for (const match of item.normalized.matchAll(/\bC\.([A-Z][A-Z0-9_]*)\b/g)) names.add(match[1]);
    for (const match of item.normalized.matchAll(/['"]((?:E[A-Z0-9]+)|(?:S_IF[A-Z0-9]+))['"]/g)) names.add(match[1]);
  }
  const constants = [...names].sort();
  assert(constants.every(name => supportedConstants.has(name)), 'UNREVIEWED_CDEF_REQUIRED');
  const deps = ['$FS', '$MEMFS'];
  const wrap = (item, argument) => {
    const parameter = item.parameter || '';
    return `(function (${parameter}) {\nvar module = {exports: {}};\n${item.transformed}\nreturn module.exports;\n}(${argument || ''}))`;
  };
  const source = `/* Owned persistent factories; generated from the complete input hashes below.
 * Preparation only: no SDK link, engine integration or runtime acceptance.
${inputs.map(input => ' * ' + input.path + ' SHA256 ' + input.sha256).join('\n')}
 */
mergeInto(LibraryManager.library, {
  $WXSLIMPersistentCreate__deps: ${JSON.stringify(deps)},
  $WXSLIMPersistentCreate: function (options) {
    'use strict';
    var fields = ${JSON.stringify(optionFields)};
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('SAVE_FACTORY_OPTIONS_REQUIRED');
    var own = Reflect.ownKeys(options);
    if (own.length !== fields.length || own.some(function (key) { return typeof key !== 'string' || fields.indexOf(key) < 0; })) throw new Error('SAVE_FACTORY_OPTION_FIELDS');
    var clean = Object.create(null);
    fields.forEach(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('SAVE_FACTORY_OPTION_DATA_FIELDS');
      clean[key] = descriptor.value;
    });
    // Snapshot identity data before any component/native call; never invoke getters.
    var identity = clean.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new Error('SAVE_FACTORY_IDENTITY_REQUIRED');
    var identityFields = ['packageId', 'wasmSha256'];
    var identityOwn = Reflect.ownKeys(identity);
    if (identityOwn.length !== 2 || identityOwn.some(function (key) { return identityFields.indexOf(key) < 0; })) throw new Error('SAVE_FACTORY_IDENTITY_FIELDS');
    var identityCopy = Object.create(null);
    identityFields.forEach(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(identity, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('SAVE_FACTORY_IDENTITY_DATA_FIELDS');
      identityCopy[key] = descriptor.value;
    });
    clean.identity = Object.freeze(identityCopy);
    clean.FS = FS;
    clean.MEMFS = MEMFS;
    clean.constants = Object.freeze({
${constants.map(name => '      ' + JSON.stringify(name) + ': {{{ cDefs.' + name + ' }}}').join(',\n')}
    });
    var transportFactory = ${wrap(loaded[0])};
    var backendFactory = ${wrap(loaded[1], 'transportFactory')};
    var sessionFactory = ${wrap(loaded[2], 'backendFactory')};
    return sessionFactory(clean);
  }
});
`;
  const macros = [...source.matchAll(/\{\{\{\s*cDefs\.([A-Z][A-Z0-9_]*)\s*\}\}\}/g)].map(match => match[1]);
  assert.deepEqual(macros, constants, 'GENERATED_CDEF_MACRO_COVERAGE');
  assert(!source.replace(/\{\{\{\s*cDefs\.[A-Z][A-Z0-9_]*\s*\}\}\}/g, '0').includes('{{{'), 'UNAPPROVED_GENERATED_MACRO');
  // Fail if a concurrent editor changed a default input during this rendering.
  for (const item of defaults) assert.equal(hash(fs.readFileSync(item.file)), item.hash, 'SOURCE_CHANGED_DURING_RENDER');
  return {source, inputs, deps, constants};
}
