import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as db from "./db";
import { uid } from "./db";
import { DEFAULT_SETTINGS, type Exercise, type Lesson, type TheoryNote, type Deck, type DraftQuestion, type Progress, type Question, type Session, type Settings, type SourceDoc } from "./types";
import { grade } from "./srs";
import { ACHIEVEMENTS, GAME_KEY, levelOf, levelTitle, loadGame, type GameCtx, type GameState } from "./game";
import { confetti, setFxSettings, sound } from "./fx";
import { onModelSwitch, onRetryWait } from "./ai";

const SETTINGS_KEY = "quizforge-settings-v1";

export const DECK_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];
export const DECK_EMOJIS = ["📘", "📗", "📙", "📕", "🧠", "🧪", "💼", "⚖️", "💻", "🌏", "📐", "🩺", "🎯", "🗣️"];

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export { normalize } from "./text";
import { normalize } from "./text";

export interface Toast { id: string; text: string; kind: "ok" | "err" | "info" | "win"; action?: { label: string; run: () => void } }
export interface Snapshot { decks?: Deck[]; questions?: Question[]; docs?: SourceDoc[]; progress?: Progress[]; notes?: TheoryNote[]; lessons?: Lesson[]; exercises?: Exercise[] }

function useStoreValue() {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notes, setNotes] = useState<TheoryNote[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [game, setGame] = useState<GameState>(loadGame);

  const reload = useCallback(async () => {
    const [d, q, dc, p, s, n, ls, ex] = await Promise.all([
      db.getAll<Deck>("decks"),
      db.getAll<Question>("questions"),
      db.getAll<SourceDoc>("docs"),
      db.getAll<Progress>("progress"),
      db.getAll<Session>("sessions"),
      db.getAll<TheoryNote>("notes"),
      db.getAll<Lesson>("lessons"),
      db.getAll<Exercise>("exercises"),
    ]);
    setLessons(ls.sort((a, b) => a.order - b.order));
    setExercises(ex.sort((a, b) => a.createdAt - b.createdAt));
    setNotes(n.sort((a, b) => a.order - b.order));
    setDecks(d.sort((a, b) => b.updatedAt - a.updatedAt));
    setQuestions(q.sort((a, b) => a.createdAt - b.createdAt));
    setDocs(dc);
    setProgress(Object.fromEntries(p.map((x) => [x.qid, x])));
    setSessions(s.sort((a, b) => b.at - a.at));
    setReady(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--fs", String(settings.fontScale || 1));
    setFxSettings(settings);
  }, [settings]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast["kind"] = "ok", action?: Toast["action"]) => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => dismissToast(id), action ? 8000 : kind === "win" ? 5000 : 3800);
  }, [dismissToast]);

  // A retired AI model is replaced automatically; remember the new one and tell the user.
  useEffect(() => {
    onModelSwitch((provider, from, to, reason) => {
      if (reason === "quota") {
        // Daily free quota resets tomorrow, so keep the user's choice and switch only for this session.
        toast(`Hết lượt miễn phí hôm nay của “${from}” — tạm dùng “${to}”, bạn không cần làm gì.`, "info");
        return;
      }
      const field = provider === "openai" ? "openaiModel" : provider === "gemini" ? "geminiModel" : "compatModel";
      setSettingsState((s) => {
        const next = { ...s, [field]: to };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return next;
      });
      toast(`Model AI “${from}” đã ngừng hoạt động — đã tự chuyển sang “${to}”.`, "info");
    });
    onRetryWait((sec) => toast(`⏳ AI miễn phí đang giới hạn số lần gọi — tự thử lại sau ${sec} giây, bạn không cần làm gì.`, "info"));
    return () => { onModelSwitch(null); onRetryWait(null); };
  }, [toast]);

  const patchGame = useCallback((fn: (g: GameState) => GameState) => {
    setGame((g) => {
      const next = fn(g);
      localStorage.setItem(GAME_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addXp = useCallback((n: number) => {
    if (n <= 0) return;
    setGame((g) => {
      const next = { ...g, xp: g.xp + n };
      localStorage.setItem(GAME_KEY, JSON.stringify(next));
      const before = levelOf(g.xp), after = levelOf(next.xp);
      if (after > before) {
        const t = levelTitle(after);
        setTimeout(() => {
          toast(`${t.icon} Lên cấp ${after}! Danh hiệu: ${t.name}`, "win");
          sound("level");
          confetti(160);
        });
      }
      return next;
    });
  }, [toast]);

  const unlock = useCallback((id: string) => {
    setGame((g) => {
      if (g.unlocked[id]) return g;
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (!a) return g;
      const next = { ...g, unlocked: { ...g.unlocked, [id]: Date.now() }, xp: g.xp + 50 };
      localStorage.setItem(GAME_KEY, JSON.stringify(next));
      setTimeout(() => {
        toast(`${a.icon} Huy hiệu mới: ${a.title} (+50 XP)`, "win");
        sound("badge");
        confetti(90);
      });
      return next;
    });
  }, [toast]);

  const checkAchievements = useCallback((ctx: Omit<GameCtx, "game">) => {
    for (const a of ACHIEVEMENTS) if (a.check && !game.unlocked[a.id] && a.check({ ...ctx, game })) unlock(a.id);
  }, [game, unlock]);

  const restore = useCallback(async (snap: Snapshot) => {
    await db.putMany("decks", snap.decks ?? []);
    await db.putMany("questions", snap.questions ?? []);
    await db.putMany("docs", snap.docs ?? []);
    await db.putMany("progress", snap.progress ?? []);
    await db.putMany("notes", snap.notes ?? []);
    await db.putMany("lessons", snap.lessons ?? []);
    await db.putMany("exercises", snap.exercises ?? []);
    if (snap.lessons?.length) setLessons((x) => [...x.filter((l) => !snap.lessons!.some((y) => y.id === l.id)), ...snap.lessons!].sort((a, b) => a.order - b.order));
    if (snap.exercises?.length) setExercises((x) => [...x.filter((l) => !snap.exercises!.some((y) => y.id === l.id)), ...snap.exercises!]);
    if (snap.notes?.length) setNotes((x) => [...x, ...snap.notes!].sort((a, b) => a.order - b.order));
    if (snap.decks?.length) setDecks((d) => [...snap.decks!, ...d.filter((x) => !snap.decks!.some((y) => y.id === x.id))]);
    if (snap.questions?.length) setQuestions((q) => [...q, ...snap.questions!].sort((a, b) => a.createdAt - b.createdAt));
    if (snap.docs?.length) setDocs((d) => [...d, ...snap.docs!]);
    if (snap.progress?.length) setProgress((p) => ({ ...p, ...Object.fromEntries(snap.progress!.map((x) => [x.qid, x])) }));
  }, []);

  const offerUndo = useCallback((text: string, snap: Snapshot) => {
    toast(text, "info", { label: "↶ Hoàn tác", run: () => restore(snap).then(() => toast("Đã khôi phục")) });
  }, [toast, restore]);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const touchDeck = useCallback(async (deckId: string) => {
    let updated: Deck | undefined;
    setDecks((ds) => {
      const out = ds.map((d) => (d.id === deckId ? (updated = { ...d, updatedAt: Date.now() }) : d));
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    if (updated) await db.putMany("decks", [updated]);
  }, []);

  const createDeck = useCallback(async (partial: Partial<Deck> & { name: string }) => {
    const deck: Deck = {
      id: uid(),
      description: "",
      emoji: DECK_EMOJIS[Math.floor(Math.random() * DECK_EMOJIS.length)],
      color: DECK_COLORS[Math.floor(Math.random() * DECK_COLORS.length)],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    await db.putMany("decks", [deck]);
    setDecks((d) => [deck, ...d]);
    return deck;
  }, []);

  const updateDeck = useCallback(async (deck: Deck) => {
    const next = { ...deck, updatedAt: Date.now() };
    await db.putMany("decks", [next]);
    setDecks((ds) => ds.map((d) => (d.id === deck.id ? next : d)));
  }, []);

  const deleteDeck = useCallback(
    async (deckId: string) => {
      const snap: Snapshot = {
        decks: decks.filter((d) => d.id === deckId),
        questions: questions.filter((q) => q.deckId === deckId),
        docs: docs.filter((d) => d.deckId === deckId),
        notes: notes.filter((n) => n.deckId === deckId),
        lessons: lessons.filter((n) => n.deckId === deckId),
        exercises: exercises.filter((n) => n.deckId === deckId),
      };
      await db.deleteMany("lessons", snap.lessons!.map((n) => n.id));
      await db.deleteMany("exercises", snap.exercises!.map((n) => n.id));
      setLessons((x) => x.filter((n) => n.deckId !== deckId));
      setExercises((x) => x.filter((n) => n.deckId !== deckId));
      await db.deleteMany("notes", snap.notes!.map((n) => n.id));
      setNotes((x) => x.filter((n) => n.deckId !== deckId));
      const qids = snap.questions!.map((q) => q.id);
      const dids = snap.docs!.map((d) => d.id);
      snap.progress = qids.map((id) => progress[id]).filter(Boolean);
      await db.deleteMany("questions", qids);
      await db.deleteMany("progress", qids);
      await db.deleteMany("docs", dids);
      await db.deleteMany("decks", [deckId]);
      setQuestions((q) => q.filter((x) => x.deckId !== deckId));
      setDocs((d) => d.filter((x) => x.deckId !== deckId));
      setDecks((d) => d.filter((x) => x.id !== deckId));
      setProgress((p) => {
        const n = { ...p };
        qids.forEach((id) => delete n[id]);
        return n;
      });
      offerUndo(`Đã xoá bộ đề “${snap.decks![0]?.name ?? ""}”`, snap);
    },
    [decks, questions, docs, progress, notes, lessons, exercises, offerUndo],
  );

  /** Adds questions, skipping exact duplicates already in the deck. Returns number added. */
  const addQuestions = useCallback(
    async (deckId: string, drafts: DraftQuestion[]) => {
      const seen = new Set(questions.filter((q) => q.deckId === deckId).map((q) => normalize(q.question + "|" + q.options.join("|"))));
      const now = Date.now();
      const items: Question[] = [];
      drafts.forEach((d, i) => {
        const key = normalize(d.question + "|" + d.options.join("|"));
        if (!d.question.trim() || d.options.length < 2 || seen.has(key)) return;
        seen.add(key);
        items.push({ ...d, id: uid(), deckId, answers: d.answers.length ? d.answers : [0], createdAt: now + i });
      });
      await db.putMany("questions", items);
      setQuestions((q) => [...q, ...items]);
      if (items.length) await touchDeck(deckId);
      return items.length;
    },
    [questions, touchDeck],
  );

  const updateQuestion = useCallback(async (q: Question) => {
    await db.putMany("questions", [q]);
    setQuestions((qs) => qs.map((x) => (x.id === q.id ? q : x)));
  }, []);

  const deleteQuestions = useCallback(async (ids: string[], silent = false) => {
    const idSet = new Set(ids);
    const snap: Snapshot = { questions: questions.filter((q) => idSet.has(q.id)), progress: ids.map((id) => progress[id]).filter(Boolean) };
    await db.deleteMany("questions", ids);
    await db.deleteMany("progress", ids);
    const set = new Set(ids);
    setQuestions((q) => q.filter((x) => !set.has(x.id)));
    setProgress((p) => {
      const n = { ...p };
      ids.forEach((id) => delete n[id]);
      return n;
    });
    if (!silent) offerUndo(`Đã xoá ${ids.length} câu hỏi`, snap);
  }, [questions, progress, offerUndo]);

  const moveQuestions = useCallback(
    async (ids: string[], deckId: string, copy: boolean) => {
      const set = new Set(ids);
      const src = questions.filter((q) => set.has(q.id));
      if (copy) {
        await addQuestions(deckId, src);
        return;
      }
      const moved = src.map((q) => ({ ...q, deckId }));
      await db.putMany("questions", moved);
      setQuestions((qs) => qs.map((q) => (set.has(q.id) ? { ...q, deckId } : q)));
      await touchDeck(deckId);
    },
    [questions, addQuestions, touchDeck],
  );

  const addDoc = useCallback(async (doc: Omit<SourceDoc, "id" | "createdAt">) => {
    const item: SourceDoc = { ...doc, id: uid(), createdAt: Date.now() };
    await db.putMany("docs", [item]);
    setDocs((d) => [...d, item]);
    return item;
  }, []);

  const deleteDoc = useCallback(async (id: string) => {
    const snap: Snapshot = { docs: docs.filter((d) => d.id === id) };
    await db.deleteMany("docs", [id]);
    setDocs((d) => d.filter((x) => x.id !== id));
    offerUndo(`Đã xoá tài liệu ${snap.docs![0]?.name ?? ""}`, snap);
  }, [docs, offerUndo]);

  const saveNotes = useCallback(async (items: TheoryNote[]) => {
    await db.putMany("notes", items);
    setNotes((x) => {
      const map = new Map(x.map((n) => [n.id, n]));
      for (const n of items) map.set(n.id, n);
      return [...map.values()].sort((a, b) => a.order - b.order);
    });
  }, []);

  const addNotes = useCallback(async (deckId: string, drafts: { title: string; summary?: string; content: string; source: TheoryNote["source"] }[]) => {
    // Time-based order stays unique even when several batches are added before state refreshes.
    const now = Date.now();
    const base = Math.max(now, ...notes.filter((n) => n.deckId === deckId).map((n) => n.order + 1));
    const items: TheoryNote[] = drafts.map((d, i) => ({ ...d, id: uid(), deckId, order: base + i, createdAt: now, updatedAt: now }));
    await saveNotes(items);
    return items;
  }, [notes, saveNotes]);

  const deleteNotes = useCallback(async (ids: string[]) => {
    const set = new Set(ids);
    const snap: Snapshot = { notes: notes.filter((n) => set.has(n.id)) };
    await db.deleteMany("notes", ids);
    setNotes((x) => x.filter((n) => !set.has(n.id)));
    offerUndo(ids.length === 1 ? `Đã xoá chủ đề “${snap.notes![0]?.title ?? ""}”` : `Đã xoá ${ids.length} chủ đề lý thuyết`, snap);
  }, [notes, offerUndo]);

  const saveLessons = useCallback(async (items: Lesson[]) => {
    await db.putMany("lessons", items);
    setLessons((x) => {
      const map = new Map(x.map((n) => [n.id, n]));
      for (const n of items) map.set(n.id, n);
      return [...map.values()].sort((a, b) => a.order - b.order);
    });
  }, []);

  const deleteLessons = useCallback(async (ids: string[], undo = true) => {
    const set = new Set(ids);
    const snap: Snapshot = { lessons: lessons.filter((n) => set.has(n.id)) };
    await db.deleteMany("lessons", ids);
    setLessons((x) => x.filter((n) => !set.has(n.id)));
    if (undo) offerUndo(ids.length === 1 ? `Đã xoá bài “${snap.lessons![0]?.title ?? ""}”` : `Đã xoá ${ids.length} bài học`, snap);
  }, [lessons, offerUndo]);

  const saveExercises = useCallback(async (items: Exercise[]) => {
    await db.putMany("exercises", items);
    setExercises((x) => {
      const map = new Map(x.map((n) => [n.id, n]));
      for (const n of items) map.set(n.id, n);
      return [...map.values()];
    });
  }, []);

  const deleteExercises = useCallback(async (ids: string[]) => {
    const set = new Set(ids);
    const snap: Snapshot = { exercises: exercises.filter((n) => set.has(n.id)) };
    await db.deleteMany("exercises", ids);
    setExercises((x) => x.filter((n) => !set.has(n.id)));
    offerUndo(`Đã xoá ${ids.length} bài tập`, snap);
  }, [exercises, offerUndo]);

  const recordAnswer = useCallback(
    async (qid: string, correct: boolean, quality?: number, conf?: number) => {
      const next = grade(progress[qid], qid, correct, quality);
      if (conf != null) {
        next.lastConf = conf;
        if (conf === 2 && !correct) next.confWrong = (next.confWrong ?? 0) + 1;
      }
      setProgress((p) => ({ ...p, [qid]: next }));
      await db.putMany("progress", [next]);
    },
    [progress],
  );

  const toggleFlag = useCallback(
    async (qid: string) => {
      const cur = progress[qid] ?? grade(undefined, qid, false, -1);
      const next = { ...cur, flagged: !cur.flagged };
      setProgress((p) => ({ ...p, [qid]: next }));
      await db.putMany("progress", [next]);
    },
    [progress],
  );

  const resetProgress = useCallback(async (qids: string[]) => {
    await db.deleteMany("progress", qids);
    setProgress((p) => {
      const n = { ...p };
      qids.forEach((id) => delete n[id]);
      return n;
    });
  }, []);

  const addSession = useCallback(async (s: Omit<Session, "id">) => {
    const item = { ...s, id: uid() };
    await db.putMany("sessions", [item]);
    setSessions((x) => [item, ...x]);
  }, []);

  const exportAll = useCallback(
    () => ({
      app: "quizforge",
      version: 1,
      exportedAt: new Date().toISOString(),
      decks,
      questions,
      docs,
      progress: Object.values(progress),
      sessions,
      notes,
      lessons,
      exercises,
      game,
    }),
    [decks, questions, docs, progress, sessions, notes, lessons, exercises, game],
  );

  const importBackup = useCallback(
    async (data: any, replace: boolean) => {
      if (replace) await db.clearAll();
      await db.putMany("decks", data.decks ?? []);
      await db.putMany("questions", data.questions ?? []);
      await db.putMany("docs", data.docs ?? []);
      await db.putMany("progress", data.progress ?? []);
      await db.putMany("sessions", data.sessions ?? []);
      await db.putMany("notes", data.notes ?? []);
      await db.putMany("lessons", data.lessons ?? []);
      await db.putMany("exercises", data.exercises ?? []);
      if (data.game) patchGame((g) => (replace ? { ...g, ...data.game } : { ...g, xp: Math.max(g.xp, data.game.xp ?? 0), unlocked: { ...data.game.unlocked, ...g.unlocked } }));
      await reload();
    },
    [reload, patchGame],
  );

  const wipe = useCallback(async () => {
    await db.clearAll();
    await reload();
  }, [reload]);

  return {
    ready, decks, questions, docs, progress, sessions, notes, lessons, exercises, settings, toasts, game, saveNotes, addNotes, deleteNotes, saveLessons, deleteLessons, saveExercises, deleteExercises,
    toast, dismissToast, setSettings, addXp, unlock, patchGame, checkAchievements, restore, createDeck, updateDeck, deleteDeck, addQuestions, updateQuestion,
    deleteQuestions, moveQuestions, addDoc, deleteDoc, recordAnswer, toggleFlag, resetProgress,
    addSession, exportAll, importBackup, wipe,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("StoreProvider missing");
  return v;
}

export function useDeckStats(deckId?: string) {
  const { questions, progress } = useStore();
  return useMemo(() => {
    const qs = deckId ? questions.filter((q) => q.deckId === deckId) : questions;
    return deckStats(qs, progress);
  }, [questions, progress, deckId]);
}

export function deckStats(qs: Question[], progress: Record<string, Progress>) {
  let seen = 0, mastered = 0, due = 0, wrong = 0, flagged = 0, attempts = 0, correct = 0;
  const now = Date.now();
  for (const q of qs) {
    const p = progress[q.id];
    if (!p || p.attempts === 0) continue;
    seen++;
    attempts += p.attempts;
    correct += p.correct;
    if (p.interval >= 7 && p.lastCorrect) mastered++;
    if (p.due <= now) due++;
    if (!p.lastCorrect) wrong++;
    if (p.flagged) flagged++;
  }
  for (const q of qs) if (progress[q.id]?.flagged && !progress[q.id].attempts) flagged++;
  return { total: qs.length, seen, mastered, due, wrong, flagged, accuracy: attempts ? correct / attempts : 0 };
}
