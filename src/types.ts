export interface Parameter {
  name: string;
  label: string;
  type: 'INTEGER' | 'STRING' | 'SELECT';
  min: number | null;
  max: number | null;
  default: string | number | null;
  options: { label: string; value: string | number }[];
}

export interface Patch {
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  dependencies: string[];
  parameters: Parameter[];
  applied: boolean;
  unavailable: string | null;
  source: string;
}

export interface Catalogue {
  edition: string;
  patches: Patch[];
}

export interface PatchSelection {
  name: string;
  parameters: Record<string, string | number>;
}

export interface LocalPackage {
  name: string;
  bytes: ArrayBuffer;
}

export type Request =
  | {
    id: number;
    type: 'load';
    rom: ArrayBuffer;
    packages: LocalPackage[];
  }
  | {
    id: number;
    type: 'apply';
    patches: PatchSelection[];
  };

export type Response =
  | {
    id: number;
    type: 'progress';
    message: string;
  }
  | {
    id: number;
    type: 'catalogue';
    catalogue: Catalogue;
  }
  | {
    id: number;
    type: 'result';
    rom: ArrayBuffer;
  }
  | {
    id: number;
    type: 'error';
    message: string;
    detail: string;
  };
