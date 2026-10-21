import { useState } from "react";
import { useStore } from "./store";
import { go } from "./ui";
import { SAMPLE_DECK } from "./sample";

export const WELCOME_KEY = "quizforge-welcome-done";

export const FONT_SIZES: [number, string][] = [
  [1, "Bình thường"],
  [1.15, "Lớn"],
  [1.3, "Rất lớn"],
  [1.5, "Cực lớn"],
];

export default function Welcome({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const [step, setStep] = useState(0);
  const s = store.settings;
  const finish = async (then?: "sample" | "studio" | "import") => {
    localStorage.setItem(WELCOME_KEY, "1");
    onDone();
    if (then === "sample") {
      const d = await store.createDeck({ name: SAMPLE_DECK.name, description: SAMPLE_DECK.description, emoji: "🧭" });
      await store.addQuestions(d.id, SAMPLE_DECK.questions);
      go("practice/" + d.id);
    } else if (then) go(then);
  };

  return (
    <div className="modal-bg welcome-bg">
      <div className="modal welcome" role="dialog" aria-label="Chào mừng">
        <div className="welcome-dots">{[0, 1, 2].map((i) => <span key={i} className={i === step ? "on" : ""} />)}</div>
        {step === 0 && (
          <div className="welcome-body">
            <div className="welcome-logo">⚡</div>
            <h2>Chào mừng bạn đến với QuizForge!</h2>
            <p className="muted">Ứng dụng giúp bạn học thuộc bất kỳ môn nào bằng câu hỏi trắc nghiệm.</p>
            <div className="how">
              <div><span>📄</span><b>1. Đưa tài liệu vào</b><small>Sách, bài giảng, slide, ảnh chụp đề…</small></div>
              <div><span>🤖</span><b>2. Máy soạn câu hỏi</b><small>Có đáp án và lời giải thích</small></div>
              <div><span>🧠</span><b>3. Luyện & nhớ lâu</b><small>Máy nhắc ôn câu bạn hay sai</small></div>
            </div>
            <button className="btn primary big" onClick={() => setStep(1)}>Tiếp tục →</button>
          </div>
        )}
        {step === 1 && (
          <div className="welcome-body">
            <h2>Bạn đọc chữ cỡ nào thấy dễ nhất?</h2>
            <p className="muted">Bấm thử từng cỡ — chữ trên màn hình sẽ đổi ngay. Có thể đổi lại trong Cài đặt.</p>
            <div className="size-pick">
              {FONT_SIZES.map(([v, label]) => (
                <button key={v} className={"size-opt" + (s.fontScale === v ? " on" : "")} onClick={() => store.setSettings({ fontScale: v })}>
                  <span style={{ fontSize: `${v * 1.2}rem` }}>Aa</span>
                  {label}
                </button>
              ))}
            </div>
            <h3>Màu nền</h3>
            <div className="seg">
              {([["light", "☀️ Nền sáng"], ["dark", "🌙 Nền tối"], ["system", "💻 Tự động"]] as const).map(([v, l]) => (
                <button key={v} className={s.theme === v ? "on" : ""} onClick={() => store.setSettings({ theme: v })}>{l}</button>
              ))}
            </div>
            <label className="check big-check"><input type="checkbox" checked={s.sound} onChange={(e) => store.setSettings({ sound: e.target.checked })} /> Bật âm thanh khi trả lời đúng / sai</label>
            <div className="row gap center">
              <button className="btn ghost" onClick={() => setStep(0)}>← Quay lại</button>
              <button className="btn primary big" onClick={() => setStep(2)}>Tiếp tục →</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="welcome-body">
            <h2>Bạn muốn bắt đầu thế nào?</h2>
            <div className="start-grid">
              <button className="start" onClick={() => finish("sample")}><span>🧭</span><b>Chơi thử ngay</b><small>Làm thử 6 câu mẫu, không cần chuẩn bị gì</small></button>
              <button className="start" onClick={() => finish("studio")}><span>📄</span><b>Tôi có tài liệu</b><small>Để máy soạn câu hỏi (cần kết nối AI)</small></button>
              <button className="start" onClick={() => finish("import")}><span>📥</span><b>Tôi có sẵn câu hỏi</b><small>File Excel, Word hoặc ảnh chụp đề</small></button>
            </div>
            <button className="btn ghost" onClick={() => finish()}>Để sau, tôi tự khám phá</button>
          </div>
        )}
      </div>
    </div>
  );
}
