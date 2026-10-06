import type Docker from 'dockerode';

// Sandbox abstraction for plan.md §7.2. The only production implementation
// is DockerProvider (T1.2); the interface keeps WASM/microVM providers
// possible later (D-001).

export interface SandboxSpec {
  attemptId: string;
  userId: string;
  levelId: string;
  image: string;
  profile: 'basic' | 'admin';
  network: 'none' | 'lan';
  sidecars: string[];
  resources: { memoryMb: number; cpus: number; pids: number };
  startCwd: string;
  env: Record<string, string>;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ShellStream {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (chunk: Buffer) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface SandboxHandle {
  id: string;
  spec: SandboxSpec;
}

export interface PutFilesEntry {
  path: string;
  content: Buffer;
  mode: number;
  uid?: number;
  gid?: number;
}

export interface ExecOptions {
  user?: string;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
}

export interface ManagedSandbox {
  containerId: string;
  attemptId: string;
  createdAt: number;
}

export interface SandboxProvider {
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  putFiles(h: SandboxHandle, entries: PutFilesEntry[]): Promise<void>;
  exec(h: SandboxHandle, cmd: string[], opts?: ExecOptions): Promise<ExecResult>;
  openShell(h: SandboxHandle, size: { cols: number; rows: number }): Promise<ShellStream>;
  watchFile(
    h: SandboxHandle,
    path: string,
    onLine: (line: string) => void,
  ): Promise<{ stop(): void }>;
  destroy(h: SandboxHandle): Promise<void>;
  listManaged(): Promise<ManagedSandbox[]>;
}

/**subset of the dockerode client surface DockerProvider needs (for tests). */
export type DockerClient = Pick<Docker, 'createContainer' | 'listContainers' | 'getContainer'>;
