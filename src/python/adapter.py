from __future__ import annotations

import io
import json
import os
import struct
import subprocess
import ast
import importlib
import sys
import types
from pathlib import Path

os.environ['SKYTEMPLE_USE_NATIVE'] = '0'
from skytemple_files.common.impl_cfg import ImplementationType, change_implementation_type
change_implementation_type(ImplementationType.PYTHON)

# Patch: SkyTemple would attempt to load a native library for WAN
registry_name = 'skytemple_files.common.types.file_types'
tree = ast.parse(Path(importlib.util.find_spec(registry_name).origin).read_text())
imports = {alias.asname or alias.name: (node.module, alias.name)
           for node in tree.body if isinstance(node, ast.ImportFrom)
           for alias in node.names}
registry = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'FileType')
handlers = {node.targets[0].id: imports[node.value.id] for node in registry.body
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Name)}


class LazyFileTypes(type):
    def __getattr__(cls, name):
        if name not in handlers:
            raise AttributeError(name)
        module, handler = handlers[name]
        value = getattr(importlib.import_module(module), handler)
        setattr(cls, name, value)
        return value


class FileType(metaclass=LazyFileTypes):
    UNKNOWN = None


registry_module = types.ModuleType(registry_name)
registry_module.FileType = FileType
sys.modules[registry_name] = registry_module


def load_script_variables(self, config):
    from skytemple_files.common.ppmdu_config.script_data import Pmd2ScriptGameVar
    section = config.bin_sections.arm9
    if section.loadaddress is None:
        return
    memory = bytes(self.rom.arm9)
    variables = []
    for symbol, count, first_id, is_local in [('SCRIPT_VARS', 115, 0, False), ('SCRIPT_VARS_LOCALS', 4, 0x400, True)]:
        offset = getattr(section.data, symbol).address
        if offset < 0 or offset + count * 16 > len(memory):
            raise ValueError('The ROM script-variable table is truncated.')
        for index in range(count):
            fields = struct.unpack_from('<HHHHHhI', memory, offset + index * 16)
            name_offset = fields[6] - section.loadaddress
            if not 0 <= name_offset < len(memory):
                raise ValueError('Invalid script-variable name pointer in ROM.')
            end = memory.find(b'\0', name_offset)
            if end < 0:
                raise ValueError('Unterminated script-variable name in ROM.')
            name = memory[name_offset:end].decode('utf-8', errors='replace')
            variables.append(Pmd2ScriptGameVar(first_id + index, *fields[:6], name, is_local))
    with config.script_data.modify() as storage:
        storage.game_variables = variables


from skytemple_files.common.ppmdu_config.rom_data.loader import RomDataLoader
RomDataLoader.load_script_var_list_into = load_script_variables


def install_armips_bridge(assemble):
    original_popen = subprocess.Popen

    class BrowserArmips:
        def __init__(self, args, *, cwd, **kwargs):
            result = json.loads(assemble(json.dumps(args[1:]), cwd))
            self.returncode = result['code']
            self.stdout = io.BytesIO(result['output'].encode('utf-8'))
            self.stderr = None

        def wait(self, timeout=None):
            return self.returncode

    def popen(args, *positional, **kwargs):
        if isinstance(args, (list, tuple)) and os.path.basename(str(args[0])) == 'armips':
            return BrowserArmips(args, **kwargs)
        return original_popen(args, *positional, **kwargs)

    subprocess.Popen = popen
