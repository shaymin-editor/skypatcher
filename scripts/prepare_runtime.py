"""Fetch hash-locked upstream packages and prepare browser assets. No ROM data."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import ssl
import urllib.request
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.runtime-cache'
OUT = ROOT / 'public/runtime'
try:
    import certifi
except ImportError:
    certifi = None


def fetch(url: str) -> bytes:
    context = ssl.create_default_context(cafile=certifi.where() if certifi else None)
    with urllib.request.urlopen(url, timeout=120, context=context) as response:
        return response.read()


def prepare() -> None:
    CACHE.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / 'runtime.lock.json').read_text())
    with ZipFile(OUT / 'python.zip', 'w', ZIP_DEFLATED) as bundle:
        for artifact in lock['python']:
            path = CACHE / artifact['filename']
            if not path.exists():
                print('Downloading', artifact['filename'], flush=True)
                path.write_bytes(fetch(artifact['url']))
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != artifact['sha256']:
                raise RuntimeError(f"Hash mismatch: {path.name}; remove the cached artifact and retry.")

            with ZipFile(io.BytesIO(data)) as wheel:
                for name in sorted(wheel.namelist()):
                    if name.endswith(('/', '.so', '.pyd', '.dylib')):
                        continue
                    if name.startswith('/') or '..' in Path(name).parts:
                        raise RuntimeError('Unsafe upstream archive path')
                    contents = wheel.read(name)
                    if name == 'skytemple_files/_resources/ppmdu_config/pmd2data.xml':
                        # Fix for broken "TeamStatsPain" patch (#1)
                        source = contents.decode('utf-8')
                        incorrect_path = '<OpenBin filepath="overlay_0010.bin">'
                        if source.count(incorrect_path) != 1:
                            raise RuntimeError('Review the TeamStatsPain overlay path fix.')
                        contents = source.replace(incorrect_path, '<OpenBin filepath="overlay/overlay_0010.bin">').encode('utf-8')
                    if name == 'skytemple_files/_resources/patches/asm_patches/chesyon_asm_mods/team_stats_pain/selector_overlay10.asm':
                        # Fix for broken "TeamStatsPain" patch (#2)
                        source = contents.decode('utf-8')
                        if source.count('common/pain_overlay10.asm') != 3:
                            raise RuntimeError('Review the TeamStatsPain include filenames.')
                        contents = source.replace('common/pain_overlay10.asm', 'common/pain_ov10.asm').encode('utf-8')
                    if name == 'skytemple_files/patch/handler/expand_poke_list.py':
                        # Out of memory fix for ExpandPokeList
                        source = contents.decode('utf-8')
                        loop = 'for new_moveset in waza_p_model.learnsets:'
                        if source.count(loop) != 2:
                            raise RuntimeError('Review the ExpandPokeList Python compatibility fix.')
                        contents = source.replace(loop, 'for new_moveset in list(waza_p_model.learnsets):').encode('utf-8')
                    bundle.writestr(name, contents)

    # Hacks to get SkyTemple's synchronous Popen call to invoke armips in memory
    armips = ROOT / 'node_modules/armips'
    source = (armips / 'index.js').read_text()
    marker = 'preInit();run();moduleRtn=readyPromise;'
    if source.count(marker) != 1:
        raise RuntimeError('ARMIPS wrapper changed; review its callMain export.')
    source = source.replace(marker, 'Module["callMain"]=callMain;' + marker)
    (OUT / 'armips.mjs').write_text(source)
    shutil.copyfile(armips / 'armips.wasm', OUT / 'armips.wasm')
    shutil.copyfile(ROOT / 'runtime.lock.json', OUT / 'runtime.lock.json')
    pyodide = ROOT / 'node_modules/pyodide'
    browser_python = OUT / 'pyodide'
    browser_python.mkdir(exist_ok=True)
    for name in ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']:
        shutil.copyfile(pyodide / name, browser_python / name)
    packages = json.loads((pyodide / 'pyodide-lock.json').read_text())['packages']
    pending = ['pillow', 'igraph']
    done = set()
    while pending:
        name = pending.pop()
        if name in done:
            continue
        done.add(name)
        package = packages[name]
        pending.extend(package['depends'])
        filename = package['file_name']
        path = CACHE / filename
        if not path.exists():
            print('Downloading', filename, flush=True)
            path.write_bytes(fetch(f'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/{filename}'))
        if hashlib.sha256(path.read_bytes()).hexdigest() != package['sha256']:
            raise RuntimeError(f'Hash mismatch: {filename}')
        shutil.copyfile(path, browser_python / filename)

    print('Browser runtime prepared:', OUT)


if __name__ == '__main__':
    prepare()
