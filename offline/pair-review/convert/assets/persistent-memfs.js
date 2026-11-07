/* Owned persistent MEMFS backend preparation; NOT installed in an engine.
 * Inject the fixed SDK's FS/MEMFS/cDefs and an existing, single-writer native
 * directory. No wx global, automatic mkdir/mount, timers or silent recovery.
 * Successful synchronous writeback/readback is not power-loss durability.
 */
(function () { 'use strict';
const createTransport = require('./persistent-file-transport.js');
function createPersistentMemfs(options) {
  const FS = options.FS, MEMFS = options.MEMFS, C = options.constants;
  const native = options.fileSystem, nativeRoot = options.rootPath;
  const maxFile = options.maxFileBytes, maxTotal = options.maxTotalBytes;
  const maxEntries = options.maxEntries, maxDepth = options.maxDepth;
  const codes = new WeakMap(), nodes = new Map(), handles = new Set();
  const state = {phase:'NEW', entries:0, totalBytes:0, generation:0,
    events:[], droppedEvents:0, lastFailure:null};
  let root = null, mounted = null, slot = null, busy = false, sdkMemoryCall = false, serial = 0, nodeSerial = 0;
  function fail(code) { const error = new FS.ErrnoError(C[code]); codes.set(error, code); throw error; }
  function need(ok, code) { if (!ok) fail(code || 'EINVAL'); }
  if (!FS || !MEMFS || !C || typeof FS.ErrnoError !== 'function') throw Error('SAVE_SDK_REQUIRED');
  for (const key of ['EIO','EINVAL','EBUSY','EFBIG','ENOSPC','ENOTSUP','ENODEV','ENOENT',
    'EEXIST','ENOTDIR','EISDIR','ENOTEMPTY','S_IFDIR','S_IFREG','S_IFMT']) {
    if (!Number.isSafeInteger(C[key])) throw Error('SAVE_CONSTANT_REQUIRED_' + key);
  }
  need(Number.isSafeInteger(maxTotal) && maxTotal >= maxFile && maxTotal <= 64 * 1024 * 1024);
  need(Number.isSafeInteger(maxEntries) && maxEntries > 0 && maxEntries <= 4096);
  need(Number.isSafeInteger(maxDepth) && maxDepth > 0 && maxDepth <= 32);
  const transport = createTransport({fileSystem:native, rootPath:nativeRoot, maxBytes:maxFile});
  const methods = {};
  for (const name of ['statSync','readdirSync','mkdirSync','renameSync','unlinkSync','rmdirSync']) {
    need(typeof native[name] === 'function'); methods[name] = native[name];
  }
  function nativeCode(error) {
    try {
      const n = error && error.errCode;
      if (Number.isSafeInteger(n)) return n;
      const c = error && error.code;
      if (typeof c === 'string' && /^(?:EIO|ENOENT|EACCES|EPERM|ENOSPC|EEXIST|EINVAL|ENOTEMPTY|ENOTDIR|EISDIR)$/.test(c)) return c;
    } catch (_) { /* Original cause stays local and non-enumerable. */ }
    return null;
  }
  function wrapError(cause) {
    // Preserve genuine SDK ErrnoError values; unknown platform numbers are NOT
    // guessed to be POSIX errno. Only explicit symbolic codes can map directly.
    const reason = codes.get(cause), nativeValue = nativeCode(cause);
    let number = reason ? C[reason] : C.EIO;
    if (!reason) {
      try {
        if (cause instanceof FS.ErrnoError) {
          const observed = cause.errno;
          if (Number.isSafeInteger(observed) && Object.keys(C).some(key=>/^E[A-Z0-9]+$/.test(key) && C[key] === observed)) number = observed;
        } else if (typeof nativeValue === 'string' && Number.isSafeInteger(C[nativeValue])) number = C[nativeValue];
      } catch (_) { /* Revoked proxies/getters cannot prevent failure recording. */ }
    }
    const error = new FS.ErrnoError(number);
    Object.defineProperty(error, 'cause', {value:cause});
    return {error,number,reason:reason || null,nativeValue};
  }
  function record(report, cause) {
    if (arguments.length > 1) Object.defineProperty(report, 'cause', {value:cause});
    Object.freeze(report);
    if (state.events.length < 128) state.events.push(report); else state.droppedEvents++;
    if (report.status === 'FAILED') state.lastFailure = report;
  }
  function mountIsLive() {
    return !!(slot && slot.mounted === mounted && FS.root && FS.root.mount
      && FS.getMounts(FS.root.mount).includes(mounted));
  }
  function operation(name, node, work, flags) {
    flags = flags || {};
    const report = {schema:'wxslim-persistent-memfs-operation-v1', sequence:++serial,
      operation:name, targetId:nodes.has(node) ? nodes.get(node).id : null,
      stage:'VALIDATE', status:'FAILED', memoryMayHaveChanged:false,
      nativeMayHaveChanged:false, nativeReturned:false, readbackMatches:null,
      atomicity:'NOT_PROVEN', restartRecovery:'NOT_TESTED'};
    let locked = false;
    try {
      need(!busy, 'EBUSY'); busy = true; locked = true;
      if (!flags.mount && !flags.close) {
        need(state.phase === 'READY', 'EIO');
        // Unmounting an ancestor does not clear descendant slots in the fixed
        // SDK. Check both slot identity and reachability from the live FS root.
        if (!mountIsLive()) {
          state.phase = 'DETACHED'; fail('ENODEV');
        }
      }
      if (node) need(nodes.has(node), 'EIO');
      const value = work(report);
      if (!flags.mount && !flags.close && !mountIsLive()) { state.phase = 'DETACHED'; fail('ENODEV'); }
      if (report.memoryMayHaveChanged || report.nativeMayHaveChanged) state.generation++;
      report.status = 'SUCCESS'; report.stage = 'COMPLETE'; record(report); return value;
    } catch (cause) {
      if (!flags.mount && state.phase !== 'DETACHED' && (report.memoryMayHaveChanged || report.nativeMayHaveChanged || report.verifying)) state.phase = 'TAINTED';
      const normalized = wrapError(cause);
      report.errno = normalized.number; report.code = normalized.reason;
      report.nativeCode = normalized.nativeValue;
      record(report, cause); throw normalized.error;
    } finally { if (locked) busy = false; }
  }
  function validName(name) {
    need(typeof name === 'string' && name.length > 0 && name.length <= 255
      && !/[\\/:\x00-\x1f\x7f?#%]/.test(name)
      && !['.','..','__proto__','prototype','constructor'].includes(name));
    return name;
  }
  function relative(node) {
    const names = [], seen = new Set();
    while (node !== root) {
      need(node && nodes.has(node) && !seen.has(node) && node.mount === mounted, 'EIO');
      seen.add(node); names.push(validName(node.name)); node = node.parent;
      need(names.length <= maxDepth, 'EIO');
    }
    return names.reverse().join('/');
  }
  function joined(parent, name) {
    const path = relative(parent), result = (path ? path + '/' : '') + validName(name);
    need(result.length <= 1024 && result.split('/').length <= maxDepth, 'ENOSPC');
    return result;
  }
  const full = path => path ? nativeRoot + '/' + path : nativeRoot;
  function invoke(report, stage, method, args, mutation) {
    report.stage = stage;
    if (mutation) report.nativeMayHaveChanged = true;
    const value = methods[method].apply(native, args);
    need(!value || typeof value.then !== 'function', 'EIO');
    if (mutation) report.nativeReturned = true;
    return value;
  }
  function stat(report, path) {
    const value = invoke(report, 'NATIVE_STAT', 'statSync', [full(path),false], false);
    need(value && !Array.isArray(value), 'EIO');
    need(typeof value.isFile === 'function' && typeof value.isDirectory === 'function', 'EIO');
    const file = value.isFile(), dir = value.isDirectory();
    need(typeof file === 'boolean' && typeof dir === 'boolean','EIO');
    need(file !== dir, 'ENOTSUP');
    const size = file ? value.size : 0;
    need(Number.isSafeInteger(size) && size >= 0, 'EIO');
    need(size <= maxFile, 'EFBIG');
    return {type:dir?'dir':'file', size};
  }
  function listing(report, path) {
    const names = invoke(report, 'NATIVE_READDIR', 'readdirSync', [full(path)], false);
    need(Array.isArray(names) && names.length <= maxEntries, 'ENOSPC');
    const result = names.map(validName).sort();
    for (let i=1;i<result.length;i++) need(result[i] !== result[i-1], 'EIO');
    return result;
  }
  function sameBytes(a,b) {
    if (a.length !== b.length) return false;
    for (let i=0;i<a.length;i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function getRead(report, path) {
    report.stage = 'NATIVE_READ'; const receipt = transport.readFile(path);
    if (receipt.status !== 'SUCCESS') throw receipt.cause;
    return receipt.data;
  }
  function inventory(report) {
    const entries = []; let total = 0;
    function visit(path, depth) {
      const info = stat(report, path);
      if (!path) need(info.type === 'dir', 'ENOTDIR');
      else {
        need(depth <= maxDepth && path.length <= 1024 && entries.length < maxEntries, 'ENOSPC');
        const entry = {path, type:info.type}; entries.push(entry);
        if (info.type === 'file') {
          need(total + info.size <= maxTotal, 'ENOSPC');
          const data = getRead(report, path);
          need(data.length === info.size, 'EIO'); total += data.length; entry.data = data;
          return;
        }
      }
      const before = listing(report, path);
      for (const name of before) visit((path ? path + '/' : '') + name, depth+1);
      need(stat(report,path).type === 'dir', 'EIO');
      const after = listing(report, path);
      need(before.length === after.length && before.every((x,i)=>x === after[i]), 'EIO');
    }
    visit('',0); return {entries,total};
  }
  function fileBytes(node) { return new Uint8Array(MEMFS.getFileDataAsTypedArray(node)); }
  function verifyFile(report, node, path) {
    report.verifying = true; const data = getRead(report, path === undefined ? relative(node) : path);
    report.readbackMatches = sameBytes(data, fileBytes(node)); need(report.readbackMatches, 'EIO');
  }
  function persist(report, node, path) {
    report.stage = 'NATIVE_WRITE'; report.nativeMayHaveChanged = true;
    const receipt = transport.replaceFile(path, fileBytes(node));
    report.nativeReturned = receipt.platformMutationReturned;
    report.readbackMatches = receipt.readbackMatches;
    if (receipt.status !== 'SUCCESS') throw receipt.cause;
  }
  function changing(report, fn) {
    report.stage = 'MEMORY_MUTATION'; report.memoryMayHaveChanged = true;
    sdkMemoryCall = true;
    try { return fn(); } finally { sdkMemoryCall = false; }
  }
  function fileBudget(node, newSize) {
    need(Number.isSafeInteger(newSize) && newSize >= 0, 'EINVAL');
    need(newSize <= maxFile, 'EFBIG');
    need(state.totalBytes - node.usedBytes + newSize <= maxTotal, 'ENOSPC');
  }
  function subtree(node) {
    const list = [node];
    if (FS.isDir(node.mode)) for (const name of Object.keys(node.contents)) list.push.apply(list,subtree(node.contents[name]));
    return list;
  }
  function noOpen(node) { for (const item of subtree(node)) need(nodes.get(item).open === 0, 'EBUSY'); }
  function absent(report, parentPath, name) { need(!listing(report,parentPath).includes(name), 'EIO'); }
  function install(node) {
    const baseNode = node.node_ops, baseStream = node.stream_ops;
    nodes.set(node,{id:++nodeSerial,open:0});
    if (FS.isDir(node.mode)) node.contents = Object.assign(Object.create(null), node.contents);
    const n = Object.assign({},baseNode), s = Object.assign({},baseStream);
    node.node_ops = n; node.stream_ops = s;
    for (const key of ['getattr','lookup','readdir','readlink']) if (typeof n[key] === 'function') {
      const original = n[key]; n[key] = function () {
        const args=arguments;
        // Fixed MEMFS.rename/rmdir performs a synchronous FS.lookupNode itself.
        // This narrow, native-call-free memory phase is not an external request.
        if (key === 'lookup' && sdkMemoryCall) return original.apply(baseNode,args);
        return operation(key.toUpperCase(),node,()=>original.apply(baseNode,args));
      };
    }
    n.setattr = function (target,attr) { return operation('SETATTR',target,report=>{
      need(target === node);
      if (attr.mode !== undefined) need(Number.isSafeInteger(attr.mode) && (attr.mode&C.S_IFMT) === (node.mode&C.S_IFMT), 'ENOTSUP');
      const resize = attr.size !== undefined;
      if (resize) { need(FS.isFile(node.mode), 'EISDIR'); fileBudget(node,attr.size); }
      const oldSize = node.usedBytes || 0, path = relative(node);
      changing(report,()=>baseNode.setattr(node,attr));
      if (resize) { persist(report,node,path); state.totalBytes += node.usedBytes-oldSize; }
      // chmod and timestamps are explicitly local metadata, not native persistence.
      report.metadataPersistence = resize ? 'CONTENT_ONLY' : 'MEMORY_ONLY';
    }); };
    n.mknod = function (parent,name,mode,dev) { return operation('MKNOD',parent,report=>{
      need(parent === node && FS.isDir(parent.mode), 'ENOTDIR');
      const path = joined(parent,name), isDir = FS.isDir(mode), isFile = FS.isFile(mode);
      need(isDir || isFile, 'ENOTSUP'); need(!dev, 'ENOTSUP');
      need(!Object.prototype.hasOwnProperty.call(parent.contents,name), 'EEXIST');
      need(state.entries < maxEntries, 'ENOSPC');
      need(!listing(report,relative(parent)).includes(name), 'EEXIST');
      if (isDir) { invoke(report,'NATIVE_MKDIR','mkdirSync',[full(path),false],true); need(stat(report,path).type === 'dir','EIO'); }
      else {
        report.nativeMayHaveChanged = true; report.stage = 'NATIVE_CREATE';
        const receipt = transport.replaceFile(path,new Uint8Array(0));
        report.nativeReturned = receipt.platformMutationReturned; report.readbackMatches = receipt.readbackMatches;
        if (receipt.status !== 'SUCCESS') throw receipt.cause;
      }
      const child = changing(report,()=>baseNode.mknod(parent,name,mode,dev)); install(child); state.entries++; return child;
    }); };
    n.rename = function (source,parent,name) { return operation('RENAME',source,report=>{
      need(nodes.has(parent) && FS.isDir(parent.mode), 'ENOTDIR');
      const oldPath = relative(source), newPath = joined(parent,name), oldParent = source.parent;
      need(source !== root && oldPath !== newPath, 'EBUSY'); noOpen(source);
      const moving = subtree(source); need(!moving.includes(parent), 'EINVAL');
      for (const item of moving) {
        const tail = relative(item).slice(oldPath.length), next = newPath+tail;
        need(next.length <= 1024 && next.split('/').length <= maxDepth, 'ENOSPC');
      }
      const target = Object.prototype.hasOwnProperty.call(parent.contents,name) ? parent.contents[name] : null;
      if (target) {
        noOpen(target); need(FS.isDir(target.mode) === FS.isDir(source.mode), 'EINVAL');
        if (FS.isDir(target.mode)) need(Object.keys(target.contents).length === 0, 'ENOTEMPTY');
      }
      need(listing(report,relative(oldParent)).includes(source.name), 'EIO');
      const nativeTarget = listing(report,relative(parent)).includes(name);
      need(nativeTarget === !!target, 'EIO');
      if (FS.isFile(source.mode)) {
        verifyFile(report,source,oldPath); report.stage = 'NATIVE_RENAME'; report.nativeMayHaveChanged = true;
        const receipt = transport.renameFile(oldPath,newPath,'ALLOW_DESTINATION_REPLACEMENT');
        report.nativeReturned = receipt.platformMutationReturned; report.readbackMatches = receipt.readbackMatches;
        if (receipt.status !== 'SUCCESS') throw receipt.cause;
      } else invoke(report,'NATIVE_RENAME','renameSync',[full(oldPath),full(newPath)],true);
      absent(report,relative(oldParent),source.name);
      need(stat(report,newPath).type === (FS.isDir(source.mode)?'dir':'file'),'EIO');
      changing(report,()=>baseNode.rename(source,parent,name));
      // FS.rename, not this node_op, changes source.parent and rehashes source.
      if (target) { state.totalBytes -= target.usedBytes || 0; state.entries--; nodes.delete(target); }
    }); };
    for (const kind of ['unlink','rmdir']) n[kind] = function (parent,name) { return operation(kind.toUpperCase(),parent,report=>{
      need(parent === node); validName(name);
      const child = parent.contents[name]; need(child && nodes.has(child),'ENOENT'); noOpen(child);
      const dir = FS.isDir(child.mode); need(dir === (kind === 'rmdir'),dir?'EISDIR':'ENOTDIR');
      if (dir) need(Object.keys(child.contents).length === 0, 'ENOTEMPTY');
      const path = relative(child), parentPath = relative(parent);
      invoke(report,'NATIVE_DELETE',dir?'rmdirSync':'unlinkSync',dir?[full(path),false]:[full(path)],true);
      absent(report,parentPath,name);
      changing(report,()=>baseNode[kind](parent,name));
      state.totalBytes -= child.usedBytes || 0; state.entries--; nodes.delete(child);
      // FS.unlink/rmdir destroys the hash node after successful node_op.
    }); };
    n.symlink = function () { return operation('SYMLINK',node,()=>fail('ENOTSUP')); };
    function registerStream(stream,kind) {
      try { return operation(kind,node,()=>{
        need(stream.node === node && !handles.has(stream), 'EIO'); handles.add(stream); nodes.get(node).open++;
      }); } catch (error) {
        // Fixed FS.open and dupStream register the fd BEFORE invoking these hooks,
        // and do not remove it on failure. Only remove this exact unaccepted fd.
        if (!handles.has(stream) && FS.getStream(stream.fd) === stream) {
          FS.closeStream(stream.fd); stream.fd = null;
        }
        throw error;
      }
    }
    s.open = function (stream) { return registerStream(stream,'OPEN'); };
    s.dup = function (stream) { return registerStream(stream,'DUP'); };
    s.close = function (stream) { return operation('CLOSE',node,()=>{
      need(handles.has(stream), 'EIO'); handles.delete(stream); nodes.get(node).open--;
    },{close:true}); };
    for (const key of ['read','llseek']) if (typeof s[key] === 'function') {
      const original = s[key]; s[key] = function () { const args=arguments; return operation(key.toUpperCase(),node,()=>original.apply(baseStream,args)); };
    }
    if (FS.isFile(node.mode)) s.write = function (stream,buffer,offset,length,position,canOwn) { return operation('WRITE',node,report=>{
      need(stream.node === node && handles.has(stream), 'EIO');
      need(ArrayBuffer.isView(buffer) && buffer.BYTES_PER_ELEMENT === 1 && Number.isSafeInteger(offset) && Number.isSafeInteger(length)
        && offset >= 0 && length >= 0 && offset+length <= buffer.length && Number.isSafeInteger(position) && position >= 0);
      fileBudget(node, length ? Math.max(node.usedBytes,position+length) : node.usedBytes);
      const oldSize = node.usedBytes, path = relative(node);
      // No borrowed input backing buffer: future caller edits must not silently
      // mutate a supposedly committed file (MEMFS canOwn aliases that buffer).
      const result = changing(report,()=>baseStream.write(stream,buffer,offset,length,position,false));
      persist(report,node,path); state.totalBytes += node.usedBytes-oldSize; return result;
    }); };
    s.fsync = function (stream) { return operation('FSYNC',node,report=>{
      need(stream.node === node && handles.has(stream), 'EIO');
      if (FS.isFile(node.mode)) verifyFile(report,node);
      else { report.verifying = true; need(stat(report,relative(node)).type === 'dir','EIO'); }
      return 0;
    }); };
    s.mmap = function () { return operation('MMAP',node,()=>fail('ENODEV')); };
    s.msync = function () { return operation('MSYNC',node,()=>fail('ENODEV')); };
  }
  const type = {
    mount: function (mount) { return operation('MOUNT',null,report=>{
      need(state.phase === 'NEW', 'EBUSY');
      need(mount && typeof mount.mountpoint === 'string' && mount.mountpoint.startsWith('/')
        && mount.mountpoint !== '/', 'ENOTSUP');
      state.phase = 'RESTORING'; mounted = mount;
      const made = [];
      try {
        slot = FS.lookupPath(mount.mountpoint,{follow_mount:false}).node;
        need(slot && FS.isDir(slot.mode) && !slot.mounted, 'EBUSY');
        const snapshot = inventory(report), map = new Map();
        root = MEMFS.mount(mount); made.push(root); root.mount = mount; install(root); map.set('',root);
        for (const entry of snapshot.entries) {
          const slash = entry.path.lastIndexOf('/'), name = entry.path.slice(slash+1), parent = map.get(slash<0?'':entry.path.slice(0,slash));
          need(parent,'EIO');
          const child = MEMFS.createNode(parent,name,(entry.type==='dir'?C.S_IFDIR:C.S_IFREG)|0o700,0);
          made.push(child); install(child); map.set(entry.path,child);
          if (entry.type === 'file') { child.contents = new Uint8Array(entry.data); child.usedBytes = entry.data.length; }
        }
        state.entries = snapshot.entries.length; state.totalBytes = snapshot.total; state.phase = 'READY'; return root;
      } catch (error) {
        // Unpublished restored nodes are nevertheless in FS.nameTable.
        for (let i=made.length-1;i>=0;i--) FS.destroyNode(made[i]);
        nodes.clear(); root = null; state.phase = 'MOUNT_FAILED'; throw error;
      }
    },{mount:true}); },
    syncfs: function (mount,populate,callback) {
      let error = null;
      try { operation('SYNCFS',root,report=>{
        need(mount === mounted, 'EINVAL'); need(populate === false, 'ENOTSUP');
        report.verifying = true;
        const observed = inventory(report), expected = new Map();
        for (const node of nodes.keys()) if (node !== root) expected.set(relative(node),node);
        need(expected.size === observed.entries.length,'EIO');
        for (const entry of observed.entries) {
          const node = expected.get(entry.path); need(node,'EIO');
          need(FS.isDir(node.mode) === (entry.type === 'dir'),'EIO');
          if (entry.type === 'file') need(sameBytes(entry.data,fileBytes(node)),'EIO');
        }
        report.readbackMatches = true;
      }); } catch (cause) { error = cause; }
      // Deliberately outside catch: a throwing caller callback is not called twice.
      callback(error);
    }
  };
  function verifyFiles(expected, generation) { return operation('VERIFY_FILES',root,report=>{
    need(Number.isSafeInteger(generation) && generation >= 0 && generation === state.generation, 'EBUSY');
    need(Array.isArray(expected) && expected.length > 0 && expected.length <= 64, 'EINVAL');
    const targets = [], seen = new Set(); let total = 0;
    for (const item of expected) {
      need(item && typeof item.relativePath === 'string' && item.relativePath.length <= 1024, 'EINVAL');
      const path = item.relativePath, names = path.split('/'); names.forEach(validName);
      need(names.length <= maxDepth && !seen.has(path),'EINVAL'); seen.add(path);
      let node = root;
      for (const name of names) {
        need(FS.isDir(node.mode) && !node.mounted, 'ENOTDIR');
        need(Object.prototype.hasOwnProperty.call(node.contents,name), 'ENOENT'); node = node.contents[name];
      }
      need(nodes.has(node) && node.mount === mounted && !node.mounted && FS.isFile(node.mode),'EINVAL');
      const value = item.bytes;
      let expectedBytes;
      try {
        const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
        const fullLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(buffer);
        const offset = ArrayBuffer.isView(value) ? value.byteOffset : 0;
        const length = ArrayBuffer.isView(value) ? value.byteLength : fullLength;
        need(length <= maxFile && total+length <= maxTotal,'EFBIG');
        expectedBytes = new Uint8Array(new Uint8Array(buffer,offset,length));
      } catch (cause) { if (codes.has(cause)) throw cause; fail('EINVAL'); }
      total += expectedBytes.length; targets.push({node,path,expected:expectedBytes});
    }
    const files = [];
    for (const target of targets) {
      report.verifying = true;
      const memory = fileBytes(target.node), nativeBytes = getRead(report,target.path);
      const matches = sameBytes(memory,nativeBytes);
      need(matches,'EIO'); // Native/memory disagreement quarantines this mount.
      files.push(Object.freeze({expectedBytes:target.expected.length,memoryBytes:memory.length,
        nativeBytes:nativeBytes.length,memoryNativeMatch:matches,
        expectedContentMatch:sameBytes(target.expected,nativeBytes)}));
    }
    need(state.generation === generation,'EBUSY');
    report.readbackMatches = true;
    return Object.freeze({generationBefore:generation,generationAfter:state.generation,
      files:Object.freeze(files),allExpectedMatch:files.every(file=>file.expectedContentMatch)});
  }); }
  return Object.freeze({type:Object.freeze(type), verifyFiles, inspect:function () {
    return Object.freeze({schema:'wxslim-persistent-memfs-v1', phase:state.phase,entries:state.entries,
      totalBytes:state.totalBytes,openHandles:handles.size,generation:state.generation,
      events:Object.freeze(state.events.slice()),droppedEvents:state.droppedEvents,lastFailure:state.lastFailure,
      metadata:'MEMORY_ONLY',writeback:'SYNCHRONOUS_WRITE_AND_READBACK',devicePersistence:'NOT_TESTED'});
  }});
}
if (typeof module === 'object' && module.exports) module.exports = createPersistentMemfs;
}());
