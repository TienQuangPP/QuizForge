import { go } from "../ui";

const FAQ: [string, string][] = [
  ["QuizForge dùng để làm gì?", "Bạn đưa tài liệu học (sách, bài giảng, slide…) vào, máy sẽ tự soạn câu hỏi trắc nghiệm có đáp án và lời giải. Sau đó bạn luyện tập, máy ghi nhớ câu nào bạn hay sai để nhắc ôn lại đúng lúc."],
  ["Tôi không rành máy tính, bắt đầu từ đâu?", "Ở trang Tổng quan, bấm “Dùng thử ngay”. Máy sẽ mở một bộ câu hỏi mẫu. Bấm “Luyện tập” → “Bắt đầu”, rồi bấm vào đáp án bạn cho là đúng. Vậy là xong!"],
  ["“AI” là gì, có bắt buộc không?", "AI là trí tuệ nhân tạo (như ChatGPT, Gemini) — giúp tự soạn câu hỏi từ tài liệu và giảng giải khi bạn làm sai. Không bắt buộc: không có AI bạn vẫn tự nhập câu hỏi và luyện tập bình thường."],
  ["Làm sao để có AI miễn phí?", "Vào Cài đặt → làm theo 5 bước có đánh số. Bạn chỉ cần một tài khoản Gmail. Google cho dùng Gemini miễn phí với mức sử dụng vừa phải."],
  ["“API key” là gì? Có an toàn không?", "Là một dãy ký tự giống mật khẩu, cho phép app dùng AI thay bạn. Key chỉ lưu trên máy này, không gửi cho ai khác ngoài Google/OpenAI. Đừng chia sẻ key cho người lạ."],
  ["Chữ nhỏ quá, khó đọc?", "Vào Cài đặt → “Cỡ chữ” → chọn “Lớn” hoặc “Rất lớn”. Bạn cũng có thể bấm 🔊 “Nghe đọc” khi làm bài để máy đọc câu hỏi cho nghe."],
  ["Đang làm bài thì lỡ tắt máy / tải lại trang?", "Không sao — bài được lưu tự động. Mở lại app, ở trang Tổng quan sẽ có nút “Làm tiếp”."],
  ["Lỡ xoá nhầm?", "Ngay sau khi xoá, góc dưới màn hình hiện nút “↶ Hoàn tác” trong vài giây — bấm vào là lấy lại."],
  ["Dữ liệu của tôi lưu ở đâu?", "Trong trình duyệt trên chính máy này, không gửi lên mạng. Vì vậy thỉnh thoảng hãy vào Cài đặt → “Sao lưu toàn bộ” để giữ một bản dự phòng (ví dụ chép vào USB hoặc Google Drive)."],
  ["Các chế độ chơi khác nhau thế nào?", "🎯 Luyện tập: biết đúng sai ngay. 📝 Thi thử: làm hết mới chấm điểm như thi thật. 🃏 Thẻ ghi nhớ: tự đánh giá mức nhớ. ⚡ Đua tốc độ: trả lời đúng càng nhiều càng tốt trong 60 giây. ❤️ Sinh tồn: có 3 mạng, sai 3 lần là thua."],
  ["XP, cấp độ, huy hiệu là gì?", "Điểm thưởng cho việc học: trả lời đúng được XP, đủ XP thì lên cấp. Làm được việc đặc biệt (học 7 ngày liền, đúng 10 câu liên tiếp…) thì nhận huy hiệu. Xem ở mục 🏆 Thành tích."],
  ["Có dùng trên điện thoại được không?", "Được, giao diện tự co lại vừa màn hình. Lưu ý dữ liệu trên điện thoại và máy tính là riêng — dùng Sao lưu/Khôi phục để chuyển qua lại."],
];

const KEYS: [string, string][] = [
  ["1 2 3 4  hoặc  A B C D", "Chọn đáp án"],
  ["Enter", "Kiểm tra / sang câu tiếp"],
  ["← →", "Câu trước / câu sau"],
  ["R", "Đọc to câu hỏi"],
  ["F", "Đánh dấu câu để ôn lại"],
  ["Space", "Lật thẻ ghi nhớ"],
];

export default function Help() {
  return (
    <div className="page narrow">
      <h1>❓ Hướng dẫn</h1>
      <div className="card stack">
        <h3>3 bước để bắt đầu</h3>
        <ol className="steps">
          <li><b>Có câu hỏi:</b> tạo từ tài liệu bằng AI (<a onClick={() => go("studio")}>Tạo đề bằng AI</a>), hoặc nhập câu có sẵn (<a onClick={() => go("import")}>Nhập câu hỏi</a>).</li>
          <li><b>Luyện tập:</b> vào <a onClick={() => go("practice")}>Luyện tập</a>, chọn cách chơi rồi bấm Bắt đầu.</li>
          <li><b>Quay lại mỗi ngày:</b> làm “Thử thách hôm nay” ở trang Tổng quan — máy tự chọn câu bạn cần ôn.</li>
        </ol>
        <button className="btn" onClick={() => { localStorage.removeItem("quizforge-welcome-done"); location.hash = "#/"; location.reload(); }}>▶ Xem lại phần giới thiệu</button>
      </div>
      <h3>Câu hỏi thường gặp</h3>
      <div className="stack">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card faq">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <h3>Phím tắt khi làm bài (máy tính)</h3>
      <div className="card list">
        {KEYS.map(([k, v]) => (
          <div key={k} className="list-row"><kbd>{k}</kbd><span className="grow">{v}</span></div>
        ))}
      </div>
    </div>
  );
}
