import { CLASS_IDS, type ClassId } from "./classes";
import type { ClassCounts } from "./types";

export const MAX_CLASS_COUNT = 9;
export const MAX_ROUNDS = 20;

export interface DraftConfigValidation {
  ok: boolean;
  blockers: string[];
}

export function normalizeClassCounts(input: ClassCounts): Record<ClassId, number> {
  const normalized = {} as Record<ClassId, number>;

  for (const classId of CLASS_IDS) {
    const rawValue = Number(input[classId]);
    const value = Number.isFinite(rawValue) ? Math.floor(rawValue) : 0;
    normalized[classId] = clamp(value, 0, MAX_CLASS_COUNT);
  }

  return normalized;
}

export function validateDraftConfig(
  classCounts: ClassCounts,
  rounds: number,
  usedPairs: string[] = []
): DraftConfigValidation {
  const blockers: string[] = [];
  const normalizedCounts = normalizeClassCounts(classCounts);
  const enabledClasses = CLASS_IDS.filter((classId) => normalizedCounts[classId] > 0);
  const totalCopies = enabledClasses.reduce((sum, classId) => sum + normalizedCounts[classId], 0);

  if (!Number.isInteger(rounds) || rounds < 1) {
    blockers.push("Количество раундов должно быть не меньше 1.");
  }

  if (rounds > MAX_ROUNDS) {
    blockers.push(`Количество раундов не может быть больше ${MAX_ROUNDS}.`);
  }

  if (enabledClasses.length < 2) {
    blockers.push("Нужно включить минимум два разных класса.");
  }

  if (totalCopies < rounds * 2) {
    blockers.push(`В пуле классов должно быть минимум ${rounds * 2} копий.`);
  }

  if (blockers.length === 0 && !canCompleteDraft(normalizedCounts, new Set(usedPairs), rounds)) {
    blockers.push("Пул классов не может дать достаточно неповторяющихся пар.");
  }

  return { ok: blockers.length === 0, blockers };
}

export function selectDraftPair(
  classCounts: ClassCounts,
  usedPairs: string[],
  roundsAfterThis: number
): [ClassId, ClassId] | null {
  const normalizedCounts = normalizeClassCounts(classCounts);
  const used = new Set(usedPairs);
  const candidates = shuffle(getAvailablePairs(normalizedCounts, used));

  for (const pair of candidates) {
    const nextCounts = consumePair(normalizedCounts, pair);
    const nextUsed = new Set(used);
    nextUsed.add(pairKey(pair[0], pair[1]));

    if (canCompleteDraft(nextCounts, nextUsed, roundsAfterThis)) {
      return pair;
    }
  }

  return null;
}

export function consumePair(
  classCounts: Record<ClassId, number>,
  pair: [ClassId, ClassId]
): Record<ClassId, number> {
  return {
    ...classCounts,
    [pair[0]]: Math.max(0, classCounts[pair[0]] - 1),
    [pair[1]]: Math.max(0, classCounts[pair[1]] - 1)
  };
}

export function pairKey(first: ClassId, second: ClassId): string {
  return [first, second].sort().join(":");
}

function canCompleteDraft(
  classCounts: Record<ClassId, number>,
  usedPairs: Set<string>,
  roundsRemaining: number,
  memo = new Map<string, boolean>()
): boolean {
  if (roundsRemaining === 0) {
    return true;
  }

  const totalCopies = CLASS_IDS.reduce((sum, classId) => sum + classCounts[classId], 0);
  if (totalCopies < roundsRemaining * 2) {
    return false;
  }

  const pairs = getAvailablePairs(classCounts, usedPairs);
  if (pairs.length < roundsRemaining) {
    return false;
  }

  const memoKey = `${roundsRemaining}|${CLASS_IDS.map((id) => classCounts[id]).join(",")}|${[
    ...usedPairs
  ]
    .sort()
    .join(",")}`;

  const cached = memo.get(memoKey);
  if (cached !== undefined) {
    return cached;
  }

  for (const pair of pairs) {
    const nextCounts = consumePair(classCounts, pair);
    const nextUsed = new Set(usedPairs);
    nextUsed.add(pairKey(pair[0], pair[1]));

    if (canCompleteDraft(nextCounts, nextUsed, roundsRemaining - 1, memo)) {
      memo.set(memoKey, true);
      return true;
    }
  }

  memo.set(memoKey, false);
  return false;
}

function getAvailablePairs(
  classCounts: Record<ClassId, number>,
  usedPairs: Set<string>
): [ClassId, ClassId][] {
  const pairs: [ClassId, ClassId][] = [];

  for (let i = 0; i < CLASS_IDS.length; i += 1) {
    for (let j = i + 1; j < CLASS_IDS.length; j += 1) {
      const first = CLASS_IDS[i];
      const second = CLASS_IDS[j];

      if (classCounts[first] <= 0 || classCounts[second] <= 0) {
        continue;
      }

      if (usedPairs.has(pairKey(first, second))) {
        continue;
      }

      pairs.push([first, second]);
    }
  }

  return pairs;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = cryptoRandomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function cryptoRandomInt(maxExclusive: number): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % maxExclusive;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
