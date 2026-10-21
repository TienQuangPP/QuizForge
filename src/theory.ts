// Theory handbook: AI writing + matching between questions and topic notes.
import { normalize } from "./text";
import type { Question, Settings, SourceDoc, TheoryNote } from "./types";
import { callAI, chunkText, LANG, parseJSON, type GenOptions } from "./ai";
import { subjectOf } from "./subjects";

export interface TheoryOptions {
  subject?: string;
  language: GenOptions["language"];
  depth: "brief" | "detailed";
  instructions: string;
}
export interface TheoryDraft { title: string; summary?: string; content: string }

const THEORY_FORMAT = (depth: TheoryOptions["depth"]) => `Mỗi chủ đề viết bằng Markdown theo khung (bỏ mục nào không phù hợp):
### 🎯 Ý chính
- 3–6 gạch đầu dòng, mỗi dòng một ý cốt lõi, in đậm **thuật ngữ**.
### 📘 Giải thích
${depth === "brief" ? "1 đoạn ngắn, dễ hiểu." : "2–4 đoạn giải thích dễ hiểu như giảng cho người mới: định nghĩa, nguyên nhân – cơ chế, ý nghĩa."}
### 🧩 Ví dụ
Ví dụ cụ thể, gần gũi đời thường.
### ⚖️ So sánh
Bảng Markdown (| Tiêu chí | A | B |) khi có các khái niệm dễ nhầm.
### ⚠️ Dễ nhầm
Những bẫy/hiểu sai thường gặp khi làm bài.
### 💡 Mẹo nhớ
1–2 câu mẹo nhớ (viết tắt, liên tưởng, vần…).`;

const toDraft = (t: any): TheoryDraft | null =>
  t?.title && t?.content ? { title: String(t.title).trim(), summary: t.summary ? String(t.summary).trim() : undefined, content: String(t.content).trim() } : null;

export async function generateTheory(
  s: Settings,
  text: string,
  opts: TheoryOptions,
  knownTopics: string[],
  onProgress: (done: number, total: number, got: TheoryDraft[]) => void,
  signal?: AbortSignal,
): Promise<TheoryDraft[]> {
  const chunks = chunkText(text, 16000);
  const system = `Bạn là giảng viên giỏi, soạn SỔ TAY LÝ THUYẾT ôn thi từ giáo trình: chính xác, dễ hiểu, có cấu trúc.
- Chỉ dựa vào tài liệu; không bịa. Chia nội dung thành các chủ đề logic (thường 3–8 chủ đề cho mỗi phần tài liệu).
- ${LANG[opts.language]}
- Môn học: ${subjectOf(opts.subject).label}. ${subjectOf(opts.subject).hint}
${THEORY_FORMAT(opts.depth)}
Trả về DUY NHẤT JSON: {"topics":[{"title":"Tên chủ đề ngắn gọn","summary":"Một câu tóm tắt","content":"Markdown…"}]}`;
  const out: TheoryDraft[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) break;
    const prompt = [
      knownTopics.length ? `Bộ câu hỏi đang dùng các tên chủ đề sau — nếu nội dung khớp, hãy dùng ĐÚNG tên này làm title: ${knownTopics.slice(0, 40).join("; ")}` : "",
      out.length ? `Đã có các chủ đề: ${out.map((t) => t.title).join("; ")} — không lặp lại.` : "",
      opts.instructions ? `Yêu cầu thêm: ${opts.instructions}` : "",
      `TÀI LIỆU${chunks.length > 1 ? ` (phần ${i + 1}/${chunks.length})` : ""}:\n"""\n${chunks[i]}\n"""`,
    ].filter(Boolean).join("\n");
    let got: TheoryDraft[] = [];
    for (let attempt = 0; attempt < 2 && !got.length; attempt++) {
      const raw = await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal, temperature: 0.3 });
      try {
        const j = parseJSON(raw);
        got = (Array.isArray(j) ? j : j.topics ?? []).map(toDraft).filter(Boolean) as TheoryDraft[];
      } catch {
        if (attempt === 1) throw new Error("AI trả về dữ liệu không đúng định dạng. Thử lại hoặc đổi model.");
      }
    }
    out.push(...got);
    onProgress(i + 1, chunks.length, got);
  }
  return out;
}

/** Writes (or rewrites) a single topic note from the given context. */
export async function writeTopicNote(s: Settings, title: string, context: string, opts: TheoryOptions, current?: string, signal?: AbortSignal): Promise<TheoryDraft> {
  const system = `Bạn là giảng viên giỏi, viết một mục trong sổ tay lý thuyết ôn thi. ${LANG[opts.language]}
${THEORY_FORMAT(opts.depth)}
Trả về DUY NHẤT JSON: {"title":"…","summary":"…","content":"Markdown…"}`;
  const prompt = [
    `Chủ đề: ${title}`,
    current ? `Bản hiện tại (hãy viết lại ${opts.depth === "detailed" ? "chi tiết, dễ hiểu hơn" : "gọn hơn"}, giữ thông tin đúng):\n"""${current}"""` : "",
    opts.instructions ? `Yêu cầu thêm: ${opts.instructions}` : "",
    `TÀI LIỆU THAM KHẢO:\n"""\n${context.slice(0, 20000) || "(không có tài liệu — dùng kiến thức chuẩn, chính xác)"}\n"""`,
  ].filter(Boolean).join("\n");
  const d = toDraft(parseJSON(await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal, temperature: 0.3 })));
  if (!d) throw new Error("AI không trả về nội dung.");
  return d;
}

// ---------------------------------------------------------------------------

const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 3);

function overlap(a: Set<string>, text: string) {
  const ws = words(text);
  let hit = 0;
  for (const w of ws) if (a.has(w)) hit++;
  return hit / Math.sqrt(ws.length + 8);
}

const sameTopic = (a?: string, b?: string) => {
  if (!a || !b) return false;
  const x = normalize(a), y = normalize(b);
  return x === y || (x.length > 4 && y.includes(x)) || (y.length > 4 && x.includes(y));
};

/** Best theory note for a question, or undefined if nothing is related enough. */
export function noteForQuestion(q: Question, notes: TheoryNote[]): TheoryNote | undefined {
  const deckNotes = notes.filter((n) => n.deckId === q.deckId);
  const byTopic = deckNotes.find((n) => sameTopic(n.title, q.topic));
  if (byTopic) return byTopic;
  const qw = new Set(words(q.question + " " + q.answers.map((a) => q.options[a]).join(" ")));
  let best: TheoryNote | undefined, score = 0;
  for (const n of deckNotes) {
    const s = overlap(qw, n.title + " " + n.title + " " + n.content);
    if (s > score) { score = s; best = n; }
  }
  return score >= 0.3 ? best : undefined;
}

/** Questions that test a note's topic: exact topic first, then the most related by content. */
export function questionsForNote(note: TheoryNote, questions: Question[], limit = 10): Question[] {
  const pool = questions.filter((q) => q.deckId === note.deckId);
  const exact = pool.filter((q) => sameTopic(note.title, q.topic));
  if (exact.length >= limit) return exact.slice(0, limit);
  const nw = new Set(words(note.title + " " + note.title + " " + note.content));
  const rest = pool
    .filter((q) => !exact.includes(q))
    .map((q) => ({ q, s: overlap(nw, q.question + " " + q.options.join(" ")) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit - exact.length)
    .map((x) => x.q);
  return [...exact, ...rest];
}

/** Source text for writing theory: the deck's documents, or its questions when there are none. */
export function theorySource(deckId: string, docs: SourceDoc[], questions: Question[]) {
  const ds = docs.filter((d) => d.deckId === deckId);
  if (ds.length) return { text: ds.map((d) => `### ${d.name}\n${d.text}`).join("\n\n"), fromQuestions: false };
  const byTopic = new Map<string, Question[]>();
  for (const q of questions.filter((x) => x.deckId === deckId)) byTopic.set(q.topic || "Chung", [...(byTopic.get(q.topic || "Chung") ?? []), q]);
  const text = [...byTopic.entries()]
    .map(([t, list]) => `## ${t}\n` + list.map((q) => `- Hỏi: ${q.question}\n  Đáp án: ${q.answers.map((a) => q.options[a]).join("; ")}${q.explanation ? `\n  Giải thích: ${q.explanation}` : ""}`).join("\n"))
    .join("\n\n");
  return { text, fromQuestions: true };
}

/** Relevant slice of the deck's material for one topic title. */
export function contextFor(title: string, deckId: string, docs: SourceDoc[], questions: Question[]) {
  const { text } = theorySource(deckId, docs, questions);
  const tw = new Set(words(title));
  if (!tw.size) return text.slice(0, 16000);
  const paras = text.split(/\n{2,}/).map((p, i) => ({ p, i, s: overlap(tw, p) }));
  const keep = new Set<number>();
  let len = 0;
  for (const x of paras.filter((y) => y.s > 0).sort((a, b) => b.s - a.s)) {
    for (const j of [x.i - 1, x.i, x.i + 1]) if (paras[j] && !keep.has(j)) { keep.add(j); len += paras[j].p.length; }
    if (len > 16000) break;
  }
  return [...keep].sort((a, b) => a - b).map((i) => paras[i].p).join("\n\n") || text.slice(0, 16000);
}
