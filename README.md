# Shaymin SkyPatcher

[日本語](README.ja.md)

Browser-based Explorers of Sky patcher, compatible with SkyTemple patches.
Install with:

```sh
npm ci
npm run prepare:runtime
npm run dev
```

`npm run build` creates `dist/` for static hosting.

# Patch author credits

- Adex
- Anonymous
- Chesyon
- Cipnit
- Frostbyte
- psy_commando
- UsernameFodder

# Runtime sources and notices

- SkyTemple Files 1.8.5, GPL-3.0-or-later: https://github.com/SkyTemple/skytemple-files
- SkyTemple Rust (script-variable parser adapted to Python), GPL-3.0-or-later: https://github.com/SkyTemple/skytemple-rust
- ExplorerScript 0.2.4 Python modules, MIT: https://github.com/SkyTemple/ExplorerScript
- ARMIPS WebAssembly 1.1.0, MIT: https://github.com/HailToDodongo/armips_wasm
- Pyodide 314.0.7, MPL-2.0, with upstream CPython and package notices: https://github.com/pyodide/pyodide/tree/314.0.7
