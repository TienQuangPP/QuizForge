import type { Progress } from "./types";

const DAY = 86_400_000;

/**
 * SM-2 style scheduling.
 * quality: 0 = again, 1 = hard, 2 = good, 3 = easy. When omitted it is derived from correctness.
 * quality -1 creates an empty record without counting an attempt (used for flagging).
 */
export function grade(prev: Progress | undefined, qid: string, correct: boolean, quality?: number): Progress {
  const now = Date.now();
  const p: Progress = prev ?? {
    qid, attempts: 0, correct: 0, wrong: 0, streak: 0, ease: 2.5, interval: 0, due: now, lastAt: 0, lastCorrect: false,
  };
  if (quality === -1) return { ...p };
  const q = quality ?? (correct ? 2 : 0);
  const next = { ...p, attempts: p.attempts + 1, lastAt: now };
  if (q === 0) {
    next.wrong++;
    next.streak = 0;
    next.lastCorrect = false;
    next.interval = 0;
    next.ease = Math.max(1.3, p.ease - 0.2);
    next.due = now + 10 * 60_000;
    return next;
  }
  next.correct++;
  next.streak = p.streak + 1;
  next.lastCorrect = true;
  next.ease = Math.max(1.3, p.ease + (q === 1 ? -0.15 : q === 3 ? 0.15 : 0));
  let interval: number;
  if (p.interval === 0) interval = q === 1 ? 1 : q === 3 ? 4 : 1;
  else if (p.interval < 3) interval = q === 1 ? 2 : q === 3 ? 6 : 3;
  else interval = Math.round(p.interval * (q === 1 ? 1.2 : q === 3 ? next.ease * 1.3 : next.ease));
  next.interval = Math.min(interval, 365);
  next.due = now + next.interval * DAY;
  return next;
}

export function formatInterval(days: number) {
  if (days <= 0) return "10 phút";
  if (days < 30) return `${days} ngày`;
  if (days < 365) return `${Math.round(days / 30)} tháng`;
  return "1 năm";
}
