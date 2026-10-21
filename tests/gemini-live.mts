// Live check of the app's AI code against Google Gemini.
// Usage (key is read from the environment, never stored):
//   GEMINI_API_KEY=... node --import ./tests/ts-resolve.mjs --experimental-strip-types --no-warnings tests/gemini-live.mts [model]
import { DEFAULT_SETTINGS, type Question, type Settings } from "../src/types.ts";
import { callAI, explainQuestion, extractQuestionsAI, generateQuestions, listModels, tutorReply } from "../src/ai.ts";
import { generateTheory } from "../src/theory.ts";

const key = process.env.GEMINI_API_KEY ?? "";
if (!key) throw new Error("Set GEMINI_API_KEY");
const s: Settings = { ...DEFAULT_SETTINGS, provider: "gemini", geminiKey: key, geminiModel: process.argv[2] ?? DEFAULT_SETTINGS.geminiModel };

const TEXT = `Quang hợp là quá trình thực vật, tảo và một số vi khuẩn sử dụng năng lượng ánh sáng để tổng hợp chất hữu cơ (glucose) từ CO2 và nước, đồng thời giải phóng O2.
Quang hợp gồm hai pha. Pha sáng diễn ra trên màng thylakoid của lục lạp: diệp lục hấp thụ ánh sáng, nước bị phân li (quang phân li) giải phóng O2, tạo ATP và NADPH.
Pha tối (chu trình Calvin) diễn ra ở chất nền (stroma) của lục lạp: sử dụng ATP và NADPH để cố định CO2 thành đường. Enzyme quan trọng nhất là Rubisco.
Các yếu tố ảnh hưởng đến cường độ quang hợp: cường độ ánh sáng, nồng độ CO2, nhiệt độ, nước. Khi tăng cường độ ánh sáng, cường độ quang hợp tăng đến điểm bão hoà ánh sáng thì không tăng nữa.
Hô hấp tế bào là quá trình phân giải glucose để giải phóng năng lượng dưới dạng ATP, gồm đường phân (tế bào chất), chu trình Krebs và chuỗi chuyền electron (ti thể).`;

const results: [string, boolean, string][] = [];
async function step(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push([name, true, `${((Date.now() - t) / 1000).toFixed(1)}s · ${detail}`]);
  } catch (e: any) {
    results.push([name, false, `${((Date.now() - t) / 1000).toFixed(1)}s · ${String(e.message).slice(0, 300)}`]);
  }
  const r = results.at(-1)!;
  console.log(`${r[1] ? "✅" : "❌"} ${r[0]} — ${r[2]}`);
}

await step("Danh sách model", async () => {
  const m = await listModels(s);
  const has = m.includes(s.geminiModel);
  return `${m.length} model; "${s.geminiModel}" ${has ? "có" : "KHÔNG có"}; vd: ${m.filter((x) => /flash|pro/.test(x)).slice(0, 8).join(", ")}`;
});
await step("Gọi AI đơn giản", async () => (await callAI(s, [{ role: "user", content: "Trả lời đúng 3 chữ: Kết nối thành công" }])).trim().slice(0, 60));

let qs: Awaited<ReturnType<typeof generateQuestions>> = [];
await step("Tạo 5 câu trắc nghiệm từ giáo trình", async () => {
  qs = await generateQuestions(s, TEXT, { count: 5, language: "vi", difficulty: "mixed", optionCount: 4, types: ["definition", "understanding", "application", "negative"], instructions: "", withExplanation: true }, "Sinh học", () => {});
  const bad = qs.filter((q) => q.options.length !== 4 || !q.answers.length || !q.explanation);
  if (qs.length < 4) throw new Error("chỉ nhận " + qs.length + " câu");
  if (bad.length) throw new Error(bad.length + " câu thiếu phương án/đáp án/giải thích");
  const pos = qs.map((q) => "ABCD"[q.answers[0]]).join("");
  return `${qs.length} câu, vị trí đáp án ${pos}; câu 1: "${qs[0].question.slice(0, 70)}"`;
});

await step("Soạn sổ tay lý thuyết", async () => {
  const notes = await generateTheory(s, TEXT, { language: "vi", depth: "brief", instructions: "" }, [], () => {});
  if (!notes.length) throw new Error("không có chủ đề");
  const withSections = notes.filter((n) => /###/.test(n.content)).length;
  return `${notes.length} chủ đề (${notes.map((n) => n.title).join("; ")}), ${withSections} có mục ###, ${notes.some((n) => n.content.includes("|")) ? "có bảng" : "không bảng"}`;
});

await step("AI giảng giải câu sai", async () => {
  if (!qs.length) throw new Error("bỏ qua (không có câu)");
  const q: Question = { ...qs[0], id: "x", deckId: "d", createdAt: 0 };
  const wrong = [0, 1, 2, 3].find((i) => !q.answers.includes(i))!;
  const out = await explainQuestion(s, q, [wrong], TEXT);
  return `${out.length} ký tự, ${/\*\*/.test(out) ? "có" : "không"} in đậm: "${out.replace(/\s+/g, " ").slice(0, 90)}…"`;
});

await step("Gia sư AI trả lời", async () => {
  const out = await tutorReply(s, [{ role: "user", content: "Vì sao pha tối vẫn cần ánh sáng gián tiếp?" }], TEXT);
  return `${out.length} ký tự: "${out.replace(/\s+/g, " ").slice(0, 90)}…"`;
});

await step("AI trích câu hỏi từ văn bản lộn xộn + tự giải", async () => {
  const messy = `cau 1 o2 trong quang hop sinh ra tu dau a) co2 b) nuoc c) glucose d) khong khi
cau2: Chu trinh Calvin dien ra o: A-mang thylakoid B-stroma C-ti the D-nhan`;
  const out = await extractQuestionsAI(s, messy, [], true);
  return `${out.length} câu; đáp án: ${out.map((q) => q.answers.map((a) => "ABCD"[a]).join("")).join(", ")} (đúng phải là B, B)`;
});

const ok = results.filter((r) => r[1]).length;
console.log(`\n${ok}/${results.length} bước AI thật đạt (model ${s.geminiModel})`);
