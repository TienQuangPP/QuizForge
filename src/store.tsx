import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as db from "./db";
import { uid } from "./db";
import { DEFAULT_SETTINGS, type Deck, type DraftQuestion, type Progress, type Question, type Session, type Settings, type SourceDoc } from "./types";
import { grade } from "./srs";

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

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export interface Toast { id: string; text: string; kind: "ok" | "err" | "info" }

function useStoreValue() {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const reload = useCallback(async () => {
    const [d, q, dc, p, s] = await Promise.all([
      db.getAll<Deck>("decks"),
      db.getAll<Question>("questions"),
      db.getAll<SourceDoc>("docs"),
      db.getAll<Progress>("progress"),
      db.getAll<Session>("sessions"),
    ]);
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

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = uid();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

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
      const qids = questions.filter((q) => q.deckId === deckId).map((q) => q.id);
      const dids = docs.filter((d) => d.deckId === deckId).map((d) => d.id);
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
    },
    [questions, docs],
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

  const deleteQuestions = useCallback(async (ids: string[]) => {
    await db.deleteMany("questions", ids);
    await db.deleteMany("progress", ids);
    const set = new Set(ids);
    setQuestions((q) => q.filter((x) => !set.has(x.id)));
    setProgress((p) => {
      const n = { ...p };
      ids.forEach((id) => delete n[id]);
      return n;
    });
  }, []);

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
    await db.deleteMany("docs", [id]);
    setDocs((d) => d.filter((x) => x.id !== id));
  }, []);

  const recordAnswer = useCallback(
    async (qid: string, correct: boolean, quality?: number) => {
      const next = grade(progress[qid], qid, correct, quality);
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
    }),
    [decks, questions, docs, progress, sessions],
  );

  const importBackup = useCallback(
    async (data: any, replace: boolean) => {
      if (replace) await db.clearAll();
      await db.putMany("decks", data.decks ?? []);
      await db.putMany("questions", data.questions ?? []);
      await db.putMany("docs", data.docs ?? []);
      await db.putMany("progress", data.progress ?? []);
      await db.putMany("sessions", data.sessions ?? []);
      await reload();
    },
    [reload],
  );

  const wipe = useCallback(async () => {
    await db.clearAll();
    await reload();
  }, [reload]);

  return {
    ready, decks, questions, docs, progress, sessions, settings, toasts,
    toast, setSettings, createDeck, updateDeck, deleteDeck, addQuestions, updateQuestion,
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
