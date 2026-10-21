// Subject profiles: tune AI prompts so every kind of course gets fitting questions and exercises.
export type SubjectId = "general" | "math" | "science" | "social" | "language" | "code" | "professional";

export interface SubjectProfile {
  id: SubjectId;
  icon: string;
  label: string;
  examples: string;
  /** Extra guidance appended to question / exercise / theory prompts. */
  hint: string;
}

export const SUBJECTS: SubjectProfile[] = [
  {
    id: "general",
    icon: "📘",
    label: "Chung",
    examples: "Kỹ năng mềm, kiến thức tổng hợp",
    hint: "Ưu tiên hiểu bản chất và vận dụng vào tình huống thực tế.",
  },
  {
    id: "math",
    icon: "📐",
    label: "Toán · Lý · Hoá",
    examples: "Toán, Vật lý, Hoá học, Thống kê, Kế toán",
    hint: "Môn tính toán: có bài tập tính nhiều bước với số liệu cụ thể; hỏi về điều kiện áp dụng công thức và lỗi tính thường gặp. Viết công thức bằng LaTeX đặt giữa dấu $…$ (ví dụ $v = \\frac{s}{t}$, $H_2O$ viết $H_2O$). Lời giải trình bày từng bước.",
  },
  {
    id: "science",
    icon: "🧬",
    label: "Sinh · Y · KH tự nhiên",
    examples: "Sinh học, Y khoa, Dược, Địa chất, Môi trường",
    hint: "Khoa học tự nhiên: hỏi về cơ chế, quá trình theo trình tự, nguyên nhân – hệ quả, so sánh cấu trúc – chức năng, và tình huống thực tế (ca bệnh, thí nghiệm). Công thức viết bằng LaTeX trong $…$.",
  },
  {
    id: "social",
    icon: "🏛️",
    label: "Xã hội · Luật · Kinh tế",
    examples: "Lịch sử, Địa lý, Luật, Kinh tế, Chính trị, Marketing",
    hint: "Khoa học xã hội: hỏi về nguyên nhân – diễn biến – kết quả – ý nghĩa, so sánh quan điểm, phân tích tình huống/vụ việc, đánh giá lập luận; tránh chỉ hỏi thuộc lòng năm tháng.",
  },
  {
    id: "language",
    icon: "🗣️",
    label: "Ngoại ngữ · Văn",
    examples: "Tiếng Anh, IELTS, Ngữ văn, Ngôn ngữ học",
    hint: "Ngôn ngữ: kiểm tra từ vựng và ngữ pháp TRONG NGỮ CẢNH câu cụ thể, phân biệt từ dễ nhầm, sửa lỗi câu, đọc hiểu đoạn ngắn, viết lại câu; giải thích quy tắc kèm ví dụ.",
  },
  {
    id: "code",
    icon: "💻",
    label: "Lập trình · CNTT",
    examples: "Python, Java, SQL, Mạng máy tính, Cấu trúc dữ liệu",
    hint: "Lập trình: có câu đọc hiểu đoạn code ngắn (đặt trong `…`), dự đoán kết quả chạy, tìm lỗi (bug), chọn cách cài đặt tốt hơn, độ phức tạp thuật toán.",
  },
  {
    id: "professional",
    icon: "💼",
    label: "Chuyên ngành · Chứng chỉ",
    examples: "Quản trị, Tài chính, PMP, ACCA, Nghiệp vụ ngân hàng",
    hint: "Chuyên ngành/chứng chỉ: ưu tiên tình huống nghiệp vụ thực tế, chọn quyết định đúng theo quy trình/chuẩn mực, phân biệt thuật ngữ chuyên môn.",
  },
];

export const subjectOf = (id?: string) => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
