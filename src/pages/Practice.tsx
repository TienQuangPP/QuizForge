import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalize, useStore } from "../store";
import type { Difficulty, DraftQuestion, PracticeMode, Progress, Question } from "../types";
import { aiReady, explainQuestion } from "../ai";
import { letter } from "../parsers";
import { DiffBadge, Empty, fmtDuration, go, Markdown, Modal, QuestionForm, shuffle, Spinner } from "../ui";
import { formatInterval, grade } from "../srs";
import { canSpeak, confetti, sound, speak, stopSpeaking } from "../fx";
import { dayKey } from "./Dashboard";

interface RunItem { id: string; order: number[] }
export interface Run {
  mode: PracticeMode;
  deckIds: string[];
  items: RunItem[];
  timeLimitSec: number;
  title: string;
  daily?: boolean;
}
interface RunState {
  run: Run;
  idx: number;
  answers: Record<number, number[]>; // displayed indices
  checked: Record<number, boolean>;
  flashRes: Record<number, number>;
  elapsed: number;
  combo: number;
  bestCombo: number;
  lives: number;
  xp: number;
}

const RUN_KEY = "quizforge-run-v1";
let pendingRun: Run | null = null;

export function startRun(run: Run) {
  if (location.hash === "#/play") {
    // Already on the player (e.g. "play again"): hand the new run over through storage.
    localStorage.setItem(RUN_KEY, JSON.stringify(freshState(run)));
    location.reload();
    return;
  }
  localStorage.removeItem(RUN_KEY);
  pendingRun = run;
  go("play");
}

export function loadSavedRun(): RunState | null {
  try {
    const s = JSON.parse(localStorage.getItem(RUN_KEY) || "null") as RunState | null;
    return s?.run?.items?.length ? s : null;
  } catch {
    return null;
  }
}
export const discardSavedRun = () => localStorage.removeItem(RUN_KEY);

export const MODE_INFO: Record<PracticeMode, { icon: string; title: string; desc: string }> = {
  practice: { icon: "🎯", title: "Luyện tập", desc: "Biết đúng/sai ngay, có giải thích" },
  exam: { icon: "📝", title: "Thi thử", desc: "Làm hết rồi mới chấm điểm" },
  flash: { icon: "🃏", title: "Thẻ ghi nhớ", desc: "Lật thẻ, tự chấm mức nhớ" },
  speed: { icon: "⚡", title: "Đua tốc độ", desc: "Đúng càng nhiều càng tốt trong 60 giây" },
  survival: { icon: "❤️", title: "Sinh tồn", desc: "3 mạng — sai 3 lần là thua" },
};

const SAFE_ORDER = /all of the above|none of the above|tất cả các|cả [abcd] và|không có (đáp án|phương án)|both a and b/i;
const makeItems = (list: Question[], shuffleOpts: boolean): RunItem[] =>
  list.map((q) => ({ id: q.id, order: shuffleOpts && !SAFE_ORDER.test(q.options.join(" ")) ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i) }));

/** Weak, wrong and due questions first, then unseen, then the rest. */
export function smartPick(list: Question[], progress: Record<string, Progress>, count: number) {
  const now = Date.now();
  const score = (q: Question) => {
    const p = progress[q.id];
    if (!p?.attempts) return 2 + Math.random();
    if (!p.lastCorrect) return 4 + Math.random();
    if (p.due <= now) return 3 + Math.random();
    return 1 - p.correct / p.attempts + Math.random() * 0.5;
  };
  return shuffle([...list].sort((a, b) => score(b) - score(a)).slice(0, count));
}

export function startDaily(questions: Question[], progress: Record<string, Progress>) {
  const list = smartPick(questions, progress, 10);
  startRun({ mode: "practice", deckIds: [...new Set(list.map((q) => q.deckId))], items: makeItems(list, true), timeLimitSec: 0, title: "🎯 Thử thách hôm nay", daily: true });
}

type Source = "smart" | "all" | "unseen" | "wrong" | "due" | "flagged";
const CFG_KEY = "quizforge-practice-cfg";

export function PracticeSetup({ deckId, preset }: { deckId?: string; preset?: string }) {
  const store = useStore();
  const saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
  const initialDecks = deckId && deckId !== "all" ? [deckId] : store.decks.map((d) => d.id);
  const presetMode = (["exam", "flash", "speed", "survival"] as PracticeMode[]).find((m) => m === preset);
  const [decks, setDecks] = useState<Set<string>>(new Set(initialDecks));
  const [mode, setMode] = useState<PracticeMode>(presetMode ?? saved.mode ?? "practice");
  const [source, setSource] = useState<Source>(preset === "wrong" ? "wrong" : preset === "due" ? "due" : saved.source ?? "smart");
  const [count, setCount] = useState<number>(saved.count ?? 20);
  const [shuffleQ, setShuffleQ] = useState<boolean>(saved.shuffleQ ?? true);
  const [shuffleO, setShuffleO] = useState<boolean>(saved.shuffleO ?? true);
  const [timeMode, setTimeMode] = useState<"auto" | "none" | "custom">(saved.timeMode ?? "auto");
  const [minutes, setMinutes] = useState<number>(saved.minutes || 15);
  const [speedSec, setSpeedSec] = useState<number>(saved.speedSec ?? 60);
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<"" | Difficulty>("");
  const selIds = preset?.startsWith("sel:") ? new Set(preset.slice(4).split(",")) : null;
  const endless = mode === "speed" || mode === "survival";

  useEffect(() => localStorage.setItem(CFG_KEY, JSON.stringify({ mode, source, count, shuffleQ, shuffleO, timeMode, minutes, speedSec })), [mode, source, count, shuffleQ, shuffleO, timeMode, minutes, speedSec]);

  const pool = useMemo(() => store.questions.filter((q) => (selIds ? selIds.has(q.id) : decks.has(q.deckId))), [store.questions, decks, preset]); // eslint-disable-line
  const allTopics = useMemo(() => [...new Set(pool.map((q) => q.topic).filter(Boolean))] as string[], [pool]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return pool.filter((q) => {
      const p = store.progress[q.id];
      if (topics.size && !topics.has(q.topic ?? "")) return false;
      if (diff && q.difficulty !== diff) return false;
      if (source === "unseen") return !p?.attempts;
      if (source === "wrong") return !!p?.attempts && !p.lastCorrect;
      if (source === "due") return !!p?.attempts && p.due <= now;
      if (source === "flagged") return !!p?.flagged;
      return true;
    });
  }, [pool, store.progress, topics, diff, source]);

  const n = endless ? filtered.length : Math.min(count, filtered.length);

  const begin = () => {
    let list: Question[];
    if (source === "smart") list = smartPick(filtered, store.progress, n);
    else list = (shuffleQ || endless ? shuffle(filtered) : filtered).slice(0, n);
    if (source === "smart" && !shuffleQ && !endless) list = filtered.filter((q) => list.includes(q));
    if (!list.length) return store.toast("Không có câu nào phù hợp bộ lọc", "err");
    const names = store.decks.filter((d) => decks.has(d.id)).map((d) => d.name);
    startRun({
      mode,
      deckIds: [...new Set(list.map((q) => q.deckId))],
      items: makeItems(list, shuffleO),
      timeLimitSec: mode === "speed" ? speedSec : mode === "exam" ? (timeMode === "none" ? 0 : timeMode === "custom" ? minutes * 60 : list.length * store.settings.examSecondsPerQuestion) : 0,
      title: names.length === 1 ? names[0] : `${names.length} bộ đề`,
    });
  };

  if (!store.questions.length) {
    return (
      <div className="page">
        <Empty icon="🎯" title="Chưa có câu hỏi để luyện">
          <p className="muted">Hãy tạo hoặc nhập câu hỏi trước, hoặc dùng thử bộ mẫu ở trang Tổng quan.</p>
          <div className="row gap center wrap">
            <button className="btn primary" onClick={() => go("studio")}>✨ Tạo bằng AI</button>
            <button className="btn" onClick={() => go("import")}>📥 Nhập câu hỏi</button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1>🎯 Luyện tập</h1>
      {selIds && <div className="callout">Đang luyện {selIds.size} câu đã chọn.</div>}
      <h3>1. Chọn cách chơi</h3>
      <div className="mode-grid">
        {(Object.keys(MODE_INFO) as PracticeMode[]).map((m) => (
          <button key={m} className={"mode" + (mode === m ? " on" : "")} onClick={() => setMode(m)}>
            <span>{MODE_INFO[m].icon}</span>
            <b>{MODE_INFO[m].title}</b>
            <small>{m === "speed" ? `Đúng càng nhiều càng tốt trong ${speedSec} giây` : MODE_INFO[m].desc}</small>
            {m === "speed" && store.game.bestSpeed > 0 && <small className="record">Kỷ lục: {store.game.bestSpeed} câu</small>}
            {m === "survival" && store.game.bestSurvival > 0 && <small className="record">Kỷ lục: {store.game.bestSurvival} câu</small>}
          </button>
        ))}
      </div>

      {!selIds && store.decks.length > 1 && (
        <div className="card stack">
          <div className="row between">
            <h3>2. Bộ đề</h3>
            <div className="row gap">
              <button className="btn sm ghost" onClick={() => setDecks(new Set(store.decks.map((d) => d.id)))}>Chọn tất cả</button>
              <button className="btn sm ghost" onClick={() => setDecks(new Set())}>Bỏ hết</button>
            </div>
          </div>
          <div className="deck-checks">
            {store.decks.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={decks.has(d.id)} onChange={() => setDecks((s) => { const x = new Set(s); x.has(d.id) ? x.delete(d.id) : x.add(d.id); return x; })} />
                {d.emoji} {d.name} <span className="muted small">({store.questions.filter((q) => q.deckId === d.id).length})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card stack">
        <h3>{!selIds && store.decks.length > 1 ? "3." : "2."} Chọn câu</h3>
        <div className="chips">
          {([
            ["smart", "🧠 Thông minh (ưu tiên câu yếu)"],
            ["all", "Tất cả"],
            ["unseen", "Chưa học"],
            ["wrong", "Đang sai"],
            ["due", "Đến hạn ôn"],
            ["flagged", "Đã đánh dấu"],
          ] as [Source, string][]).map(([id, label]) => (
            <button key={id} className={"chip" + (source === id ? " on" : "")} onClick={() => setSource(id)}>{label}</button>
          ))}
        </div>
        {allTopics.length > 1 && (
          <>
            <label>Chủ đề {topics.size > 0 && <a onClick={() => setTopics(new Set())}>(bỏ lọc)</a>}</label>
            <div className="chips">
              {allTopics.map((t) => (
                <button key={t} className={"chip" + (topics.has(t) ? " on" : "")} onClick={() => setTopics((s) => { const x = new Set(s); x.has(t) ? x.delete(t) : x.add(t); return x; })}>{t}</button>
              ))}
            </div>
          </>
        )}
        <div className="grid3">
          {!endless && (
            <div>
              <label>Số câu (có {filtered.length})</label>
              <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value || 1))} />
              <div className="chips tight">
                {[10, 20, 40].map((x) => <button key={x} className={"chip" + (count === x ? " on" : "")} onClick={() => setCount(x)}>{x}</button>)}
                <button className="chip" onClick={() => setCount(filtered.length || 1)}>Hết</button>
              </div>
            </div>
          )}
          {mode === "speed" && (
            <div>
              <label>Thời gian</label>
              <div className="chips">
                {[60, 90, 120].map((x) => <button key={x} className={"chip" + (speedSec === x ? " on" : "")} onClick={() => setSpeedSec(x)}>{x} giây</button>)}
              </div>
            </div>
          )}
          <div>
            <label>Độ khó</label>
            <select value={diff} onChange={(e) => setDiff(e.target.value as any)}>
              <option value="">Mọi mức</option>
              <option value="easy">Dễ</option>
              <option value="medium">Trung bình</option>
              <option value="hard">Khó</option>
            </select>
          </div>
          {mode === "exam" && (
            <div>
              <label>Thời gian làm bài</label>
              <select value={timeMode} onChange={(e) => setTimeMode(e.target.value as any)}>
                <option value="auto">Tự động ({store.settings.examSecondsPerQuestion} giây/câu)</option>
                <option value="none">Không giới hạn</option>
                <option value="custom">Tự chọn số phút</option>
              </select>
              {timeMode === "custom" && <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Math.max(1, +e.target.value || 1))} />}
            </div>
          )}
        </div>
        {!endless && <label className="check"><input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} /> Trộn thứ tự câu hỏi</label>}
        <label className="check"><input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} /> Trộn thứ tự đáp án A, B, C, D</label>
      </div>
      <button className="btn primary big" disabled={!filtered.length} onClick={begin}>
        {MODE_INFO[mode].icon} Bắt đầu {endless ? "" : `${n} câu `}→
      </button>
      <p className="muted small center">Mẹo: bấm phím 1–4 (hoặc A–D) để chọn, Enter để sang câu, F để đánh dấu, R để nghe đọc câu hỏi.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function relevantContext(docsText: string[], q: Question) {
  if (!docsText.length) return "";
  const words = new Set(normalize(q.question + " " + q.options.join(" ")).split(" ").filter((w) => w.length > 3));
  const paras = docsText.join("\n\n").split(/\n{2,}/);
  const scored = paras.map((p) => {
    const n = normalize(p).split(" ");
    let s = 0;
    for (const w of n) if (words.has(w)) s++;
    return { p, s: s / Math.sqrt(n.length + 5) };
  });
  scored.sort((a, b) => b.s - a.s);
  let out = "";
  for (const { p, s } of scored) {
    if (s <= 0 || out.length + p.length > 9000) break;
    out += p + "\n\n";
  }
  return out;
}

function AIExplain({ q, chosen }: { q: Question; chosen: number[] }) {
  const store = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setText(""); setErr(""); }, [q.id]);
  if (!aiReady(store.settings)) return <a className="small" href="#/settings">💡 Kết nối AI để được giải thích chi tiết hơn →</a>;
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const ctx = relevantContext(store.docs.filter((d) => d.deckId === q.deckId).map((d) => d.text), q);
      setText(await explainQuestion(store.settings, q, chosen, ctx));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="ai-explain">
      {!text && (
        <button className="btn sm" disabled={busy} onClick={run}>{busy ? <><Spinner /> AI đang phân tích…</> : "🤖 Nhờ AI giảng kỹ hơn"}</button>
      )}
      {err && <div className="callout bad small">{err}</div>}
      {text && (
        <>
          <Markdown text={text} />
          {canSpeak() && <button className="btn sm ghost" onClick={() => speak(text.replace(/[#*`]/g, ""))}>🔊 Đọc lời giải</button>}
        </>
      )}
    </div>
  );
}

const readQuestion = (q: Question, order: number[]) =>
  speak(`${q.question}. ${order.map((orig, disp) => `${letter(disp)}: ${q.options[orig]}`).join(". ")}`);

function freshState(run: Run): RunState {
  return { run, idx: 0, answers: {}, checked: {}, flashRes: {}, elapsed: 0, combo: 0, bestCombo: 0, lives: 3, xp: 0 };
}

export function Player() {
  const store = useStore();
  const [init] = useState<RunState | null>(() => (pendingRun ? freshState(pendingRun) : loadSavedRun()));
  const run = init?.run ?? null;
  const [idx, setIdx] = useState(init?.idx ?? 0);
  const [answers, setAnswers] = useState<Record<number, number[]>>(init?.answers ?? {});
  const [checked, setChecked] = useState<Record<number, boolean>>(init?.checked ?? {});
  const [flashRes, setFlashRes] = useState<Record<number, number>>(init?.flashRes ?? {});
  const [combo, setCombo] = useState(init?.combo ?? 0);
  const [bestCombo, setBestCombo] = useState(init?.bestCombo ?? 0);
  const [lives, setLives] = useState(init?.lives ?? 3);
  const [xp, setXp] = useState(init?.xp ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);
  const [startAt] = useState(() => Date.now() - (init?.elapsed ?? 0) * 1000);
  const [now, setNow] = useState(Date.now());
  const [showPalette, setShowPalette] = useState(false);
  const [editing, setEditing] = useState<DraftQuestion | null>(null);
  const [pop, setPop] = useState<{ key: number; text: string } | null>(null);
  const [prevBest] = useState(() => ({ speed: store.game.bestSpeed, survival: store.game.bestSurvival }));
  const recorded = useRef(false);
  const advanceTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    pendingRun = null;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearTimeout(advanceTimer.current); stopSpeaking(); };
  }, []);

  const qmap = useMemo(() => new Map(store.questions.map((q) => [q.id, q])), [store.questions]);
  const items = useMemo(() => (run?.items ?? []).filter((it) => qmap.has(it.id)), [run, qmap]);
  const elapsed = Math.floor((now - startAt) / 1000);
  const remaining = run?.timeLimitSec ? run.timeLimitSec - elapsed : 0;
  const instant = run ? run.mode !== "exam" && run.mode !== "flash" : false; // check on answer
  const auto = run?.mode === "speed" || run?.mode === "survival";

  // Persist progress so a refresh or accidental close can resume.
  useEffect(() => {
    if (!run || finished) return;
    const state: RunState = { run, idx, answers, checked, flashRes, elapsed, combo, bestCombo, lives, xp };
    try { localStorage.setItem(RUN_KEY, JSON.stringify(state)); } catch { /* storage full */ }
  }, [run, idx, answers, checked, flashRes, elapsed, combo, bestCombo, lives, xp, finished]);

  const view = (i: number) => {
    const it = items[i];
    const q = qmap.get(it.id)!;
    const order = q.options.length === it.order.length ? it.order : q.options.map((_, j) => j);
    return { q, order, correct: order.map((orig, disp) => (q.answers.includes(orig) ? disp : -1)).filter((x) => x >= 0) };
  };
  const isCorrect = (i: number, ans = answers[i]) => [...(ans ?? [])].sort().join(",") === view(i).correct.sort().join(",");

  const finish = useCallback(async () => {
    if (!run || recorded.current) return;
    recorded.current = true;
    clearTimeout(advanceTimer.current);
    localStorage.removeItem(RUN_KEY);
    let total = 0, correct = 0;
    const wrongIds: string[] = [];
    if (run.mode === "flash") {
      for (const [i, quality] of Object.entries(flashRes)) {
        total++;
        if (quality > 0) correct++;
        else wrongIds.push(items[+i].id);
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        const answered = run.mode === "exam" ? !!answers[i]?.length : checked[i];
        if (!answered && run.mode !== "exam") continue;
        total++;
        const ok = isCorrect(i);
        if (ok) correct++;
        else wrongIds.push(items[i].id);
        if (run.mode === "exam") await store.recordAnswer(items[i].id, ok);
      }
    }
    let bonus = 0;
    if (run.mode === "exam") bonus += correct * 8 + (total - correct) * 2;
    if (total >= 5) bonus += 20;
    if (total >= 10 && correct === total) {
      store.unlock("perfect");
      bonus += 50;
    }
    if (run.daily && total >= Math.min(10, items.length)) {
      bonus += 100;
      store.patchGame((g) => ({ ...g, dailyDone: dayKey(Date.now()), dailyCount: g.dailyDone === dayKey(Date.now()) ? g.dailyCount : g.dailyCount + 1 }));
    }
    store.patchGame((g) => ({
      ...g,
      bestCombo: Math.max(g.bestCombo, bestCombo),
      bestSpeed: run.mode === "speed" ? Math.max(g.bestSpeed, correct) : g.bestSpeed,
      bestSurvival: run.mode === "survival" ? Math.max(g.bestSurvival, correct) : g.bestSurvival,
    }));
    const h = new Date().getHours();
    if (total && h >= 23) store.unlock("night_owl");
    if (total && h < 6) store.unlock("early_bird");
    store.addXp(bonus);
    setXp((x) => x + bonus);
    if (total) await store.addSession({ deckIds: run.deckIds, mode: run.mode, total, correct, durationSec: Math.floor((Date.now() - startAt) / 1000), at: Date.now(), wrongIds, daily: run.daily, bestCombo });
    if (total >= 5 && correct / total >= 0.8) confetti(200);
    setFinished(true);
  }, [run, items, answers, checked, flashRes, store, startAt, bestCombo]); // eslint-disable-line

  useEffect(() => {
    if (!run || finished || !run.timeLimitSec) return;
    if (remaining <= 0) {
      store.toast(run.mode === "speed" ? "⏰ Hết giờ!" : "Hết giờ! Bài đã được nộp.", "info");
      finish();
    } else if (remaining <= 5 && run.mode === "speed") sound("tick");
  }, [remaining]); // eslint-disable-line

  const item = items[idx];
  const cur = item ? view(idx) : null;

  useEffect(() => {
    if (cur && store.settings.autoRead && !finished) readQuestion(cur.q, cur.order);
  }, [idx]); // eslint-disable-line

  const next = useCallback(() => {
    clearTimeout(advanceTimer.current);
    stopSpeaking();
    if (idx < items.length - 1) {
      setIdx(idx + 1);
      setFlipped(false);
    } else finish();
  }, [idx, items.length, finish]);

  const check = (ans = answers[idx]) => {
    if (!run || !ans?.length || checked[idx]) return;
    setChecked((c) => ({ ...c, [idx]: true }));
    const ok = isCorrect(idx, ans);
    store.recordAnswer(item.id, ok);
    const nextCombo = ok ? combo + 1 : 0;
    setCombo(nextCombo);
    if (nextCombo > bestCombo) setBestCombo(nextCombo);
    const gain = ok ? 10 + Math.min(nextCombo, 10) : 2;
    store.addXp(gain);
    setXp((x) => x + gain);
    setPop({ key: Date.now(), text: ok ? `+${gain} XP` : "+2 XP" });
    if (ok && nextCombo >= 3 && nextCombo % 5 === 0) {
      sound("combo");
      confetti(60);
    } else sound(ok ? "right" : "wrong");
    let dead = false;
    if (!ok && run.mode === "survival") {
      dead = lives - 1 <= 0;
      setLives((l) => l - 1);
    }
    if (auto) {
      advanceTimer.current = window.setTimeout(() => (dead ? finish() : next()), ok ? 650 : 1400);
    }
  };

  const choose = (disp: number) => {
    if (!item || finished || !run) return;
    if (instant && checked[idx]) return;
    const multi = cur!.q.answers.length > 1;
    if (multi) {
      // Functional update so rapid taps never drop a selection.
      setAnswers((prev) => {
        const curAns = prev[idx] ?? [];
        return { ...prev, [idx]: curAns.includes(disp) ? curAns.filter((x) => x !== disp) : [...curAns, disp] };
      });
      return;
    }
    setAnswers((prev) => ({ ...prev, [idx]: [disp] }));
    if (instant) check([disp]);
  };

  const rateFlash = (quality: number) => {
    setFlashRes((r) => ({ ...r, [idx]: quality }));
    store.recordAnswer(item.id, quality > 0, quality);
    store.addXp(quality > 0 ? 5 : 1);
    setXp((x) => x + (quality > 0 ? 5 : 1));
    next();
  };

  const submitExam = () => {
    const left = items.length - Object.values(answers).filter((a) => a.length).length;
    if (left && !confirm(`Còn ${left} câu chưa làm. Bạn chắc chắn muốn nộp bài?`)) return;
    finish();
  };

  useEffect(() => {
    if (!run || finished || !item || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      const k = e.key.toLowerCase();
      if (k === "r") return readQuestion(cur!.q, cur!.order);
      if (k === "f") return void store.toggleFlag(item.id);
      if (run.mode === "flash") {
        if (k === " " || k === "enter") { e.preventDefault(); if (!flipped) setFlipped(true); else rateFlash(2); }
        else if (flipped && ["1", "2", "3", "4"].includes(k)) rateFlash(+k - 1);
        return;
      }
      const n = /^[1-9]$/.test(k) ? +k - 1 : /^[a-h]$/.test(k) && k !== "f" && k !== "r" ? k.charCodeAt(0) - 97 : -1;
      if (n >= 0 && n < cur!.order.length) choose(n);
      else if (k === "enter") {
        e.preventDefault();
        if (instant) checked[idx] ? next() : check();
        else next();
      } else if (k === "arrowright" && (run.mode === "exam" || checked[idx])) next();
      else if (k === "arrowleft" && idx > 0 && !auto) setIdx(idx - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!run || !items.length) {
    return (
      <div className="page">
        <Empty icon="🎯" title="Không có bài nào đang làm">
          <button className="btn primary" onClick={() => go("practice")}>Bắt đầu luyện tập</button>
        </Empty>
      </div>
    );
  }

  if (finished) return <Results run={run} items={items} view={view} answers={answers} checked={checked} flashRes={flashRes} isCorrect={isCorrect} elapsed={elapsed} xp={xp} bestCombo={bestCombo} prevBest={prevBest} />;

  const { q, order, correct: cd } = cur!;
  const deck = store.decks.find((d) => d.id === q.deckId);
  const p = store.progress[q.id];
  const answeredCount = run.mode === "flash" ? Object.keys(flashRes).length : run.mode === "exam" ? Object.values(answers).filter((a) => a.length).length : Object.keys(checked).length;
  const correctSoFar = Object.keys(checked).filter((i) => isCorrect(+i)).length;
  const isChecked = instant && checked[idx];
  const showAnswer = isChecked || (run.mode === "flash" && flipped);
  const mine = answers[idx] ?? [];
  const multi = q.answers.length > 1;

  return (
    <div className={"player mode-" + run.mode}>
      <div className="player-top">
        <button className="btn ghost sm" onClick={() => {
          if (!answeredCount) { localStorage.removeItem(RUN_KEY); return history.back(); }
          if (confirm("Kết thúc bài ngay bây giờ?\n\nOK = chấm điểm các câu đã làm\nCancel = tiếp tục làm")) finish();
        }}>✕ {answeredCount ? "Kết thúc" : "Thoát"}</button>
        <div className="grow center">
          <b>{run.title}</b>
          <div className="muted small">
            {MODE_INFO[run.mode].title}
            {run.mode === "speed" ? ` · Đúng ${correctSoFar}` : run.mode === "survival" ? ` · Đã qua ${correctSoFar} câu` : ` · Câu ${idx + 1}/${items.length}`}
            {run.mode === "practice" && answeredCount > 0 && ` · Đúng ${correctSoFar}/${answeredCount}`}
          </div>
        </div>
        {run.mode === "survival" && <div className="lives" aria-label={`${lives} mạng`}>{"❤️".repeat(Math.max(0, lives))}{"🖤".repeat(Math.max(0, 3 - lives))}</div>}
        {run.timeLimitSec ? (
          <div className={"timer" + (remaining < (run.mode === "speed" ? 10 : 60) ? " low" : "")}>⏱ {fmtDuration(Math.max(0, remaining))}</div>
        ) : (
          <div className="timer muted">⏱ {fmtDuration(elapsed)}</div>
        )}
      </div>
      <div className="bar thin"><span style={{ width: `${run.mode === "speed" && run.timeLimitSec ? (elapsed / run.timeLimitSec) * 100 : (answeredCount / items.length) * 100}%` }} /></div>

      <div className="player-body">
        {combo >= 3 && instant && <div className="combo" key={combo}>🔥 Combo x{combo}</div>}
        <div className={"qcard" + (run.mode === "flash" ? " flash" + (flipped ? " flipped" : "") : "")} onClick={() => run.mode === "flash" && !flipped && setFlipped(true)}>
          {pop && <span className="xp-pop" key={pop.key}>{pop.text}</span>}
          <div className="row between small muted">
            <span>{deck?.emoji} {deck?.name}{q.topic && ` · ${q.topic}`}</span>
            <span className="row gap">
              <DiffBadge d={q.difficulty} />
              {p?.attempts ? <span>Trước đó đúng {p.correct}/{p.attempts}</span> : <span>Câu mới</span>}
            </span>
          </div>
          <div className="qbig">{q.question}</div>
          {multi && run.mode !== "flash" && <div className="pill warn">Câu này có {q.answers.length} đáp án đúng — chọn đủ rồi bấm Kiểm tra</div>}
          {q.image && <img className="qimg" src={q.image} alt="" />}

          <div className="choices">
            {order.map((orig, disp) => {
              const sel = mine.includes(disp);
              const ok = cd.includes(disp);
              const cls = showAnswer ? (ok ? " right" : sel ? " wrong" : " dim") : sel ? " sel" : "";
              return (
                <button key={disp} className={"choice" + cls} onClick={(e) => { e.stopPropagation(); if (run.mode !== "flash") choose(disp); }} disabled={run.mode === "flash"}>
                  <span className="key">{letter(disp)}</span>
                  <span className="grow">{q.options[orig]}</span>
                  {showAnswer && ok && <span className="mark">✓</span>}
                  {showAnswer && sel && !ok && <span className="mark">✗</span>}
                </button>
              );
            })}
          </div>

          <div className="qtools" onClick={(e) => e.stopPropagation()}>
            {canSpeak() && <button className="btn sm ghost" onClick={() => readQuestion(q, order)} title="Đọc to câu hỏi (phím R)">🔊 Nghe đọc</button>}
            <button className={"btn sm ghost" + (p?.flagged ? " flag-on" : "")} onClick={() => store.toggleFlag(q.id)} title="Đánh dấu để ôn lại (phím F)">⚑ {p?.flagged ? "Đã đánh dấu" : "Đánh dấu"}</button>
            {!auto && <button className="btn sm ghost" onClick={() => setEditing({ ...q })} title="Sửa nội dung/đáp án câu này">✎ Sửa câu</button>}
          </div>

          {run.mode === "flash" && !flipped && <div className="flip-hint">👆 Nhấn vào thẻ để xem đáp án</div>}

          {showAnswer && !(auto && isCorrect(idx)) && (
            <div className={"feedback" + (instant ? (isCorrect(idx) ? " ok" : " no") : "")}>
              {instant && <b className="fb-title">{isCorrect(idx) ? "🎉 Chính xác!" : `❌ Chưa đúng — đáp án đúng là ${cd.map(letter).join(", ")}`}</b>}
              {run.mode === "flash" && <b className="fb-title">Đáp án: {cd.map(letter).join(", ")}</b>}
              {!auto && q.explanation && <p>{q.explanation}</p>}
              {!auto && q.source && <div className="muted small">Nguồn: {q.source}</div>}
              {p && run.mode === "practice" && <div className="muted small">📅 Sẽ nhắc ôn lại sau {formatInterval(p.interval)}</div>}
              {!auto && <AIExplain q={q} chosen={mine.map((d) => order[d])} />}
            </div>
          )}
        </div>

        <div className="player-actions">
          {run.mode === "flash" ? (
            flipped ? (
              <>
                <div className="muted small center" style={{ width: "100%" }}>Bạn nhớ câu này đến đâu?</div>
                <div className="rate">
                  {([["😵 Quên", 0, "bad"], ["😓 Khó", 1, "warn"], ["🙂 Nhớ", 2, "good"], ["😎 Dễ", 3, "accent"]] as const).map(([label, quality, tone]) => (
                    <button key={label} className={"btn " + tone} onClick={() => rateFlash(quality)}>
                      {label}
                      <small>ôn lại sau {formatInterval(grade(p, q.id, quality > 0, quality).interval)}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="btn primary big" onClick={() => setFlipped(true)}>Lật thẻ xem đáp án</button>
            )
          ) : instant ? (
            <>
              {!auto && <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Câu trước</button>}
              {isChecked ? (
                !auto && <button className="btn primary big" onClick={next}>{idx === items.length - 1 ? "Xem kết quả 🏁" : "Câu tiếp theo →"}</button>
              ) : (
                (multi || !auto) && <button className="btn primary big" disabled={!mine.length} onClick={() => check()}>{mine.length ? "Kiểm tra" : "Chọn một đáp án"}</button>
              )}
              {!isChecked && !auto && <button className="btn ghost" onClick={next}>Bỏ qua</button>}
            </>
          ) : (
            <>
              <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Trước</button>
              <button className="btn" onClick={() => setShowPalette(!showPalette)}>☰ Đã làm {answeredCount}/{items.length}</button>
              {idx < items.length - 1 ? <button className="btn primary" onClick={next}>Tiếp →</button> : <button className="btn primary" onClick={submitExam}>Nộp bài</button>}
            </>
          )}
        </div>

        {run.mode === "exam" && (showPalette || items.length <= 60) && (
          <div className="palette">
            {items.map((it, i) => (
              <button key={i} className={(i === idx ? "cur " : "") + (answers[i]?.length ? "done " : "") + (store.progress[it.id]?.flagged ? "flag" : "")} onClick={() => setIdx(i)}>{i + 1}</button>
            ))}
            <button className="btn primary sm" onClick={submitExam}>Nộp bài</button>
          </div>
        )}
      </div>

      {editing && (
        <Modal wide title="Sửa câu hỏi" onClose={() => setEditing(null)} footer={
          <button className="btn primary" onClick={async () => {
            await store.updateQuestion({ ...q, ...editing, options: editing.options.map((o) => o.trim()) });
            setEditing(null);
            store.toast("Đã lưu thay đổi");
          }}>Lưu</button>
        }>
          <QuestionForm value={editing} onChange={setEditing} />
        </Modal>
      )}
    </div>
  );
}

function Results({ run, items, view, answers, checked, flashRes, isCorrect, elapsed, xp, bestCombo, prevBest }: {
  run: Run;
  items: RunItem[];
  view: (i: number) => { q: Question; order: number[]; correct: number[] };
  answers: Record<number, number[]>;
  checked: Record<number, boolean>;
  flashRes: Record<number, number>;
  isCorrect: (i: number) => boolean;
  elapsed: number;
  xp: number;
  bestCombo: number;
  prevBest: { speed: number; survival: number };
}) {
  const store = useStore();
  const [filter, setFilter] = useState<"all" | "wrong">("wrong");
  const rows = items.map((it, i) => {
    const done = run.mode === "flash" ? i in flashRes : run.mode === "exam" ? true : !!checked[i];
    const ok = run.mode === "flash" ? (flashRes[i] ?? 0) > 0 : (run.mode === "exam" ? !!answers[i]?.length : done) && isCorrect(i);
    return { it, i, done, ok };
  });
  const done = rows.filter((r) => r.done);
  const correct = rows.filter((r) => r.ok).length;
  const total = done.length;
  const pct = total ? correct / total : 0;
  const wrongItems = rows.filter((r) => !r.ok && r.done).map((r) => r.it);
  const shown = rows.filter((r) => r.done && (filter === "wrong" ? !r.ok : true));
  const again = (list: RunItem[]) => startRun({ ...run, daily: false, items: shuffle(list).map((x) => ({ ...x, order: shuffle(x.order) })) });
  const record = run.mode === "speed" ? correct > prevBest.speed : run.mode === "survival" ? correct > prevBest.survival : false;

  const headline =
    run.mode === "speed" ? `⚡ ${correct} câu đúng trong ${run.timeLimitSec} giây!` :
    run.mode === "survival" ? `❤️ Bạn vượt qua ${correct} câu!` :
    pct >= 0.9 ? "Xuất sắc! 🏆" : pct >= 0.7 ? "Làm tốt lắm! 👏" : pct >= 0.5 ? "Khá ổn, cố thêm chút nữa! 💪" : "Đừng nản — ôn lại câu sai nhé 📚";

  return (
    <div className="page narrow">
      <div className="result-hero">
        <div className="score-ring" style={{ ["--p" as any]: pct, ["--tone" as any]: pct >= 0.8 ? "var(--good)" : pct >= 0.5 ? "var(--warn)" : "var(--bad)" }}>
          <div><b>{Math.round(pct * 100)}%</b><small>{correct}/{total} đúng</small></div>
        </div>
        <div className="grow">
          {record && <div className="record-banner">🏅 KỶ LỤC MỚI!</div>}
          {run.daily && <div className="record-banner">✅ Hoàn thành thử thách hôm nay (+100 XP)</div>}
          <h1>{headline}</h1>
          <div className="result-chips">
            {run.mode === "exam" && <span className="pill big">📝 Điểm: <b>{Math.round(pct * 100) / 10}</b>/10</span>}
            <span className="pill big">⭐ +{xp} XP</span>
            <span className="pill big">⏱ {fmtDuration(elapsed)}</span>
            {bestCombo >= 3 && <span className="pill big">🔥 Combo cao nhất x{bestCombo}</span>}
          </div>
          <div className="row gap wrap">
            {wrongItems.length > 0 && <button className="btn primary" onClick={() => again(wrongItems)}>🩹 Làm lại {wrongItems.length} câu sai</button>}
            <button className="btn" onClick={() => again(items)}>↻ Chơi lại</button>
            <button className="btn ghost" onClick={() => go(run.daily ? "" : run.deckIds.length === 1 ? "deck/" + run.deckIds[0] : "practice")}>Xong</button>
          </div>
        </div>
      </div>
      <div className="row between">
        <h3>Xem lại bài</h3>
        <div className="seg">
          <button className={filter === "wrong" ? "on" : ""} onClick={() => setFilter("wrong")}>Câu sai ({wrongItems.length})</button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>Tất cả ({done.length})</button>
        </div>
      </div>
      <div className="stack">
        {shown.map(({ i, ok }) => {
          const { q, order } = view(i);
          const mine = answers[i] ?? [];
          return (
            <div key={i} className={"card review " + (ok ? "ok" : "no")}>
              <div className="qtext"><b>{i + 1}.</b> {q.question} {run.mode === "exam" && !mine.length && <span className="pill">Bỏ trống</span>}</div>
              {q.image && <img className="qimg-small" src={q.image} alt="" />}
              <ol type="A" className="opts">
                {order.map((orig, disp) => (
                  <li key={disp} className={(q.answers.includes(orig) ? "correct " : "") + (mine.includes(disp) && !q.answers.includes(orig) ? "picked-wrong" : "")}>
                    {q.options[orig]} {mine.includes(disp) && <span className="muted">← bạn chọn</span>}
                  </li>
                ))}
              </ol>
              {q.explanation && <div className="explain-mini">💡 {q.explanation}</div>}
              {!ok && <AIExplain q={q} chosen={mine.map((d) => order[d])} />}
              {!ok && <button className="btn sm ghost" onClick={() => store.toggleFlag(q.id)}>⚑ {store.progress[q.id]?.flagged ? "Đã đánh dấu" : "Đánh dấu ôn sau"}</button>}
            </div>
          );
        })}
        {shown.length === 0 && <p className="muted center">{filter === "wrong" ? "Không có câu sai nào 🎉" : "Chưa làm câu nào."}</p>}
      </div>
    </div>
  );
}
