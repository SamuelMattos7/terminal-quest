import { createHash } from 'node:crypto';
import type { Check } from '@terminal-quest/shared';
import { shQuote } from '../setupCompiler.js';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { resolveSecrets, rootShell, type CheckContext } from './context.js';

type FileExists = Extract<Check, { type: 'file_exists' }>;
type FileAbsent = Extract<Check, { type: 'file_absent' }>;
type FileContent = Extract<Check, { type: 'file_content' }>;
type FileMode = Extract<Check, { type: 'file_mode' }>;
type FileOwner = Extract<Check, { type: 'file_owner' }>;
type SymlinkTarget = Extract<Check, { type: 'symlink_target' }>;
type DirListing = Extract<Check, { type: 'dir_listing' }>;

async function readFile(
  provider: SandboxProvider,
  handle: SandboxHandle,
  path: string,
  ctx: CheckContext,
): Promise<string | undefined> {
  const res = await rootShell(provider, handle, `cat -- ${shQuote(path)}`, ctx);
  return res.code === 0 ? res.stdout : undefined;
}

export async function checkFileExists(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: FileExists,
  ctx: CheckContext,
): Promise<boolean> {
  const p = shQuote(check.path);
  const test =
    check.kind === 'file'
      ? `test -f ${p}`
      : check.kind === 'dir'
        ? `test -d ${p}`
        : check.kind === 'symlink'
          ? `test -L ${p}`
          : `test -e ${p} || test -L ${p}`;
  const res = await rootShell(provider, handle, test, ctx);
  return res.code === 0;
}

export async function checkFileAbsent(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: FileAbsent,
  ctx: CheckContext,
): Promise<boolean> {
  const res = await rootShell(
    provider,
    handle,
    `test ! -e ${shQuote(check.path)} && test ! -L ${shQuote(check.path)}`,
    ctx,
  );
  return res.code === 0;
}

export async function checkFileContent(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: FileContent,
  ctx: CheckContext,
): Promise<boolean> {
  const raw = await readFile(provider, handle, check.path, ctx);
  if (raw === undefined) {
    return false;
  }
  const content = check.trim ? raw.replace(/\s+$/, '').replace(/^\s+/, '') : raw;
  if (check.equals !== undefined) {
    const expected = await resolveSecrets(provider, handle, check.equals, ctx);
    if (expected === undefined) {
      return false;
    }
    const want = check.trim ? expected.replace(/\s+$/, '').replace(/^\s+/, '') : expected;
    return content === want;
  }
  if (check.contains !== undefined) {
    const expected = await resolveSecrets(provider, handle, check.contains, ctx);
    return expected !== undefined && content.includes(expected);
  }
  if (check.matches !== undefined) {
    const expected = await resolveSecrets(provider, handle, check.matches, ctx);
    return expected !== undefined && new RegExp(expected).test(content);
  }
  if (check.sha256 !== undefined) {
    const actual = createHash('sha256').update(content, 'utf8').digest('hex');
    return actual.toLowerCase() === check.sha256.toLowerCase();
  }
  if (check.lines_equal_unordered !== undefined) {
    const actual = content.split('\n').sort();
    const expected = [...check.lines_equal_unordered].sort();
    return actual.length === expected.length && actual.every((line, i) => line === expected[i]);
  }
  return false;
}

export async function checkFileMode(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: FileMode,
  ctx: CheckContext,
): Promise<boolean> {
  const res = await rootShell(provider, handle, `stat -c %a -- ${shQuote(check.path)}`, ctx);
  if (res.code !== 0) {
    return false;
  }
  return parseInt(res.stdout.trim(), 8) === parseInt(check.mode, 8);
}

export async function checkFileOwner(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: FileOwner,
  ctx: CheckContext,
): Promise<boolean> {
  const res = await rootShell(provider, handle, `stat -c '%U %G' -- ${shQuote(check.path)}`, ctx);
  if (res.code !== 0) {
    return false;
  }
  const [user, group] = res.stdout.trim().split(' ');
  return (
    (check.user === undefined || check.user === user) &&
    (check.group === undefined || check.group === group)
  );
}

export async function checkSymlinkTarget(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: SymlinkTarget,
  ctx: CheckContext,
): Promise<boolean> {
  const res = await rootShell(provider, handle, `readlink -- ${shQuote(check.path)}`, ctx);
  return res.code === 0 && res.stdout.replace(/\n$/, '') === check.target;
}

export async function checkDirListing(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: DirListing,
  ctx: CheckContext,
): Promise<boolean> {
  const flag = check.ignore_hidden === true ? '' : 'A';
  const res = await rootShell(provider, handle, `ls -1${flag} -- ${shQuote(check.path)}`, ctx);
  if (res.code !== 0) {
    return false;
  }
  const actual = res.stdout
    .split('\n')
    .filter((l) => l !== '')
    .sort();
  const expected = [...check.equals].sort();
  return actual.length === expected.length && actual.every((name, i) => name === expected[i]);
}
