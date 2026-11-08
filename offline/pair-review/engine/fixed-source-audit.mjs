// Read-only replay against pinned Git blobs. Never applies a patch to a checkout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const lf = bytes => {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (Buffer.isBuffer(bytes)) assert(Buffer.from(text).equals(bytes), 'source must be valid UTF-8');
  return text.replaceAll('\r\n', '\n');
};
const identity = bytes => ({bytes:bytes.length, sha256:sha(bytes)});
function safeName(name) {
  assert(name && !name.includes('\\') && !path.posix.isAbsolute(name) && !name.split('/').some(x => !x || x === '.' || x === '..') && !name.includes(':'), 'unsafe patch path');
  return name;
}

/** Strict subset used by the fixed five patches: ordinary UTF-8, LF EOF, no fuzz/renames/deletions. */
export function replayUnifiedPatch(bytes, readBase, files = new Map()) {
  const text = lf(bytes);
  assert(text.startsWith('diff --git ') && text.endsWith('\n'), 'ordinary unified patch required');
  for (const section of text.split(/(?=^diff --git )/m).filter(Boolean)) {
    const lines = section.split('\n'), head = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0]);
    assert(head && head[1] === head[2], 'renamed or unexpected patch header');
    const name = safeName(head[1]), addedFile = lines.includes('--- /dev/null');
    assert(!lines.includes('+++ /dev/null'), 'file deletion not supported');
    assert(lines.includes('+++ b/' + name) && lines.includes(addedFile ? '--- /dev/null' : '--- a/' + name), 'patch file headers mismatch');
    assert(!lines.some(x => /^\\ No newline|^(old|new) mode |^deleted file mode |^GIT binary patch/.test(x)), 'unsupported patch operation');
    if (addedFile) assert(lines.includes('new file mode 100644'), 'only regular new source files supported');
    if (!files.has(name)) {
      const base = readBase(name); // null means absent in the pinned tree.
      assert.equal(base === null, addedFile, 'base existence differs: ' + name);
      const original = base === null ? '' : lf(base);
      assert(!original || original.endsWith('\n'), 'base without final newline unsupported');
      files.set(name, {text:original, added:addedFile});
    } else assert(!addedFile, 'duplicate new file');
    const previous = files.get(name), old = previous.text ? previous.text.split('\n') : [];
    if (previous.text.endsWith('\n')) old.pop();
    let cursor = 0, hunks = 0; const out = [];
    for (let i = 1; i < lines.length; i++) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[i]);
      if (!h) {
        assert(!lines[i].startsWith('@@'), 'malformed hunk');
        assert(/^(?:index |new file mode 100644$|--- |\+\+\+ |$)/.test(lines[i]), 'unexpected patch line');
        continue;
      }
      hunks++;
      const start = Math.max(0, Number(h[1]) - 1);
      assert(start >= cursor && start <= old.length, 'overlapping/out-of-range hunk');
      out.push(...old.slice(cursor,start)); cursor = start;
      assert.equal(out.length,Math.max(0,Number(h[3])-1),'new hunk location mismatch');
      let removed = 0, added = 0;
      while (i + 1 < lines.length && /^[ +\-]/.test(lines[i+1])) {
        const row = lines[++i];
        if (row[0] !== '+') { assert.equal(old[cursor++],row.slice(1),'patch context mismatch: ' + name); removed++; }
        if (row[0] !== '-') { out.push(row.slice(1)); added++; }
      }
      assert.equal(removed,Number(h[2] ?? 1),'old hunk count mismatch');
      assert.equal(added,Number(h[4] ?? 1),'new hunk count mismatch');
    }
    assert(hunks > 0,'patch section must contain a hunk');
    out.push(...old.slice(cursor));
    files.set(name,{text:out.length ? out.join('\n') + '\n' : '',added:previous.added});
  }
  return files;
}

function regular(file) {
  assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),'regular source file required: ' + file);
  return fs.readFileSync(file);
}
export function auditFixedSource({source, recipePath = path.join(repo,'engine/alpha-preserve-lighting/delivery-recipe.json'), repositoryRoot = repo}) {
  assert(source && path.isAbsolute(source),'absolute existing source checkout required');
  const git = args => execFileSync('git',['--no-optional-locks','--no-replace-objects','-c','diff.autoRefreshIndex=false','-c','core.quotePath=false','-C',source,...(args[0]==='diff'?[args[0],'--no-textconv',...args.slice(1)]:args)],{windowsHide:true,maxBuffer:32*1024*1024});
  const names = args => git(args).toString('utf8').split('\0').filter(Boolean).sort();
  assert.equal(path.resolve(git(['rev-parse','--show-toplevel']).toString().trim()).toLowerCase(),path.resolve(source).toLowerCase(),'source must be checkout root');
  const recipeBytes = regular(recipePath), recipe = JSON.parse(recipeBytes), sourceCommit = git(['rev-parse','HEAD']).toString().trim();
  assert(/^[0-9a-f]{40}$/.test(recipe.engine.source.commit),'full source commit required');
  assert.equal(sourceCommit,recipe.engine.source.commit,'source HEAD differs from fixed recipe');
  const indexFlags = git(['ls-files','-v','-z']).toString('utf8').split('\0').filter(Boolean);
  assert(indexFlags.every(entry=>entry.startsWith('H ')),'nonstandard tracked index state (assume-unchanged, skip-worktree or conflict) is not allowed');
  assert.equal(recipe.engine.patches.length,4,'four source patches required');
  assert.deepEqual(recipe.engine.patches.map(x=>x.order),[1,2,3,4],'fixed patch order required');
  const files = new Map(), patches = [];
  for (const patch of [...recipe.engine.patches,recipe.engine.windowsLinkPatch]) {
    safeName(patch.path);
    const bytes = regular(path.join(repositoryRoot,patch.path));
    assert.equal(sha(bytes),patch.sha256,'patch fingerprint mismatch: ' + patch.path);
    replayUnifiedPatch(bytes,name=>{
      const exists = git(['ls-tree','--name-only',sourceCommit,'--',name]).toString().trim();
      return exists ? git(['show',`${sourceCommit}:${name}`]) : null;
    },files);
    patches.push({path:patch.path,...identity(bytes)});
  }
  const expectedTracked = [...files].filter(([,f])=>!f.added).map(([n])=>n).sort();
  const expectedUntracked = [...files].filter(([,f])=>f.added).map(([n])=>n).sort();
  const changed = names(['diff','--no-ext-diff','--no-renames','--name-only','-z','HEAD','--','.']);
  const untracked = names(['ls-files','--others','--exclude-standard','-z']);
  assert.deepEqual(changed,expectedTracked,'unexpected tracked changes or missing patch edits');
  // No extension filter: .cjs and extensionless SCons inputs must not escape this check.
  assert.deepEqual(untracked,expectedUntracked,'unexpected nonignored/untracked files or missing patch sources');
  const trackedDiff = git(['diff','--no-ext-diff','--binary','HEAD','--','.']);
  const stagedDiff = git(['diff','--cached','--no-ext-diff','--binary','HEAD','--','.']);
  assert.equal(git(['diff','--no-ext-diff','--summary','HEAD','--','.']).length,0,'unexpected file mode/type changes');
  const staged = names(['diff','--cached','--no-ext-diff','--name-only','-z','HEAD','--','.']);
  assert(staged.every(n=>expectedTracked.includes(n)),'unexpected staged changes');
  const actualFiles = [...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,expected])=>{
    const actual = regular(path.join(source,name)), normalized = Buffer.from(lf(actual));
    assert.equal(normalized.toString(),expected.text,'patched source differs from strict replay: ' + name);
    return {path:name,kind:expected.added?'untracked':'tracked',raw:identity(actual),lf:identity(normalized),expectedLf:identity(Buffer.from(expected.text))};
  });
  assert.equal(git(['rev-parse','HEAD']).toString().trim(),sourceCommit,'HEAD changed during source audit');
  assert(git(['diff','--no-ext-diff','--binary','HEAD','--','.']).equals(trackedDiff),'tracked source changed during source audit');
  assert(git(['diff','--cached','--no-ext-diff','--binary','HEAD','--','.']).equals(stagedDiff),'staged source changed during source audit');
  assert.deepEqual(names(['ls-files','--others','--exclude-standard','-z']),untracked,'untracked set changed during source audit');
  for(const file of actualFiles) assert.deepEqual(identity(regular(path.join(source,file.path))),file.raw,'source bytes changed during source audit');
  return {status:'PASS_SOURCE_ONLY',sourceCommit,recipe:identity(recipeBytes),patches,files:actualFiles,
    tracked:{paths:changed,diff:identity(trackedDiff),stagedPaths:staged,stagedDiff:identity(stagedDiff)},
    untracked:{paths:untracked,files:actualFiles.filter(f=>f.kind==='untracked')},
    limitations:['Read-only Git HEAD/diffs and exact patch-touched UTF-8 source replay; raw and LF identities are separate.',
      'Ignored/generated files and ignored directories are not traversed or audited; no whole-build-tree or generated-source integrity claim.',
      'Nonignored untracked files are rejected without extension filtering; assume-unchanged/skip-worktree/conflicted index entries are refused.',
      'No compiler, engine, WASM or device execution; no runtime, ABI, visual or reproducible-build acceptance.']};
}

export function assertSourceEvidenceUnchanged(before, after) {
  assert.equal(before?.status,'PASS_SOURCE_ONLY'); assert.equal(after?.status,'PASS_SOURCE_ONLY');
  assert.deepEqual(after,before,'fixed source evidence changed during build');
  return true;
}
