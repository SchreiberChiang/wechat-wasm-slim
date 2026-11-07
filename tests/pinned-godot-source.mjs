import {execFileSync} from 'node:child_process';

// The callers separately verify each blob's pinned length and digest.
export async function readOfficialSource(commit, name) {
  if (process.env.WXSLIM_C050_GIT) {
    return execFileSync(process.env.WXSLIM_PINNED_GIT_EXE || 'git', [
      '--no-replace-objects', '-C', process.env.WXSLIM_C050_GIT, 'cat-file', 'blob', commit + ':' + name,
    ], {windowsHide:true});
  }
  const response = await fetch('https://raw.githubusercontent.com/godotengine/godot/' + commit + '/' + name,
    {redirect:'error', signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('OFFICIAL_SOURCE_HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
