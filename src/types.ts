export type Difficulty = "easy" | "medium" | "hard";

export interface Deck {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
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
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "gemini",
  openaiKey: "",
  openaiModel: "gpt-4.1-mini",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
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
};

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
