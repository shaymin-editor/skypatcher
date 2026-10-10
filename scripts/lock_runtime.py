"""Explicit maintainer command to select and hash upstream wheel artifacts."""
import json
from pathlib import Path
from prepare_runtime import fetch

VERSIONS = {
    'skytemple-files': '1.8.5',
    'explorerscript': '0.2.4',
    'pmdsky-debug-py': '10.0.48',
    'ndspy': '4.2.0',
    'range-typed-integers': '1.0.1',
    'appdirs': '1.4.4',
    'dungeon-eos': '0.0.5',
}
artifacts = []
for package, version in VERSIONS.items():
    metadata = json.loads(fetch(f'https://pypi.org/pypi/{package}/{version}/json'))
    files = [f for f in metadata['urls'] if f['filename'].endswith('-none-any.whl')]
    if package == 'explorerscript':
        files = [f for f in metadata['urls'] if f['filename'].endswith('cp314-cp314-macosx_11_0_arm64.whl')]
    if len(files) != 1:
        raise RuntimeError(f'Review wheel selection for {package}: {files}')
    artifact = files[0]
    artifacts.append({
        'package': package, 'version': version, 'filename': artifact['filename'],
        'url': artifact['url'], 'sha256': artifact['digests']['sha256'],
        'source': metadata['info'].get('project_urls'),
    })
root = Path(__file__).resolve().parents[1]
(root / 'runtime.lock.json').write_text(json.dumps({'python': artifacts}, indent=2) + '\n')
