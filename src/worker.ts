import type { PyodideInterface } from 'pyodide';
import adapterSource from './python/adapter.py?raw';
import patcherSource from './python/patcher.py?raw';
import { assembleInMemory, type ArmipsFactory } from './armips';
import type { Catalogue, Request, Response } from './types';

const runtimeUrl = new URL('../runtime/', self.location.href);
let python: PyodideInterface;
let ready: Promise<void> | undefined;
let running = false;
let activeId = 0;

function send(message: Response, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function progress(message: string): void {
  send({ id: activeId, type: 'progress', message });
}

async function initialize(): Promise<void> {
  progress('Loading Python and the assembler...');
  const pythonUrl = new URL('pyodide/', runtimeUrl).href;
  const [{ loadPyodide }, { default: createArmips }] = await Promise.all([
    import(/* @vite-ignore */ `${pythonUrl}pyodide.mjs`) as Promise<typeof import('pyodide')>,
    import(/* @vite-ignore */ new URL('armips.mjs', runtimeUrl).href) as Promise<{ default: ArmipsFactory }>,
  ]);

  let assemblerOutput = '';
  const collectOutput = (text: string): void => {
    assemblerOutput += `${text}\n`;
  };
  const [py, assembler, response] = await Promise.all([
    loadPyodide({ indexURL: pythonUrl, stdout: () => {}, stderr: () => {} }),
    createArmips({
      argv: ['', 'armips'],
      noInitialRun: true,
      noExitRuntime: true,
      locateFile: path => new URL(path, runtimeUrl).href,
      log: collectOutput,
      error: collectOutput,
    }),
    fetch(new URL('python.zip', runtimeUrl)),
  ]);
  python = py;
  if (!response.ok) {
    throw new Error('Python packages are missing. Run npm run prepare:runtime before starting the app.');
  }

  progress('Loading Python libraries...');
  await python.loadPackage(['pillow', 'igraph']);
  const archive = new Uint8Array(await response.arrayBuffer());
  python.unpackArchive(archive, 'zip', { extractDir: '/runtime' });
  python.FS.mkdirTree('/work/packages');
  python.runPython("import sys; sys.path.insert(0, '/runtime')");
  python.runPython(adapterSource);
  python.globals.set('_assemble_browser', (args: string, directory: string) => {
    return assembleInMemory(
      assembler,
      python.FS,
      args,
      directory,
      () => assemblerOutput,
      () => { assemblerOutput = ''; },
    );
  });
  python.runPython('install_armips_bridge(_assemble_browser)');
  python.runPython(patcherSource);
}

async function loadRom(request: Extract<Request, { type: 'load' }>): Promise<void> {
  progress('Checking your ROM and available patches...');
  python.FS.writeFile('/work/original.nds', new Uint8Array(request.rom));
  const packages = request.packages.map((pkg, index) => {
    const path = `/work/packages/${index}.skypatch`;
    python.FS.writeFile(path, new Uint8Array(pkg.bytes));
    return { name: pkg.name, path };
  });
  python.globals.set('_packages_json', JSON.stringify(packages));
  const result = await python.runPythonAsync("load_rom('/work/original.nds', _packages_json)");
  const catalogue = JSON.parse(result) as Catalogue;
  send({ id: request.id, type: 'catalogue', catalogue });
}

async function applyPatches(request: Extract<Request, { type: 'apply' }>): Promise<void> {
  python.globals.set('_selection_json', JSON.stringify(request.patches));
  python.globals.set('_report_progress', progress);
  await python.runPythonAsync('apply_patches(_selection_json, _report_progress)');
  const data = python.FS.readFile('/work/patched.nds');
  const rom = Uint8Array.from(data).buffer;
  send({ id: request.id, type: 'result', rom }, [rom]);
  python.FS.unlink('/work/patched.nds');
}

function reportError(id: number, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const lines = detail.split('\n').filter(Boolean);
  const lastLine = lines.at(-1) ?? 'Unable to apply these patches.';
  let message = lastLine.replace(/^(\w+Error|\w+Exception):\s*/, '');
  if (detail.includes('explorerscript_parser')) {
    message = 'This package needs the native ExplorerScript compiler, which is not available in the browser runtime.';
  }
  send({ id, type: 'error', message, detail });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (running) {
    send({
      id: request.id,
      type: 'error',
      message: 'A patch operation is already running.',
      detail: '',
    });
    return;
  }

  running = true;
  activeId = request.id;
  try {
    ready ??= initialize();
    await ready;
    if (request.type === 'load') {
      await loadRom(request);
    } else {
      await applyPatches(request);
    }
  } catch (error) {
    reportError(request.id, error);
  } finally {
    running = false;
  }
};
