import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  BadgesResponseSchema,
  DailyResponseSchema,
  NoteRequestSchema,
  OkResponseSchema,
  ProgressResponseSchema,
  ReviewResponseSchema,
  SkillsResponseSchema,
  SpellbookResponseSchema,
  type LevelState,
} from '@terminal-quest/shared';
import {
  attempts,
  badges,
  levelProgress,
  skillProgress,
  spellbookNotes,
  users,
} from '../db/schema.js';
import { levelStates } from '../progression/unlock.js';
import { dailyLevel, isDailyEligible } from '../progression/daily.js';
import { reviewDue } from '../progression/review.js';
import { dayString } from '../progression/streaks.js';
import { closeLiveSession } from '../ws/sessionFlow.js';

// Progression endpoints for plan.md §6 (T3.3): progress, skills, spellbook,
// daily, review. Auth is enforced by the global /api hook; handlers still
// guard defensively like the other route modules.

function requireUserId(request: { user?: { id: string } }): string | undefined {
  return request.user?.id;
}

export async function registerProgressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/progress', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const rows = await app.db
      .select()
      .from(levelProgress)
      .where(eq(levelProgress.userId, userId))
      .all();
    const completed = new Set(rows.filter((r) => r.completions > 0).map((r) => r.levelId));
    const states = levelStates(app.levels.byWorld, completed, app.config.UNLOCK_ALL === 1);
    const levels: Record<
      string,
      {
        bestRank: 'S' | 'A' | 'B' | 'C' | null;
        bestXp: number;
        completions: number;
        state: LevelState;
      }
    > = {};
    for (const row of rows) {
      levels[row.levelId] = {
        bestRank: row.bestRank as 'S' | 'A' | 'B' | 'C' | null,
        bestXp: row.bestXp,
        completions: row.completions,
        state: states.get(row.levelId) ?? 'locked',
      };
    }
    const [user] = await app.db.select().from(users).where(eq(users.id, userId)).all();
    const attemptRows = await app.db
      .select({ hintsUsed: attempts.hintsUsed })
      .from(attempts)
      .where(eq(attempts.userId, userId))
      .all();
    return reply.send(
      ProgressResponseSchema.parse({
        levels,
        totals: {
          xp: user?.xp ?? 0,
          completions: rows.reduce((sum, r) => sum + r.completions, 0),
          levelsCompleted: completed.size,
          hintsUsed: attemptRows.reduce((sum, r) => sum + r.hintsUsed, 0),
        },
      }),
    );
  });

  app.get('/api/skills', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const rows = await app.db
      .select()
      .from(skillProgress)
      .where(eq(skillProgress.userId, userId))
      .all();
    const bySkill = new Map(rows.map((r) => [r.skillId, r]));
    return reply.send(
      SkillsResponseSchema.parse({
        skills: [...app.levels.skills.values()].map((s) => ({
          id: s.id,
          title: s.title,
          group: s.group,
          world: s.world,
          prereqs: s.prereqs,
          uses: bySkill.get(s.id)?.uses ?? 0,
          masteredAt: bySkill.get(s.id)?.masteredAt ?? null,
        })),
      }),
    );
  });

  async function spellbookEntries(userId: string): Promise<
    {
      skillId: string;
      title: string;
      cheatsheet: { syntax: string; note: string }[];
      examples: string[];
      note: string | null;
    }[]
  > {
    const [progressRows, noteRows] = await Promise.all([
      app.db.select().from(skillProgress).where(eq(skillProgress.userId, userId)).all(),
      app.db.select().from(spellbookNotes).where(eq(spellbookNotes.userId, userId)).all(),
    ]);
    const unlocked = new Set(progressRows.map((r) => r.skillId));
    const notes = new Map(noteRows.map((r) => [r.skillId, r.note]));
    const levelRows = await app.db
      .select()
      .from(levelProgress)
      .where(eq(levelProgress.userId, userId))
      .all();
    const completed = new Set(levelRows.filter((r) => r.completions > 0).map((r) => r.levelId));
    const entries = [];
    for (const skillId of [...unlocked].sort()) {
      const skill = app.levels.skills.get(skillId);
      if (skill === undefined) {
        continue;
      }
      const teaching = [...app.levels.byId.values()].filter(
        (l) => completed.has(l.id) && l.teaches.includes(skillId),
      );
      entries.push({
        skillId,
        title: skill.title,
        cheatsheet: teaching.flatMap((l) =>
          l.cheatsheet
            .filter((c) => c.skill === skillId)
            .map((c) => ({ syntax: c.syntax, note: c.note })),
        ),
        examples: teaching.flatMap((l) => l.explain.map((e) => e.command)),
        note: notes.get(skillId) ?? null,
      });
    }
    return entries;
  }

  app.get('/api/spellbook', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send(SpellbookResponseSchema.parse({ entries: await spellbookEntries(userId) }));
  });

  app.put<{ Params: { skillId: string } }>(
    '/api/spellbook/:skillId/note',
    async (request, reply) => {
      const userId = requireUserId(request);
      if (userId === undefined) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const { skillId } = request.params;
      if (!app.levels.skills.has(skillId)) {
        return reply.code(404).send({ error: 'unknown skill' });
      }
      const parsed = NoteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'note must be a string up to 2000 chars' });
      }
      const now = Math.floor(Date.now() / 1000);
      const [existing] = await app.db
        .select()
        .from(spellbookNotes)
        .where(and(eq(spellbookNotes.userId, userId), eq(spellbookNotes.skillId, skillId)))
        .all();
      if (existing === undefined) {
        await app.db
          .insert(spellbookNotes)
          .values({ userId, skillId, note: parsed.data.note, updatedAt: now })
          .run();
      } else {
        await app.db
          .update(spellbookNotes)
          .set({ note: parsed.data.note, updatedAt: now })
          .where(and(eq(spellbookNotes.userId, userId), eq(spellbookNotes.skillId, skillId)))
          .run();
      }
      return reply.send({ ok: true });
    },
  );

  app.get('/api/spellbook/export', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const lines = ['# Spellbook', ''];
    for (const entry of await spellbookEntries(userId)) {
      lines.push(`## ${entry.title} (\`${entry.skillId}\`)`, '');
      for (const cheat of entry.cheatsheet) {
        lines.push(`\`${cheat.syntax}\` — ${cheat.note}`, '');
      }
      for (const example of entry.examples) {
        lines.push(`Example: \`${example}\``, '');
      }
      if (entry.note !== null) {
        lines.push(`Personal note: ${entry.note}`, '');
      }
    }
    return reply.type('text/markdown').send(lines.join('\n'));
  });

  app.get('/api/daily', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const date = dayString(Date.now());
    const pool = [...app.levels.byId.values()]
      .filter((l) => app.config.ENABLE_WORLDS.includes(l.world) && isDailyEligible(l))
      .sort((a, b) => a.id.localeCompare(b.id));
    const picked = dailyLevel(pool, date);
    if (picked === undefined) {
      return reply.code(404).send({ error: 'no daily level' });
    }
    const [row] = await app.db
      .select()
      .from(levelProgress)
      .where(and(eq(levelProgress.userId, userId), eq(levelProgress.levelId, picked.id)))
      .all();
    return reply.send(
      DailyResponseSchema.parse({
        levelId: picked.id,
        date,
        completed: (row?.completions ?? 0) > 0,
      }),
    );
  });

  app.get('/api/review', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const [skillRows, progressRows] = await Promise.all([
      app.db.select().from(skillProgress).where(eq(skillProgress.userId, userId)).all(),
      app.db.select().from(levelProgress).where(eq(levelProgress.userId, userId)).all(),
    ]);
    const completed = new Set(progressRows.filter((r) => r.completions > 0).map((r) => r.levelId));
    const teachesByLevel = new Map<string, string[]>();
    for (const level of app.levels.byId.values()) {
      if (completed.has(level.id)) {
        teachesByLevel.set(level.id, level.teaches);
      }
    }
    const due = reviewDue(
      skillRows.map((r) => ({
        skillId: r.skillId,
        uses: r.uses,
        lastUsedAt: r.lastUsedAt,
        levelsUsed: [],
      })),
      teachesByLevel,
      completed,
    );
    return reply.send(ReviewResponseSchema.parse({ due }));
  });

  // Badge catalog with earned state for the Profile grid (D-014, T4.3).
  app.get('/api/badges', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const earned = await app.db.select().from(badges).where(eq(badges.userId, userId)).all();
    const earnedAt = new Map(earned.map((r) => [r.badgeId, r.earnedAt]));
    return reply.send(
      BadgesResponseSchema.parse({
        badges: app.badgeList.map((b) => ({
          id: b.id,
          title: b.title,
          description: b.description,
          earnedAt: earnedAt.get(b.id) ?? null,
        })),
      }),
    );
  });

  // Settings "reset progress" (D-014, T4.3): wipe completions, attempts,
  // mastery, badges, XP, and streaks. Identity (user row, tokens, display
  // name) and knowledge (spellbook notes) are kept. A live session is
  // abandoned first so its late completion cannot resurrect progress.
  app.delete('/api/progress', async (request, reply) => {
    const userId = requireUserId(request);
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const live = app.live.getByUser(userId);
    if (live !== undefined) {
      await closeLiveSession(
        {
          provider: app.provider,
          manager: app.manager,
          live: app.live,
          coachRules: app.coachRules,
          badgeList: app.badgeList,
          skills: app.levels.skills,
          db: app.db,
          levelsByWorld: app.levels.byWorld,
          levelsById: app.levels.byId,
          unlockAll: app.config.UNLOCK_ALL === 1,
        },
        live,
        'abandoned',
      );
    }
    await app.db.delete(attempts).where(eq(attempts.userId, userId)).run();
    await app.db.delete(levelProgress).where(eq(levelProgress.userId, userId)).run();
    await app.db.delete(skillProgress).where(eq(skillProgress.userId, userId)).run();
    await app.db.delete(badges).where(eq(badges.userId, userId)).run();
    await app.db
      .update(users)
      .set({ xp: 0, streakDays: 0, lastActiveDay: null })
      .where(eq(users.id, userId))
      .run();
    return reply.send(OkResponseSchema.parse({ ok: true }));
  });
}
