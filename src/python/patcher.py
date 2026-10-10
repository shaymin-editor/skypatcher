from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from ndspy.rom import NintendoDSRom
from skytemple_files.common.util import get_ppmdu_config_for_rom
from skytemple_files.patch.handler.abstract import DependantPatch
from skytemple_files.patch.patches import Patcher

MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_EXTRACTED_BYTES = 128 * 1024 * 1024
MAX_PACKAGE_ENTRIES = 10000
baseline = None
package_paths = []
patcher = None
sources = {}


def validate_package(path):
    if os.path.getsize(path) > MAX_PACKAGE_BYTES:
        raise ValueError('A .skypatch package must be smaller than 32 MB.')
    with ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_PACKAGE_ENTRIES or sum(entry.file_size for entry in entries) > MAX_EXTRACTED_BYTES:
            raise ValueError('The .skypatch archive is too large to unpack in a browser.')
        for entry in entries:
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('The .skypatch archive contains an unsafe path or symlink.')
        if 'config.xml' not in archive.namelist() or 'patch.py' not in archive.namelist():
            raise ValueError('A .skypatch must contain config.xml and patch.py at its root.')
        root = ET.fromstring(archive.read('config.xml'))
        return {element.attrib['id'] for element in root.iter() if element.tag in ('Patch', 'SimplePatch') and 'id' in element.attrib}


def make_patcher(rom):
    config = get_ppmdu_config_for_rom(rom)
    current = Patcher(rom, config)
    source_map = {handler.name: 'Built-in' for handler in current.list()}
    reserved = set(config.asm_patches_constants.patches)
    for path, filename in package_paths:
        declared = validate_package(path)
        collision = declared & reserved
        if collision:
            raise ValueError('Patch name already exists: ' + ', '.join(sorted(collision)))
        handler = current.add_pkg(path)
        if handler.name in source_map:
            raise ValueError(f'Patch name already exists: {handler.name}')
        reserved.update(declared)
        reserved.add(handler.name)
        source_map[handler.name] = filename
    return current, config, source_map


def catalogue(current, config, source_map):
    items = []
    for handler in current.list():
        unavailable = None
        applied = False
        try:
            applied = bool(current.is_applied(handler.name))
        except NotImplementedError:
            unavailable = 'Not available for this ROM region.'
        except Exception as error:
            unavailable = f'Cannot check this patch on this ROM: {error}'
        parameters = []
        for parameter in config.asm_patches_constants.patches[handler.name].parameters.values():
            parameters.append({
                'name': parameter.name, 'label': parameter.label, 'type': parameter.type.name,
                'min': parameter.min, 'max': parameter.max, 'default': parameter.default,
                'options': [{'label': option.label, 'value': option.value} for option in (parameter.options or [])],
            })
        items.append({
            'name': handler.name, 'description': handler.description,
            'author': handler.author, 'version': handler.version, 'category': handler.category.name,
            'dependencies': handler.depends_on() if isinstance(handler, DependantPatch) else [],
            'parameters': parameters, 'applied': applied, 'unavailable': unavailable,
            'source': source_map[handler.name],
        })
    return {'edition': config.game_edition, 'patches': items}


def load_rom(rom_path, packages_json):
    global baseline, package_paths, patcher, sources
    baseline = Path(rom_path).read_bytes()
    package_paths = [(item['path'], item['name']) for item in json.loads(packages_json)]
    rom = NintendoDSRom(baseline)
    patcher, config, sources = make_patcher(rom)
    return json.dumps(catalogue(patcher, config, sources))


def apply_patches(selection_json, report_progress):
    if baseline is None:
        raise ValueError('Select a ROM first.')
    requested = json.loads(selection_json)
    if not requested or len({item['name'] for item in requested}) != len(requested):
        raise ValueError('Select at least one patch, with no duplicates.')

    rom = NintendoDSRom(baseline)
    current, config, source_map = make_patcher(rom)
    catalogue_by_name = {item['name']: item for item in catalogue(current, config, source_map)['patches']}
    supplied = {item['name']: item['parameters'] for item in requested}
    order, visiting, visited = [], set(), set()

    def visit(name):
        if name in visited:
            return
        item = catalogue_by_name.get(name)
        if item is None:
            raise ValueError(f'Missing required patch: {name}')
        if item['applied']:
            visited.add(name)
            return
        if item['unavailable']:
            raise ValueError(f"{name}: {item['unavailable']}")
        if name in visiting:
            raise ValueError(f'Patch dependency cycle: {name}')
        if name not in supplied:
            raise ValueError(f'Missing dependency selection: {name}')
        visiting.add(name)
        for dependency in item['dependencies']:
            visit(dependency)
        visiting.remove(name)
        visited.add(name)
        order.append(name)

    for item in requested:
        visit(item['name'])
    if not order:
        raise ValueError('All selected patches are already applied.')
    for index, name in enumerate(order):
        report_progress(f'Applying {name} ({index + 1}/{len(order)})...')
        # Patch handlers might externalize data or add overlays, refresh ROM config.
        if index:
            current, config, source_map = make_patcher(rom)
        current.apply(name, supplied[name])
        if not current.is_applied(name):
            raise RuntimeError(f'{name} completed but failed to check if the patch was applied.')
    report_progress('Preparing your patched ROM...')
    Path('/work/patched.nds').write_bytes(rom.save())
