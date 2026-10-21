import type { SubjectId } from "./subjects";

export type Difficulty = "easy" | "medium" | "hard";

export interface Deck {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
  /** Kind of subject — tunes AI prompts (formulas for math, context for languages…). */
  subject?: SubjectId;
  createdAt: number;
  updatedAt: number;
}

export interface Question {
  id: string;
  deckId: string;
  question: string;
  options: string[];
  /** indices of correct options (more than one = multiple-answer question) */
  answers: number[];
  explanation?: string;
  topic?: string;
  difficulty?: Difficulty;
  source?: string;
  image?: string;
  /** Cached "AI explain" answer so it doesn't need to be requested again. */
  aiExplain?: string;
  createdAt: number;
}

/** A theory note (one topic) in a deck's study handbook. Content is Markdown. */
export interface TheoryNote {
  id: string;
  deckId: string;
  title: string;
  summary?: string;
  content: string;
  order: number;
  source: "ai" | "manual";
  readAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SourceDoc {
  id: string;
  deckId: string;
  name: string;
  kind: string;
  text: string;
  size: number;
  createdAt: number;
}

export interface Progress {
  qid: string;
  attempts: number;
  correct: number;
  wrong: number;
  streak: number;
  ease: number;
  interval: number;
  due: number;
  lastAt: number;
  lastCorrect: boolean;
  flagged?: boolean;
  note?: string;
  /** Confidence given with the last answer: 0 guess, 1 unsure, 2 sure. */
  lastConf?: number;
  /** How many times the learner was sure but wrong (a misconception signal). */
  confWrong?: number;
}

export type PracticeMode = "practice" | "exam" | "flash" | "speed" | "survival";

export interface Session {
  id: string;
  deckIds: string[];
  mode: PracticeMode;
  total: number;
  correct: number;
  durationSec: number;
  at: number;
  wrongIds: string[];
  daily?: boolean;
  bestCombo?: number;
}

export type AIProvider = "openai" | "gemini" | "compatible";

export interface Settings {
  provider: AIProvider;
  openaiKey: string;
  openaiModel: string;
  geminiKey: string;
  geminiModel: string;
  compatBaseUrl: string;
  compatKey: string;
  compatModel: string;
  temperature: number;
  theme: "light" | "dark" | "system";
  dailyGoal: number;
  examSecondsPerQuestion: number;
  showExplanationAlways: boolean;
  fontScale: number;
  sound: boolean;
  effects: boolean;
  autoRead: boolean;
  speechRate: number;
  /** fast = lower reasoning effort (about 2x quicker); deep = full reasoning. */
  aiSpeed: "fast" | "deep";
  /** Ask "how sure are you?" before revealing the answer in practice mode. */
  askConfidence: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "gemini",
  openaiKey: "",
  openaiModel: "gpt-4.1-mini",
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  compatBaseUrl: "https://openrouter.ai/api/v1",
  compatKey: "",
  compatModel: "",
  temperature: 0.4,
  theme: "system",
  dailyGoal: 30,
  examSecondsPerQuestion: 60,
  showExplanationAlways: true,
  fontScale: 1,
  sound: true,
  effects: true,
  autoRead: false,
  speechRate: 1,
  aiSpeed: "fast",
  askConfidence: false,
};

/** Bloom's taxonomy level of a learning objective or exercise. */
export type Bloom = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";

/** One lesson of a deck's learning path. */
export interface Lesson {
  id: string;
  deckId: string;
  module: string;
  title: string;
  objectives: string[];
  concepts: string[];
  order: number;
  noteId?: string;
  /** Per-step results: theory read (1), self-explanation score 0..1, exercises avg 0..1, quiz score 0..1. */
  steps: { theory?: number; explain?: number; exercises?: number; quiz?: number };
  mastery: number;
  explainText?: string;
  doneAt?: number;
  reviewStage: number;
  reviewDue?: number;
  createdAt: number;
}

export type ExerciseType = "cloze" | "order" | "match" | "truefalse" | "open" | "error";

/** A thinking exercise (beyond multiple choice). Fields used depend on the type. */
export interface Exercise {
  id: string;
  deckId: string;
  lessonId?: string;
  topic?: string;
  type: ExerciseType;
  bloom?: Bloom;
  /** Instruction, question or scenario shown to the learner. */
  prompt: string;
  /** cloze: text with [[answer]] or [[a|b]] blanks · error: a passage containing a mistake */
  text?: string;
  /** order: steps in the correct order */
  items?: string[];
  /** match: [term, description] pairs */
  pairs?: [string, string][];
  /** truefalse: the claim and whether it is true */
  statement?: string;
  isTrue?: boolean;
  /** open/error/truefalse: model answer or correction */
  answer?: string;
  /** Key points a good answer must contain (used for AI grading and self-assessment). */
  rubric?: string[];
  explanation?: string;
  lastScore?: number;
  attempts?: number;
  lastAt?: number;
  createdAt: number;
}

export interface DraftQuestion {
  question: string;
  options: string[];
  answers: number[];
  explanation?: string;
  topic?: string;
  difficulty?: Difficulty;
  source?: string;
  image?: string;
}
