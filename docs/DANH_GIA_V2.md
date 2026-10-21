# Đánh giá QuizForge v1.3 — vòng 2 (thử với Gemini thật)

## 🎓 TS. Hà — chuyên gia khoa học học tập (learning science)
> "Ứng dụng làm tốt phần *nhớ* (lặp lại ngắt quãng, kiểm tra chủ động), nhưng gần như chỉ dừng ở tầng **Nhớ – Hiểu** của thang Bloom. Trắc nghiệm 4 lựa chọn dạy người học *nhận ra* đáp án, không dạy *tạo ra* lời giải."

| Nhận xét | Đề xuất |
|---|---|
| Thiếu **lộ trình**: kiến thức rời rạc, không có thứ tự tiên quyết, không có mục tiêu bài học | Lộ trình học theo chương → bài, mỗi bài có mục tiêu đo được |
| Chỉ có trắc nghiệm → khuyến khích học vẹt, đoán mò | Bài tập **tự sinh câu trả lời**: điền khuyết, sắp xếp quy trình, nối khái niệm, tự giải thích, phân tích tình huống, tìm lỗi sai |
| Không có bước **tự giải thích (Feynman)** — kỹ thuật hiệu quả nhất để phát hiện lỗ hổng | Người học viết lại bằng lời của mình, AI chấm theo các ý chính và chỉ ra chỗ hiểu sai |
| Không phân biệt "đúng vì hiểu" với "đúng vì đoán" | Hỏi **mức độ tự tin**; "chắc chắn mà sai" là *hiểu lầm nguy hiểm* cần ưu tiên sửa |
| Lý thuyết học một lần rồi thôi | Ôn bài học theo lịch giãn cách (1 – 3 – 7 – 16 ngày) |
| Một kiểu đề cho mọi môn | Môn tự nhiên cần **công thức** và bài tính nhiều bước; ngoại ngữ cần ngữ cảnh; xã hội cần nhân – quả, so sánh, tình huống |

## 🧐 Anh Tuấn — khách hàng khó tính (đã dùng với Gemini thật)
| Vấn đề | Kết quả kiểm tra |
|---|---|
| Nhập key Gemini mới → **lỗi 404 ngay** | Đúng: Google đã ngừng `gemini-2.5-flash` cho người dùng mới. **Đã sửa:** mặc định `gemini-flash-latest` + tự chuyển model khi bị ngừng |
| Tạo đề phải chờ ~19 giây | **Đã sửa:** chế độ Nhanh (~8 giây) |
| Thỉnh thoảng báo "quá tải" (503) rồi dừng | **Đã sửa:** tự thử lại |
| Gói miễn phí báo "exceeded quota" khi tạo đề dài | **Đã sửa:** tự đợi đúng thời gian Google yêu cầu rồi chạy tiếp, có thông báo |
| Đáp án đúng hay rơi vào B/C | **Đã sửa:** tự xáo vị trí đáp án |

## 👵 Bác Năm — mù công nghệ
> "Vào app thấy nhiều nút quá. Tôi chỉ muốn biết **hôm nay học gì**, bấm một nút là học."

| Vấn đề | Đề xuất |
|---|---|
| Trang chủ có nhiều lựa chọn ngang hàng | Thẻ **"Hôm nay học gì"**: danh sách việc cần làm theo thứ tự, mỗi việc một nút |
| Không biết bắt đầu học một môn từ đâu | **Lộ trình** có bài 1, bài 2… như sách giáo khoa, nút "Học tiếp" |
| Gõ công thức hoá/toán không được, hiện ký hiệu lạ | Hiển thị công thức đẹp ($x^2$, phân số, chỉ số dưới) |

## Đã nâng cấp ở v1.4
- 🗺️ **Lộ trình học**: AI chia giáo trình thành chương → bài với mục tiêu, mỗi bài học theo 4 bước *Học → Tự giải thích → Bài tập tư duy → Kiểm tra*, có điểm thành thạo và lịch ôn lại.
- 🧩 **Bài tập tư duy** 6 dạng: điền khuyết, sắp xếp quy trình, nối khái niệm, đúng/sai kèm lý do, tự luận/tình huống (AI chấm theo ý), tìm lỗi sai. Không có AI vẫn tự chấm theo thang tiêu chí.
- 🧠 **Tự giải thích (Feynman)**: AI chấm, chỉ ra ý còn thiếu và chỗ hiểu sai.
- 🎯 **Mức độ tự tin** khi trả lời, thống kê "hiểu lầm nguy hiểm".
- 📚 **Môn học**: mỗi bộ đề chọn loại môn để AI ra đề/bài tập đúng kiểu; hiển thị **công thức toán/hoá**.
- 📋 **Hôm nay học gì** trên trang chủ.
