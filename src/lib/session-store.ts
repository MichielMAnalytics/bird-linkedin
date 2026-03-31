/**
 * Persistent session identity for LinkedIn anti-detection.
 * Stores a stable clientUuid, pageInstanceId, display resolution,
 * and (after first auth check) the memberIdentity and clientVersion.
 *
 * All values persist to ~/.config/bird-linkedin/session.json.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { COMMON_RESOLUTIONS } from './linkedin-client-constants.js';

const SESSION_PATH = path.join(homedir(), '.config', 'bird-linkedin', 'session.json');

export interface SessionData {
  /** Stable UUID used in x-li-track and similar telemetry. */
  clientUuid: string;

  /** Base64 random suffix for x-li-page-instance. */
  pageInstanceId: string;

  /** Randomly chosen display resolution for this session. */
  displayWidth: number;
  displayHeight: number;
  displayDensity: number;

  /** Populated after first successful /me or auth call. */
  memberIdentity?: string;

  /** Populated if we successfully scrape the current clientVersion. */
  clientVersion?: string;

  createdAt: string;
}

let cached: SessionData | null = null;

async function readSession(): Promise<SessionData | null> {
  try {
    const raw = await readFile(SESSION_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data?.clientUuid && data?.pageInstanceId) return data as SessionData;
  } catch {}
  return null;
}

async function writeSession(data: SessionData): Promise<void> {
  await mkdir(path.dirname(SESSION_PATH), { recursive: true });
  await writeFile(SESSION_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Generate a base64-encoded random page instance suffix,
 * matching LinkedIn's format: `urn:li:page:d_flagship3_feed;<base64>==`
 */
function generatePageInstanceId(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Pick a random common resolution from the list.
 */
function pickResolution(): { width: number; height: number; density: number } {
  const idx = Math.floor(Math.random() * COMMON_RESOLUTIONS.length);
  return COMMON_RESOLUTIONS[idx];
}

/**
 * Get (or create) the persistent session identity.
 */
export async function getSessionIdentity(): Promise<SessionData> {
  if (cached) return cached;

  const existing = await readSession();
  if (existing) {
    cached = existing;
    return existing;
  }

  const res = pickResolution();
  const fresh: SessionData = {
    clientUuid: randomUUID(),
    pageInstanceId: generatePageInstanceId(),
    displayWidth: res.width,
    displayHeight: res.height,
    displayDensity: res.density,
    createdAt: new Date().toISOString(),
  };

  await writeSession(fresh).catch(() => {});
  cached = fresh;
  return fresh;
}

/**
 * Update the stored session with new fields (memberIdentity, clientVersion, etc.)
 * without regenerating UUIDs or resolution.
 */
export async function updateSessionFields(
  updates: Partial<Pick<SessionData, 'memberIdentity' | 'clientVersion'>>
): Promise<void> {
  const session = await getSessionIdentity();
  let changed = false;

  if (updates.memberIdentity && session.memberIdentity !== updates.memberIdentity) {
    session.memberIdentity = updates.memberIdentity;
    changed = true;
  }
  if (updates.clientVersion && session.clientVersion !== updates.clientVersion) {
    session.clientVersion = updates.clientVersion;
    changed = true;
  }

  if (changed) {
    cached = session;
    await writeSession(session).catch(() => {});
  }
}

/**
 * Regenerate the pageInstanceId (useful for simulating page navigation).
 */
export function rotatePageInstanceId(): string {
  if (cached) {
    cached.pageInstanceId = generatePageInstanceId();
    writeSession(cached).catch(() => {});
  }
  return cached?.pageInstanceId ?? generatePageInstanceId();
}
