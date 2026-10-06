import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Data model for plan.md §5. Table/column names match the spec exactly;
// indexes on foreign keys are declared inline below.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  displayName: text('display_name'),
  xp: integer('xp').notNull().default(0),
  streakDays: integer('streak_days').notNull().default(0),
  lastActiveDay: text('last_active_day'),
});

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ userIdIdx: index('auth_tokens_user_id_idx').on(t.userId) }),
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    levelId: text('level_id').notNull(),
    seed: integer('seed').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    status: text('status').notNull(),
    hintsUsed: integer('hints_used').notNull().default(0),
    hintTiersJson: text('hint_tiers_json').notNull().default('[]'),
    commandsCount: integer('commands_count').notNull().default(0),
    usedManual: integer('used_manual').notNull().default(0),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    rank: text('rank'),
  },
  (t) => ({
    userIdIdx: index('attempts_user_id_idx').on(t.userId),
    levelIdIdx: index('attempts_level_id_idx').on(t.levelId),
  }),
);

export const levelProgress = sqliteTable(
  'level_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    levelId: text('level_id').notNull(),
    bestRank: text('best_rank'),
    bestXp: integer('best_xp').notNull().default(0),
    completions: integer('completions').notNull().default(0),
    firstCompletedAt: integer('first_completed_at'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.levelId] }) }),
);

export const skillProgress = sqliteTable(
  'skill_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    skillId: text('skill_id').notNull(),
    uses: integer('uses').notNull().default(0),
    levelsUsedJson: text('levels_used_json').notNull().default('[]'),
    masteredAt: integer('mastered_at'),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.skillId] }),
    userIdIdx: index('skill_progress_user_id_idx').on(t.userId),
  }),
);

export const spellbookNotes = sqliteTable(
  'spellbook_notes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    skillId: text('skill_id').notNull(),
    note: text('note').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.skillId] }),
    userIdIdx: index('spellbook_notes_user_id_idx').on(t.userId),
  }),
);

export const badges = sqliteTable(
  'badges',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    badgeId: text('badge_id').notNull(),
    earnedAt: integer('earned_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.badgeId] }),
    userIdIdx: index('badges_user_id_idx').on(t.userId),
  }),
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id'),
    levelId: text('level_id'),
    attemptId: text('attempt_id'),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    userIdIdx: index('events_user_id_idx').on(t.userId),
    levelIdIdx: index('events_level_id_idx').on(t.levelId),
    attemptIdIdx: index('events_attempt_id_idx').on(t.attemptId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
