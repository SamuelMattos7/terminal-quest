import type { Level } from '@terminal-quest/shared';
import type { PutFilesEntry } from '../sandbox/provider.js';

// These tools intentionally grant substantial in-container authority (D-004/D-010).
// No shell, editor, arbitrary reader, mount, or sudoers ALL rule is granted.
export const DEFAULT_SUDO_COMMANDS = [
  '/usr/bin/id',
  '/usr/bin/apt-get',
  '/usr/bin/dpkg',
  '/usr/sbin/useradd',
  '/usr/sbin/usermod',
  '/usr/sbin/userdel',
  '/usr/sbin/groupadd',
  '/usr/sbin/groupmod',
  '/usr/sbin/groupdel',
  '/usr/sbin/service',
  '/usr/bin/chown',
  '/usr/bin/chmod',
  '/usr/bin/chgrp',
  '/usr/bin/kill',
  '/usr/bin/pkill',
];

export function adminSudoers(level: Level): PutFilesEntry[] {
  if (level.sandbox.profile !== 'admin') return [];
  const commands = [...new Set([...DEFAULT_SUDO_COMMANDS, ...level.sandbox.sudo_allow])];
  return [
    {
      path: '/etc/sudoers.d/tq',
      mode: 0o440,
      uid: 0,
      gid: 0,
      content: Buffer.from(
        `Defaults:player !lecture\nplayer ALL=(root) NOPASSWD: ${commands.join(', ')}\n`,
      ),
    },
  ];
}

export function adminSetupCommands(level: Level): string[] {
  if (level.sandbox.profile !== 'admin') return [];
  return [
    'chown root:root /etc/sudoers.d/tq',
    'chmod 0440 /etc/sudoers.d/tq',
    '/usr/sbin/visudo -cf /etc/sudoers.d/tq',
    ...(level.sandbox.needs_cron ? ['/usr/sbin/cron', 'pgrep -x cron > /dev/null'] : []),
  ];
}
