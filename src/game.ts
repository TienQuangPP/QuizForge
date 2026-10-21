// XP, levels and achievements. Stored in localStorage (small and per-browser like the rest).

export interface GameState {
  xp: number;
  unlocked: Record<string, number>;
  bestCombo: number;
  bestSpeed: number;
  bestSurvival: number;
  dailyDone: string; // yyyy-mm-dd of last finished daily challenge
  dailyCount: number;
  aiGenerated: number;
}

export const GAME_KEY = "quizforge-game-v1";
export const EMPTY_GAME: GameState = { xp: 0, unlocked: {}, bestCombo: 0, bestSpeed: 0, bestSurvival: 0, dailyDone: "", dailyCount: 0, aiGenerated: 0 };

export function loadGame(): GameState {
  try {
    return { ...EMPTY_GAME, ...JSON.parse(localStorage.getItem(GAME_KEY) || "{}") };
  } catch {
    return EMPTY_GAME;
  }
}

/** Level n starts at 50·(n-1)² XP. */
export const levelOf = (xp: number) => Math.floor(Math.sqrt(xp / 50)) + 1;
export const xpForLevel = (lv: number) => 50 * (lv - 1) ** 2;

const TITLES: [number, string, string][] = [
  [1, "Tập sự", "🌱"],
  [3, "Chăm chỉ", "📖"],
  [5, "Ham học", "✏️"],
  [8, "Học giả", "🎓"],
  [12, "Chuyên gia", "🧠"],
  [16, "Bậc thầy", "🏅"],
  [20, "Huyền thoại", "👑"],
];
export function levelTitle(lv: number) {
  let t = TITLES[0];
  for (const x of TITLES) if (lv >= x[0]) t = x;
  return { name: t[1], icon: t[2] };
}

export interface GameCtx {
  answered: number;
  streak: number;
  mastered: number;
  decks: number;
  questions: number;
  game: GameState;
}

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** Derived achievements are checked from stats; others are unlocked by events. */
  check?: (c: GameCtx) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_answer", icon: "👣", title: "Bước đầu tiên", desc: "Trả lời câu hỏi đầu tiên", check: (c) => c.answered >= 1 },
  { id: "first_deck", icon: "📦", title: "Nhà sưu tầm", desc: "Tạo bộ đề đầu tiên", check: (c) => c.decks >= 1 },
  { id: "bank_100", icon: "🏦", title: "Ngân hàng đề", desc: "Có 100 câu hỏi trong thư viện", check: (c) => c.questions >= 100 },
  { id: "ai_creator", icon: "🪄", title: "Phù thuỷ AI", desc: "Tạo câu hỏi bằng AI lần đầu", check: (c) => c.game.aiGenerated >= 1 },
  { id: "answers_100", icon: "💯", title: "Trăm câu", desc: "Trả lời 100 câu", check: (c) => c.answered >= 100 },
  { id: "answers_500", icon: "📚", title: "Mọt sách", desc: "Trả lời 500 câu", check: (c) => c.answered >= 500 },
  { id: "answers_2000", icon: "🏔️", title: "Leo núi tri thức", desc: "Trả lời 2.000 câu", check: (c) => c.answered >= 2000 },
  { id: "mastered_50", icon: "🧠", title: "Thuộc lòng", desc: "Thuộc 50 câu (ôn cách nhau ≥ 7 ngày)", check: (c) => c.mastered >= 50 },
  { id: "streak_3", icon: "🔥", title: "Giữ lửa", desc: "Học 3 ngày liên tiếp", check: (c) => c.streak >= 3 },
  { id: "streak_7", icon: "🌟", title: "Một tuần bền bỉ", desc: "Học 7 ngày liên tiếp", check: (c) => c.streak >= 7 },
  { id: "streak_30", icon: "🏆", title: "Kỷ luật thép", desc: "Học 30 ngày liên tiếp", check: (c) => c.streak >= 30 },
  { id: "combo_5", icon: "⚡", title: "Combo x5", desc: "Đúng 5 câu liên tiếp", check: (c) => c.game.bestCombo >= 5 },
  { id: "combo_10", icon: "💥", title: "Combo x10", desc: "Đúng 10 câu liên tiếp", check: (c) => c.game.bestCombo >= 10 },
  { id: "combo_25", icon: "🚀", title: "Không thể cản", desc: "Đúng 25 câu liên tiếp", check: (c) => c.game.bestCombo >= 25 },
  { id: "perfect", icon: "🎯", title: "Điểm tuyệt đối", desc: "Đúng 100% một bài từ 10 câu trở lên" },
  { id: "speed_15", icon: "🏎️", title: "Tia chớp", desc: "Đúng 15 câu trong chế độ Đua tốc độ", check: (c) => c.game.bestSpeed >= 15 },
  { id: "survival_20", icon: "🛡️", title: "Bất tử", desc: "Sống sót qua 20 câu ở chế độ Sinh tồn", check: (c) => c.game.bestSurvival >= 20 },
  { id: "daily_1", icon: "📅", title: "Thử thách đầu tiên", desc: "Hoàn thành thử thách hằng ngày", check: (c) => c.game.dailyCount >= 1 },
  { id: "daily_10", icon: "🗓️", title: "Chiến binh hằng ngày", desc: "Hoàn thành 10 thử thách hằng ngày", check: (c) => c.game.dailyCount >= 10 },
  { id: "theory_first", icon: "📖", title: "Nhà lý luận", desc: "Soạn sổ tay lý thuyết đầu tiên" },
  { id: "theory_reader", icon: "🦉", title: "Hiểu rồi mới làm", desc: "Học xong 5 chủ đề lý thuyết" },
  { id: "night_owl", icon: "🦉", title: "Cú đêm", desc: "Học sau 23 giờ" },
  { id: "early_bird", icon: "🐦", title: "Chim sớm", desc: "Học trước 6 giờ sáng" },
];
