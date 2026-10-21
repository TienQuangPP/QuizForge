// Fake OpenAI-compatible server for local UI testing only.
import { createServer } from "node:http";

const theoryNote = (title) => ({
  title,
  summary: `Tóm tắt nhanh về ${title.toLowerCase()}.`,
  content: `### 🎯 Ý chính
- **${title}** là kỹ thuật học dựa trên khoa học trí nhớ.
- Giúp chuyển kiến thức vào **trí nhớ dài hạn**.

### 📘 Giải thích
Khi ôn lại đúng lúc sắp quên, não phải cố gắng truy xuất nên ký ức được củng cố.

### ⚖️ So sánh
| Tiêu chí | Học dồn | ${title} |
|---|---|---|
| Thời gian ôn | Một lần, liền mạch | Nhiều lần, giãn cách |
| Nhớ lâu | Kém | Tốt |

### ⚠️ Dễ nhầm
> Đọc lại nhiều lần **không** phải là chủ động nhớ lại.

### 💡 Mẹo nhớ
"Sắp quên mới ôn — ôn là nhớ lâu".`,
});

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "mock-1" }] }));
  let body = "";
  for await (const c of req) body += c;
  const j = JSON.parse(body);
  const sys = j.messages[0]?.content ?? "";
  const last = j.messages.at(-1).content;
  const text = typeof last === "string" ? last : last[0].text;
  let content;
  if (sys.includes("LỘ TRÌNH HỌC")) {
    content = JSON.stringify({ modules: [
      { title: "Chương 1: Nền tảng", lessons: [
        { title: "Phương pháp học", objectives: ["Giải thích được vì sao ôn giãn cách giúp nhớ lâu", "Vận dụng active recall khi ôn thi"], concepts: ["spaced repetition", "active recall"] },
        { title: "Quản lý thời gian", objectives: ["Lập được kế hoạch Pomodoro"], concepts: ["Pomodoro"] },
      ] },
      { title: "Chương 2: Đi thi", lessons: [{ title: "Chiến lược thi", objectives: ["Phân tích đề và phân bổ thời gian"], concepts: ["phân bổ thời gian"] }] },
    ] });
  } else if (sys.includes("BÀI TẬP TƯ DUY")) {
    content = JSON.stringify({ exercises: [
      { type: "cloze", prompt: "Điền vào chỗ trống", text: "Ôn lại đúng lúc sắp [[quên]] giúp củng cố trí nhớ [[dài hạn|lâu dài]].", explanation: "Hiệu ứng giãn cách.", bloom: "remember" },
      { type: "order", prompt: "Sắp xếp các bước Pomodoro", items: ["Chọn một việc", "Tập trung 25 phút", "Nghỉ 5 phút", "Nghỉ dài sau 4 phiên"], bloom: "understand" },
      { type: "match", prompt: "Nối khái niệm", pairs: [["Active recall", "Tự nhớ lại không nhìn tài liệu"], ["Spaced repetition", "Ôn giãn cách theo thời gian"], ["Interleaving", "Xen kẽ nhiều dạng bài"]], bloom: "understand" },
      { type: "truefalse", prompt: "Đúng hay sai? Giải thích.", statement: "Đọc lại tài liệu nhiều lần là cách ôn hiệu quả nhất.", isTrue: false, answer: "Sai, tự kiểm tra hiệu quả hơn đọc lại.", rubric: ["nêu được tự kiểm tra hiệu quả hơn"], bloom: "analyze" },
      { type: "open", prompt: "Lan còn 7 ngày trước kỳ thi và 3 môn. Hãy lập kế hoạch ôn tập và giải thích vì sao.", answer: "Chia nhỏ, xen kẽ môn, tự kiểm tra, ôn giãn cách.", rubric: ["xen kẽ các môn", "tự kiểm tra", "ôn giãn cách"], bloom: "apply" },
      { type: "error", prompt: "Tìm lỗi sai", text: "Muốn nhớ lâu thì nên học dồn toàn bộ vào đêm trước khi thi.", answer: "Học dồn chỉ giúp nhớ ngắn hạn; nên ôn giãn cách.", rubric: ["chỉ ra học dồn là sai", "nêu ôn giãn cách"], bloom: "evaluate" },
    ] });
  } else if (sys.includes("chấm bài công bằng")) {
    content = JSON.stringify({ score: 7, covered: ["Nêu được ý chính"], missing: ["Thiếu ví dụ cụ thể"], misconceptions: ["Nhầm học dồn là hiệu quả"], feedback: "Bạn nắm được ý chính, cần thêm ví dụ.", improved: "Bài mẫu ngắn gọn." });
  } else if (sys.includes("SỔ TAY LÝ THUYẾT")) {
    content = JSON.stringify({ topics: [theoryNote("Phương pháp học"), theoryNote("Quản lý thời gian"), theoryNote("Chiến lược thi")] });
  } else if (sys.includes("một mục trong sổ tay")) {
    const t = text.match(/Chủ đề: (.*)/)?.[1] ?? "Chủ đề";
    const n = theoryNote(t);
    n.content += text.includes("Bản hiện tại") ? "\n\n### 📘 Phần bổ sung\nĐã viết lại chi tiết hơn." : "";
    content = JSON.stringify(n);
  } else if (j.response_format) {
    const n = +(text.match(/Tạo đúng (\d+)/)?.[1] ?? 2);
    content = JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({ question: `Câu mới ${Date.now() % 1000}-${i}: Spaced repetition giúp gì?`, options: ["Nhớ lâu hơn", "Quên nhanh hơn", "Không tác dụng", "Chỉ dùng cho toán"], answers: [0], explanation: "Ôn giãn cách củng cố trí nhớ dài hạn." })) });
  } else {
    content = "### Kiến thức cốt lõi\n- **Ý chính** của câu hỏi.\n\n### Vì sao đúng\nVì lý do A.\n\n### Mẹo nhớ\nNhớ chữ A.";
  }
  console.log("REQ", sys.slice(0, 40).replace(/\n/g, " "));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}).listen(3199, "127.0.0.1", () => console.log("mock ready"));
