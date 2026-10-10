import './style.css';
import { setLanguage, translate, type Language } from './i18n';
import { outputFilename, parameterDefault, resolveSelection, validateParameters } from './selection';
import type { Catalogue, Parameter, Patch, Request, Response } from './types';

function getElement<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function cloneTemplate<T extends HTMLElement>(id: string): T {
  const template = getElement<HTMLTemplateElement>(id);
  return template.content.firstElementChild!.cloneNode(true) as T;
}

const romInput = getElement<HTMLInputElement>('rom');
const packagesInput = getElement<HTMLInputElement>('packages');
const searchInput = getElement<HTMLInputElement>('search');
const applyButton = getElement<HTMLButtonElement>('apply');
const cancelButton = getElement<HTMLButtonElement>('cancel');
const patchList = getElement('patches');
const packageList = getElement('package-list');
const statusMessage = getElement('status');
const log = getElement('log');
const logDetails = getElement('log-details');
const languageInput = getElement<HTMLSelectElement>('language');

let romFile: File | undefined;
let patchPackages: File[] = [];
let catalogue: Catalogue | undefined;
let worker: Worker | undefined;
const selectedPatchNames = new Set<string>();
const parameterValues = new Map<string, Record<string, string | number>>();
let busy = false;
let operationId = 0;
let statusText = '';

function setStatus(message: string, error = false): void {
  statusText = message;
  statusMessage.textContent = translate(message);
  statusMessage.title = translate(message);
  statusMessage.hidden = !message;
  statusMessage.classList.toggle('error', error);
}

function saveRom(rom: ArrayBuffer): void {
  const blob = new Blob([rom], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = outputFilename(romFile!.name);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function updateControls(): void {
  romInput.disabled = busy;
  packagesInput.disabled = busy || !romFile;
  searchInput.disabled = busy || !catalogue;
  applyButton.disabled = busy || !catalogue || !selectedPatchNames.size;
  cancelButton.hidden = !busy;
  patchList.toggleAttribute('inert', busy);

  const buttons = patchPackages.map((pkg, index) => {
    const button = cloneTemplate<HTMLButtonElement>('package-template');
    button.textContent = translate(`Remove ${pkg.name}`);
    button.disabled = busy;
    button.addEventListener('click', () => {
      patchPackages.splice(index, 1);
      selectedPatchNames.clear();
      parameterValues.clear();
      void loadRom();
    });
    return button;
  });
  packageList.replaceChildren(...buttons);
}

function getSelectedPatches(): Patch[] {
  return resolveSelection(catalogue?.patches ?? [], selectedPatchNames);
}

function setApplyCount(count: number): void {
  applyButton.textContent = translate(count === 1 ? 'Apply 1 patch' : `Apply ${count} patches`);
}

function getPatchNote(patch: Patch, required: boolean): string {
  if (patch.unavailable) {
    return translate(patch.unavailable);
  }
  if (patch.applied) {
    return translate('Already applied');
  }
  if (required) {
    return translate('Required by your selection');
  }
  return patch.source === 'Built-in' ? '' : patch.source;
}

function createParameterInput(patch: Patch, parameter: Parameter): HTMLElement {
  const template = parameter.type === 'SELECT' ? 'select-parameter-template' : 'input-parameter-template';
  const label = cloneTemplate<HTMLLabelElement>(template);
  label.querySelector('span')!.textContent = translate(parameter.label);
  const input = label.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')!;
  const storedValues = parameterValues.get(patch.name) ?? {};
  const value = storedValues[parameter.name] ?? parameterDefault(parameter);

  if (input instanceof HTMLSelectElement) {
    parameter.options.forEach((option, index) => {
      const choice = new Option(translate(option.label), String(index));
      choice.selected = value === option.value;
      input.append(choice);
    });
  } else {
    input.type = parameter.type === 'INTEGER' ? 'number' : 'text';
    if (parameter.min !== null) {
      input.min = String(parameter.min);
    }
    if (parameter.max !== null) {
      input.max = String(parameter.max);
    }
    if (input.type === 'number') {
      input.step = '1';
    }
    input.value = value === null || value === undefined ? '' : String(value);
  }

  input.addEventListener('input', () => {
    const values = parameterValues.get(patch.name) ?? {};
    if (parameter.type === 'SELECT') {
      values[parameter.name] = parameter.options[Number(input.value)].value;
    } else if (parameter.type === 'INTEGER' && input.value !== '') {
      values[parameter.name] = Number(input.value);
    } else {
      values[parameter.name] = input.value;
    }
    parameterValues.set(patch.name, values);
  });
  return label;
}

function createPatchRow(patch: Patch, included: Set<string>): HTMLElement {
  const row = cloneTemplate<HTMLDivElement>('patch-template');
  const checkbox = row.querySelector('input')!;
  const required = included.has(patch.name) && !selectedPatchNames.has(patch.name);
  checkbox.checked = included.has(patch.name) || patch.applied;
  checkbox.disabled = patch.applied || !!patch.unavailable || required;
  row.classList.toggle('patch-selected', checkbox.checked);
  row.classList.toggle('patch-unavailable', !!patch.unavailable);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedPatchNames.add(patch.name);
    } else {
      selectedPatchNames.delete(patch.name);
    }
    setStatus('');
    renderPatchList();
  });

  row.querySelector('strong')!.textContent = patch.name.replace(/([a-z])([A-Z])/g, '$1 $2');
  row.querySelector('.description')!.textContent = translate(patch.description);
  const badge = row.querySelector<HTMLElement>('.badge')!;
  badge.textContent = getPatchNote(patch, required);
  badge.hidden = !badge.textContent;

  if (included.has(patch.name) && patch.parameters.length) {
    const fields = row.querySelector<HTMLElement>('.parameters')!;
    fields.hidden = false;
    for (const parameter of patch.parameters) {
      fields.append(createParameterInput(patch, parameter));
    }
  }
  return row;
}

function showPatchMessage(message: string): void {
  const empty = cloneTemplate<HTMLDivElement>('empty-message-template');
  empty.querySelector('p')!.textContent = translate(message);
  patchList.replaceChildren(empty);
}

function renderPatchList(): void {
  patchList.replaceChildren();
  if (!catalogue) {
    setApplyCount(0);
    showPatchMessage('Select a ROM to see compatible patches.');
    updateControls();
    return;
  }

  let ordered: Patch[] = [];
  try {
    ordered = getSelectedPatches();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
  const included = new Set(ordered.map(patch => patch.name));
  setApplyCount(ordered.length);
  const query = searchInput.value.trim().toLowerCase();
  const visiblePatches = [...catalogue.patches].sort((left, right) => {
    return translate(left.name).localeCompare(translate(right.name), document.documentElement.lang);
  });
  for (const patch of visiblePatches) {
    const searchableText = `${patch.name} ${translate(patch.name)} ${patch.description} ${translate(patch.description)} ${patch.source}`.toLowerCase();
    if (searchableText.includes(query)) {
      patchList.append(createPatchRow(patch, included));
    }
  }
  if (!patchList.childElementCount) {
    showPatchMessage('No matching patches.');
  }
  updateControls();
}

function showError(message: string, detail = ''): void {
  busy = false;
  setStatus(message, true);
  if (!catalogue) {
    showPatchMessage('Unable to load patches. Remove a custom package or select your ROM again to retry.');
  }
  log.textContent = detail;
  logDetails.hidden = !detail;
  updateControls();
}

function handleWorkerResponse(event: MessageEvent<Response>): void {
  const message = event.data;
  if (message.id !== operationId) {
    return;
  }
  if (message.type === 'progress') {
    setStatus(message.message);
    return;
  }

  busy = false;
  if (message.type === 'error') {
    showError(message.message, message.detail);
  } else if (message.type === 'catalogue') {
    catalogue = message.catalogue;
    setStatus('');
    renderPatchList();
  } else {
    saveRom(message.rom);
    setStatus('Patches applied.');
    updateControls();
  }
}

async function loadRom(): Promise<void> {
  const id = ++operationId;
  worker?.terminate();
  catalogue = undefined;
  busy = true;
  setApplyCount(0);
  logDetails.hidden = true;
  showPatchMessage('Loading patches...');
  updateControls();

  try {
    if (!romFile || romFile.size < 512 || romFile.size > 256 * 1024 * 1024 || !/\.nds$/i.test(romFile.name)) {
      throw new Error('Choose an .nds ROM between 512 bytes and 256 MB.');
    }
    setStatus('Reading your ROM...');
    const rom = await romFile.arrayBuffer();
    const packages = await Promise.all(patchPackages.map(async pkg => ({
      name: pkg.name,
      bytes: await pkg.arrayBuffer(),
    })));
    if (id !== operationId) {
      return;
    }

    const newWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = newWorker;
    newWorker.onmessage = handleWorkerResponse;
    newWorker.onerror = event => {
      if (worker === newWorker) {
        showError('The patch runtime stopped. Select your ROM again to retry.', event.message);
      }
    };
    newWorker.onmessageerror = () => {
      if (worker === newWorker) {
        showError('Unable to read the patch runtime response.');
      }
    };
    newWorker.postMessage(
      { id, type: 'load', rom, packages } satisfies Request,
      [rom, ...packages.map(pkg => pkg.bytes)],
    );
  } catch (error) {
    if (id === operationId) {
      showError((error as Error).message);
    }
  }
}

function selectRom(): void {
  romFile = romInput.files?.[0];
  patchPackages = [];
  selectedPatchNames.clear();
  parameterValues.clear();
  searchInput.value = '';
  packagesInput.value = '';
  if (romFile) {
    void loadRom();
  }
}

function addPackages(): void {
  const added = [...(packagesInput.files ?? [])];
  packagesInput.value = '';
  if (added.some(pkg => !/\.skypatch$/i.test(pkg.name) || pkg.size > 32 * 1024 * 1024)) {
    showError('Choose .skypatch files smaller than 32 MB.');
    return;
  }
  patchPackages.push(...added);
  void loadRom();
}

function applyPatches(): void {
  try {
    const patches = getSelectedPatches().map(patch => {
      return validateParameters(patch, parameterValues.get(patch.name) ?? {});
    });
    if (!patches.length) {
      throw new Error('Select at least one patch.');
    }
    busy = true;
    logDetails.hidden = true;
    updateControls();
    setStatus('Applying your patches...');
    worker!.postMessage({ id: ++operationId, type: 'apply', patches } satisfies Request);
  } catch (error) {
    showError((error as Error).message);
  }
}

function cancelOperation(): void {
  ++operationId;
  worker?.terminate();
  worker = undefined;
  catalogue = undefined;
  selectedPatchNames.clear();
  parameterValues.clear();
  busy = false;
  romInput.value = '';
  romFile = undefined;
  patchPackages = [];
  setStatus('Cancelled. Select your ROM to start again.');
  renderPatchList();
}

function changeLanguage(): void {
  const language = languageInput.value as Language;
  setLanguage(language);
  localStorage.setItem('language', language);
  document.documentElement.lang = language;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    element.dataset.i18n ||= element.textContent!.trim();
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(element => {
    element.dataset.i18nPlaceholder ||= element.placeholder;
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  });
  renderPatchList();
  statusMessage.textContent = translate(statusText);
  statusMessage.title = translate(statusText);
}

languageInput.value = localStorage.getItem('language') ?? (navigator.language.startsWith('ja') ? 'ja' : 'en');
changeLanguage();
languageInput.addEventListener('change', changeLanguage);
romInput.addEventListener('change', selectRom);
packagesInput.addEventListener('change', addPackages);
searchInput.addEventListener('input', renderPatchList);
applyButton.addEventListener('click', applyPatches);
cancelButton.addEventListener('click', cancelOperation);
window.addEventListener('pagehide', () => {
  worker?.terminate();
});
