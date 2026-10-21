import type { DraftQuestion } from "./types";

export const SAMPLE_DECK: { name: string; description: string; questions: DraftQuestion[] } = {
  name: "Bộ mẫu: Kỹ năng học tập",
  description: "Bộ câu hỏi nhỏ để làm quen với QuizForge. Có thể xoá bất cứ lúc nào.",
  questions: [
    {
      question: "Kỹ thuật “lặp lại ngắt quãng” (spaced repetition) giúp ghi nhớ tốt hơn chủ yếu vì sao?",
      options: ["Ôn lại đúng lúc sắp quên giúp củng cố trí nhớ dài hạn", "Học nhiều giờ liền trong một buổi", "Chỉ đọc lại tài liệu nhiều lần", "Tránh hoàn toàn việc tự kiểm tra"],
      answers: [0],
      explanation: "Mỗi lần nhớ lại thông tin khi nó sắp bị quên, đường truy xuất được củng cố, khoảng cách ôn kéo dài dần.",
      topic: "Phương pháp học",
      difficulty: "easy",
    },
    {
      question: "Phương pháp nào là ví dụ của “active recall” (chủ động nhớ lại)?",
      options: ["Gạch chân thật nhiều trong sách", "Tự làm câu hỏi trắc nghiệm mà không nhìn tài liệu", "Nghe lại bài giảng ở tốc độ 2x", "Chép lại nguyên văn slide"],
      answers: [1],
      explanation: "Active recall là buộc não truy xuất kiến thức — làm câu hỏi/thẻ nhớ là cách điển hình.",
      topic: "Phương pháp học",
      difficulty: "easy",
    },
    {
      question: "Đâu KHÔNG phải là lợi ích của việc làm đề thi thử có bấm giờ?",
      options: ["Quen áp lực thời gian", "Phát hiện lỗ hổng kiến thức", "Đảm bảo chắc chắn đạt điểm tối đa", "Luyện chiến lược phân bổ thời gian"],
      answers: [2],
      explanation: "Thi thử giúp chuẩn bị tốt hơn nhưng không thể đảm bảo chắc chắn điểm tối đa.",
      topic: "Chiến lược thi",
      difficulty: "medium",
    },
    {
      question: "Kỹ thuật Pomodoro thường gồm những yếu tố nào? (Chọn tất cả đáp án đúng)",
      options: ["Phiên tập trung khoảng 25 phút", "Nghỉ ngắn sau mỗi phiên", "Nghỉ dài hơn sau vài phiên", "Làm nhiều việc cùng lúc trong một phiên"],
      answers: [0, 1, 2],
      explanation: "Pomodoro: 25 phút tập trung một việc, nghỉ 5 phút, sau 4 phiên nghỉ dài 15–30 phút.",
      topic: "Quản lý thời gian",
      difficulty: "medium",
    },
    {
      question: "“Interleaving” (học xen kẽ) nghĩa là gì?",
      options: ["Học một chủ đề duy nhất đến khi thật thuộc", "Xen kẽ nhiều dạng bài/chủ đề liên quan trong một buổi", "Học vào ban đêm và ban ngày xen kẽ", "Đọc hai cuốn sách cùng lúc"],
      answers: [1],
      explanation: "Xen kẽ dạng bài giúp não học cách phân biệt khi nào dùng phương pháp nào, hiệu quả hơn học dồn một dạng.",
      topic: "Phương pháp học",
      difficulty: "hard",
    },
    {
      question: "Ngủ đủ giấc sau khi học có tác dụng củng cố trí nhớ.",
      options: ["Đúng", "Sai"],
      answers: [0],
      explanation: "Giấc ngủ giúp củng cố (consolidate) ký ức mới vào trí nhớ dài hạn.",
      topic: "Sức khoẻ & học tập",
      difficulty: "easy",
    },
  ],
};
