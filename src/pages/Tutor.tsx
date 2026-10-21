import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { aiReady, generateQuestions, tutorReply, type ChatMsg } from "../ai";
import { compressImage } from "../parsers";
import { go, Markdown, Spinner } from "../ui";

const QUICK = [
  "Tóm tắt toàn bộ tài liệu thành dàn ý ôn thi",
  "Liệt kê các khái niệm/thuật ngữ quan trọng kèm định nghĩa ngắn",
  "Những phần nào dễ ra đề thi nhất? Vì sao?",
  "So sánh các khái niệm dễ nhầm lẫn trong tài liệu",
  "Tạo sơ đồ tư duy (dạng danh sách lồng nhau)",
  "Giải thích phần khó nhất như cho người mới bắt đầu",
];

const histKey = (deckId: string) => `quizforge-chat-${deckId}`;

export default function Tutor({ deckId }: { deckId?: string }) {
  const store = useStore();
  const [deck, setDeck] = useState(deckId ?? store.decks[0]?.id ?? "");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const ready = aiReady(store.settings);
  const docs = store.docs.filter((d) => d.deckId === deck);
  const d = store.decks.find((x) => x.id === deck);

  useEffect(() => {
    try { setMsgs(JSON.parse(localStorage.getItem(histKey(deck)) || "[]")); } catch { setMsgs([]); }
  }, [deck]);
  useEffect(() => {
    if (deck) localStorage.setItem(histKey(deck), JSON.stringify(msgs.slice(-40).map((m) => ({ ...m, images: undefined }))));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, deck]);

  const context = () => {
    const parts = docs.map((x) => `### ${x.name}\n${x.text}`);
    if (!parts.length) {
      // Fall back to the deck's questions as knowledge.
      const qs = store.questions.filter((q) => q.deckId === deck).slice(0, 150);
      return qs.map((q) => `Q: ${q.question}\nĐáp án: ${q.answers.map((a) => q.options[a]).join("; ")}${q.explanation ? `\n${q.explanation}` : ""}`).join("\n\n");
    }
    return parts.join("\n\n");
  };

  const send = async (text = input) => {
    if (!text.trim() && !images.length) return;
    const history: ChatMsg[] = [...msgs, { role: "user", content: text.trim() || "Giải thích ảnh này", images: images.length ? images : undefined }];
    setMsgs(history);
    setInput("");
    setImages([]);
    setBusy(true);
    setErr("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const reply = await tutorReply(store.settings, history.slice(-16), context(), ctrl.signal);
      setMsgs([...history, { role: "assistant", content: reply }]);
    } catch (e: any) {
      if (e.name !== "AbortError") setErr(e.message);
    }
    setBusy(false);
  };

  const quizFromChat = async () => {
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!last || !deck) return;
    setBusy(true);
    try {
      const qs = await generateQuestions(store.settings, last.content, { count: 5, language: "vi", difficulty: "mixed", optionCount: 4, types: ["understanding", "application"], instructions: "", withExplanation: true }, "Gia sư AI", () => {});
      const n = await store.addQuestions(deck, qs);
      store.toast(`Đã thêm ${n} câu từ đoạn hội thoại vào bộ đề`);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="page chat-page">
      <div className="page-head">
        <div>
          <h1>🤖 Gia sư AI</h1>
          <p className="muted">Hỏi bất cứ điều gì về giáo trình. AI trả lời dựa trên tài liệu của bộ đề bạn chọn.</p>
        </div>
        <div className="row gap">
          <select value={deck} onChange={(e) => setDeck(e.target.value)}>
            {store.decks.map((x) => <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>)}
          </select>
          {msgs.length > 0 && <button className="btn ghost" onClick={() => setMsgs([])}>Cuộc trò chuyện mới</button>}
        </div>
      </div>
      {!ready && <div className="callout warn">Cần <a href="#/settings">kết nối AI</a> để dùng gia sư.</div>}
      {d && (
        <div className="muted small">
          Ngữ cảnh: {docs.length ? `${docs.length} tài liệu (${Math.round(docs.reduce((n, x) => n + x.text.length, 0) / 1000)}k ký tự)` : `chưa có tài liệu — dùng ${store.questions.filter((q) => q.deckId === deck).length} câu hỏi của bộ đề`}
          {!docs.length && <> · <a onClick={() => go(`deck/${deck}/docs`)}>Thêm tài liệu</a></>}
        </div>
      )}
      <div className="chat">
        {msgs.length === 0 && (
          <div className="quick">
            {QUICK.map((q) => <button key={q} className="chip" disabled={!ready || !deck} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            {m.images?.map((src, j) => <img key={j} src={src} alt="" />)}
            {m.role === "assistant" ? <Markdown text={m.content} /> : <p>{m.content}</p>}
          </div>
        ))}
        {busy && <div className="msg assistant"><Spinner /> Đang suy nghĩ… <button className="btn sm ghost" onClick={() => abort.current?.abort()}>Dừng</button></div>}
        {err && <div className="callout bad">{err}</div>}
        <div ref={endRef} />
      </div>
      {msgs.some((m) => m.role === "assistant") && !busy && (
        <div className="row gap"><button className="btn sm" onClick={quizFromChat}>✨ Tạo 5 câu trắc nghiệm từ câu trả lời vừa rồi</button></div>
      )}
      <div className="composer">
        {images.length > 0 && <div className="thumbs">{images.map((s, i) => <div className="thumb" key={i}><img src={s} alt="" /><button className="icon-btn" onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button></div>)}</div>}
        <div className="row gap">
          <label className="icon-btn file-btn" title="Đính kèm ảnh">
            📎
            <input type="file" accept="image/*" hidden multiple onChange={async (e) => { const fs = Array.from(e.target.files ?? []); const urls = await Promise.all(fs.map((f) => compressImage(f))); setImages((im) => [...im, ...urls]); }} />
          </label>
          <textarea
            rows={2}
            value={input}
            disabled={!ready || !deck}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={async (e) => {
              const f = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"))?.getAsFile();
              if (f) { e.preventDefault(); const u = await compressImage(f); setImages((im) => [...im, u]); }
            }}
            placeholder={deck ? "Hỏi gia sư… (Enter gửi, Shift+Enter xuống dòng, dán ảnh được)" : "Tạo bộ đề trước"}
          />
          <button className="btn primary" disabled={busy || !ready || (!input.trim() && !images.length)} onClick={() => send()}>Gửi</button>
        </div>
      </div>
    </div>
  );
}
