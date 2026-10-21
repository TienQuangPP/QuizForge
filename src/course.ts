// Learning path (course → lessons), thinking exercises, grading and mastery.
import type { Bloom, Exercise, ExerciseType, Lesson, Settings, TheoryNote } from "./types";
import { callAI, LANG, parseJSON, type GenOptions } from "./ai";
import { subjectOf } from "./subjects";
import { normalize } from "./text";

export const BLOOM: Record<Bloom, { label: string; icon: string }> = {
  remember: { label: "Nhớ", icon: "🧷" },
  understand: { label: "Hiểu", icon: "💡" },
  apply: { label: "Vận dụng", icon: "🛠️" },
  analyze: { label: "Phân tích", icon: "🔍" },
  evaluate: { label: "Đánh giá", icon: "⚖️" },
  create: { label: "Sáng tạo", icon: "🎨" },
};

export const EXERCISE_TYPES: Record<ExerciseType, { label: string; icon: string; desc: string; needsAI: boolean }> = {
  cloze: { label: "Điền khuyết", icon: "✍️", desc: "Tự nhớ lại từ khoá, không có gợi ý đáp án", needsAI: false },
  order: { label: "Sắp xếp quy trình", icon: "🔢", desc: "Đặt các bước theo đúng thứ tự", needsAI: false },
  match: { label: "Nối khái niệm", icon: "🔗", desc: "Ghép thuật ngữ với ý nghĩa", needsAI: false },
  truefalse: { label: "Đúng/Sai + lý do", icon: "⚖️", desc: "Phán đoán và giải thích vì sao", needsAI: false },
  open: { label: "Tự luận · Tình huống", icon: "🧠", desc: "Trả lời bằng lời của bạn, AI chấm theo ý", needsAI: true },
  error: { label: "Tìm lỗi sai", icon: "🕵️", desc: "Phát hiện và sửa chỗ sai trong lập luận", needsAI: true },
};

const BLOOMS = Object.keys(BLOOM) as Bloom[];
const asBloom = (b: unknown): Bloom | undefined => (BLOOMS.includes(b as Bloom) ? (b as Bloom) : undefined);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => String(v ?? "").trim()).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// Learning path
// ---------------------------------------------------------------------------

export interface LessonDraft { module: string; title: string; objectives: string[]; concepts: string[] }

export async function generateCourse(
  s: Settings,
  material: string,
  subject: string | undefined,
  language: GenOptions["language"],
  existingTopics: string[],
  signal?: AbortSignal,
): Promise<LessonDraft[]> {
  const limit = s.provider === "gemini" ? 120000 : 40000;
  const system = `Bạn là nhà thiết kế chương trình giảng dạy. Từ tài liệu, hãy xây dựng LỘ TRÌNH HỌC hợp lý cho người tự học.
- Chia thành 2–6 chương (module), mỗi chương 2–6 bài; bài sau dựa trên bài trước (tiên quyết đi trước).
- Mỗi bài có 2–4 MỤC TIÊU đo được, bắt đầu bằng động từ hành động theo thang Bloom (Nêu được, Giải thích được, Vận dụng…, Phân tích…, So sánh…, Đánh giá…). Có mục tiêu ở tầng Vận dụng/Phân tích, không chỉ "nhớ".
- "concepts": 2–6 khái niệm then chốt của bài.
- ${LANG[language]}
- Môn học: ${subjectOf(subject).label}. ${subjectOf(subject).hint}
Trả về DUY NHẤT JSON: {"modules":[{"title":"Chương 1: …","lessons":[{"title":"…","objectives":["…"],"concepts":["…"]}]}]}`;
  const prompt = `${existingTopics.length ? `Sổ tay lý thuyết hiện có các chủ đề (hãy dùng lại đúng tên nếu khớp với bài học): ${existingTopics.join("; ")}\n` : ""}TÀI LIỆU:\n"""\n${material.slice(0, limit)}\n"""`;
  const j = parseJSON(await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal, temperature: 0.3 }));
  const out: LessonDraft[] = [];
  for (const m of j.modules ?? []) {
    for (const l of m.lessons ?? []) {
      if (!l?.title) continue;
      out.push({ module: String(m.title ?? "Chương").trim(), title: String(l.title).trim(), objectives: strs(l.objectives), concepts: strs(l.concepts) });
    }
  }
  if (!out.length) throw new Error("AI không trả về lộ trình. Thử lại hoặc đổi model.");
  return out;
}

/** No-AI path: one lesson per theory note, using its key bullet points as objectives. */
export function courseFromNotes(notes: TheoryNote[]): LessonDraft[] {
  return notes.map((n) => {
    const bullets = [...n.content.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].replace(/\*\*/g, "").trim()).slice(0, 3);
    const terms = [...n.content.matchAll(/\*\*([^*]{2,40})\*\*/g)].map((m) => m[1].trim());
    return {
      module: "Sổ tay lý thuyết",
      title: n.title,
      objectives: bullets.length ? bullets.map((b) => "Hiểu: " + b) : [`Giải thích được ${n.title.toLowerCase()}`],
      concepts: [...new Set(terms)].slice(0, 6),
    };
  });
}

export function newLesson(d: LessonDraft, deckId: string, order: number, noteId?: string): Lesson {
  return { ...d, id: crypto.randomUUID(), deckId, order, noteId, steps: {}, mastery: 0, reviewStage: 0, createdAt: Date.now() };
}

/** Mastery from the 4 lesson steps; a lesson counts as done at 70%. */
export function computeMastery(st: Lesson["steps"]) {
  return (st.theory ?? 0) * 0.15 + (st.explain ?? 0) * 0.25 + (st.exercises ?? 0) * 0.3 + (st.quiz ?? 0) * 0.3;
}
export const MASTERED = 0.7;
const REVIEW_DAYS = [1, 3, 7, 16, 35, 90];
const DAY = 86_400_000;

/** Updates steps → mastery, and schedules spaced review once the lesson is mastered. */
export function updateLesson(l: Lesson, patch: Partial<Lesson["steps"]>, extra: Partial<Lesson> = {}): Lesson {
  const steps = { ...l.steps, ...patch };
  const mastery = computeMastery(steps);
  const next: Lesson = { ...l, ...extra, steps, mastery };
  if (mastery >= MASTERED && !l.doneAt) {
    next.doneAt = Date.now();
    next.reviewStage = 0;
    next.reviewDue = Date.now() + REVIEW_DAYS[0] * DAY;
  }
  return next;
}

/** Called after a successful review session of a mastered lesson. */
export function advanceReview(l: Lesson, passed: boolean): Lesson {
  const stage = passed ? Math.min(l.reviewStage + 1, REVIEW_DAYS.length - 1) : 0;
  return { ...l, reviewStage: stage, reviewDue: Date.now() + REVIEW_DAYS[stage] * DAY };
}

export const lessonDue = (l: Lesson) => !!l.doneAt && !!l.reviewDue && l.reviewDue <= Date.now();

// ---------------------------------------------------------------------------
// Thinking exercises
// ---------------------------------------------------------------------------

export const EXERCISE_SCHEMA = `Trả về DUY NHẤT JSON {"exercises":[…]} — mỗi phần tử theo đúng loại:
- {"type":"cloze","prompt":"Điền vào chỗ trống","text":"Đoạn văn có chỗ trống [[đáp án]] … [[đáp án 2|cách viết khác]]","explanation":"…","bloom":"remember"}
- {"type":"order","prompt":"Sắp xếp các bước của …","items":["bước 1","bước 2","bước 3","bước 4"],"explanation":"…","bloom":"understand"}   (items theo ĐÚNG thứ tự, 3–7 bước)
- {"type":"match","prompt":"Nối khái niệm với ý nghĩa","pairs":[["thuật ngữ","mô tả"],["…","…"]],"explanation":"…","bloom":"understand"}   (3–6 cặp)
- {"type":"truefalse","prompt":"Nhận định sau đúng hay sai? Giải thích.","statement":"…","isTrue":false,"answer":"Lý do đúng/sai","rubric":["ý cần có"],"bloom":"analyze"}
- {"type":"open","prompt":"Câu hỏi tự luận hoặc tình huống thực tế cụ thể","answer":"Bài giải mẫu","rubric":["ý chính 1","ý chính 2","ý chính 3"],"bloom":"apply"}
- {"type":"error","prompt":"Đoạn lập luận sau có chỗ sai. Hãy chỉ ra và sửa.","text":"Đoạn văn chứa 1 lỗi khái niệm phổ biến","answer":"Chỗ sai và cách sửa","rubric":["chỉ ra đúng lỗi","giải thích vì sao sai","nêu cách đúng"],"bloom":"evaluate"}
"bloom" ∈ remember, understand, apply, analyze, evaluate, create.`;

export async function generateExercises(
  s: Settings,
  topic: string,
  context: string,
  subject: string | undefined,
  opts: { count: number; types: ExerciseType[]; language: GenOptions["language"]; objectives?: string[] },
  signal?: AbortSignal,
): Promise<Omit<Exercise, "id" | "deckId" | "createdAt">[]> {
  const system = `Bạn là giáo viên giỏi, ra BÀI TẬP TƯ DUY giúp người học hiểu sâu thay vì học vẹt.
- Bài tập buộc người học tự nhớ lại, lập luận, vận dụng vào tình huống mới; tránh hỏi lại nguyên văn câu trong tài liệu.
- Trải đều các tầng Bloom, ít nhất một nửa ở tầng Vận dụng trở lên.
- Chỉ dựa vào tài liệu; tình huống phải cụ thể, có số liệu/nhân vật/bối cảnh khi phù hợp.
- ${LANG[opts.language]}
- Môn học: ${subjectOf(subject).label}. ${subjectOf(subject).hint}
${EXERCISE_SCHEMA}`;
  const prompt = `Tạo ${opts.count} bài tập cho chủ đề "${topic}", chỉ dùng các loại: ${opts.types.join(", ")} (phân bổ đều).
${opts.objectives?.length ? `Mục tiêu bài học: ${opts.objectives.join("; ")}\n` : ""}TÀI LIỆU:\n"""\n${context.slice(0, 20000)}\n"""`;
  const j = parseJSON(await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal, temperature: 0.5 }));
  return (j.exercises ?? []).map((e: any) => normalizeExercise(e, topic)).filter(Boolean);
}

/** Validates an exercise coming from an AI (app or web chat). */
export function normalizeExercise(e: any, topic?: string): Omit<Exercise, "id" | "deckId" | "createdAt"> | null {
  const type = e?.type as ExerciseType;
  if (!(type in EXERCISE_TYPES)) return null;
  const base = { type, topic: e.topic ? String(e.topic) : topic, prompt: String(e.prompt ?? "").trim() || EXERCISE_TYPES[type].label, bloom: asBloom(e.bloom), explanation: e.explanation ? String(e.explanation) : undefined, rubric: strs(e.rubric), answer: e.answer ? String(e.answer) : undefined };
  if (type === "cloze") return /\[\[.+?\]\]/.test(e.text ?? "") ? { ...base, text: String(e.text) } : null;
  if (type === "order") { const items = strs(e.items); return items.length >= 3 ? { ...base, items } : null; }
  if (type === "match") {
    const pairs = (Array.isArray(e.pairs) ? e.pairs : []).map((p: any) => (Array.isArray(p) ? [String(p[0] ?? ""), String(p[1] ?? "")] : [String(p?.term ?? p?.left ?? ""), String(p?.definition ?? p?.right ?? "")])).filter((p: string[]) => p[0] && p[1]) as [string, string][];
    return pairs.length >= 3 ? { ...base, pairs } : null;
  }
  if (type === "truefalse") return e.statement ? { ...base, statement: String(e.statement), isTrue: e.isTrue === true || /^(true|đúng|dung)$/i.test(String(e.isTrue)) } : null;
  if (type === "error") return e.text && (e.answer || base.rubric.length) ? { ...base, text: String(e.text) } : null;
  return base.prompt && (base.answer || base.rubric.length) ? base : null;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Accepts small typos and accent-free typing: "quang phan li" matches "quang phân li". */
export function looseEqual(user: string, expected: string) {
  const u = normalize(user), e = normalize(expected);
  if (!u) return false;
  if (u === e || u.replace(/ /g, "") === e.replace(/ /g, "")) return true;
  // Short answers (O2 vs CO2, ATP vs ADP) and numbers must match exactly; typos are forgiven only in longer words.
  if (e.replace(/ /g, "").length < 5) return false;
  if ((u.match(/\d+/g) ?? []).join() !== (e.match(/\d+/g) ?? []).join()) return false;
  return editDistance(u, e) <= Math.max(1, Math.floor(e.length / 7));
}

export const clozeBlanks = (text: string) => [...text.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1].split("|").map((x) => x.trim()));

export function gradeCloze(text: string, answers: string[]) {
  const blanks = clozeBlanks(text);
  const right = blanks.map((alts, i) => alts.some((a) => looseEqual(answers[i] ?? "", a)));
  return { score: blanks.length ? right.filter(Boolean).length / blanks.length : 0, right };
}

export function gradeOrder(correct: string[], user: string[]) {
  const right = user.map((x, i) => x === correct[i]);
  return { score: right.filter(Boolean).length / correct.length, right };
}

export function gradeMatch(pairs: [string, string][], chosen: Record<string, string>) {
  const right = pairs.map(([l, r]) => chosen[l] === r);
  return { score: right.filter(Boolean).length / pairs.length, right };
}

export interface AIGrade {
  score: number; // 0..10
  covered: string[];
  missing: string[];
  misconceptions: string[];
  feedback: string;
  improved?: string;
}

/** AI grading of free-text answers against a rubric (or the lesson's theory). */
export async function gradeFreeText(
  s: Settings,
  task: { title: string; prompt: string; reference?: string; rubric?: string[]; context?: string },
  answer: string,
  signal?: AbortSignal,
): Promise<AIGrade> {
  const system = `Bạn là giáo viên chấm bài công bằng, khích lệ nhưng chính xác. Chấm câu trả lời của học sinh theo các ý chính.
- Chấp nhận cách diễn đạt khác nếu đúng ý; không bắt học thuộc nguyên văn.
- Chỉ ra rõ ý còn thiếu và CHỖ HIỂU SAI (nếu có), giải thích ngắn vì sao sai.
- Viết nhận xét bằng tiếng Việt, xưng "bạn", tối đa 4 câu, bắt đầu bằng điểm làm tốt.
Trả về DUY NHẤT JSON: {"score":0-10,"covered":["ý đã có"],"missing":["ý còn thiếu"],"misconceptions":["chỗ hiểu sai và vì sao"],"feedback":"nhận xét","improved":"câu trả lời mẫu ngắn gọn, viết lại từ ý của học sinh"}`;
  const prompt = `NHIỆM VỤ: ${task.title}
ĐỀ: ${task.prompt}
${task.rubric?.length ? `Ý CHÍNH CẦN CÓ:\n${task.rubric.map((r) => "- " + r).join("\n")}\n` : ""}${task.reference ? `ĐÁP ÁN THAM KHẢO:\n${task.reference}\n` : ""}${task.context ? `TÀI LIỆU:\n"""${task.context.slice(0, 12000)}"""\n` : ""}
CÂU TRẢ LỜI CỦA HỌC SINH:
"""${answer}"""`;
  const j = parseJSON(await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal, temperature: 0.2, deep: true }));
  return {
    score: Math.max(0, Math.min(10, Number(j.score) || 0)),
    covered: strs(j.covered),
    missing: strs(j.missing),
    misconceptions: strs(j.misconceptions),
    feedback: String(j.feedback ?? ""),
    improved: j.improved ? String(j.improved) : undefined,
  };
}

/** Key ideas of a note — used as a self-check list when no AI is connected. */
export function keyPointsOf(note?: TheoryNote, lesson?: Lesson): string[] {
  const fromNote = note ? [...note.content.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].replace(/\*\*/g, "").trim()).filter((x) => x.length > 8).slice(0, 6) : [];
  return fromNote.length ? fromNote : lesson?.objectives ?? [];
}
