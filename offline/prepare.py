"""Prepare the locked Windows tools and source objects from one offline checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import shutil
import stat
import subprocess
import sys
import zipfile

OFFLINE = Path(__file__).resolve().parent
PYTHON = 'python-3.14.0'
SOURCE_PACKS = {
    'c050': ('c050c09b105c3715e1caa57a7109cd752047fd89', 'd4e5a39168f7a49bf54a67fafa6ad2ae58b44c1d'),
    'df3': ('df3cdd9bc9941a20cb5575d781cde6f937637bcb', 'a465e77ddd3bb290a6749b57e6d75e75a2c866ea'),
}

def load(file):
    return json.loads(file.read_bytes())

def target(root, name):
    parts = name.split('/')
    if PureWindowsPath(name).anchor or any(
            part in ('', '.', '..') or part.rstrip(' .') != part or
            '\\' in part or ':' in part or os.path.isreserved(part) for part in parts):
        raise ValueError(f'Invalid input path {name}')
    file = root.joinpath(*parts)
    if file.resolve() != file:
        raise ValueError(f'Expected an ordinary path at {file}')
    return file

def identity(file):
    with file.open('rb') as src:
        return {'bytes': os.fstat(src.fileno()).st_size, 'sha256': hashlib.file_digest(src,'sha256').hexdigest()}

def verify(file, spec):
    if identity(file) != {key:spec[key] for key in ('bytes','sha256')}:
        raise ValueError(f'File differs from its lock: {file}')

def expand(archive, output, *, check_existing=False):
    names = set()
    if not check_existing:
        output.mkdir()
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            if entry.is_dir():
                continue
            file = target(output,entry.filename)
            if file in names or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f'Unexpected archive entry {entry.filename}')
            names.add(file)
            with package.open(entry) as data:
                if check_existing:
                    if file.stat().st_size != entry.file_size or identity(file)['sha256'] != hashlib.file_digest(data,'sha256').hexdigest():
                        raise ValueError(f'Bootstrap file differs: {entry.filename}')
                else:
                    file.parent.mkdir(parents=True,exist_ok=True)
                    with file.open('xb') as dest:
                        shutil.copyfileobj(data,dest)
    if check_existing and names != {p for p in output.rglob('*') if p.is_file()}:
        raise ValueError('Unexpected files in the bootstrap interpreter')

def prepare(directory, bootstrapped):
    if sys.platform != 'win32':
        raise ValueError('This toolchain targets Windows x64')
    state = Path(os.path.abspath(directory))
    if state.resolve() != state or state.is_relative_to(OFFLINE.parent) or OFFLINE.parent.is_relative_to(state):
        raise ValueError('Choose an ordinary output directory separate from the source')
    if state.exists():
        bootstrap_files = {state/PYTHON, state/'bootstrap-hash.txt'}
        if not bootstrapped or set(state.iterdir()) != bootstrap_files or Path(sys.executable).resolve() != state/PYTHON/'python.exe':
            raise FileExistsError('A fresh output directory is required')
    else:
        if bootstrapped:
            raise ValueError('Extract the verified bootstrap interpreter first')
        state.mkdir()
    inputs = load(OFFLINE/'inputs.json')['files']
    platforms = load(OFFLINE/'platform/platform.json')
    for name, spec in inputs.items():
        verify(target(OFFLINE,name),spec)
    for name, spec in platforms.items():
        source = target(OFFLINE/'platform',name)
        verify(source,spec)
        output = state/source.stem
        expand(source,output,check_existing=bootstrapped and source.stem == PYTHON)
    node = state/'node.exe'
    with zipfile.ZipFile(OFFLINE/'downloads/node-v24.18.0-win-x64.zip') as archive:
        with archive.open('node-v24.18.0-win-x64/node.exe') as src, node.open('xb') as dest:
            shutil.copyfileobj(src,dest)
    python = state/PYTHON/'python.exe'
    git = state/'git-windows/mingw64/bin/git.exe'
    prepare_test_sources(state,python,git)
    subprocess.run([node,OFFLINE/'prepare-editor.mjs',state],check=True,cwd=state,creationflags=subprocess.CREATE_NO_WINDOW)
    print(f'Offline tools and verified source objects are ready in {state}')


def prepare_test_sources(state,python,git):
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='NUL',PYTHONDONTWRITEBYTECODE='1')
    def run(*args):
        subprocess.run(args,check=True,cwd=state,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
    run(python,'-I','-B','-m','venv','--without-pip',state/'venv')
    for name,(commit,pack_id) in SOURCE_PACKS.items():
        repo = state/(name+'.git')
        run(git,'init','--bare','--initial-branch=main',repo)
        pack = repo/'objects/pack'/('pack-'+pack_id+'.pack')
        with (OFFLINE/'upstream'/(name+'.pack')).open('rb') as src, pack.open('xb') as dest:
            shutil.copyfileobj(src,dest)
        run(git,'-C',repo,'index-pack',pack)
        (repo/'shallow').write_bytes((commit+'\n').encode('ascii'))
        run(git,'-C',repo,'update-ref','refs/heads/main',commit)
        run(git,'-C',repo,'fsck','--full','--strict')
    request = {'gitExecutable':str(git),'upstreamSource':str(OFFLINE/'upstream/library_godot_memfs.js')}
    with (state/'source-request.json').open('x',encoding='utf-8') as out:
        json.dump(request,out)


def prepare_local_tests(directory, git, node):
    state = directory.absolute()
    git, node, python = [p.resolve(strict=True) for p in (git,node,Path(sys.executable))]
    if (sys.platform != 'win32' or sys.version_info[:3] != (3,14,0) or state.resolve() != state
            or state.is_relative_to(OFFLINE.parent) or OFFLINE.parent.is_relative_to(state)):
        raise ValueError('Use Windows Python 3.14.0 and a new ordinary directory outside the source')
    if subprocess.check_output([node,'--version'],text=True).strip() != 'v24.18.0':
        raise ValueError('Use Node 24.18.0')
    inputs = load(OFFLINE/'inputs.json')['files']
    for name,spec in inputs.items():
        if name.startswith(('vendor/','upstream/','fixtures/')):
            verify(target(OFFLINE,name),spec)
    state.mkdir()
    prepare_test_sources(state,python,git)
    with (state/'test-tools.json').open('x',encoding='utf-8') as out:
        json.dump({'node':str(node),'git':str(git)},out)
    print(f'Local regression inputs ready in {state}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--bootstrapped',action='store_true')
    parser.add_argument('--local-test-tools',nargs=2,metavar=('GIT_EXE','NODE_EXE'),type=Path)
    args = parser.parse_args()
    if args.local_test_tools:
        if args.bootstrapped:
            parser.error('Choose one preparation mode')
        prepare_local_tests(args.directory,*args.local_test_tools)
    else:
        prepare(args.directory,args.bootstrapped)
