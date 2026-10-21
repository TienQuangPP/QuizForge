import { useEffect, useMemo, useRef, useState } from "react";
import { normalize, useStore } from "../store";
import type { TheoryNote } from "../types";
import { aiReady, generateQuestions } from "../ai";
import { contextFor, generateTheory, questionsForNote, theorySource, writeTopicNote, type TheoryOptions } from "../theory";
import { confirmBox, Empty, go, Markdown, mdToHtml, Modal, Progress, Spinner } from "../ui";
import { canSpeak, speak, stopSpeaking } from "../fx";
import { makeItems, startRun } from "./Practice";

const OPTS_KEY = "quizforge-theory-opts";
const DEFAULT_OPTS: TheoryOptions = { language: "vi", depth: "detailed", instructions: "" };

const plain = (md: string) => md.replace(/[#*`>|]/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ");

export function practiceNote(note: TheoryNote, questions: ReturnType<typeof useStore>["questions"]) {
  const qs = questionsForNote(note, questions);
  if (!qs.length) return false;
  startRun({ mode: "practice", deckIds: [note.deckId], items: makeItems(qs, true), timeLimitSec: 0, title: "📖 " + note.title });
  return true;
}

export function printHandbook(title: string, notes: TheoryNote[]) {
  const w = window.open("", "_blank");
  if (!w) return alert("Trình duyệt chặn cửa sổ in. Hãy cho phép pop-up.");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font-family:"Segoe UI",Arial,sans-serif;max-width:820px;margin:24px auto;color:#111;font-size:14px;line-height:1.55;padding:0 16px}
  h1{font-size:22px}h2{font-size:18px;border-bottom:2px solid #6366f1;padding-bottom:4px;margin-top:28px;break-after:avoid}
  h5,h6{font-size:15px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}
  th{background:#eef}blockquote{border-left:3px solid #6366f1;margin:6px 0;padding:2px 10px;color:#333}.toc li{margin:2px 0}.sum{color:#555;font-style:italic}
  </style></head><body><h1>📖 ${esc(title)}</h1><ol class="toc">${notes.map((n) => `<li>${esc(n.title)}</li>`).join("")}</ol>
  ${notes.map((n, i) => `<h2>${i + 1}. ${esc(n.title)}</h2>${n.summary ? `<p class="sum">${esc(n.summary)}</p>` : ""}${mdToHtml(n.content)}`).join("")}
  <script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

function TheoryOptionsForm({ opts, set }: { opts: TheoryOptions; set: (o: TheoryOptions) => void }) {
  return (
    <>
      <div className="grid2">
        <div>
          <label>Ngôn ngữ</label>
          <select value={opts.language} onChange={(e) => set({ ...opts, language: e.target.value as TheoryOptions["language"] })}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
            <option value="source">Giống tài liệu</option>
            <option value="bilingual">Song ngữ Anh–Việt</option>
          </select>
        </div>
        <div>
          <label>Mức độ</label>
          <select value={opts.depth} onChange={(e) => set({ ...opts, depth: e.target.value as TheoryOptions["depth"] })}>
            <option value="detailed">Chi tiết, dễ hiểu</option>
            <option value="brief">Ngắn gọn để ôn nhanh</option>
          </select>
        </div>
      </div>
      <label>Yêu cầu thêm (tuỳ chọn)</label>
      <input value={opts.instructions} onChange={(e) => set({ ...opts, instructions: e.target.value })} placeholder="VD: giải thích như cho học sinh lớp 10; nhấn mạnh thuật ngữ tiếng Anh" />
    </>
  );
}

export default function TheoryTab({ deckId, noteId }: { deckId: string; noteId?: string }) {
  const store = useStore();
  const ai = aiReady(store.settings);
  const notes = useMemo(() => store.notes.filter((n) => n.deckId === deckId), [store.notes, deckId]);
  const deck = store.decks.find((d) => d.id === deckId)!;
  const [sel, setSel] = useState<string | undefined>(noteId);
  const [search, setSearch] = useState("");
  const [opts, setOptsState] = useState<TheoryOptions>(() => ({ ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") }));
  const setOpts = (o: TheoryOptions) => { setOptsState(o); localStorage.setItem(OPTS_KEY, JSON.stringify(o)); };
  const [genOpen, setGenOpen] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editing, setEditing] = useState<{ title: string; summary: string; content: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [err, setErr] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { if (noteId) setSel(noteId); }, [noteId]);
  useEffect(() => () => void stopSpeaking(), []);

  const filtered = useMemo(() => {
    const q = normalize(search);
    return q ? notes.filter((n) => normalize(n.title + " " + (n.summary ?? "") + " " + n.content).includes(q)) : notes;
  }, [notes, search]);
  const current = notes.find((n) => n.id === sel) ?? filtered[0];
  const idx = current ? notes.indexOf(current) : -1;
  const readCount = notes.filter((n) => n.readAt).length;
  const src = useMemo(() => theorySource(deckId, store.docs, store.questions), [deckId, store.docs, store.questions]);
  const knownTopics = useMemo(() => [...new Set(store.questions.filter((q) => q.deckId === deckId).map((q) => q.topic).filter(Boolean))] as string[], [store.questions, deckId]);
  const related = current ? questionsForNote(current, store.questions) : [];

  const runGenerate = async () => {
    setErr("");
    if (src.text.trim().length < 50) return setErr("Bộ đề chưa có tài liệu hay câu hỏi nào để soạn lý thuyết. Hãy thêm tài liệu ở tab Tài liệu.");
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy("AI đang đọc giáo trình và soạn sổ tay…");
    setProgress([0, 1]);
    try {
      if (replaceAll && notes.length) await store.deleteNotes(notes.map((n) => n.id));
      let first: string | undefined;
      const all = await generateTheory(store.settings, src.text, opts, knownTopics, async (d, t, got) => {
        setProgress([d, t]);
        const saved = await store.addNotes(deckId, got.map((g) => ({ ...g, source: "ai" as const })));
        first ??= saved[0]?.id;
        if (first) setSel(first);
      }, ctrl.signal);
      setGenOpen(false);
      store.toast(`Đã soạn ${all.length} chủ đề lý thuyết`);
      store.unlock("theory_first");
      store.addXp(30);
    } catch (e: any) {
      if (e.name !== "AbortError") setErr(e.message);
    }
    setBusy("");
  };

  const addTopic = async (withAI: boolean) => {
    const title = newTitle.trim();
    if (!title) return;
    setErr("");
    if (!withAI) {
      const [n] = await store.addNotes(deckId, [{ title, content: "### 🎯 Ý chính\n- \n\n### 📘 Giải thích\n", source: "manual" }]);
      setAddOpen(false);
      setNewTitle("");
      setSel(n.id);
      setEditing({ title: n.title, summary: "", content: n.content });
      return;
    }
    setBusy("AI đang viết chủ đề…");
    try {
      const d = await writeTopicNote(store.settings, title, contextFor(title, deckId, store.docs, store.questions), opts);
      const [n] = await store.addNotes(deckId, [{ ...d, source: "ai" }]);
      setAddOpen(false);
      setNewTitle("");
      setSel(n.id);
      store.toast("Đã thêm chủ đề");
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const rewrite = async (depth: TheoryOptions["depth"]) => {
    if (!current) return;
    setBusy(depth === "detailed" ? "AI đang giảng lại chi tiết hơn…" : "AI đang rút gọn…");
    setErr("");
    try {
      const d = await writeTopicNote(store.settings, current.title, contextFor(current.title, deckId, store.docs, store.questions), { ...opts, depth }, current.content);
      const before = current;
      await store.saveNotes([{ ...current, summary: d.summary ?? current.summary, content: d.content, updatedAt: Date.now() }]);
      store.toast("Đã viết lại", "info", { label: "↶ Bản cũ", run: () => store.saveNotes([before]) });
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const quizFromNote = async () => {
    if (!current) return;
    setBusy("AI đang ra câu hỏi từ chủ đề này…");
    setErr("");
    try {
      const qs = await generateQuestions(store.settings, `# ${current.title}\n${current.content}`, { count: 5, language: opts.language, difficulty: "mixed", optionCount: 4, types: ["definition", "understanding", "application", "compare"], instructions: "", withExplanation: true }, current.title, () => {}, undefined, related.map((q) => q.question));
      const n = await store.addQuestions(deckId, qs.map((q) => ({ ...q, topic: current.title })));
      if (n) store.patchGame((g) => ({ ...g, aiGenerated: g.aiGenerated + n }));
      store.toast(`Đã thêm ${n} câu hỏi cho chủ đề “${current.title}”`);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const toggleRead = async () => {
    if (!current) return;
    const readAt = current.readAt ? undefined : Date.now();
    await store.saveNotes([{ ...current, readAt }]);
    if (readAt) {
      store.addXp(5);
      if (notes.filter((n) => n.readAt || n.id === current.id).length >= 5) store.unlock("theory_reader");
      const next = notes[idx + 1];
      if (next) setSel(next.id);
    }
  };

  const move = async (dir: -1 | 1) => {
    const other = notes[idx + dir];
    if (!current || !other) return;
    const list = [...notes];
    [list[idx], list[idx + dir]] = [list[idx + dir], list[idx]];
    await store.saveNotes(list.map((n, i) => ({ ...n, order: i })));
  };

  const listen = () => {
    if (!current) return;
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    speak(`${current.title}. ${current.summary ?? ""}. ${plain(current.content)}`);
    setSpeaking(true);
    const t = setInterval(() => { if (!speechSynthesis.speaking) { setSpeaking(false); clearInterval(t); } }, 500);
  };

  const genModal = genOpen && (
    <Modal title="✨ AI soạn sổ tay lý thuyết" onClose={() => { abort.current?.abort(); setGenOpen(false); }} footer={
      busy ? (
        <div className="gen-status grow"><Spinner /> {busy} {progress[1] > 1 && `(phần ${progress[0]}/${progress[1]})`}<button className="btn sm" onClick={() => abort.current?.abort()}>Dừng</button></div>
      ) : (
        <button className="btn primary" disabled={!ai} onClick={runGenerate}>✨ Bắt đầu soạn</button>
      )
    }>
      {!ai && <div className="callout warn">Cần <a href="#/settings">kết nối AI</a> trước.</div>}
      <p className="muted small">
        {src.fromQuestions
          ? `Bộ đề chưa có tài liệu — AI sẽ tổng hợp lý thuyết từ ${store.questions.filter((q) => q.deckId === deckId).length} câu hỏi và lời giải. Thêm tài liệu ở tab Tài liệu để có lý thuyết đầy đủ hơn.`
          : `AI sẽ đọc ${store.docs.filter((d) => d.deckId === deckId).length} tài liệu (~${Math.round(src.text.length / 1000)}k ký tự), chia thành các chủ đề, mỗi chủ đề có ý chính, giải thích, ví dụ, so sánh, lỗi hay nhầm và mẹo nhớ.`}
      </p>
      <TheoryOptionsForm opts={opts} set={setOpts} />
      {notes.length > 0 && (
        <div className="seg">
          <button className={!replaceAll ? "on" : ""} onClick={() => setReplaceAll(false)}>Thêm vào sổ tay hiện có</button>
          <button className={replaceAll ? "on" : ""} onClick={() => setReplaceAll(true)}>Soạn lại từ đầu</button>
        </div>
      )}
      {err && <div className="callout bad">{err}</div>}
    </Modal>
  );

  const addModal = addOpen && (
    <Modal title="Thêm chủ đề lý thuyết" onClose={() => setAddOpen(false)} footer={
      busy ? <div className="gen-status grow"><Spinner /> {busy}</div> : (
        <>
          <button className="btn" disabled={!newTitle.trim()} onClick={() => addTopic(false)}>✎ Tự viết</button>
          <button className="btn primary" disabled={!newTitle.trim() || !ai} onClick={() => addTopic(true)}>✨ Nhờ AI viết</button>
        </>
      )
    }>
      <label>Tên chủ đề</label>
      <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="VD: Luật cung – cầu, Thì hiện tại hoàn thành…" />
      {!ai && <p className="muted small">Kết nối AI trong Cài đặt để AI viết giúp; hoặc bấm Tự viết.</p>}
      {err && <div className="callout bad">{err}</div>}
    </Modal>
);

  if (!notes.length) {
    return (
      <>
        <Empty icon="📖" title="Chưa có sổ tay lý thuyết">
          <p className="muted">Học lý thuyết trước khi làm bài giúp hiểu sâu và nhớ lâu hơn. AI có thể đọc giáo trình và soạn sẵn cho bạn theo từng chủ đề.</p>
          <div className="row gap center wrap">
            <button className="btn primary" onClick={() => setGenOpen(true)}>✨ AI soạn sổ tay lý thuyết</button>
            <button className="btn" onClick={() => go(`import/${deckId}/external-theory`)}>🌐 Dùng ChatGPT/Gemini web (không cần key)</button>
            <button className="btn ghost" onClick={() => setAddOpen(true)}>✎ Tự viết một chủ đề</button>
          </div>
        </Empty>
        {genModal}
        {addModal}
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="🔍 Tìm trong lý thuyết…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" onClick={() => setAddOpen(true)}>＋ Chủ đề</button>
        <button className="btn" onClick={() => setGenOpen(true)}>✨ AI soạn thêm</button>
        <button className="btn" onClick={() => go(`import/${deckId}/external-theory`)} title="Nhờ ChatGPT/Gemini/Claude bản web soạn rồi dán về">🌐 AI bên ngoài</button>
        <button className="btn ghost" onClick={() => printHandbook(deck.name, notes)}>🖨 In sổ tay</button>
      </div>
      <div className="theory-progress">
        <span>📖 Đã học <b>{readCount}/{notes.length}</b> chủ đề</span>
        <Progress value={readCount / notes.length} color="var(--good)" />
      </div>

      <div className="theory">
        <nav className="toc">
          <select className="toc-select" value={current?.id} onChange={(e) => setSel(e.target.value)}>
            {filtered.map((n) => <option key={n.id} value={n.id}>{n.readAt ? "✓ " : ""}{notes.indexOf(n) + 1}. {n.title}</option>)}
          </select>
          {filtered.map((n) => (
            <button key={n.id} className={"toc-item" + (n.id === current?.id ? " on" : "") + (n.readAt ? " read" : "")} onClick={() => { setSel(n.id); stopSpeaking(); setSpeaking(false); }}>
              <span className="toc-num">{n.readAt ? "✓" : notes.indexOf(n) + 1}</span>
              <span className="grow">
                <b>{n.title}</b>
                {n.summary && <small>{n.summary}</small>}
              </span>
            </button>
          ))}
          {!filtered.length && <p className="muted small">Không có chủ đề khớp “{search}”.</p>}
        </nav>

        {current && (
          <article className="note card">
            <div className="note-head">
              <div className="grow">
                <div className="muted small">Chủ đề {idx + 1}/{notes.length}{current.source === "ai" ? " · ✨ AI soạn" : " · ✎ Tự viết"}</div>
                <h2>{current.title}</h2>
                {current.summary && <p className="note-summary">{current.summary}</p>}
              </div>
            </div>
            <div className="note-tools">
              {canSpeak() && <button className="btn sm" onClick={listen}>{speaking ? "⏹ Dừng đọc" : "🔊 Nghe đọc"}</button>}
              <button className="btn sm" onClick={() => setEditing({ title: current.title, summary: current.summary ?? "", content: current.content })}>✎ Sửa nội dung</button>
              {ai && <button className="btn sm" disabled={!!busy} onClick={() => rewrite("detailed")}>✨ Giảng kỹ hơn</button>}
              {ai && <button className="btn sm" disabled={!!busy} onClick={() => rewrite("brief")}>✂️ Rút gọn</button>}
              <button className="icon-btn" title="Lên trên" disabled={idx === 0} onClick={() => move(-1)}>↑</button>
              <button className="icon-btn" title="Xuống dưới" disabled={idx === notes.length - 1} onClick={() => move(1)}>↓</button>
              <button className="icon-btn" title="Xoá chủ đề" onClick={() => store.deleteNotes([current.id])}>🗑</button>
            </div>
            {busy && !genOpen && !addOpen && <div className="gen-status"><Spinner /> {busy}</div>}
            {err && !genOpen && !addOpen && <div className="callout bad">{err}</div>}

            <Markdown text={current.content} className="note-body" />

            <div className="note-foot">
              <button className={"btn" + (current.readAt ? " good" : " primary")} onClick={toggleRead}>
                {current.readAt ? "✓ Đã học xong (bấm để bỏ)" : "✓ Tôi đã hiểu phần này"}
              </button>
              <button className="btn" disabled={!related.length} onClick={() => practiceNote(current, store.questions)} title={related.length ? "" : "Chưa có câu hỏi nào liên quan"}>
                🎯 Luyện {related.length ? `${related.length} câu` : ""} về chủ đề này
              </button>
              {ai && <button className="btn" disabled={!!busy} onClick={quizFromNote}>✨ Ra thêm 5 câu hỏi</button>}
            </div>
            <div className="note-nav">
              <button className="btn ghost" disabled={idx <= 0} onClick={() => setSel(notes[idx - 1]?.id)}>← {notes[idx - 1]?.title ?? ""}</button>
              <button className="btn ghost" disabled={idx >= notes.length - 1} onClick={() => setSel(notes[idx + 1]?.id)}>{notes[idx + 1]?.title ?? ""} →</button>
            </div>
          </article>
        )}
      </div>

      {genModal}
      {addModal}
      {editing && current && (
        <Modal wide title="Sửa chủ đề lý thuyết" onClose={() => setEditing(null)} footer={
          <button className="btn primary" onClick={async () => {
            await store.saveNotes([{ ...current, title: editing.title.trim() || current.title, summary: editing.summary.trim() || undefined, content: editing.content, source: current.source, updatedAt: Date.now() }]);
            setEditing(null);
            store.toast("Đã lưu");
          }}>Lưu</button>
        }>
          <label>Tên chủ đề</label>
          <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <label>Tóm tắt một câu</label>
          <input value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
          <label>Nội dung <span className="muted">(viết thường cũng được; ### tiêu đề, - gạch đầu dòng, **in đậm**, | bảng |)</span></label>
          <textarea rows={16} className="mono" value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          <details>
            <summary className="small">Xem trước</summary>
            <Markdown text={editing.content} />
          </details>
          <button className="btn sm danger ghost" onClick={() => { if (confirmBox("Xoá chủ đề này?")) { store.deleteNotes([current.id]); setEditing(null); } }}>🗑 Xoá chủ đề</button>
        </Modal>
      )}
    </>
  );
}

/** Pop-up used inside quizzes: shows the related theory without leaving the quiz. */
export function NoteModal({ note, onClose }: { note: TheoryNote; onClose: () => void }) {
  useEffect(() => () => void stopSpeaking(), []);
  return (
    <Modal wide title={"📖 " + note.title} onClose={onClose} footer={
      <>
        {canSpeak() && <button className="btn ghost" onClick={() => speak(`${note.title}. ${plain(note.content)}`)}>🔊 Nghe đọc</button>}
        <button className="btn ghost" onClick={() => { onClose(); go(`deck/${note.deckId}/theory/${note.id}`); }}>Mở trong sổ tay →</button>
        <button className="btn primary" onClick={onClose}>Đã hiểu, quay lại bài</button>
      </>
    }>
      {note.summary && <p className="note-summary">{note.summary}</p>}
      <Markdown text={note.content} className="note-body" />
    </Modal>
  );
}
