"""Restore the reviewed original pair evidence into a new, independent directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import shutil
import tempfile
import zipfile

def destination(root, name):
    path = PureWindowsPath(name)
    parts = name.split('/')
    if path.drive or path.root or any(part in ('', '.', '..') or ':' in part or
                                     '\\' in part or part.endswith((' ', '.')) or
                                     os.path.isreserved(part) for part in parts):
        raise ValueError(f'Invalid evidence path: {name}')
    return root.joinpath(*parts)

def restore(out):
    archive = Path(__file__).resolve().parent / 'proof/paired-evidence.zip'
    pin = json.loads(archive.with_name('pack.json').read_text(encoding='utf8'))
    with archive.open('rb') as f:
        if archive.stat().st_size != pin['bytes'] or hashlib.file_digest(f,'sha256').hexdigest() != pin['sha256']:
            raise ValueError('Evidence archive checksum differs')
    if out.exists() or out.is_symlink() or out.parent.resolve() != out.parent or not out.parent.is_dir():
        raise ValueError('Choose a new destination under an existing ordinary directory')
    with zipfile.ZipFile(archive) as z:
        index = json.loads(z.read('manifest.json'))
        if len(index['files']) != pin['files'] or sum(size for _,size,_ in index['files']) != pin['logicalBytes']:
            raise ValueError('Evidence manifest totals differ')
        if shutil.disk_usage(out.parent).free < pin['logicalBytes'] + 512 * 2**20:
            raise OSError('Insufficient space to restore the evidence')
        stage = Path(tempfile.mkdtemp(prefix=out.name+'-partial-',dir=out.parent))
        for name in index['directories']:
            destination(stage,name).mkdir(parents=True,exist_ok=True)
        for name,size,digest in index['files']:
            file = destination(stage,name)
            file.parent.mkdir(parents=True,exist_ok=True)
            with z.open(digest) as inp, file.open('xb') as dest:
                shutil.copyfileobj(inp, dest)
            with file.open('rb') as f:
                if file.stat().st_size != size or hashlib.file_digest(f,'sha256').hexdigest() != digest:
                    raise ValueError('Restored file differs: '+name)
        stage.rename(out)
    return {'files':pin['files'],'bytes':pin['logicalBytes'],'directory':str(out)}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path)
    print(json.dumps(restore(parser.parse_args().destination.absolute())))
