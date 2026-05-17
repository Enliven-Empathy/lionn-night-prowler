/**
 * Per-device user profiles + stat persistence. Smash-Bros-style: any
 * number of users on the same browser/device, picked by a 3-char tag.
 * No auth, no privacy boundary — this is a dad-and-kid game.
 *
 * Data lives in a single localStorage key as JSON. Schema is versioned
 * so future migrations can be additive (read-old + write-new).
 *
 * On read, an in-memory cache is built lazily and reused across calls.
 * Every mutating method writes through to localStorage immediately —
 * we don't batch or defer, because a crash during gameplay shouldn't
 * lose the just-recorded best score.
 *
 * If localStorage is blocked (privacy mode, third-party-cookie blocker
 * in some embedded contexts) every method falls back to in-memory-only
 * state. The kid still gets a working session, just no persistence
 * across reloads.
 */

import { evaluateBadges } from './Achievements';

const KEY = 'lionn:userstore:v1';
const SCHEMA_VERSION = 1;
const TAG_LENGTH = 3;

export type GameMode = 'endless' | 'parkour';

export interface UserProfile {
  id: string;
  /** 3-char A-Z tag (Smash Bros style). */
  tag: string;
  /** Per-mode best distance in pixel units (the same number GameScene
   *  uses internally; UI divides by 100 for display in metres). */
  bestDistance: { endless: number; parkour: number };
  /** Per-mode best score (orbs collected this run). */
  bestScore: { endless: number; parkour: number };
  /** Lifetime run count across all modes. */
  totalRuns: number;
  /** Badge unlocks: badge_id → unlocked_at_ms. Phase 2 fills this. */
  badges: Record<string, number>;
  /** ms since epoch when the profile was created. */
  createdAt: number;
  /** Cosmetic skin choice. Resolved via state/Skins.getSkin(); falls
   *  back to the default Lionn if missing or unknown. Optional so
   *  older saved profiles (v1 schema) keep working without migration. */
  selectedSkinId?: string;
}

export interface RunSummary {
  mode: GameMode;
  /** Run distance in pixels, same units as GameScene's internal value. */
  distance: number;
  /** Total orbs collected this run. */
  score: number;
  /** Used by First Blood / Bone Collector badges. */
  enemiesKilled: number;
  /** Successful wall-jumps this run. Counted in PlayerMovement when a
   *  wall-jump's velocity assignment fires; reaches Player → GameScene
   *  via the per-frame snapshot. Used by Wall Walker badge. */
  wallJumps: number;
  /** Successful ledge climbs this run. Counted when climbLedge fires.
   *  Used by Climber badge. */
  ledgeClimbs: number;
  /** Total bosses defeated this run (counts every boss, major or
   *  minor). Used by the Night Slayer badge. */
  bossesKilled: number;
  /** Unique boss ids defeated this run — drives the per-boss badges
   *  (boss_shadow_stalker, boss_crimson_beast, boss_night_sovereign).
   *  Order = first-kill order. Empty array = no bosses defeated. */
  bossIdsKilled: string[];
  startedAt: number;
  endedAt: number;
}

interface StoreData {
  schemaVersion: number;
  currentUserId: string | null;
  users: Record<string, UserProfile>;
}

function defaultData(): StoreData {
  return { schemaVersion: SCHEMA_VERSION, currentUserId: null, users: {} };
}

let cache: StoreData | null = null;

function readRaw(): StoreData {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoreData> | null;
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.schemaVersion === SCHEMA_VERSION &&
        parsed.users &&
        typeof parsed.users === 'object'
      ) {
        cache = {
          schemaVersion: SCHEMA_VERSION,
          currentUserId: parsed.currentUserId ?? null,
          users: parsed.users as Record<string, UserProfile>,
        };
        return cache;
      }
    }
  } catch {
    // localStorage blocked or corrupt — fall through to defaults
  }
  cache = defaultData();
  return cache;
}

function writeRaw(data: StoreData): void {
  cache = data;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // privacy mode etc — in-memory cache survives this session
  }
}

/** Sanitise a tag to exactly TAG_LENGTH uppercase letters. Pads with
 *  'A' on the right; truncates if longer; replaces non-letters with
 *  'A'. Empty string becomes 'AAA'. */
function normaliseTag(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length && out.length < TAG_LENGTH; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 65 && c <= 90) out += raw[i];
    else if (c >= 97 && c <= 122) out += String.fromCharCode(c - 32);
  }
  while (out.length < TAG_LENGTH) out += 'A';
  return out;
}

function makeUserId(): string {
  return `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 0x1000).toString(36)}`;
}

export const UserStore = {
  /** Returns the active profile, or null if no user is selected. */
  getCurrentUser(): UserProfile | null {
    const d = readRaw();
    if (!d.currentUserId) return null;
    return d.users[d.currentUserId] ?? null;
  },

  /** Mark `id` as the active user. No-op if the id doesn't exist. */
  setCurrentUser(id: string): void {
    const d = readRaw();
    if (!d.users[id]) return;
    d.currentUserId = id;
    writeRaw(d);
  },

  listUsers(): UserProfile[] {
    return Object.values(readRaw().users).sort((a, b) => a.createdAt - b.createdAt);
  },

  hasAnyUser(): boolean {
    return Object.keys(readRaw().users).length > 0;
  },

  /** Create a new profile with `tag` (sanitised to 3 uppercase letters)
   *  and immediately make it the current user. Returns the new profile. */
  createUser(tag: string): UserProfile {
    const d = readRaw();
    const id = makeUserId();
    const profile: UserProfile = {
      id,
      tag: normaliseTag(tag),
      bestDistance: { endless: 0, parkour: 0 },
      bestScore: { endless: 0, parkour: 0 },
      totalRuns: 0,
      badges: {},
      createdAt: Date.now(),
    };
    d.users[id] = profile;
    d.currentUserId = id;
    writeRaw(d);
    return profile;
  },

  /** Apply a finished run to the current user. Updates per-mode bests,
   *  totalRuns, and unlocks any newly-triggered badges. Returns the
   *  three pieces of feedback ResultsScene needs:
   *    - isNewBestDistance / isNewBestScore (for NEW BEST callouts)
   *    - newlyUnlockedBadges (badge ids → ResultsScene shows a flourish
   *      and BadgesScene gallery flips them from locked to unlocked).
   *
   *  Imports `Achievements` lazily (require) to keep the dependency
   *  one-way: Achievements depends on UserStore types, but evaluating
   *  triggers needs access to the badge list. The cycle is broken by
   *  importing the evaluator at call time. */
  recordRun(summary: RunSummary): {
    isNewBestDistance: boolean;
    isNewBestScore: boolean;
    newlyUnlockedBadges: string[];
  } {
    const d = readRaw();
    if (!d.currentUserId) {
      return { isNewBestDistance: false, isNewBestScore: false, newlyUnlockedBadges: [] };
    }
    const u = d.users[d.currentUserId];
    if (!u) {
      return { isNewBestDistance: false, isNewBestScore: false, newlyUnlockedBadges: [] };
    }

    const distFloor = Math.max(0, Math.floor(summary.distance));
    const isNewBestDistance = distFloor > (u.bestDistance[summary.mode] ?? 0);
    const isNewBestScore = summary.score > (u.bestScore[summary.mode] ?? 0);

    if (isNewBestDistance) u.bestDistance[summary.mode] = distFloor;
    if (isNewBestScore) u.bestScore[summary.mode] = summary.score;
    u.totalRuns += 1;

    // Badge evaluation runs AFTER the bests/totalRuns update so triggers
    // that read profile state see this run already folded in. Achievements.ts
    // uses `import type` for our types so the dep is one-way at runtime.
    const newlyUnlockedBadges = evaluateBadges(summary, u);
    const now = Date.now();
    for (const id of newlyUnlockedBadges) {
      u.badges[id] = now;
    }

    writeRaw(d);
    return { isNewBestDistance, isNewBestScore, newlyUnlockedBadges };
  },

  /** Set the current user's cosmetic skin id. Looked up by state/Skins
   *  at render time; unknown ids silently fall back to the default. */
  setSelectedSkin(skinId: string): void {
    const d = readRaw();
    if (!d.currentUserId) return;
    const u = d.users[d.currentUserId];
    if (!u) return;
    u.selectedSkinId = skinId;
    writeRaw(d);
  },

  /** Update an existing user's tag (rename). No-op if id missing. */
  renameUser(id: string, newTag: string): void {
    const d = readRaw();
    const u = d.users[id];
    if (!u) return;
    u.tag = normaliseTag(newTag);
    writeRaw(d);
  },

  /** Delete a user. If they were the current user, currentUserId is
   *  cleared (the next scene transition picks up the no-user fallback
   *  and routes to the user select / name entry screen). */
  deleteUser(id: string): void {
    const d = readRaw();
    if (!d.users[id]) return;
    delete d.users[id];
    if (d.currentUserId === id) d.currentUserId = null;
    writeRaw(d);
  },

  /** For tests/debug only — wipes all data. */
  __resetForTests(): void {
    cache = defaultData();
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
