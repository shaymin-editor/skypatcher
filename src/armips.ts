interface FileSystem {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  mkdirTree(path: string): void;
  readFile(path: string): Uint8Array;
  writeFile(path: string, bytes: Uint8Array): void;
  chdir(path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface ArmipsModule {
  FS: FileSystem;
  callMain(args: string[]): number;
}

export type ArmipsFactory = (options: {
  argv: string[];
  noInitialRun: boolean;
  noExitRuntime: boolean;
  locateFile: (path: string) => string;
  log: (text: string) => void;
  error: (text: string) => void;
}) => Promise<ArmipsModule>;

function walk(fs: FileSystem, directory: string, file: (path: string) => void): void {
  for (const name of fs.readdir(directory)) {
    if (name === '.' || name === '..') {
      continue;
    }
    const path = `${directory}/${name}`;
    if (fs.isDir(fs.stat(path).mode)) {
      walk(fs, path, file);
    } else {
      file(path);
    }
  }
}

function removeTree(fs: FileSystem, directory: string): void {
  for (const name of fs.readdir(directory)) {
    if (name === '.' || name === '..') {
      continue;
    }
    const path = `${directory}/${name}`;
    if (fs.isDir(fs.stat(path).mode)) {
      removeTree(fs, path);
    } else {
      fs.unlink(path);
    }
  }
  fs.rmdir(directory);
}

/** Mirror the Python file system into the armips FS */
export function assembleInMemory(
  armips: ArmipsModule,
  pythonFS: FileSystem,
  argumentsJson: string,
  directory: string,
  collectOutput: () => string,
  clearOutput: () => void,
): string {
  clearOutput();
  armips.FS.mkdirTree(directory);
  walk(pythonFS, directory, path => {
    armips.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    armips.FS.writeFile(path, pythonFS.readFile(path));
  });
  let code = 1;
  try {
    armips.FS.chdir(directory);
    code = armips.callMain(JSON.parse(argumentsJson) as string[]);
    if (code === 0) {
      walk(armips.FS, directory, path => {
        pythonFS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        pythonFS.writeFile(path, armips.FS.readFile(path));
      });
    }
    return JSON.stringify({ code, output: collectOutput() });
  } finally {
    armips.FS.chdir('/');
    removeTree(armips.FS, directory);
  }
}
