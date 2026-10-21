import { parsePasted, parseTheoryMarkdown } from "../src/parsers.ts";
const S: [string, string, number[][]][] = [
  ["ChatGPT markdown", `**Câu 1:** Quang hợp diễn ra ở bào quan nào?
A) Ti thể
B) Lục lạp
C) Ribosome
D) Nhân
**Đáp án:** B
**Giải thích:** Lục lạp chứa diệp lục.

**Câu 2:** Sản phẩm của pha sáng?
- A. ATP và NADPH
- B. Glucose
- C. CO₂
- D. Tinh bột
**Đáp án đúng: A**`, [[1], [0]]],
  ["Gemini bullets", `### Câu 1
Pha tối diễn ra ở đâu?
* A. Màng thylakoid
* B. Chất nền lục lạp
* C. Ti thể
* D. Tế bào chất

> **Đáp án: B**`, [[1]]],
  ["Claude key inline", `1. Đường phân diễn ra ở đâu?
   A. Ti thể
   B. Tế bào chất
   C. Nhân
   D. Lục lạp

2. ATP được tạo nhiều nhất ở giai đoạn nào?
   A. Đường phân
   B. Krebs
   C. Chuỗi chuyền electron
   D. Lên men

Đáp án: 1-B, 2-C`, [[1], [2]]],
  ["Key table at end", `Câu 1. 2+2=?
A. 3
B. 4
Câu 2. Thủ đô Việt Nam?
A. Huế
B. Đà Nẵng
C. Hà Nội

## Bảng đáp án
| Câu | Đáp án |
|---|---|
| 1 | B |
| 2 | C |`, [[1], [2]]],
  ["JSON fenced in prose", `Đây là bộ câu hỏi của bạn:
\`\`\`json
{"questions":[{"question":"Enzyme là gì?","options":["A. Chất xúc tác sinh học","B. Hormone","C. Vitamin","D. Khoáng chất"],"answer":"A","explanation":"..."},{"question":"Chọn số chẵn","options":["1","2","3","4"],"answer":["B","D"]}]}
\`\`\`
Chúc bạn học tốt!`, [[0], [1, 3]]],
  ["Answer as text + emoji", `Question 1: Which planet is red?
a) Venus
b) Mars
c) Jupiter
✅ Answer: Mars`, [[1]]],
  ["Old style marker still works", `Câu 1: 2+3?
A. 4
*B. 5
C. 6`, [[1]]],
  ["Answer letter + text", `Câu 1: Lá cây màu xanh vì?
A. Diệp lục
B. Carotene
C. Nước
Đáp án: A. Diệp lục`, [[0]]],
];
let pass = 0;
for (const [name, text, expected] of S) {
  const qs = parsePasted(text);
  const got = qs.map((q) => q.answers);
  const ok = JSON.stringify(got) === JSON.stringify(expected) && qs.every((q) => !/\*\*|^#/.test(q.question));
  if (ok) pass++;
  console.log(`${ok ? "✅" : "❌"} ${name}: ${qs.length} câu, đáp án ${JSON.stringify(got)}${ok ? "" : " (mong đợi " + JSON.stringify(expected) + ")"}`);
  if (!ok) qs.forEach((q) => console.log("    ", JSON.stringify(q).slice(0, 160)));
}
console.log(`\n${pass}/${S.length} mẫu đúng`);
const notes = parseTheoryMarkdown("```markdown\n## 1. Quang hợp\n> Tóm tắt A\n### 🎯 Ý chính\n- x\n\n## Chủ đề 2: Hô hấp\n### Giải thích\nabc\n```");
console.log("Lý thuyết:", JSON.stringify(notes.map((n) => [n.title, n.summary ?? null, n.content.length])));
