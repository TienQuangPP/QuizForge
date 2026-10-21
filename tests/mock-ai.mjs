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
  if (sys.includes("SỔ TAY LÝ THUYẾT")) {
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
