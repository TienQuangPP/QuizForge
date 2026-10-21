# QuizForge

Biến mọi giáo trình (PDF, Word, PowerPoint, văn bản, ảnh chụp đề) thành bộ trắc nghiệm, luyện tập với lặp lại ngắt quãng, thi thử, và gia sư AI (OpenAI ChatGPT / Google Gemini / API tương thích OpenAI).

## Tính năng
- **Tạo đề bằng AI** từ tài liệu hoặc chỉ từ một chủ đề; AI đọc ảnh chụp đề thi.
- **Nhập câu hỏi** từ Excel, CSV, JSON, Word, PDF, văn bản dán.
- **5 chế độ chơi:** Luyện tập, Thi thử, Thẻ ghi nhớ (SRS), ⚡ Đua tốc độ, ❤️ Sinh tồn — cộng 🎯 Thử thách hằng ngày.
- **Game hoá:** XP, cấp độ & danh hiệu, 21 huy hiệu, combo, pháo giấy, âm thanh.
- **Dễ dùng cho mọi lứa tuổi:** màn hình chào mừng, 4 cỡ chữ, đọc to câu hỏi, hướng dẫn lấy API key từng bước, trang Hướng dẫn.
- **An toàn dữ liệu:** tự lưu bài đang làm, hoàn tác khi xoá, nhắc sao lưu, sao lưu/khôi phục.

Đánh giá trải nghiệm theo 3 kiểu người dùng: [docs/DANH_GIA_TRAI_NGHIEM.md](docs/DANH_GIA_TRAI_NGHIEM.md)

## Phát triển
- `npm run dev` — chạy bản phát triển
- `npm run portable` — build và đóng gói `../QuizForge_Portable` + `.zip` (cần `runtime/node.exe`)

Mã nguồn: `src/` (React + Vite, dữ liệu lưu IndexedDB trong trình duyệt).
