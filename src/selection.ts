import type { Parameter, Patch, PatchSelection } from './types';
import { translate } from './i18n';

export function resolveSelection(patches: Patch[], selected: Set<string>): Patch[] {
  const byName = new Map(patches.map(patch => [patch.name, patch]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const ordered: Patch[] = [];

  function visit(name: string): void {
    if (done.has(name)) {
      return;
    }
    const patch = byName.get(name);
    if (!patch) {
      throw new Error(`Missing required patch: ${name}. Add its .skypatch file first.`);
    }
    if (patch.applied) {
      done.add(name);
      return;
    }
    if (patch.unavailable) {
      throw new Error(`${name}: ${patch.unavailable}`);
    }
    if (visiting.has(name)) {
      throw new Error(`Patch dependencies contain a cycle at ${name}.`);
    }

    visiting.add(name);
    for (const dependency of patch.dependencies) {
      visit(dependency);
    }
    visiting.delete(name);
    done.add(name);
    ordered.push(patch);
  }

  for (const patch of patches) {
    if (selected.has(patch.name)) {
      visit(patch.name);
    }
  }
  for (const name of selected) {
    if (!byName.has(name)) {
      throw new Error(`Unknown patch: ${name}`);
    }
  }
  return ordered;
}

export function parameterDefault(parameter: Parameter): string | number | null {
  if (parameter.default !== null) {
    return parameter.default;
  }
  if (parameter.type === 'SELECT') {
    return parameter.options[0]?.value ?? null;
  }
  return null;
}

export function validateParameters(patch: Patch, values: Record<string, string | number>): PatchSelection {
  const parameters: Record<string, string | number> = {};
  for (const parameter of patch.parameters) {
    const value = values[parameter.name] ?? parameterDefault(parameter);
    const fieldName = `${translate(patch.name)}: ${translate(parameter.label)}`;
    if (value === null || value === undefined) {
      throw new Error(`${fieldName} needs a value.`);
    }
    if (parameter.type === 'INTEGER') {
      if (value === '' || typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(`${fieldName} must be a whole number.`);
      }
      if (parameter.min !== null && value < parameter.min) {
        throw new Error(`${fieldName} must be at least ${parameter.min}.`);
      }
      if (parameter.max !== null && value > parameter.max) {
        throw new Error(`${fieldName} must be at most ${parameter.max}.`);
      }
    } else if (parameter.type === 'STRING' && typeof value !== 'string') {
      throw new Error(`${fieldName} must be text.`);
    } else if (parameter.type === 'SELECT' && !parameter.options.some(option => option.value === value)) {
      throw new Error(`${fieldName} needs a valid option.`);
    }
    parameters[parameter.name] = value;
  }
  return { name: patch.name, parameters };
}

export function outputFilename(name: string): string {
  return `${name.replace(/\.nds$/i, '')}-patched.nds`;
}
