import type { Difficulty, DraftQuestion, Question, Settings } from "./types";
import { letter } from "./parsers";
import { subjectOf } from "./subjects";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // data URLs
}

interface CallOpts {
  system?: string;
  json?: boolean;
  signal?: AbortSignal;
  temperature?: number;
  /** Ask for full reasoning even in "fast" mode (grading, solving). */
  deep?: boolean;
}

export const PROVIDER_LABEL = { openai: "OpenAI (ChatGPT)", gemini: "Google Gemini", compatible: "API tương thích OpenAI" } as const;

export function aiReady(s: Settings) {
  if (s.provider === "openai") return !!s.openaiKey.trim();
  if (s.provider === "gemini") return !!s.geminiKey.trim();
  return !!s.compatBaseUrl.trim() && !!s.compatModel.trim();
}

/** Model actually used: a retired model is transparently replaced (see pickReplacement). */
const modelOverride: Record<string, string> = {};
export function currentModel(s: Settings) {
  const m = s.provider === "openai" ? s.openaiModel : s.provider === "gemini" ? s.geminiModel : s.compatModel;
  return modelOverride[m.trim()] ?? m;
}

type SwitchListener = (provider: Settings["provider"], from: string, to: string, reason: "retired" | "quota") => void;
let switchListener: SwitchListener | null = null;
export const onModelSwitch = (fn: SwitchListener | null) => (switchListener = fn);

class AIError extends Error {
  status: number;
  raw: string;
  constructor(message: string, status: number, raw: string) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

async function readError(res: Response) {
  let body = "";
  let full = "";
  try {
    body = full = await res.text();
    const j = JSON.parse(body);
    body = j.error?.message ?? j.message ?? body;
  } catch { /* keep raw */ }
  const hint =
    res.status === 401 || res.status === 403 ? " — API key sai hoặc không có quyền." :
    res.status === 429 && /PerDay/i.test(full) ? " — Đã hết lượt miễn phí trong ngày của model này." :
    res.status === 429 ? (/free_tier|per ?minute|PerMinute/i.test(full) ? " — Gói miễn phí giới hạn số lần gọi mỗi phút. Đợi khoảng 1 phút rồi thử lại." : " — Hết hạn mức hoặc gửi quá nhiều yêu cầu. Đợi một lát rồi thử lại.") :
    res.status === 503 ? " — Máy chủ AI đang quá tải, thử lại sau ít phút." :
    res.status === 404 ? " — Model không tồn tại, hãy bấm “Tải danh sách model”." : "";
  return new AIError(`Lỗi ${res.status}: ${String(body).slice(0, 300)}${hint}`, res.status, full);
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/** How long the server asked us to wait (Gemini sends RetryInfo.retryDelay like "27s"). */
function serverRetryDelay(raw: string): number | undefined {
  const m = raw.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? raw.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(+m[1] * 1000) + 500 : undefined;
}

let retryListener: ((seconds: number) => void) | null = null;
/** Lets the UI show "waiting N seconds for the free-tier limit" instead of looking frozen. */
export const onRetryWait = (fn: ((seconds: number) => void) | null) => (retryListener = fn);

/** Retries temporary failures (overload, rate limit, network blips) with growing delays. */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const delays = [2000, 6000];
  let waitedForQuota = false;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      // Per-minute free-tier limit: wait as long as the server asks (once, up to a minute).
      const asked = e instanceof AIError && e.status === 429 ? serverRetryDelay(e.raw) : undefined;
      if (asked && asked <= 61000 && !waitedForQuota && !signal?.aborted) {
        waitedForQuota = true;
        retryListener?.(Math.round(asked / 1000));
        await wait(asked, signal);
        i--;
        continue;
      }
      const temporary = e instanceof AIError
        ? [429, 500, 502, 503, 504].includes(e.status) && !/quota|billing|exceeded your current/i.test(e.raw)
        : e instanceof TypeError;
      if (!temporary || i >= delays.length || signal?.aborted) throw e;
      await wait(delays[i], signal);
    }
  }
}

async function openaiLike(baseUrl: string, key: string, model: string, msgs: ChatMsg[], o: CallOpts, temperature: number): Promise<string> {
  const messages: any[] = [];
  if (o.system) messages.push({ role: "system", content: o.system });
  for (const m of msgs) {
    if (m.images?.length) {
      messages.push({
        role: m.role,
        content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))],
      });
    } else messages.push({ role: m.role, content: m.content });
  }
  const send = async (withTemp: boolean, withJson: boolean) => {
    const body: any = { model, messages };
    if (withTemp) body.temperature = temperature;
    if (withJson) body.response_format = { type: "json_object" };
    return fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  };
  let res = await send(true, !!o.json);
  if (res.status === 400) {
    // Some models (reasoning models, some gateways) reject temperature or response_format.
    const err = await res.clone().text();
    if (/temperature/i.test(err)) res = await send(false, !!o.json);
    else if (/response_format|json/i.test(err)) res = await send(true, false);
  }
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function gemini(key: string, model: string, msgs: ChatMsg[], o: CallOpts, temperature: number, fast: boolean): Promise<string> {
  const contents = msgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      { text: m.content },
      ...(m.images ?? []).map((url) => {
        const [meta, data] = url.split(",");
        return { inline_data: { mime_type: meta.match(/data:(.*?);/)?.[1] ?? "image/png", data } };
      }),
    ],
  }));
  const send = (thinkLow: boolean) => {
    const body: any = { contents, generationConfig: { temperature } };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    if (o.json) body.generationConfig.responseMimeType = "application/json";
    // Lower reasoning effort roughly halves latency for routine generation.
    if (thinkLow) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  };
  let res = await send(fast);
  if (fast && res.status === 400 && /thinking/i.test(await res.clone().text())) res = await send(false);
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error("Gemini không trả về kết quả" + (data.promptFeedback?.blockReason ? ` (bị chặn: ${data.promptFeedback.blockReason})` : ""));
  const text = (cand.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
  if (!text && cand.finishReason && cand.finishReason !== "STOP") throw new Error(`Gemini dừng giữa chừng (${cand.finishReason}). Thử lại hoặc rút ngắn tài liệu.`);
  return text;
}

/** Free-tier daily quotas are per model, so other Gemini models can keep the learner going. */
export function quotaAlternatives(provider: Settings["provider"], models: string[], current: string): string[] {
  if (provider !== "gemini") return [];
  const ver = (m: string) => Number(m.match(/-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const preferred = ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
  const others = models.filter((m) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(m)).sort((a, b) => ver(b) - ver(a));
  return [...new Set([...preferred, ...others])].filter((m) => m !== current && models.includes(m));
}

/** Best available replacement when a configured model has been retired. */
export function pickReplacement(provider: Settings["provider"], models: string[]): string | undefined {
  const ver = (m: string) => Number(m.match(/-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  if (provider === "gemini") {
    if (models.includes("gemini-flash-latest")) return "gemini-flash-latest";
    return models.filter((m) => /^gemini-\d+(\.\d+)?-flash$/.test(m)).sort((a, b) => ver(b) - ver(a))[0];
  }
  if (provider === "openai") {
    for (const m of ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4o-mini"]) if (models.includes(m)) return m;
    return models.filter((m) => /^gpt-\d+(\.\d+)?-mini$/.test(m)).sort((a, b) => ver(b) - ver(a))[0];
  }
  return undefined;
}

async function callOnce(s: Settings, model: string, msgs: ChatMsg[], o: CallOpts, t: number) {
  if (s.provider === "gemini") return gemini(s.geminiKey.trim(), model, msgs, o, t, s.aiSpeed !== "deep" && !o.deep);
  if (s.provider === "openai") return openaiLike("https://api.openai.com/v1", s.openaiKey.trim(), model, msgs, o, t);
  return openaiLike(s.compatBaseUrl.trim(), s.compatKey.trim(), model, msgs, o, t);
}

/** Models whose free daily quota ran out during this session. */
const exhausted = new Set<string>();
const isDailyQuota = (e: unknown) =>
  e instanceof AIError && e.status === 429 && (/PerDay/i.test(e.raw) || (serverRetryDelay(e.raw) ?? 0) > 61000);

export async function callAI(s: Settings, msgs: ChatMsg[], o: CallOpts = {}): Promise<string> {
  if (!aiReady(s)) throw new Error("Chưa cấu hình AI. Vào Cài đặt → AI để nhập API key.");
  const t = o.temperature ?? s.temperature;
  const configured = (s.provider === "openai" ? s.openaiModel : s.provider === "gemini" ? s.geminiModel : s.compatModel).trim();
  const model = currentModel(s).trim();
  try {
    if (exhausted.has(model)) throw new AIError("quota", 429, "PerDay");
    return await withRetry(() => callOnce(s, model, msgs, o, t), o.signal);
  } catch (e) {
    const retired = e instanceof AIError && e.status === 404;
    const daily = isDailyQuota(e);
    if ((!retired && !daily) || s.provider === "compatible") throw e;
    if (daily) exhausted.add(model);
    const available = await listModels(s).catch(() => [] as string[]);
    const candidates = retired ? [pickReplacement(s.provider, available)] : quotaAlternatives(s.provider, available, model);
    for (const alt of candidates) {
      if (!alt || alt === model || exhausted.has(alt)) continue;
      try {
        const out = await withRetry(() => callOnce(s, alt, msgs, o, t), o.signal);
        modelOverride[configured] = alt;
        switchListener?.(s.provider, model, alt, daily ? "quota" : "retired");
        return out;
      } catch (e2) {
        if (isDailyQuota(e2)) { exhausted.add(alt); continue; }
        if (e2 instanceof AIError && [404, 500, 503].includes(e2.status)) continue;
        throw e2;
      }
    }
    if (daily) throw new Error("Đã hết lượt AI miễn phí hôm nay của các model Gemini dùng được với key này. Lượt sẽ được cấp lại vào ngày mai — trong lúc chờ, bạn có thể dùng tab “🌐 AI bên ngoài” (ChatGPT/Gemini bản web) để học tiếp ngay.");
    throw e;
  }
}

export async function listModels(s: Settings): Promise<string[]> {
  if (s.provider === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": s.geminiKey.trim() } });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return (data.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""))
      .sort();
  }
  const base = s.provider === "openai" ? "https://api.openai.com/v1" : s.compatBaseUrl.trim().replace(/\/+$/, "");
  const key = s.provider === "openai" ? s.openaiKey.trim() : s.compatKey.trim();
  const res = await fetch(base + "/models", { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const ids: string[] = (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name);
  return (s.provider === "openai" ? ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|search/.test(id)) : ids).sort();
}

export function parseJSON(text: string): any {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    const a2 = t.indexOf("["), b2 = t.lastIndexOf("]");
    if (a2 >= 0 && (a < 0 || a2 < a) && b2 > a2) t = t.slice(a2, b2 + 1);
    else if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }
}

function normalizeDrafts(raw: any, source?: string): DraftQuestion[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.questions ?? [];
  return list
    .map((q): DraftQuestion | null => {
      const options: string[] = (q.options ?? q.choices ?? []).map((o: any) => String(typeof o === "object" ? o.text ?? o.content ?? "" : o).replace(/^\s*[A-Ha-h][.)]\s+/, "").trim());
      if (!q.question || options.length < 2) return null;
      let answers: number[] = (Array.isArray(q.answers) ? q.answers : [q.answers ?? q.answer ?? q.correct ?? 0]).map((a: any) =>
        typeof a === "number" ? a : /^[A-Ha-h]$/.test(String(a).trim()) ? String(a).trim().toUpperCase().charCodeAt(0) - 65 : options.findIndex((o) => o === String(a)),
      );
      answers = [...new Set(answers.filter((i) => i >= 0 && i < options.length))];
      const d = String(q.difficulty ?? "").toLowerCase();
      return {
        question: String(q.question).trim(),
        options,
        answers,
        explanation: q.explanation ? String(q.explanation).trim() : undefined,
        topic: q.topic ? String(q.topic).trim() : undefined,
        difficulty: (["easy", "medium", "hard"].includes(d) ? d : undefined) as Difficulty | undefined,
        source: q.source ? String(q.source) : source,
      };
    })
    .filter(Boolean) as DraftQuestion[];
}

const SCHEMA = `Trả về DUY NHẤT một JSON object dạng:
{"questions":[{"question":"…","options":["…","…","…","…"],"answers":[0],"explanation":"…","topic":"…","difficulty":"easy|medium|hard","source":"…"}]}
- "answers": mảng chỉ số (bắt đầu từ 0) của các phương án đúng.
- "options": KHÔNG ghi chữ cái A./B. ở đầu.`;

export const QUESTION_TYPES = [
  { id: "definition", label: "Định nghĩa / nhận biết" },
  { id: "understanding", label: "Hiểu bản chất / vì sao" },
  { id: "application", label: "Vận dụng / tình huống" },
  { id: "compare", label: "So sánh / phân biệt" },
  { id: "negative", label: "Câu phủ định (NOT / EXCEPT)" },
  { id: "allabove", label: "All / None of the above" },
  { id: "multi", label: "Nhiều đáp án đúng" },
  { id: "truefalse", label: "Đúng / Sai" },
  { id: "numbers", label: "Số liệu / mốc / công thức" },
] as const;

export interface GenOptions {
  /** Subject profile id of the deck (tunes question style). */
  subject?: string;
  count: number;
  language: "vi" | "en" | "source" | "bilingual";
  difficulty: "mixed" | Difficulty;
  optionCount: number;
  types: string[];
  instructions: string;
  withExplanation: boolean;
}

export const LANG: Record<GenOptions["language"], string> = {
  vi: "Viết bằng tiếng Việt.",
  en: "Write in English.",
  source: "Dùng cùng ngôn ngữ với tài liệu.",
  bilingual: "Song ngữ: viết tiếng Anh trước, sau đó bản dịch tiếng Việt trong ngoặc hoặc dòng mới (áp dụng cho câu hỏi, phương án và giải thích).",
};

const FIXED_ORDER = /all of the above|none of the above|tất cả (các )?(đáp án|phương án|ý) trên|không có (đáp án|phương án)|cả [a-d] và [a-d]|both a and b|^(đúng|sai|true|false)$/i;

/** Shuffles options (keeping answers in sync) so correct answers don't cluster on one letter. */
export function shuffleOptions(q: DraftQuestion): DraftQuestion {
  if (q.options.some((o) => FIXED_ORDER.test(o.trim()))) return q;
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answers: q.answers.map((a) => order.indexOf(a)).sort((x, y) => x - y) };
}

export function chunkText(text: string, size = 14000): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    if (cur.length + para.length > size && cur) {
      parts.push(cur);
      cur = "";
    }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) parts.push(para.slice(i, i + size));
    } else cur += (cur ? "\n\n" : "") + para;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export async function generateQuestions(
  s: Settings,
  text: string,
  opts: GenOptions,
  sourceName: string,
  onProgress: (done: number, total: number, got: DraftQuestion[]) => void,
  signal?: AbortSignal,
  avoid: string[] = [],
): Promise<DraftQuestion[]> {
  const chunks = chunkText(text);
  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  // Spread requested count proportionally; every chunk gets at least 1 when count allows.
  let remaining = opts.count;
  const plan = chunks.map((c, i) => {
    const n = i === chunks.length - 1 ? remaining : Math.max(opts.count >= chunks.length ? 1 : 0, Math.round((opts.count * c.length) / totalLen));
    const take = Math.min(remaining, n);
    remaining -= take;
    return take;
  });
  const typeLabels = QUESTION_TYPES.filter((t) => opts.types.includes(t.id)).map((t) => t.label);
  const system = `Bạn là chuyên gia khảo thí, soạn câu hỏi trắc nghiệm chất lượng cao từ giáo trình.
Nguyên tắc:
- Chỉ dựa vào nội dung tài liệu được cung cấp; không bịa kiến thức ngoài tài liệu.
- Mỗi câu kiểm tra một ý quan trọng; tránh câu hỏi vụn vặt về định dạng, số trang, tên file.
- Phương án nhiễu phải hợp lý, cùng độ dài và cùng phong cách với đáp án đúng; không để lộ đáp án.
- Phân bố vị trí đáp án đúng ngẫu nhiên giữa các phương án.
- ${opts.withExplanation ? "Giải thích ngắn gọn vì sao đáp án đúng và vì sao các phương án khác sai, có trích ý trong tài liệu." : "explanation có thể để trống."}
- "source": ghi slide/trang/mục liên quan nếu tài liệu có đánh dấu.
- Môn học: ${subjectOf(opts.subject).label}. ${subjectOf(opts.subject).hint}
${SCHEMA}`;
  const all: DraftQuestion[] = [];
  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) break;
    const n = plan[i];
    if (n <= 0) { done++; continue; }
    const prompt = `Tạo đúng ${n} câu hỏi trắc nghiệm, mỗi câu ${opts.optionCount} phương án.
${LANG[opts.language]}
Độ khó: ${opts.difficulty === "mixed" ? "trộn dễ / trung bình / khó (khoảng 30/50/20)" : opts.difficulty}.
${typeLabels.length ? `Dạng câu hỏi ưu tiên (phân bổ đều): ${typeLabels.join("; ")}.` : ""}
${opts.types.includes("multi") ? "Với câu nhiều đáp án đúng, ghi rõ trong câu hỏi \"(Chọn tất cả đáp án đúng)\"." : "Mỗi câu chỉ có MỘT đáp án đúng."}
${opts.types.includes("truefalse") ? "Câu Đúng/Sai dùng 2 phương án: \"Đúng\", \"Sai\" (hoặc True/False theo ngôn ngữ)." : ""}
${opts.instructions ? `Yêu cầu thêm của người học: ${opts.instructions}` : ""}
${avoid.length ? `Không lặp lại các câu đã có:\n${avoid.slice(-40).map((a) => "- " + a.slice(0, 120)).join("\n")}` : ""}

TÀI LIỆU (${sourceName}${chunks.length > 1 ? `, phần ${i + 1}/${chunks.length}` : ""}):
"""
${chunks[i]}
"""`;
    let got: DraftQuestion[] = [];
    for (let attempt = 0; attempt < 2 && !got.length; attempt++) {
      const out = await callAI(s, [{ role: "user", content: prompt }], { system, json: true, signal });
      try {
        got = normalizeDrafts(parseJSON(out), sourceName);
      } catch {
        if (attempt === 1) throw new Error("AI trả về dữ liệu không đúng định dạng JSON. Thử lại hoặc đổi model.");
      }
    }
    got = got.map(shuffleOptions);
    all.push(...got);
    done++;
    onProgress(done, chunks.length, got);
  }
  return all;
}

/** Turns messy pasted text or photos of exam papers into structured questions. */
export async function extractQuestionsAI(s: Settings, text: string, images: string[], solve: boolean, signal?: AbortSignal): Promise<DraftQuestion[]> {
  const system = `Bạn là trợ lý số hoá đề thi. Nhiệm vụ: trích xuất CHÍNH XÁC các câu hỏi trắc nghiệm có trong nội dung (văn bản hoặc ảnh chụp), giữ nguyên ngôn ngữ và nội dung gốc, không tự thêm câu hỏi.
- Nếu đề có đánh dấu đáp án (in đậm, khoanh, dấu *, bảng đáp án, "Đáp án: B"…) thì dùng đáp án đó.
- ${solve ? "Nếu không có đáp án, hãy tự giải và chọn đáp án đúng nhất, kèm giải thích." : "Nếu không có đáp án, để answers là [] ."}
- explanation: giải thích ngắn gọn bằng ngôn ngữ của câu hỏi${solve ? "" : " (nếu đề có sẵn)"}.
${SCHEMA}`;
  const chunks = text.trim() ? chunkText(text, 16000) : [""];
  const all: DraftQuestion[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = await callAI(
      s,
      [{ role: "user", content: (chunks[i] ? `NỘI DUNG:\n"""\n${chunks[i]}\n"""` : "Trích xuất các câu hỏi trong ảnh.") , images: i === 0 ? images : undefined }],
      { system, json: true, signal, temperature: 0.1, deep: solve },
    );
    all.push(...normalizeDrafts(parseJSON(out)));
  }
  return all;
}

export async function explainQuestion(s: Settings, q: Question, chosen: number[], context?: string, signal?: AbortSignal) {
  const body = `${q.question}
${q.options.map((o, i) => `${letter(i)}. ${o}`).join("\n")}
Đáp án đúng theo bộ đề: ${q.answers.map(letter).join(", ")}
Người học đã chọn: ${chosen.length ? chosen.map(letter).join(", ") : "(chưa chọn)"}
${q.explanation ? `Giải thích có sẵn: ${q.explanation}` : ""}`;
  return callAI(
    s,
    [{ role: "user", content: body, images: q.image ? [q.image] : undefined }],
    {
      signal,
      deep: true,
      system: `Bạn là gia sư tận tâm. Giải thích bằng tiếng Việt, dùng Markdown ngắn gọn:
1. **Kiến thức cốt lõi** cần nắm.
2. **Vì sao đáp án đúng**.
3. **Vì sao từng phương án sai** (nếu người học chọn sai, phân tích lỗi tư duy).
4. **Mẹo ghi nhớ** 1 dòng.
Nếu bạn cho rằng đáp án của bộ đề có thể sai, hãy nói rõ và lý giải.${context ? `\nTài liệu tham khảo:\n"""${context.slice(0, 12000)}"""` : ""}`,
    },
  );
}

export async function tutorReply(s: Settings, history: ChatMsg[], context: string, signal?: AbortSignal) {
  return callAI(s, history, {
    signal,
    system: `Bạn là gia sư AI giúp người học ôn thi. Trả lời bằng ngôn ngữ người học dùng, rõ ràng, có cấu trúc Markdown, ví dụ cụ thể.
Ưu tiên dựa vào tài liệu dưới đây; nếu kiến thức nằm ngoài tài liệu, nói rõ điều đó.
TÀI LIỆU:
"""
${context.slice(0, 60000) || "(chưa có tài liệu — trả lời bằng kiến thức chung)"}
"""`,
  });
}
