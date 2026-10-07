import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authTokens, users, type User } from './db/schema.js';
import type { Db } from './db/client.js';

// Guest auth for plan.md §6 / D-003: httpOnly SameSite=Lax cookie
// `tq_session` with a random 32-byte token; only its sha256 is stored.
// `secure` stays false in dev (plain http); TLS terminates at the reverse
// proxy in prod — revisit under T9.1.

export const SESSION_COOKIE = 'tq_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createGuest(db: Db): Promise<{ user: User; token: string }> {
  const token = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const [user] = db.insert(users).values({ id: randomUUID(), createdAt: now }).returning().all();
  if (user === undefined) {
    throw new Error('failed to create guest user');
  }
  db.insert(authTokens)
    .values({ tokenHash: hashToken(token), userId: user.id, createdAt: now })
    .run();
  return { user, token };
}

export async function userFromToken(db: Db, token: string | undefined): Promise<User | undefined> {
  if (token === undefined || token === '') {
    return undefined;
  }
  const [link] = db
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, hashToken(token)))
    .all();
  if (link === undefined) {
    return undefined;
  }
  const [user] = db.select().from(users).where(eq(users.id, link.userId)).all();
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: false,
  });
}

export function toUserShape(user: User): {
  id: string;
  displayName: string | null;
  xp: number;
  streakDays: number;
} {
  return { id: user.id, displayName: user.displayName, xp: user.xp, streakDays: user.streakDays };
}

export function requestToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}
