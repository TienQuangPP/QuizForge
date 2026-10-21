// Prompts for using a web chat AI (ChatGPT, Gemini, Claude…) without an API key.
// The answer is pasted back and parsed by parsePasted / parseTheoryMarkdown.
import { QUESTION_TYPES, type GenOptions } from "./ai";

export const EXTERNAL_AIS = [
  { name: "ChatGPT", url: "https://chatgpt.com/", icon: "🟢" },
  { name: "Gemini", url: "https://gemini.google.com/app", icon: "🔷" },
  { name: "Claude", url: "https://claude.ai/new", icon: "🟠" },
  { name: "Copilot", url: "https://copilot.microsoft.com/", icon: "🔵" },
];

export type MaterialMode = "attach" | "docs" | "topic";

const LANG_TEXT: Record<GenOptions["language"], string> = {
  vi: "Viết toàn bộ bằng tiếng Việt.",
  en: "Write everything in English.",
  source: "Dùng cùng ngôn ngữ với tài liệu.",
  bilingual: "Song ngữ: tiếng Anh trước, bản dịch tiếng Việt ngay sau trong ngoặc (cho câu hỏi, phương án và giải thích).",
};

function materialBlock(mode: MaterialMode, material: string, topic: string) {
  if (mode === "topic") return `CHỦ ĐỀ: ${topic.trim()}\n(Không có tài liệu đính kèm — dùng kiến thức chuẩn, chính xác, phổ biến trong giáo trình.)`;
  if (mode === "docs") return `TÀI LIỆU:\n"""\n${material}\n"""`;
  return "TÀI LIỆU: xem (các) file tôi đính kèm trong tin nhắn này. Chỉ dùng nội dung trong file.";
}

export function buildQuestionPrompt(o: GenOptions & { mode: MaterialMode; material: string; topic: string }) {
  const types = QUESTION_TYPES.filter((t) => o.types.includes(t.id)).map((t) => t.label);
  return `Bạn là chuyên gia ra đề thi. Hãy soạn ${o.count} câu hỏi trắc nghiệm chất lượng cao để tôi ôn thi.

YÊU CẦU
- ${LANG_TEXT[o.language]}
- Mỗi câu có ${o.optionCount} phương án; phương án nhiễu hợp lý, cùng độ dài, không lộ đáp án; vị trí đáp án đúng phân bố ngẫu nhiên.
- Độ khó: ${o.difficulty === "mixed" ? "trộn khoảng 30% dễ, 50% trung bình, 20% khó" : o.difficulty === "easy" ? "dễ" : o.difficulty === "hard" ? "khó" : "trung bình"}.
${types.length ? `- Dạng câu hỏi (phân bổ đều): ${types.join("; ")}.\n` : ""}- ${o.types.includes("multi") ? "Câu nhiều đáp án đúng phải ghi rõ \"(Chọn tất cả đáp án đúng)\" trong câu hỏi." : "Mỗi câu chỉ có MỘT đáp án đúng."}
- ${o.withExplanation ? "Mỗi câu có giải thích ngắn: vì sao đáp án đúng, vì sao các phương án khác sai." : "Giải thích có thể để trống."}
- Chỉ hỏi kiến thức quan trọng; không hỏi về số trang, tên file, định dạng.
- Kiểm tra lại từng đáp án cho chắc chắn đúng trước khi trả lời.
${o.instructions.trim() ? `- Yêu cầu thêm: ${o.instructions.trim()}\n` : ""}
ĐỊNH DẠNG TRẢ LỜI (bắt buộc)
Chỉ trả về MỘT khối code \`\`\`json duy nhất, không viết gì thêm, theo đúng mẫu:
\`\`\`json
{"questions":[
  {"question":"Nội dung câu hỏi","options":["Phương án 1","Phương án 2","Phương án 3","Phương án 4"],"answer":"B","explanation":"Giải thích ngắn","topic":"Tên chủ đề","difficulty":"easy"}
]}
\`\`\`
- "options": KHÔNG ghi chữ A./B. ở đầu.
- "answer": chữ cái của đáp án đúng ("A", "B"…); nhiều đáp án thì dùng mảng ["A","C"].
- "difficulty": "easy", "medium" hoặc "hard".
- Nếu câu trả lời quá dài, hãy dừng ở cuối một câu hỏi trọn vẹn, đóng JSON hợp lệ và chờ tôi gõ "tiếp tục".

${materialBlock(o.mode, o.material, o.topic)}`;
}

export function buildTheoryPrompt(o: { language: GenOptions["language"]; depth: "brief" | "detailed"; instructions: string; mode: MaterialMode; material: string; topic: string }) {
  return `Bạn là giảng viên giỏi. Hãy soạn SỔ TAY LÝ THUYẾT ôn thi: chính xác, dễ hiểu, chia thành các chủ đề logic.

YÊU CẦU
- ${LANG_TEXT[o.language]}
- ${o.depth === "detailed" ? "Giải thích chi tiết, dễ hiểu như giảng cho người mới." : "Ngắn gọn, súc tích để ôn nhanh."}
${o.instructions.trim() ? `- Yêu cầu thêm: ${o.instructions.trim()}\n` : ""}
ĐỊNH DẠNG TRẢ LỜI (bắt buộc, Markdown)
Mỗi chủ đề bắt đầu bằng một dòng "## Tên chủ đề", dòng tiếp theo là "> một câu tóm tắt", rồi đến các mục (bỏ mục nào không phù hợp):

## Tên chủ đề
> Một câu tóm tắt chủ đề.
### 🎯 Ý chính
- 3–6 ý cốt lõi, in đậm **thuật ngữ**
### 📘 Giải thích
### 🧩 Ví dụ
### ⚖️ So sánh
| Tiêu chí | A | B |
|---|---|---|
### ⚠️ Dễ nhầm
### 💡 Mẹo nhớ

Không viết lời mở đầu hay kết luận ngoài các chủ đề.

${materialBlock(o.mode, o.material, o.topic)}`;
}
