// Live check of learning-path, thinking-exercise and grading prompts against Gemini.
//   GEMINI_API_KEY=... node --import ./tests/ts-resolve.mjs --experimental-strip-types --no-warnings tests/gemini-course.mts
import { DEFAULT_SETTINGS, type Settings } from "../src/types.ts";
import { generateCourse, generateExercises, gradeFreeText, gradeCloze, clozeBlanks } from "../src/course.ts";

const s: Settings = { ...DEFAULT_SETTINGS, provider: "gemini", geminiKey: process.env.GEMINI_API_KEY ?? "" };
const TEXT = `Quang hợp là quá trình thực vật sử dụng năng lượng ánh sáng để tổng hợp glucose từ CO2 và nước, giải phóng O2.
Pha sáng diễn ra trên màng thylakoid: diệp lục hấp thụ ánh sáng, nước bị quang phân li giải phóng O2, tạo ATP và NADPH.
Pha tối (chu trình Calvin) ở chất nền lục lạp dùng ATP, NADPH để cố định CO2 thành đường nhờ enzyme Rubisco.
Cường độ quang hợp tăng theo cường độ ánh sáng đến điểm bão hoà; nồng độ CO2, nhiệt độ, nước cũng ảnh hưởng.
Hô hấp tế bào phân giải glucose tạo ATP qua đường phân (tế bào chất), chu trình Krebs và chuỗi chuyền electron (ti thể).`;
const t0 = () => Date.now();
const sec = (t: number) => ((Date.now() - t) / 1000).toFixed(1) + "s";

let t = t0();
const course = await generateCourse(s, TEXT, "science", "vi", []);
console.log(`✅ Lộ trình (${sec(t)}): ${course.length} bài`);
for (const l of course) console.log(`   [${l.module}] ${l.title} — mục tiêu: ${l.objectives.slice(0, 2).join(" | ")}`);

t = t0();
const ex = await generateExercises(s, course[0].title, TEXT, "science", { count: 6, types: ["cloze", "order", "match", "truefalse", "open", "error"], language: "vi", objectives: course[0].objectives });
console.log(`\n✅ Bài tập tư duy (${sec(t)}): ${ex.length} bài hợp lệ, loại: ${ex.map((e) => e.type).join(", ")}`);
for (const e of ex) {
  const body = e.type === "cloze" ? e.text : e.type === "order" ? e.items!.join(" → ") : e.type === "match" ? e.pairs!.map((p) => p.join("=")).join("; ") : e.type === "truefalse" ? `${e.statement} (${e.isTrue ? "Đúng" : "Sai"})` : e.type === "error" ? e.text : e.prompt;
  console.log(`   ${e.type.padEnd(9)} [${e.bloom ?? "-"}] ${String(body).slice(0, 110)}`);
}
const cloze = ex.find((e) => e.type === "cloze");
if (cloze) {
  const blanks = clozeBlanks(cloze.text!);
  const accentless = blanks.map((b) => b[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d"));
  console.log(`   chấm điền khuyết gõ không dấu "${accentless.join(", ")}": ${Math.round(gradeCloze(cloze.text!, accentless).score * 100)}%`);
}

t = t0();
const g = await gradeFreeText(
  s,
  { title: "Tự giải thích: Quang hợp", prompt: "Giải thích quang hợp bằng lời của bạn", context: TEXT },
  "Quang hợp là cây hấp thụ ánh sáng để tạo ra glucose. Khí O2 được tạo ra từ CO2. Pha tối diễn ra vào ban đêm vì không cần ánh sáng.",
);
console.log(`\n✅ AI chấm tự giải thích (${sec(t)}): ${g.score}/10`);
console.log(`   Đã có: ${g.covered.join(" | ")}`);
console.log(`   Còn thiếu: ${g.missing.join(" | ")}`);
console.log(`   Hiểu sai: ${g.misconceptions.join(" | ")}`);
console.log(`   Nhận xét: ${g.feedback}`);
