# Shaymin SkyPatcher

[English](README.md)

SkyTempleのパッチに対応した、ブラウザで動作する『空の探検隊』用パッチ適用ツールです。
開発環境は次のコマンドで起動できます。

```sh
npm ci
npm run prepare:runtime
npm run dev
```

`npm run build`で、静的ホスティング用のファイルを`dist/`に生成します。

# パッチ作者のクレジット

- Adex
- Anonymous
- Chesyon
- Cipnit
- Frostbyte
- psy_commando
- UsernameFodder

# 実行環境のソースコードとライセンス

- SkyTemple Files 1.8.5、GPL-3.0-or-later：https://github.com/SkyTemple/skytemple-files
- SkyTemple Rust（スクリプト変数パーサーをPythonに移植）、GPL-3.0-or-later：https://github.com/SkyTemple/skytemple-rust
- ExplorerScript 0.2.4のPythonモジュール、MIT：https://github.com/SkyTemple/ExplorerScript
- ARMIPS WebAssembly 1.1.0、MIT：https://github.com/HailToDodongo/armips_wasm
- Pyodide 314.0.7、MPL-2.0。上流のCPythonおよび各パッケージのライセンス表示を含みます：https://github.com/pyodide/pyodide/tree/314.0.7
