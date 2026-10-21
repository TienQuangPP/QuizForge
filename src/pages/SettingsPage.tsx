import { useRef, useState } from "react";
import { useStore } from "../store";
import type { AIProvider } from "../types";
import { aiReady, callAI, listModels } from "../ai";
import { download } from "../parsers";
import { confirmBox, Spinner } from "../ui";
import { canSpeak, sound, speak } from "../fx";
import { FONT_SIZES } from "../Welcome";

const SUGGEST: Record<AIProvider, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
  compatible: [],
};

const PRESETS = [
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { name: "Ollama (máy local)", url: "http://localhost:11434/v1" },
  { name: "LM Studio (máy local)", url: "http://localhost:1234/v1" },
];

const GUIDE: Record<"gemini" | "openai", { url: string; label: string; steps: string[]; note: string }> = {
  gemini: {
    url: "https://aistudio.google.com/apikey",
    label: "Mở trang Google AI Studio",
    steps: [
      "Bấm nút xanh bên dưới để mở trang của Google (mở tab mới).",
      "Đăng nhập bằng tài khoản Gmail của bạn, đồng ý điều khoản nếu được hỏi.",
      "Bấm nút “Create API key” (Tạo khoá API).",
      "Bấm biểu tượng sao chép 📋 cạnh dãy ký tự bắt đầu bằng “AIza…”.",
      "Quay lại đây, bấm vào ô “Dán khoá” bên dưới rồi nhấn Ctrl+V. Máy sẽ tự kiểm tra.",
    ],
    note: "Miễn phí với mức dùng vừa phải. Không cần thẻ ngân hàng.",
  },
  openai: {
    url: "https://platform.openai.com/api-keys",
    label: "Mở trang OpenAI",
    steps: [
      "Bấm nút bên dưới để mở trang OpenAI Platform.",
      "Đăng nhập (có thể dùng tài khoản ChatGPT), nạp tiền ở mục Billing nếu chưa có.",
      "Bấm “Create new secret key”, đặt tên tuỳ ý rồi bấm Create.",
      "Bấm Copy để sao chép dãy ký tự bắt đầu bằng “sk-…”.",
      "Quay lại đây, dán vào ô “Dán khoá” bên dưới. Máy sẽ tự kiểm tra.",
    ],
    note: "Trả phí theo lượng dùng (tạo 20 câu thường tốn chưa tới 1.000đ). Gói ChatGPT Plus KHÔNG bao gồm API.",
  },
};

export default function SettingsPage() {
  const store = useStore();
  const s = store.settings;
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const testTimer = useRef<number | undefined>(undefined);

  const keyField = s.provider === "openai" ? "openaiKey" : s.provider === "gemini" ? "geminiKey" : "compatKey";
  const modelField = s.provider === "openai" ? "openaiModel" : s.provider === "gemini" ? "geminiModel" : "compatModel";

  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      const out = await callAI(store.settings, [{ role: "user", content: "Chỉ trả lời đúng câu: Kết nối thành công!" }]);
      setResult({ ok: true, text: "Kết nối thành công! AI đã sẵn sàng. " + (out.length < 80 ? `(AI trả lời: “${out.trim()}”)` : "") });
      sound("right");
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    }
    setBusy("");
  };
  // Auto-test shortly after a key is pasted, so non-technical users get instant feedback.
  const onKey = (v: string) => {
    store.setSettings({ [keyField]: v.trim() } as any);
    setResult(null);
    clearTimeout(testTimer.current);
    if (v.trim().length > 20) testTimer.current = window.setTimeout(() => document.getElementById("test-ai")?.click(), 600);
  };
  const loadModels = async () => {
    setBusy("models");
    try {
      const m = await listModels(s);
      setModels(m);
      store.toast(`Tìm thấy ${m.length} model`);
    } catch (e: any) {
      store.toast(e.message, "err");
    }
    setBusy("");
  };

  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "quizforge") throw new Error("Đây không phải file sao lưu QuizForge. Muốn đưa câu hỏi vào, hãy dùng mục Nhập câu hỏi.");
      const replace = confirmBox("Thay thế toàn bộ dữ liệu hiện tại bằng file sao lưu?\n\nOK = thay thế hết\nCancel = gộp thêm vào dữ liệu đang có");
      await store.importBackup(data, replace);
      store.toast("Đã khôi phục dữ liệu");
    } catch (e: any) {
      store.toast(e.message, "err");
    }
  };

  const guide = s.provider !== "compatible" ? GUIDE[s.provider] : null;
  const lastBackup = +(localStorage.getItem("quizforge-last-backup") || 0);

  return (
    <div className="page narrow">
      <h1>⚙️ Cài đặt</h1>

      <div className="card stack">
        <h3>👀 Dễ nhìn & âm thanh</h3>
        <label>Cỡ chữ</label>
        <div className="size-pick">
          {FONT_SIZES.map(([v, label]) => (
            <button key={v} className={"size-opt" + (s.fontScale === v ? " on" : "")} onClick={() => store.setSettings({ fontScale: v })}>
              <span style={{ fontSize: `${v * 1.2}rem` }}>Aa</span>
              {label}
            </button>
          ))}
        </div>
        <label>Màu nền</label>
        <div className="seg">
          {([["light", "☀️ Sáng"], ["dark", "🌙 Tối"], ["system", "💻 Theo máy"]] as const).map(([v, l]) => (
            <button key={v} className={s.theme === v ? "on" : ""} onClick={() => store.setSettings({ theme: v })}>{l}</button>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={s.sound} onChange={(e) => store.setSettings({ sound: e.target.checked })} /> Âm thanh khi trả lời đúng/sai, lên cấp</label>
        <label className="check"><input type="checkbox" checked={s.effects} onChange={(e) => store.setSettings({ effects: e.target.checked })} /> Hiệu ứng pháo giấy 🎉</label>
        {canSpeak() && (
          <>
            <label className="check"><input type="checkbox" checked={s.autoRead} onChange={(e) => store.setSettings({ autoRead: e.target.checked })} /> Tự động đọc to mỗi câu hỏi khi làm bài</label>
            <label>Tốc độ giọng đọc: {s.speechRate === 1 ? "bình thường" : s.speechRate < 1 ? "chậm" : "nhanh"}</label>
            <div className="row gap">
              <input className="grow" type="range" min={0.6} max={1.4} step={0.1} value={s.speechRate} onChange={(e) => store.setSettings({ speechRate: +e.target.value })} />
              <button className="btn sm" onClick={() => speak("Xin chào! Đây là giọng đọc câu hỏi của QuizForge.")}>🔊 Nghe thử</button>
            </div>
          </>
        )}
      </div>

      <div className="card stack">
        <h3>🤖 Kết nối AI {aiReady(s) && result?.ok !== false && <span className="pill good">Đã có khoá</span>}</h3>
        <p className="muted small">AI giúp tự soạn câu hỏi từ tài liệu, giảng giải câu sai và trả lời thắc mắc. Không bắt buộc.</p>
        <label>Chọn nhà cung cấp AI</label>
        <div className="provider-pick">
          <button className={s.provider === "gemini" ? "on" : ""} onClick={() => { store.setSettings({ provider: "gemini" }); setResult(null); }}>
            <b>Google Gemini</b><small>✅ Miễn phí · khuyên dùng</small>
          </button>
          <button className={s.provider === "openai" ? "on" : ""} onClick={() => { store.setSettings({ provider: "openai" }); setResult(null); }}>
            <b>ChatGPT (OpenAI)</b><small>Trả phí theo lượng dùng</small>
          </button>
          <button className={s.provider === "compatible" ? "on" : ""} onClick={() => { store.setSettings({ provider: "compatible" }); setResult(null); }}>
            <b>Khác</b><small>OpenRouter, Groq, Ollama…</small>
          </button>
        </div>

        {guide && (
          <div className="guide">
            <b>Cách lấy khoá (API key) — khoảng 2 phút:</b>
            <ol>{guide.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            <a className="btn primary" href={guide.url} target="_blank" rel="noreferrer">🌐 {guide.label}</a>
            <p className="muted small">{guide.note}</p>
            <details>
              <summary className="small">“API key” là gì? Có an toàn không?</summary>
              <p className="small">API key giống một mật khẩu riêng, cho phép QuizForge dùng AI dưới tài khoản của bạn. Khoá chỉ được lưu trong trình duyệt trên máy này và chỉ gửi tới {s.provider === "gemini" ? "Google" : "OpenAI"}. Đừng đưa khoá cho người lạ; nếu lỡ lộ, vào lại trang trên để xoá khoá cũ và tạo khoá mới.</p>
            </details>
          </div>
        )}

        {s.provider === "compatible" && (
          <>
            <label>Địa chỉ máy chủ (Base URL, chuẩn OpenAI /v1)</label>
            <input value={s.compatBaseUrl} onChange={(e) => store.setSettings({ compatBaseUrl: e.target.value })} />
            <div className="chips tight">
              {PRESETS.map((p) => <button key={p.name} className="chip" onClick={() => store.setSettings({ compatBaseUrl: p.url })}>{p.name}</button>)}
            </div>
          </>
        )}

        <label>{s.provider === "compatible" ? "API key (để trống nếu dùng Ollama/LM Studio)" : "Dán khoá vào đây"}</label>
        <div className="row gap">
          <input className="grow key-input" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={s[keyField]} onChange={(e) => onKey(e.target.value)} placeholder={s.provider === "gemini" ? "AIza…" : "sk-…"} />
          <button className="btn ghost" onClick={() => setShowKey(!showKey)}>{showKey ? "Ẩn" : "Hiện"}</button>
        </div>
        {s.provider === "compatible" && (
          <>
            <label>Tên model</label>
            <input list="model-list" value={s.compatModel} onChange={(e) => store.setSettings({ compatModel: e.target.value })} placeholder="VD: meta-llama/llama-3.3-70b-instruct" />
          </>
        )}
        <div className="row gap wrap">
          <button id="test-ai" className="btn primary" disabled={!!busy || !aiReady(s)} onClick={test}>{busy === "test" ? <><Spinner /> Đang kiểm tra…</> : "Kiểm tra kết nối"}</button>
          {s[keyField] && <button className="btn ghost danger" onClick={() => { store.setSettings({ [keyField]: "" } as any); setResult(null); }}>Xoá khoá</button>}
        </div>
        {result && <div className={"callout " + (result.ok ? "good" : "bad")}>{result.ok ? "✅ " : "❌ "}{result.text}</div>}

        <details className="advanced">
          <summary>⚙️ Nâng cao (dành cho người rành công nghệ)</summary>
          <div className="stack">
            {s.provider !== "compatible" && (
              <>
                <label>Model</label>
                <div className="row gap">
                  <input className="grow" list="model-list" value={s[modelField]} onChange={(e) => store.setSettings({ [modelField]: e.target.value } as any)} placeholder="Tên model" />
                  <button className="btn" disabled={!!busy || !aiReady(s)} onClick={loadModels}>{busy === "models" ? <Spinner /> : "Tải danh sách"}</button>
                </div>
                <div className="chips tight">
                  {SUGGEST[s.provider].map((m) => <button key={m} className={"chip" + (s[modelField] === m ? " on" : "")} onClick={() => store.setSettings({ [modelField]: m } as any)}>{m}</button>)}
                </div>
              </>
            )}
            {s.provider === "compatible" && <button className="btn sm" disabled={!!busy} onClick={loadModels}>{busy === "models" ? <Spinner /> : "Tải danh sách model"}</button>}
            <datalist id="model-list">{[...new Set([...models, ...SUGGEST[s.provider]])].map((m) => <option key={m} value={m} />)}</datalist>
            <label>Độ sáng tạo (temperature): {s.temperature}</label>
            <input type="range" min={0} max={1} step={0.1} value={s.temperature} onChange={(e) => store.setSettings({ temperature: +e.target.value })} />
            <div className="grid2">
              <div>
                <label>Mục tiêu mỗi ngày (câu)</label>
                <input type="number" min={5} value={s.dailyGoal} onChange={(e) => store.setSettings({ dailyGoal: Math.max(1, +e.target.value || 1) })} />
              </div>
              <div>
                <label>Thời gian thi thử (giây/câu)</label>
                <input type="number" min={10} value={s.examSecondsPerQuestion} onChange={(e) => store.setSettings({ examSecondsPerQuestion: Math.max(10, +e.target.value || 60) })} />
              </div>
            </div>
          </div>
        </details>
      </div>

      <div className="card stack">
        <h3>💾 Sao lưu dữ liệu</h3>
        <p className="muted small">
          Mọi bộ đề, tài liệu và tiến độ được lưu trong trình duyệt trên máy này. Hãy sao lưu để không mất khi đổi máy, cài lại Windows hoặc xoá lịch sử duyệt web.
          {" "}{lastBackup ? `Lần sao lưu gần nhất: ${new Date(lastBackup).toLocaleDateString("vi-VN")}.` : "Bạn chưa sao lưu lần nào."}
        </p>
        <div className="row gap wrap">
          <button className="btn primary" onClick={() => { download(`quizforge-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll())); localStorage.setItem("quizforge-last-backup", String(Date.now())); store.toast("Đã tải file sao lưu về thư mục Downloads"); }}>⤓ Sao lưu toàn bộ</button>
          <label className="btn file-btn">
            ⤒ Khôi phục từ file
            <input type="file" accept=".json" hidden onChange={(e) => restore(e.target.files?.[0])} />
          </label>
          <button className="btn danger ghost" onClick={async () => {
            if (!confirmBox("Xoá TOÀN BỘ bộ đề, tài liệu và tiến độ?\nViệc này KHÔNG thể hoàn tác. Nên sao lưu trước.")) return;
            await store.wipe();
            store.toast("Đã xoá toàn bộ dữ liệu");
          }}>🗑 Xoá toàn bộ dữ liệu</button>
        </div>
        <div className="muted small">
          {store.decks.length} bộ đề · {store.questions.length} câu hỏi · {store.docs.length} tài liệu · {store.sessions.length} lượt làm bài
        </div>
      </div>
      <p className="muted small center">QuizForge v1.3.1 · chạy trên máy bạn · AI chỉ dùng khi bạn bấm</p>
    </div>
  );
}
