"""Fixed SDK acquisition. Explicit --execute, no global install or old cache copy."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import time
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RECIPE = json.loads((HERE / 'delivery-recipe.json').read_text(encoding='utf-8'))
ARCHIVES = [
    dict(name='node-v24.18.0-win-x64.zip',
         url='https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip',
         sha256='0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821', prefix='node-v24.18.0-win-x64/', target='tools/driver-node'),
    dict(name='emscripten-4.0.10-wasm-binaries.zip',
         url='https://storage.googleapis.com/webassembly/emscripten-releases-builds/win/8103ffedfb0c42d231c6af6859a5a1a832260b43/wasm-binaries.zip',
         sha256='1a66825e85fda039f57d39c98ae2bdb96a18e53745159e9599f69679be18439f', prefix='install/', target='tools/emsdk/upstream'),
    dict(name='node-v24.19.0-win-x64.zip',
         url='https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip',
         sha256='57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73', prefix='node-v24.19.0-win-x64/', target='tools/emsdk/node/24.19.0_64bit'),
    dict(name='python-3.13.3-0-win-amd64.zip',
         url='https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/python-3.13.3-0-win-amd64.zip',
         sha256='6fe7a540c6b8b185780467cf7495e884ee62316ec4abb19e1c735b8a77c62465', prefix='', target='tools/emsdk/python/3.13.3_64bit'),
]
INSTALL_METADATA = [
    ('emsdk-4.0.10.py', 'https://raw.githubusercontent.com/emscripten-core/emsdk/4.0.10/emsdk.py',
     '07ca12876cbc49283c4b2d441b0ebe8a741c31c5f776abe59c9f3f7364b4524b'),
    ('emsdk-4.0.10-tags.json', 'https://raw.githubusercontent.com/emscripten-core/emsdk/4.0.10/emscripten-releases-tags.json',
     '70c566d0212d79f041d18a3841c1eee521953f42cc60fc4c90bfe1ad74736f78'),
]


def sha(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def config_bytes(frozen=True):
    return ("import os\n"
            "emsdk_path = os.path.dirname(os.getenv('EM_CONFIG')).replace('\\\\', '/')\n"
            "NODE_JS = emsdk_path + '/node/24.19.0_64bit/node.exe'\n"
            "PYTHON = emsdk_path + '/python/3.13.3_64bit/python.exe'\n"
            "LLVM_ROOT = emsdk_path + '/upstream/bin'\n"
            "BINARYEN_ROOT = emsdk_path + '/upstream'\n"
            "EMSCRIPTEN_ROOT = emsdk_path + '/upstream/emscripten'\n"
            f"FROZEN_CACHE = {frozen}").encode('utf-8')


def install_archive(root, spec):
    archive = root / 'downloads' / spec['name']
    if not archive.exists():
        with open(root / 'logs' / (spec['name'] + '.download.log'), 'wb') as log:
            subprocess.run(['curl.exe', '-fL', '--connect-timeout', '20', '--max-time', '1200', spec['url'], '-o', str(archive)],
                           stdout=log, stderr=log, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    if sha(archive) != spec['sha256']:
        raise RuntimeError('Archive mismatch; preserve, do not overwrite: ' + spec['name'])
    target = root / spec['target']
    verified = 0
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if not info.filename.startswith(spec['prefix']):
                raise RuntimeError('Unexpected archive prefix')
            rel = PurePosixPath(info.filename[len(spec['prefix']):])
            if '..' in rel.parts or rel.is_absolute() or ':' in str(rel) or ((info.external_attr >> 16) & 0o170000) == 0o120000:
                raise RuntimeError('Unsafe archive member')
            dest = target.joinpath(*rel.parts)
            if info.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            # A prior partial download/extraction can only be reused byte-for-byte.
            # Never patch an existing SDK file or import an old project's cache.
            with z.open(info) as src:
                if dest.exists():
                    digest = hashlib.file_digest(src, 'sha256').hexdigest()
                    if sha(dest) != digest:
                        installed_version = (str(rel) == 'emscripten/emscripten-version.txt'
                                             and digest == '0155f2fbb8025df1ab9e00649e6e1b1cf521c2b5861b74a94b6f6703098e750e'
                                             and dest.read_bytes() == b'"4.0.10"\r\n')
                        if not installed_version:
                            raise RuntimeError('Existing SDK member differs: ' + str(rel))
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with open(dest, 'xb') as sink:
                        while chunk := src.read(1024 * 1024):
                            sink.write(chunk)
            verified += 1
    return dict(**spec, bytes=archive.stat().st_size, verifiedFiles=verified)


def execute(root, base_python):
    if not root.is_absolute() or not root.is_dir():
        raise RuntimeError('Use the explicitly approved existing root')
    if sha(base_python) != RECIPE['toolchain']['pythonBaseSha256']:
        raise RuntimeError('Build Python base mismatch')
    version = subprocess.check_output([str(base_python), '-c', 'import platform;print(platform.python_version())'], text=True).strip()
    if version != '3.14.0':
        raise RuntimeError('Build Python must be 3.14.0')
    for name in ['downloads', 'logs', 'tools', 'tools/temp']:
        (root / name).mkdir(parents=True, exist_ok=True)
    receipt = root / 'TOOLCHAIN_ACQUISITION.json'
    if receipt.exists():
        raise RuntimeError('Completed receipt exists; use read-only delivery check, not reinstall')
    started = time.monotonic()
    acquired = [install_archive(root, spec) for spec in ARCHIVES]
    host = RECIPE['host']['archive']
    host_path = root / 'downloads' / host['name']
    if not host_path.exists():
        with open(root / 'logs/host-archive-download.log', 'wb') as log:
            subprocess.run(['curl.exe', '-fL', '--connect-timeout', '20', '--max-time', '1200',
                            host['url'], '-o', str(host_path)], stdout=log, stderr=log, check=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
    if host_path.stat().st_size != host['bytes'] or sha(host_path) != host['sha256']:
        raise RuntimeError('Host archive mismatch; preserve it, do not substitute another release')
    if sha(root / 'tools/driver-node/node.exe') != RECIPE['toolchain']['driverNode']['sha256']:
        raise RuntimeError('Installed driver Node mismatch')
    sdk = root / 'tools/emsdk'
    # emsdk 4.0.10 install(), lines 1884-1892, writes the mapped release
    # version using Windows text mode. This is an installation step, not a
    # changed compiler or a relaxed fingerprint. Preserve both source inputs.
    for name, url, expected in INSTALL_METADATA:
        target = root / 'downloads' / name
        if not target.exists():
            subprocess.run(['curl.exe', '-fL', '--connect-timeout', '20', '--max-time', '120', url, '-o', str(target)],
                           check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if sha(target) != expected:
            raise RuntimeError('Official installation metadata mismatch: ' + name)
    tags = json.loads((root / 'downloads/emsdk-4.0.10-tags.json').read_text())
    if tags['releases']['4.0.10'] != '8103ffedfb0c42d231c6af6859a5a1a832260b43':
        raise RuntimeError('Official release archive mapping changed')
    version_file = sdk / 'upstream/emscripten/emscripten-version.txt'
    previous = version_file.read_bytes()
    if previous not in (b'4.0.10-git\n', b'"4.0.10"\r\n'):
        raise RuntimeError('Unexpected version source bytes')
    version_file.write_bytes(b'"4.0.10"\r\n')
    version_install = dict(source='emsdk 4.0.10 install(), lines 1884-1892',
                           archiveSha256='0155f2fbb8025df1ab9e00649e6e1b1cf521c2b5861b74a94b6f6703098e750e',
                           installedSha256=sha(version_file))
    config = sdk / '.emscripten'
    content = config_bytes()
    expected = next(x['sha256'] for x in RECIPE['toolchain']['sdkFiles'] if x['path'] == '.emscripten')
    if hashlib.sha256(content).hexdigest() != expected:
        raise RuntimeError('Portable config template differs from fixed recipe')
    if config.exists() and config.read_bytes() != content:
        raise RuntimeError('Existing .emscripten differs; preserve it')
    if not config.exists():
        config.write_bytes(content)
    for item in RECIPE['toolchain']['sdkFiles']:
        if sha(sdk / item['path']) != item['sha256']:
            raise RuntimeError('Installed fixed input differs: ' + item['path'])
    venv = root / 'tools/venv'
    if venv.exists():
        raise RuntimeError('Existing venv without completed receipt; inspect rather than overwrite')
    env = dict(os.environ, TEMP=str(root / 'tools/temp'), TMP=str(root / 'tools/temp'),
               PIP_CACHE_DIR=str(root / 'tools/pip-cache'), PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
    for key in ['PYTHONPATH', 'PYTHONHOME', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL']:
        env.pop(key, None)
    def run(name, args):
        with open(root / 'logs' / (name + '.log'), 'wb') as output:
            subprocess.run(list(map(str, args)), env=env, stdout=output, stderr=output, check=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
    run('create-venv', [base_python, '-m', 'venv', venv])
    python = venv / 'Scripts/python.exe'
    lock = REPO / 'engine/requirements-scons.lock'
    run('scons-download', [python, '-m', 'pip', '--isolated', 'download', '--index-url', 'https://pypi.org/simple',
                           '--only-binary=:all:', '--no-deps', '--require-hashes', '-r', lock, '-d', root / 'downloads'])
    run('scons-install', [python, '-m', 'pip', '--isolated', 'install', '--no-index', '--no-deps', '--require-hashes',
                          '--find-links', root / 'downloads', '-r', lock])
    with open(receipt, 'x', encoding='utf-8', newline='\n') as out:
        json.dump(dict(schema='simple-delivery-acquisition-v1', archives=acquired,
                       hostArchive=dict(name=host['name'], sha256=sha(host_path)), pythonVersion=version,
                       versionInstall=version_install, installationMetadata=INSTALL_METADATA,
                       pythonBaseSha256=sha(base_python), basePythonSharedReadOnly=True,
                       cache='OFFICIAL_ARCHIVE_ONLY; ThinLTO cache not yet prepared', seconds=time.monotonic()-started,
                       engineBuilt=False, runtimeAccepted=False), out, indent=2)
        out.write('\n')
    print(json.dumps({'status': 'DEPENDENCIES_ACQUIRED', 'seconds': time.monotonic()-started, 'cacheReady': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--base-python', required=True, type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if args.execute:
        execute(args.root, args.base_python)
    else:
        print(json.dumps({'archives': ARCHIVES, 'hostArchive': RECIPE['host']['archive'], 'venv': str(args.root / 'tools/venv'),
                          'writes': 'approved root only, base Python read-only', 'execution': 'NOT_RUN'}, indent=2))
