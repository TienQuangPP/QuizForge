import { useState } from "react";
import { useStore } from "../store";
import type { AIProvider } from "../types";
import { callAI, listModels, PROVIDER_LABEL } from "../ai";
import { download } from "../parsers";
import { confirmBox, Spinner } from "../ui";

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

export default function SettingsPage() {
  const store = useStore();
  const s = store.settings;
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const keyField = s.provider === "openai" ? "openaiKey" : s.provider === "gemini" ? "geminiKey" : "compatKey";
  const modelField = s.provider === "openai" ? "openaiModel" : s.provider === "gemini" ? "geminiModel" : "compatModel";

  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      const out = await callAI(s, [{ role: "user", content: "Trả lời đúng một câu: 'Kết nối thành công!' kèm tên model của bạn." }]);
      setResult({ ok: true, text: out.slice(0, 200) });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    }
    setBusy("");
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
      if (data.app !== "quizforge") throw new Error("Không phải file sao lưu QuizForge. Để nhập câu hỏi hãy dùng mục Nhập câu hỏi.");
      const replace = confirmBox("Thay thế toàn bộ dữ liệu hiện tại?\nOK = thay thế · Cancel = gộp thêm vào");
      await store.importBackup(data, replace);
      store.toast("Đã khôi phục dữ liệu");
    } catch (e: any) {
      store.toast(e.message, "err");
    }
  };

  return (
    <div className="page narrow">
      <h1>⚙️ Cài đặt</h1>

      <div className="card stack">
        <h3>🤖 Kết nối AI</h3>
        <p className="muted small">
          API key chỉ lưu trong trình duyệt trên máy này và được gửi thẳng tới nhà cung cấp AI bạn chọn. Lấy key tại{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> (Gemini, có gói miễn phí) hoặc{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI Platform</a> (ChatGPT, trả phí theo lượng dùng).
        </p>
        <div className="seg">
          {(Object.keys(PROVIDER_LABEL) as AIProvider[]).map((p) => (
            <button key={p} className={s.provider === p ? "on" : ""} onClick={() => { store.setSettings({ provider: p }); setModels([]); setResult(null); }}>
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
        {s.provider === "compatible" && (
          <>
            <label>Base URL (chuẩn OpenAI /v1)</label>
            <input value={s.compatBaseUrl} onChange={(e) => store.setSettings({ compatBaseUrl: e.target.value })} />
            <div className="chips tight">
              {PRESETS.map((p) => <button key={p.name} className="chip" onClick={() => store.setSettings({ compatBaseUrl: p.url })}>{p.name}</button>)}
            </div>
          </>
        )}
        <label>API key {s.provider === "compatible" && <span className="muted">(để trống nếu dùng Ollama/LM Studio)</span>}</label>
        <div className="row gap">
          <input className="grow" type={showKey ? "text" : "password"} autoComplete="off" value={s[keyField]} onChange={(e) => store.setSettings({ [keyField]: e.target.value } as any)} placeholder={s.provider === "gemini" ? "AIza…" : "sk-…"} />
          <button className="btn ghost" onClick={() => setShowKey(!showKey)}>{showKey ? "Ẩn" : "Hiện"}</button>
        </div>
        <label>Model</label>
        <div className="row gap">
          <input className="grow" list="model-list" value={s[modelField]} onChange={(e) => store.setSettings({ [modelField]: e.target.value } as any)} placeholder="Tên model" />
          <datalist id="model-list">
            {[...new Set([...models, ...SUGGEST[s.provider]])].map((m) => <option key={m} value={m} />)}
          </datalist>
          <button className="btn" disabled={!!busy} onClick={loadModels}>{busy === "models" ? <Spinner /> : "Tải danh sách model"}</button>
        </div>
        <div className="chips tight">
          {SUGGEST[s.provider].map((m) => <button key={m} className={"chip" + (s[modelField] === m ? " on" : "")} onClick={() => store.setSettings({ [modelField]: m } as any)}>{m}</button>)}
        </div>
        <label>Độ sáng tạo (temperature): {s.temperature}</label>
        <input type="range" min={0} max={1} step={0.1} value={s.temperature} onChange={(e) => store.setSettings({ temperature: +e.target.value })} />
        <div className="row gap">
          <button className="btn primary" disabled={!!busy} onClick={test}>{busy === "test" ? <><Spinner /> Đang thử…</> : "Kiểm tra kết nối"}</button>
        </div>
        {result && <div className={"callout " + (result.ok ? "good" : "bad")}>{result.ok ? "✅ " : "❌ "}{result.text}</div>}
      </div>

      <div className="card stack">
        <h3>🎨 Giao diện & học tập</h3>
        <label>Chủ đề màu</label>
        <div className="seg">
          {([["light", "☀️ Sáng"], ["dark", "🌙 Tối"], ["system", "💻 Theo hệ thống"]] as const).map(([v, l]) => (
            <button key={v} className={s.theme === v ? "on" : ""} onClick={() => store.setSettings({ theme: v })}>{l}</button>
          ))}
        </div>
        <div className="grid2">
          <div>
            <label>Mục tiêu mỗi ngày (câu)</label>
            <input type="number" min={5} value={s.dailyGoal} onChange={(e) => store.setSettings({ dailyGoal: Math.max(1, +e.target.value || 1) })} />
          </div>
          <div>
            <label>Thời gian thi thử mặc định (giây/câu)</label>
            <input type="number" min={10} value={s.examSecondsPerQuestion} onChange={(e) => store.setSettings({ examSecondsPerQuestion: Math.max(10, +e.target.value || 60) })} />
          </div>
        </div>
      </div>

      <div className="card stack">
        <h3>💾 Dữ liệu</h3>
        <p className="muted small">Mọi dữ liệu (bộ đề, tài liệu, tiến độ) lưu trong trình duyệt trên máy này. Hãy sao lưu định kỳ hoặc khi chuyển máy.</p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => download(`quizforge-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll()))}>⤓ Sao lưu toàn bộ</button>
          <label className="btn file-btn">
            ⤒ Khôi phục từ file
            <input type="file" accept=".json" hidden onChange={(e) => restore(e.target.files?.[0])} />
          </label>
          <button className="btn danger ghost" onClick={async () => {
            if (!confirmBox("Xoá TOÀN BỘ bộ đề, tài liệu và tiến độ? Không thể hoàn tác.")) return;
            await store.wipe();
            store.toast("Đã xoá toàn bộ dữ liệu");
          }}>🗑 Xoá toàn bộ dữ liệu</button>
        </div>
        <div className="muted small">
          {store.decks.length} bộ đề · {store.questions.length} câu hỏi · {store.docs.length} tài liệu · {store.sessions.length} lượt làm bài
        </div>
      </div>
      <p className="muted small center">QuizForge v1.0 · chạy offline trên máy bạn · AI chỉ dùng khi bạn bấm</p>
    </div>
  );
}
