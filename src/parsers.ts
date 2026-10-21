import type { Difficulty, DraftQuestion } from "./types";

export const DOC_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv,.json,.xlsx,.html,.htm,.png,.jpg,.jpeg,.webp";

export const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const isImage = (name: string) => ["png", "jpg", "jpeg", "webp", "gif"].includes(ext(name));

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale big images so they fit in storage and AI requests. */
export async function compressImage(file: Blob, max = 1600): Promise<string> {
  const url = await readAsDataURL(file);
  const img = new Image();
  await new Promise((r, j) => ((img.onload = r), (img.onerror = j), (img.src = url)));
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 600_000) return url;
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function pdfText(buf: ArrayBuffer, onProgress?: (msg: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`Đang đọc trang ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let last = -1;
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as any[]) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5]);
      if (last !== -1 && Math.abs(y - last) > 2) {
        lines.push(line);
        line = "";
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
      last = y;
    }
    if (line) lines.push(line);
    pages.push(`--- Trang ${i} ---\n` + lines.map((l) => l.trim()).filter(Boolean).join("\n"));
  }
  return pages.join("\n\n");
}

async function pptxText(buf: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const num = (p: string) => Number(p.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const path of slides) {
    const xml = await zip.file(path)!.async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join("")).filter((t) => t.trim());
    const notesPath = `ppt/notesSlides/notesSlide${num(path)}.xml`;
    let notes = "";
    if (zip.file(notesPath)) {
      const nx = await zip.file(notesPath)!.async("string");
      notes = [...nx.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(" ").trim();
    }
    out.push(`--- Slide ${num(path)} ---\n${paras.join("\n")}${notes && !/^\d+$/.test(notes) ? `\n[Ghi chú] ${notes}` : ""}`);
  }
  return out.join("\n\n");
}

async function docxText(buf: ArrayBuffer) {
  const mammoth: any = await import("mammoth");
  const res = await (mammoth.extractRawText ?? mammoth.default.extractRawText)({ arrayBuffer: buf });
  return (res.value as string).replace(/\n{3,}/g, "\n\n");
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

/** Reads the first sheet of an .xlsx file as rows of strings (no external dependency). */
export async function xlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.split("</si>").slice(0, -1)) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(""));
    }
  }
  const sheetPath = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort()[0];
  if (!sheetPath) return [];
  const xml = await zip.file(sheetPath)!.async("string");
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of rowM[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1] ?? "";
      const col = ref.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const inner = c[2] ?? "";
      let v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (type === "s") v = shared[+v] ?? "";
      else if (type === "inlineStr") v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
      row[col >= 0 ? col : row.length] = decodeXml(v);
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

export async function extractText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  const e = ext(file.name);
  if (e === "pdf") return pdfText(await file.arrayBuffer(), onProgress);
  if (e === "pptx") return pptxText(await file.arrayBuffer());
  if (e === "docx") return docxText(await file.arrayBuffer());
  if (e === "xlsx") return (await xlsxRows(await file.arrayBuffer())).map((r) => r.join(" | ")).join("\n");
  if (e === "html" || e === "htm") {
    const doc = new DOMParser().parseFromString(await file.text(), "text/html");
    return doc.body.innerText || doc.body.textContent || "";
  }
  if (e === "doc" || e === "ppt") throw new Error("Định dạng cũ .doc/.ppt chưa hỗ trợ — hãy lưu lại thành .docx/.pptx hoặc PDF.");
  return file.text();
}

// ---------------------------------------------------------------------------
// Question import
// ---------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJ";
export const letter = (i: number) => LETTERS[i] ?? String(i + 1);

function lettersToIdx(s: string, n = 10): number[] {
  const out = new Set<number>();
  for (const m of s.toUpperCase().matchAll(/[A-J]|\d+/g)) {
    const t = m[0];
    const idx = /\d/.test(t) ? +t - 1 : t.charCodeAt(0) - 65;
    if (idx >= 0 && idx < n) out.add(idx);
  }
  return [...out].sort((a, b) => a - b);
}

function parseDifficulty(s?: string): Difficulty | undefined {
  const v = (s ?? "").toLowerCase();
  if (/easy|dễ|de/.test(v)) return "easy";
  if (/hard|khó|kho/.test(v)) return "hard";
  if (/medium|trung|tb|vừa/.test(v)) return "medium";
  return undefined;
}

const RE_QSTART = /^(?:câu(?:\s*hỏi)?|cau|question|q|bài)\s*(\d+)\s*[.:)\-–]?\s*(.*)$/i;
const RE_NUMSTART = /^(\d{1,4})\s*[.)]\s+(.+)$/;
// "*" directly before the letter (no space) marks the correct option; "* A." with a space is just a Markdown bullet.
const RE_OPT = /^(\*(?=\(?[A-Ha-h])|✓|✔|✅)?\s*\(?([A-Ha-h])\s*[.):\]\-–]\s*(.*?)\s*(\*|✓|✔|✅|\(đúng\)|\(correct\))?\s*$/i;
const RE_ANS = /^(?:đáp\s*án(?:\s*(?:đúng|chính xác))?|dap\s*an|answers?|ans|correct(?:\s*answer)?|key|đ\/a|da)\s*[:：=\-–]?\s*(.+)$/i;
const RE_EXP = /^(?:giải\s*thích|giai\s*thich|explanation|explain|lời\s*giải|rationale)\s*[:：\-–]?\s*(.*)$/i;
const RE_TOPIC = /^(?:chủ\s*đề|topic|chương|chapter)\s*[:：]\s*(.*)$/i;
const RE_KEY_HEADING = /^(?:bảng\s*)?(?:đáp\s*án(?:\s*(?:đúng|tham khảo))?|answer\s*key|answers|key)\s*[:：]?$/i;
// "1-B", "1. B", "1) A,C", "| 1 | B |", "1B" — the letter must not be the start of a word.
const RE_KEY_PAIR = /(\d{1,3})\s*[.\-:)\]=|]?\s*\|?\s*([A-Ha-h](?:\s*[,&/]\s*[A-Ha-h])*)(?![\p{L}\p{N}])/gu;

/** Removes Markdown/chat formatting so AI chat answers parse like plain text. */
function cleanLine(raw: string): string {
  let l = raw.trim();
  l = l.replace(/^#{1,6}\s*/, "").replace(/^>\s?/, "");
  l = l.replace(/^[-•+]\s+/, "").replace(/^\*\s+(?=\S)/, "");
  l = l.replace(/\*\*|__/g, "");
  // Leading emoji: keep ✓/✅ only when it marks an option ("✅ B. …"); drop it before "✅ Đáp án: …".
  const em = l.match(/^[\p{Extended_Pictographic}️‍]+\s*/u);
  if (em && !(/[✓✔✅]/.test(em[0]) && /^\(?[A-Ha-h]\s*[.):\]\-–]\s/.test(l.slice(em[0].length)))) l = l.slice(em[0].length);
  return l.trim();
}

function keyPairs(s: string): [number, string][] {
  return [...s.matchAll(RE_KEY_PAIR)].map((m) => [+m[1], m[2]] as [number, string]);
}

/** Reads an answer like "B", "A, C", "B. Lục lạp" or the option text itself. */
export function parseAnswerRaw(raw: string, options: string[]): number[] {
  const r = raw.trim().replace(/^[\s:：\-–]+/, "");
  const lead = r.match(/^\(?([A-Ja-j])\)?(?![\p{L}])((?:\s*(?:,|;|&|\/|và|and)\s*\(?[A-Ja-j]\)?(?![\p{L}]))*)/u);
  if (lead) {
    const letters = (lead[1] + lead[2]).toUpperCase().match(/[A-J]/g) ?? [];
    const idx = [...new Set(letters.map((c) => c.charCodeAt(0) - 65))].filter((i) => i < options.length);
    if (idx.length) return idx.sort((a, b) => a - b);
  }
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const nr = norm(r);
  const hit = options.findIndex((o) => norm(o) && (norm(o) === nr || nr.startsWith(norm(o)) || norm(o).startsWith(nr)));
  return hit >= 0 ? [hit] : [];
}

/** Parses "Câu 1: … A. … B. … Đáp án: B Giải thích: …" style text, including AI chat output. */
export function parseQuestionText(text: string): DraftQuestion[] {
  const out: (DraftQuestion & { _num?: number })[] = [];
  type Cur = DraftQuestion & { _exp?: boolean; _ansRaw?: string; _num?: number };
  let cur = null as Cur | null;
  let topic: string | undefined;
  let inKey = false;
  const key = new Map<number, string>();

  const flush = () => {
    if (!cur) return;
    if (cur._ansRaw) {
      const parsed = parseAnswerRaw(cur._ansRaw, cur.options);
      if (parsed.length) cur.answers = parsed;
    }
    cur.question = cur.question.trim();
    cur.explanation = cur.explanation?.trim() || undefined;
    if (cur.question && cur.options.length >= 2) {
      const { _exp, _ansRaw, ...q } = cur;
      void _exp; void _ansRaw;
      out.push(q);
    }
    cur = null;
  };
  const start = (q: string, num?: number) => {
    flush();
    cur = { question: q, options: [], answers: [], topic, _num: num ?? out.length + 1 };
  };

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = cleanLine(raw);
    if (!line || /^[-=_*|:\s]{3,}$/.test(line)) continue;
    let m: RegExpMatchArray | null;
    if (RE_KEY_HEADING.test(line)) { flush(); inKey = true; continue; }
    if (inKey) {
      const pairs = keyPairs(line);
      if (pairs.length) { pairs.forEach(([n, l]) => key.set(n, l)); continue; }
      if (!RE_QSTART.test(line)) continue;
      inKey = false;
    }
    if ((m = line.match(RE_TOPIC)) && (!cur || cur.options.length === 0 || cur.answers.length || cur._ansRaw)) {
      flush();
      topic = m[1].trim();
      continue;
    }
    if ((m = line.match(RE_QSTART))) { start(m[2], +m[1]); continue; }
    if ((m = line.match(RE_ANS))) {
      const pairs = keyPairs(m[1]);
      if (pairs.length >= 2) { flush(); pairs.forEach(([n, l]) => key.set(n, l)); continue; }
      if (cur && cur.options.length) { cur._ansRaw = m[1]; cur._exp = false; continue; }
    }
    if (cur && (m = line.match(RE_EXP))) { cur.explanation = m[1]; cur._exp = true; continue; }
    if ((m = line.match(RE_NUMSTART)) && (!cur || cur.options.length >= 2)) { start(m[2], +m[1]); continue; }
    if (cur && !cur._exp && (m = line.match(RE_OPT))) {
      const idx = m[2].toUpperCase().charCodeAt(0) - 65;
      if (idx === cur.options.length) {
        cur.options.push(m[3]);
        if (m[1] || m[4]) cur.answers.push(idx);
        continue;
      }
    }
    if (!cur) { start(line); continue; }
    if (cur._exp) cur.explanation = (cur.explanation ?? "") + "\n" + line;
    else if (cur.options.length === 0) cur.question += (cur.question ? "\n" : "") + line;
    else if (!cur._ansRaw) cur.options[cur.options.length - 1] += " " + line;
  }
  flush();
  // Apply an answer key given separately ("Đáp án: 1-B, 2-C" or a key table at the end).
  if (key.size) {
    out.forEach((q, i) => {
      const k = key.get(q._num ?? i + 1) ?? key.get(i + 1);
      if (k && !q.answers.length) q.answers = parseAnswerRaw(k, q.options);
    });
  }
  return out.map(({ _num, ...q }) => { void _num; return q; });
}

/** Paste box entry point: accepts JSON (optionally inside ```json fences or prose) or plain text. */
export function parsePasted(text: string): DraftQuestion[] {
  const t = text.trim();
  const candidates: string[] = [];
  for (const m of t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1].trim());
  candidates.push(t);
  const a = t.search(/[[{]/);
  if (a > 0) candidates.push(t.slice(a, Math.max(t.lastIndexOf("]"), t.lastIndexOf("}")) + 1));
  for (const c of candidates) {
    if (!/^[[{]/.test(c)) continue;
    try {
      const qs = jsonToQuestions(JSON.parse(c));
      if (qs.length) return qs;
    } catch { /* not JSON, try next */ }
  }
  const fenced = [...t.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g)].map((m) => m[1]).join("\n\n");
  const fromText = parseQuestionText(t);
  return fromText.length || !fenced ? fromText : parseQuestionText(fenced);
}

/** Splits a Markdown handbook ("## Topic" sections) into theory notes. */
export function parseTheoryMarkdown(text: string): { title: string; summary?: string; content: string }[] {
  const t = text.replace(/\r/g, "").replace(/^```(?:markdown|md)?\s*$/gim, "").trim();
  const parts = t.split(/^##\s+(?!#)/m).slice(1);
  return parts
    .map((p) => {
      const lines = p.split("\n");
      const title = lines.shift()!.replace(/\*\*/g, "").replace(/^(?:chủ\s*đề|topic)\s*\d*\s*[:：.\-–]\s*/i, "").replace(/^\d+[.)]\s*/, "").trim();
      while (lines.length && !lines[0].trim()) lines.shift();
      let summary: string | undefined;
      if (lines[0]?.trim().startsWith(">")) summary = lines.shift()!.replace(/^>\s*/, "").replace(/\*\*/g, "").trim();
      return { title, summary, content: lines.join("\n").trim() };
    })
    .filter((n) => n.title && n.content);
}

/** Parses a CSV line respecting quotes. Delimiter auto-detected by caller. */
export function parseCSV(text: string): string[][] {
  const first = text.split("\n")[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Converts spreadsheet rows to questions. Header row recognised by names; otherwise
 * columns are: question, A, B, C, D, answer, explanation. */
export function rowsToQuestions(rows: string[][]): DraftQuestion[] {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.toLowerCase().trim());
  const find = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  let qi = find(/^(câu hỏi|cau hoi|question|nội dung|content|q)$/, /question|câu hỏi/);
  let ai = find(/^(đáp án|dap an|answer|answers|correct|key|đ\/a)$/, /đáp án|answer|correct/);
  const ei = find(/giải thích|explanation|explain|rationale/);
  const ti = find(/chủ đề|topic|chapter|chương/);
  const di = find(/độ khó|difficulty|level/);
  let optCols = head.map((h, i) => (/^(option|lựa chọn|phương án|choice|opt)?\s*[a-h1-8]$/i.test(h) && i !== qi && i !== ai ? i : -1)).filter((i) => i >= 0);
  let body = rows.slice(1);
  if (qi < 0 || ai < 0 || optCols.length < 2) {
    // positional fallback
    body = qi < 0 ? rows : body;
    const width = Math.max(...rows.map((r) => r.length));
    qi = 0;
    const tail = width >= 7 ? 2 : 1;
    ai = width - tail;
    optCols = Array.from({ length: Math.max(0, ai - 1) }, (_, i) => i + 1);
    return body.map((r) => toQ(r, qi, optCols, ai, width >= 7 ? width - 1 : -1, -1, -1)).filter(Boolean) as DraftQuestion[];
  }
  return body.map((r) => toQ(r, qi, optCols, ai, ei, ti, di)).filter(Boolean) as DraftQuestion[];
}

function toQ(r: string[], qi: number, optCols: number[], ai: number, ei: number, ti: number, di: number): DraftQuestion | null {
  const question = (r[qi] ?? "").trim();
  const opts = optCols.map((c) => (r[c] ?? "").trim());
  while (opts.length && !opts[opts.length - 1]) opts.pop();
  if (!question || opts.length < 2) return null;
  const rawAns = (r[ai] ?? "").trim();
  let answers = lettersToIdx(rawAns, opts.length);
  if (!answers.length) {
    const hit = opts.findIndex((o) => o.toLowerCase() === rawAns.toLowerCase());
    answers = hit >= 0 ? [hit] : [0];
  }
  return {
    question, options: opts, answers,
    explanation: ei >= 0 ? r[ei]?.trim() || undefined : undefined,
    topic: ti >= 0 ? r[ti]?.trim() || undefined : undefined,
    difficulty: di >= 0 ? parseDifficulty(r[di]) : undefined,
  };
}

const pick = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (v.vi && v.en) return `${v.vi}\n(${v.en})`;
    return v.vi ?? v.en ?? v.text ?? v.content ?? "";
  }
  return "";
};

/** Accepts QuizForge exports, generic arrays and the older Smart Deck card format. */
export function jsonToQuestions(data: any): DraftQuestion[] {
  const list: any[] = Array.isArray(data) ? data : data.questions ?? data.cards ?? data.items ?? [];
  return list
    .map((c): DraftQuestion | null => {
      const rawOpts: any[] = c.options ?? c.choices ?? c.answers_list ?? [];
      const options = rawOpts.map((o) => pick(o).replace(/^\s*\(?[A-Ha-h][.)]\s+/, ""));
      if (!options.length && c.a) ["a", "b", "c", "d", "e"].forEach((k) => c[k] && options.push(String(c[k])));
      const optIds: string[] = rawOpts.map((o, i) => (typeof o === "object" && o?.id ? String(o.id) : letter(i)));
      let answers: number[] = [];
      const ans = c.answers ?? c.correctAnswers ?? c.correctAnswer ?? c.answer ?? c.correct ?? c.key;
      const toIdx = (a: any): number => {
        if (typeof a === "number") return a;
        const s = String(a).trim();
        const byId = optIds.findIndex((id) => id.toUpperCase() === s.toUpperCase());
        if (byId >= 0) return byId;
        const byText = options.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
        if (byText >= 0) return byText;
        return lettersToIdx(s, options.length)[0] ?? -1;
      };
      if (Array.isArray(ans)) answers = ans.map(toIdx);
      else if (ans != null) answers = String(ans).length > 1 && /^[A-J](\s*[,;&]\s*[A-J])+$/i.test(String(ans)) ? lettersToIdx(String(ans), options.length) : [toIdx(ans)];
      answers = answers.filter((i) => i >= 0 && i < options.length);
      const question = pick(c.question ?? c.q ?? c.prompt ?? c.text);
      if (!question || options.length < 2) return null;
      return {
        question,
        options,
        answers: answers.length ? answers : [0],
        explanation: pick(c.explanation ?? c.explain ?? c.rationale) || undefined,
        topic: pick(c.topic ?? c.lesson ?? c.category) || undefined,
        difficulty: parseDifficulty(c.difficulty),
        source: pick(c.source) || undefined,
        image: typeof c.image === "string" && c.image.startsWith("data:") ? c.image : undefined,
      };
    })
    .filter(Boolean) as DraftQuestion[];
}

export async function fileToQuestions(file: File): Promise<DraftQuestion[]> {
  const e = ext(file.name);
  if (e === "json") return jsonToQuestions(JSON.parse(await file.text()));
  if (e === "csv" || e === "tsv") return rowsToQuestions(parseCSV(await file.text()));
  if (e === "xlsx") return rowsToQuestions(await xlsxRows(await file.arrayBuffer()));
  return parseQuestionText(await extractText(file));
}

export function download(name: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type: type + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function questionsToCSV(qs: DraftQuestion[]) {
  const n = Math.max(4, ...qs.map((q) => q.options.length));
  const esc = (s = "") => `"${s.replace(/"/g, '""')}"`;
  const head = ["question", ...Array.from({ length: n }, (_, i) => letter(i)), "answer", "explanation", "topic", "difficulty"];
  const lines = qs.map((q) =>
    [q.question, ...Array.from({ length: n }, (_, i) => q.options[i] ?? ""), q.answers.map(letter).join(","), q.explanation ?? "", q.topic ?? "", q.difficulty ?? ""].map(esc).join(","),
  );
  return "﻿" + [head.join(","), ...lines].join("\n");
}

export function questionsToText(qs: DraftQuestion[]) {
  return qs
    .map((q, i) =>
      [`Câu ${i + 1}: ${q.question}`, ...q.options.map((o, j) => `${letter(j)}. ${o}`), `Đáp án: ${q.answers.map(letter).join(", ")}`, q.explanation ? `Giải thích: ${q.explanation}` : ""]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}
