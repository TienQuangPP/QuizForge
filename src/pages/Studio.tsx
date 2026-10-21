import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { DraftQuestion } from "../types";
import { aiReady, callAI, generateQuestions, QUESTION_TYPES, type GenOptions } from "../ai";
import { DOC_ACCEPT, extractText, isImage } from "../parsers";
import { DiffBadge, go, Modal, QuestionForm, Spinner } from "../ui";

const OPTS_KEY = "quizforge-gen-opts";
const defaultOpts: GenOptions = {
  count: 20,
  language: "vi",
  difficulty: "mixed",
  optionCount: 4,
  types: ["definition", "understanding", "application", "negative"],
  instructions: "",
  withExplanation: true,
};

export function DraftReview({ drafts, setDrafts, picked, setPicked }: {
  drafts: DraftQuestion[];
  setDrafts: (d: DraftQuestion[]) => void;
  picked: Set<number>;
  setPicked: (s: Set<number>) => void;
}) {
  const [edit, setEdit] = useState<number | null>(null);
  const [tmp, setTmp] = useState<DraftQuestion | null>(null);
  const toggle = (i: number) => {
    const n = new Set(picked);
    n.has(i) ? n.delete(i) : n.add(i);
    setPicked(n);
  };
  return (
    <div className="stack">
      {drafts.map((q, i) => (
        <div key={i} className={"draft" + (picked.has(i) ? "" : " off")}>
          <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
          <div className="grow">
            <div className="qtext"><b>{i + 1}.</b> {q.question}</div>
            {q.image && <img className="qimg-small" src={q.image} alt="" />}
            <ol type="A" className="opts">
              {q.options.map((o, j) => <li key={j} className={q.answers.includes(j) ? "correct" : ""}>{o}</li>)}
            </ol>
            {q.explanation && <div className="explain-mini">💡 {q.explanation}</div>}
            <div className="row gap small">
              {q.topic && <span className="pill">{q.topic}</span>}
              <DiffBadge d={q.difficulty} />
              {q.source && <span className="muted">{q.source}</span>}
              {!q.answers.length && <span className="pill bad">⚠️ Chưa có đáp án — bấm ✎ để chọn</span>}
              {q.options.length > 2 && q.answers.length === q.options.length && <span className="pill bad">⚠️ Tất cả phương án đều đúng?</span>}
            </div>
          </div>
          <button className="icon-btn" title="Sửa" onClick={() => { setEdit(i); setTmp({ ...q }); }}>✎</button>
        </div>
      ))}
      {edit != null && tmp && (
        <Modal wide title={`Sửa câu ${edit + 1}`} onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={() => { setDrafts(drafts.map((d, j) => (j === edit ? tmp : d))); setEdit(null); }}>Xong</button>}>
          <QuestionForm value={tmp} onChange={setTmp} />
        </Modal>
      )}
    </div>
  );
}

export default function Studio({ deckId, docId }: { deckId?: string; docId?: string }) {
  const store = useStore();
  const ready = aiReady(store.settings);
  const [target, setTarget] = useState(deckId && store.decks.some((d) => d.id === deckId) ? deckId : store.decks[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"docs" | "paste" | "topic">("docs");
  const [chosenDocs, setChosenDocs] = useState<Set<string>>(new Set(docId ? [docId] : []));
  const [pasted, setPasted] = useState("");
  const [topicText, setTopicText] = useState("");
  const [opts, setOpts] = useState<GenOptions>(() => ({ ...defaultOpts, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") }));
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => localStorage.setItem(OPTS_KEY, JSON.stringify(opts)), [opts]);
  const docs = useMemo(() => store.docs.filter((d) => d.deckId === target), [store.docs, target]);
  useEffect(() => {
    if (!docId) setChosenDocs(new Set(docs.map((d) => d.id)));
  }, [target]); // eslint-disable-line
  useEffect(() => {
    if (target !== "__new" && !docs.length && mode === "docs") setMode("paste");
  }, [target]); // eslint-disable-line

  const set = (p: Partial<GenOptions>) => setOpts((o) => ({ ...o, ...p }));

  const ensureDeck = async () => {
    if (target !== "__new") return target;
    const name = newName.trim() || (mode === "topic" ? topicText.slice(0, 60) : "Bộ đề mới " + new Date().toLocaleDateString("vi-VN"));
    const d = await store.createDeck({ name });
    setTarget(d.id);
    return d.id;
  };

  const upload = async (files: FileList | null) => {
    if (!files) return;
    const id = await ensureDeck();
    for (const f of Array.from(files)) {
      if (isImage(f.name)) { store.toast("Ảnh đề thi: dùng mục Nhập câu hỏi → AI đọc ảnh", "info"); continue; }
      try {
        setBusy(`Đang đọc ${f.name}…`);
        const text = await extractText(f, setBusy);
        if (text.trim().length < 20) throw new Error("Không đọc được chữ (file scan?)");
        const doc = await store.addDoc({ deckId: id, name: f.name, kind: f.name.split(".").pop() ?? "txt", text, size: text.length });
        setChosenDocs((s) => new Set([...s, doc.id]));
        setMode("docs");
      } catch (e: any) {
        store.toast(`${f.name}: ${e.message}`, "err");
      }
    }
    setBusy("");
  };

  const sourceText = () => {
    if (mode === "paste") return { text: pasted, name: "Văn bản dán" };
    const ds = docs.filter((d) => chosenDocs.has(d.id));
    return { text: ds.map((d) => `### ${d.name}\n${d.text}`).join("\n\n"), name: ds.map((d) => d.name).join(", ") };
  };

  const run = async () => {
    setError("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      let text: string, name: string;
      if (mode === "topic") {
        if (!topicText.trim()) return;
        setBusy("AI đang soạn dàn ý kiến thức…");
        text = await callAI(store.settings, [{ role: "user", content: `Viết tài liệu ôn tập chi tiết, chính xác (khoảng 1500-2500 từ) về chủ đề sau, gồm khái niệm, phân loại, ví dụ, số liệu/mốc quan trọng, so sánh và lỗi thường gặp:\n${topicText}` }], { signal: ctrl.signal });
        name = "AI: " + topicText.slice(0, 50);
      } else ({ text, name } = sourceText());
      if (text.trim().length < 50) throw new Error("Nội dung quá ngắn. Hãy chọn tài liệu hoặc dán thêm văn bản.");
      const id = await ensureDeck();
      const existing = store.questions.filter((q) => q.deckId === id).map((q) => q.question);
      setBusy("AI đang tạo câu hỏi…");
      setProgress([0, 1]);
      let offset = drafts.length;
      const out = await generateQuestions(store.settings, text, opts, name, (d, t, got) => {
        setProgress([d, t]);
        setDrafts((prev) => [...prev, ...got]);
        // newly appended items are selected by default
        const from = offset;
        offset += got.length;
        setPicked((p) => new Set([...p, ...got.map((_, i) => from + i)]));
      }, ctrl.signal, existing);
      store.toast(`AI đã tạo ${out.length} câu — xem lại rồi lưu`);
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy("");
      abort.current = null;
    }
  };

  const save = async () => {
    const chosen = drafts.filter((_, i) => picked.has(i));
    const missing = chosen.filter((q) => !q.answers.length).length;
    if (missing && !confirm(`${missing} câu chưa có đáp án (sẽ tạm đặt là A). Nên bấm ✎ để chọn đáp án trước. Vẫn lưu?`)) return;
    const id = await ensureDeck();
    const n = await store.addQuestions(id, chosen);
    if (n) store.patchGame((g) => ({ ...g, aiGenerated: g.aiGenerated + n }));
    store.toast(`Đã lưu ${n} câu vào bộ đề${chosen.length - n ? ` (bỏ ${chosen.length - n} câu trùng)` : ""}`);
    setDrafts([]);
    setPicked(new Set());
    go("deck/" + id);
  };

  const canRun = ready && !busy && (mode === "topic" ? topicText.trim() : mode === "paste" ? pasted.trim().length > 50 : chosenDocs.size > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>✨ Tạo đề bằng AI</h1>
          <p className="muted">Tải giáo trình lên → chọn số câu, độ khó, dạng câu → AI soạn trắc nghiệm có đáp án và giải thích → bạn duyệt rồi lưu.</p>
        </div>
      </div>
      {!ready && (
        <div className="callout warn">
          Cần API key để dùng AI tại đây. <a href="#/settings">Mở Cài đặt → AI</a> để nhập key — hoặc <a href="#/import/__/external">🌐 dùng ChatGPT/Gemini/Claude bản web miễn phí</a> (không cần key).
        </div>
      )}

      <div className="studio">
        <div className="card stack">
          <h3>1. Lưu vào bộ đề</h3>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {store.decks.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
            <option value="__new">＋ Tạo bộ đề mới</option>
          </select>
          {target === "__new" && <input placeholder="Tên bộ đề mới (VD: Marketing căn bản)" value={newName} onChange={(e) => setNewName(e.target.value)} />}

          <h3>2. Nguồn nội dung</h3>
          <div className="seg">
            <button className={mode === "docs" ? "on" : ""} onClick={() => setMode("docs")}>📄 Giáo trình</button>
            <button className={mode === "paste" ? "on" : ""} onClick={() => setMode("paste")}>📋 Dán văn bản</button>
            <button className={mode === "topic" ? "on" : ""} onClick={() => setMode("topic")}>💡 Chỉ nhập chủ đề</button>
          </div>
          {mode === "docs" && (
            <>
              <div className="dropzone sm" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
                <span>Kéo thả PDF / Word / PowerPoint / TXT…</span>
                <label className="btn sm file-btn">
                  Chọn file
                  <input type="file" multiple hidden accept={DOC_ACCEPT} onChange={(e) => upload(e.target.files)} />
                </label>
              </div>
              {docs.map((d) => (
                <label key={d.id} className="check">
                  <input type="checkbox" checked={chosenDocs.has(d.id)} onChange={() => setChosenDocs((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
                  <span className="grow">{d.name}</span>
                  <span className="muted small">{Math.round(d.text.length / 1000)}k ký tự</span>
                </label>
              ))}
              {!docs.length && <p className="muted small">Bộ đề này chưa có tài liệu — tải file lên ở trên.</p>}
            </>
          )}
          {mode === "paste" && <textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Dán nội dung bài học, ghi chép, chương sách…" />}
          {mode === "topic" && (
            <>
              <textarea rows={4} value={topicText} onChange={(e) => setTopicText(e.target.value)} placeholder="VD: Chiến tranh thế giới thứ 2 — nguyên nhân, diễn biến chính, hệ quả; hoặc: Python cơ bản: list, dict, vòng lặp" />
              <p className="muted small">AI sẽ tự soạn tài liệu tóm tắt rồi tạo câu hỏi. Nên kiểm tra lại độ chính xác.</p>
            </>
          )}

          <h3>3. Tuỳ chọn</h3>
          <div className="grid2">
            <div>
              <label>Số câu</label>
              <input type="number" min={1} max={300} value={opts.count} onChange={(e) => set({ count: Math.max(1, Math.min(300, +e.target.value || 1)) })} />
            </div>
            <div>
              <label>Số phương án</label>
              <select value={opts.optionCount} onChange={(e) => set({ optionCount: +e.target.value })}>
                {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label>Ngôn ngữ</label>
              <select value={opts.language} onChange={(e) => set({ language: e.target.value as GenOptions["language"] })}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
                <option value="source">Giống tài liệu</option>
                <option value="bilingual">Song ngữ Anh–Việt</option>
              </select>
            </div>
            <div>
              <label>Độ khó</label>
              <select value={opts.difficulty} onChange={(e) => set({ difficulty: e.target.value as GenOptions["difficulty"] })}>
                <option value="mixed">Trộn</option>
                <option value="easy">Dễ</option>
                <option value="medium">Trung bình</option>
                <option value="hard">Khó</option>
              </select>
            </div>
          </div>
          <label>Dạng câu hỏi</label>
          <div className="chips">
            {QUESTION_TYPES.map((t) => (
              <button key={t.id} className={"chip" + (opts.types.includes(t.id) ? " on" : "")} onClick={() => set({ types: opts.types.includes(t.id) ? opts.types.filter((x) => x !== t.id) : [...opts.types, t.id] })}>
                {t.label}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={opts.withExplanation} onChange={(e) => set({ withExplanation: e.target.checked })} />
            Kèm giải thích chi tiết
          </label>
          <label>Yêu cầu thêm (tuỳ chọn)</label>
          <textarea rows={2} value={opts.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="VD: Tập trung chương 3; bắt chước form đề thi FE; hỏi nhiều về thuật ngữ tiếng Anh…" />

          {busy ? (
            <div className="gen-status">
              <Spinner /> {busy} {progress[1] > 1 && `(phần ${progress[0]}/${progress[1]})`}
              <button className="btn sm" onClick={() => abort.current?.abort()}>Dừng</button>
            </div>
          ) : (
            <button className="btn primary big" disabled={!canRun} onClick={run}>✨ Tạo {opts.count} câu hỏi</button>
          )}
          {error && <div className="callout bad">{error}</div>}
        </div>

        <div className="card stack">
          <div className="row between">
            <h3>Kết quả {drafts.length > 0 && `(${picked.size}/${drafts.length} được chọn)`}</h3>
            {drafts.length > 0 && (
              <div className="row gap">
                <button className="btn sm ghost" onClick={() => setPicked(new Set(drafts.map((_, i) => i)))}>Chọn hết</button>
                <button className="btn sm ghost" onClick={() => { setDrafts([]); setPicked(new Set()); }}>Xoá kết quả</button>
                <button className="btn sm primary" disabled={!picked.size} onClick={save}>💾 Lưu {picked.size} câu</button>
              </div>
            )}
          </div>
          {drafts.length === 0 ? (
            <div className="empty small">
              <div className="empty-icon">🪄</div>
              <p className="muted">Câu hỏi AI tạo sẽ hiện ở đây để bạn xem, sửa, bỏ chọn trước khi lưu.</p>
            </div>
          ) : (
            <DraftReview drafts={drafts} setDrafts={setDrafts} picked={picked} setPicked={setPicked} />
          )}
        </div>
      </div>
    </div>
  );
}
