import { z } from 'zod';

// Check schemas for plan.md §8.2. The discriminated union below is the
// machine-verifiable condition behind a level objective. Secret references
// (`{{secret:name}}`, `from_file`) are validated as shape-only here;
// resolution against `/opt/tq/secret/*` happens in the engine (T2.3).

const AbsPathSchema = z.string().min(1).regex(/^\//, 'must be an absolute path');
const OctalModeSchema = z
  .string()
  .regex(/^[0-7]{3,4}$/, 'must be an octal mode like "644" or "0600"');

const FileExistsCheckSchema = z
  .object({
    type: z.literal('file_exists'),
    path: AbsPathSchema,
    kind: z.enum(['file', 'dir', 'symlink', 'any']).default('any'),
  })
  .strict();

const FileAbsentCheckSchema = z
  .object({
    type: z.literal('file_absent'),
    path: AbsPathSchema,
  })
  .strict();

const FileContentCheckSchema = z
  .object({
    type: z.literal('file_content'),
    path: AbsPathSchema,
    equals: z.string().optional(),
    contains: z.string().optional(),
    matches: z.string().min(1).optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-char hex sha256')
      .optional(),
    lines_equal_unordered: z.array(z.string()).optional(),
    trim: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const set = [v.equals, v.contains, v.matches, v.sha256, v.lines_equal_unordered].filter(
      (x) => x !== undefined,
    );
    if (set.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'file_content needs exactly one of equals, contains, matches, sha256, lines_equal_unordered',
      });
    }
  });

const FileModeCheckSchema = z
  .object({
    type: z.literal('file_mode'),
    path: AbsPathSchema,
    mode: OctalModeSchema,
  })
  .strict();

const FileOwnerCheckSchema = z
  .object({
    type: z.literal('file_owner'),
    path: AbsPathSchema,
    user: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.user === undefined && v.group === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'file_owner needs at least one of user, group',
      });
    }
  });

const SymlinkTargetCheckSchema = z
  .object({
    type: z.literal('symlink_target'),
    path: AbsPathSchema,
    target: z.string().min(1),
  })
  .strict();

const DirListingCheckSchema = z
  .object({
    type: z.literal('dir_listing'),
    path: AbsPathSchema,
    equals: z.array(z.string()),
    ignore_hidden: z.boolean().optional(),
  })
  .strict();

const ShellCwdCheckSchema = z
  .object({
    type: z.literal('shell_cwd'),
    equals: AbsPathSchema,
  })
  .strict();

const CommandUsedCheckSchema = z
  .object({
    type: z.literal('command_used'),
    regex: z.string().min(1),
    min_count: z.number().int().positive().default(1),
    exit_code: z.union([z.number().int(), z.literal('any')]).default(0),
  })
  .strict();

const AnswerEqualsCheckSchema = z
  .object({
    type: z.literal('answer_equals'),
    value: z.string().optional(),
    from_file: AbsPathSchema.optional(),
    case_sensitive: z.boolean().optional(),
    trim: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const set = [v.value, v.from_file].filter((x) => x !== undefined);
    if (set.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'answer_equals needs exactly one of value, from_file',
      });
    }
  });

const ProcessMatchFields = {
  name: z.string().min(1).optional(),
  cmdline_regex: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
};

const ProcessRunningCheckSchema = z
  .object({ type: z.literal('process_running'), ...ProcessMatchFields })
  .strict()
  .superRefine((v, ctx) => {
    if (v.name === undefined && v.cmdline_regex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'process_running needs at least one of name, cmdline_regex',
      });
    }
  });

const ProcessAbsentCheckSchema = z
  .object({ type: z.literal('process_absent'), ...ProcessMatchFields })
  .strict()
  .superRefine((v, ctx) => {
    if (v.name === undefined && v.cmdline_regex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'process_absent needs at least one of name, cmdline_regex',
      });
    }
  });

const ProcessStateCheckSchema = z
  .object({
    type: z.literal('process_state'),
    cmdline_regex: z.string().min(1),
    state: z.enum(['R', 'S', 'T', 'Z']),
  })
  .strict();

const PortListeningCheckSchema = z
  .object({
    type: z.literal('port_listening'),
    port: z.number().int().min(1).max(65535),
    proto: z.enum(['tcp', 'udp']).default('tcp'),
  })
  .strict();

const CrontabEntryCheckSchema = z
  .object({
    type: z.literal('crontab_entry'),
    user: z.string().min(1),
    schedule: z.string().min(1),
    command_regex: z.string().min(1),
  })
  .strict();

const CronDryRunExpectSchema = z
  .object({
    exit_code: z.number().int().optional(),
    stdout_equals: z.string().optional(),
    stdout_contains: z.string().optional(),
    stdout_matches: z.string().min(1).optional(),
    stderr_equals: z.string().optional(),
    stderr_contains: z.string().optional(),
    stderr_matches: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cron_dry_run expect needs at least one assertion',
      });
    }
  });

const CronDryRunCheckSchema = z
  .object({
    type: z.literal('cron_dry_run'),
    user: z.string().min(1),
    entry_index: z.number().int().min(0).optional(),
    command_regex: z.string().min(1).optional(),
    expect: CronDryRunExpectSchema,
    timeout_s: z.number().int().positive().optional(),
  })
  .strict();

const LoginShellEvalCheckSchema = z
  .object({
    type: z.literal('login_shell_eval'),
    user: z.string().min(1),
    script: z.string().min(1),
    stdout_equals: z.string().optional(),
    stdout_matches: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.stdout_equals === undefined && v.stdout_matches === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'login_shell_eval needs exactly one of stdout_equals, stdout_matches',
      });
    }
  });

const ScriptCaseFileSchema = z
  .object({
    path: z.string().min(1),
    exists: z.boolean().optional(),
    contains: z.string().optional(),
    matches: z.string().min(1).optional(),
  })
  .strict();

const ScriptCaseExpectSchema = z
  .object({
    exit_code: z.number().int().optional(),
    stdout_equals: z.string().optional(),
    stdout_contains: z.string().optional(),
    stdout_matches: z.string().min(1).optional(),
    stderr_equals: z.string().optional(),
    stderr_contains: z.string().optional(),
    stderr_matches: z.string().min(1).optional(),
    files: z.array(ScriptCaseFileSchema).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'script_tests case expect needs at least one assertion',
      });
    }
  });

const ScriptCaseSchema = z
  .object({
    name: z.string().min(1),
    args: z.array(z.string()).default([]),
    setup: z.array(z.string()).default([]),
    stdin: z.string().optional(),
    env: z.record(z.string()).optional(),
    hidden: z.boolean().default(false),
    expect: ScriptCaseExpectSchema,
  })
  .strict();

const ScriptTestsCheckSchema = z
  .object({
    type: z.literal('script_tests'),
    path: AbsPathSchema,
    shellcheck: z.boolean().default(false),
    cases: z.array(ScriptCaseSchema).min(1),
  })
  .strict();

const ExecCheckSchema = z
  .object({
    type: z.literal('exec'),
    script: z.string().min(1).optional(),
    inline: z.string().min(1).optional(),
    expect_exit: z.number().int().default(0),
    stdout_matches: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const set = [v.script, v.inline].filter((x) => x !== undefined);
    if (set.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exec needs exactly one of script, inline',
      });
    }
  });

// Combinators are recursive: a subtree is a full check.
// Plain union (not discriminated): several members use superRefine for
// exactly-one-of rules, and zod does not allow refined schemas as
// discriminated-union options. `type` still discriminates at runtime.
export const CheckSchema: z.ZodType<Check, z.ZodTypeDef, unknown> = z.union([
  FileExistsCheckSchema,
  FileAbsentCheckSchema,
  FileContentCheckSchema,
  FileModeCheckSchema,
  FileOwnerCheckSchema,
  SymlinkTargetCheckSchema,
  DirListingCheckSchema,
  ShellCwdCheckSchema,
  CommandUsedCheckSchema,
  AnswerEqualsCheckSchema,
  ProcessRunningCheckSchema,
  ProcessAbsentCheckSchema,
  ProcessStateCheckSchema,
  PortListeningCheckSchema,
  CrontabEntryCheckSchema,
  CronDryRunCheckSchema,
  LoginShellEvalCheckSchema,
  ScriptTestsCheckSchema,
  ExecCheckSchema,
  z.object({ type: z.literal('all'), checks: z.array(z.lazy(() => CheckSchema)).min(1) }).strict(),
  z.object({ type: z.literal('any'), checks: z.array(z.lazy(() => CheckSchema)).min(1) }).strict(),
  z.object({ type: z.literal('not'), checks: z.array(z.lazy(() => CheckSchema)).min(1) }).strict(),
]);

export type Check =
  | z.infer<typeof FileExistsCheckSchema>
  | z.infer<typeof FileAbsentCheckSchema>
  | z.infer<typeof FileContentCheckSchema>
  | z.infer<typeof FileModeCheckSchema>
  | z.infer<typeof FileOwnerCheckSchema>
  | z.infer<typeof SymlinkTargetCheckSchema>
  | z.infer<typeof DirListingCheckSchema>
  | z.infer<typeof ShellCwdCheckSchema>
  | z.infer<typeof CommandUsedCheckSchema>
  | z.infer<typeof AnswerEqualsCheckSchema>
  | z.infer<typeof ProcessRunningCheckSchema>
  | z.infer<typeof ProcessAbsentCheckSchema>
  | z.infer<typeof ProcessStateCheckSchema>
  | z.infer<typeof PortListeningCheckSchema>
  | z.infer<typeof CrontabEntryCheckSchema>
  | z.infer<typeof CronDryRunCheckSchema>
  | z.infer<typeof LoginShellEvalCheckSchema>
  | z.infer<typeof ScriptTestsCheckSchema>
  | z.infer<typeof ExecCheckSchema>
  | { type: 'all'; checks: Check[] }
  | { type: 'any'; checks: Check[] }
  | { type: 'not'; checks: Check[] };
