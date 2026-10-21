import { useMemo, useState } from "react";
import { deckStats, normalize, useStore } from "../store";
import type { DraftQuestion, Question, SourceDoc } from "../types";
import { blankQuestion, confirmBox, DiffBadge, Empty, go, Modal, Progress, QuestionForm, Spinner, Stat, timeAgo } from "../ui";
import { DOC_ACCEPT, download, extractText, isImage, letter, questionsToCSV, questionsToText } from "../parsers";
import { DeckForm } from "./Library";
import { formatInterval } from "../srs";

type Filter = "all" | "wrong" | "flagged" | "unseen" | "mastered" | "due";

export function printQuestions(title: string, qs: Question[] | DraftQuestion[], withAnswers: boolean) {
  const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  const body = qs
    .map(
      (q, i) => `<div class="q"><p><b>Câu ${i + 1}.</b> ${esc(q.question)}</p>${q.image ? `<img src="${q.image}">` : ""}<ol type="A">${q.options
        .map((o, j) => `<li${withAnswers && q.answers.includes(j) ? ' class="ok"' : ""}>${esc(o)}</li>`)
        .join("")}</ol>${withAnswers && q.explanation ? `<p class="ex">💡 ${esc(q.explanation)}</p>` : ""}</div>`,
    )
    .join("");
  const key = withAnswers ? "" : `<div class="key"><h3>Đáp án</h3>${qs.map((q, i) => `${i + 1}.${q.answers.map(letter).join("")}`).join(" &nbsp; ")}</div>`;
  const w = window.open("", "_blank");
  if (!w) return alert("Trình duyệt chặn cửa sổ in. Hãy cho phép pop-up.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font-family:"Segoe UI",Arial,sans-serif;max-width:800px;margin:24px auto;color:#111;font-size:14px;line-height:1.45}
  h1{font-size:20px;margin-bottom:4px}.meta{color:#555;margin-bottom:18px}.q{break-inside:avoid;margin-bottom:14px}
  ol{margin:4px 0 0 0}li.ok{font-weight:700;text-decoration:underline}.ex{color:#444;font-size:13px;margin:4px 0 0 18px}
  img{max-width:100%;max-height:260px}.key{break-before:page;font-size:13px;line-height:2}
  </style></head><body><h1>${esc(title)}</h1><div class="meta">${qs.length} câu · Họ tên: ........................................ Điểm: ........</div>${body}${key}
  <script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

function QuestionRow({ q, index, selected, onSelect, onEdit }: { q: Question; index: number; selected: boolean; onSelect: () => void; onEdit: () => void }) {
  const store = useStore();
  const p = store.progress[q.id];
  const [open, setOpen] = useState(false);
  return (
    <div className={"qrow" + (selected ? " sel" : "")}>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Chọn câu" />
      <div className="qrow-main" onClick={() => setOpen(!open)}>
        <div className="qrow-title">
          <span className="muted">#{index + 1}</span> {q.question}
        </div>
        <div className="row gap small">
          {q.topic && <span className="pill">{q.topic}</span>}
          <DiffBadge d={q.difficulty} />
          {q.answers.length > 1 && <span className="pill">Nhiều đáp án</span>}
          {q.image && <span className="pill">🖼️ ảnh</span>}
          {p?.attempts ? (
            <span className={"pill " + (p.lastCorrect ? "good" : "bad")}>
              {p.correct}/{p.attempts} đúng · ôn sau {formatInterval(p.interval)}
            </span>
          ) : (
            <span className="pill muted">Chưa học</span>
          )}
        </div>
        {open && (
          <div className="qrow-detail">
            {q.image && <img className="qimg-small" src={q.image} alt="" />}
            <ol type="A" className="opts">
              {q.options.map((o, i) => (
                <li key={i} className={q.answers.includes(i) ? "correct" : ""}>{o}</li>
              ))}
            </ol>
            {q.explanation && <div className="explain-mini">💡 {q.explanation}</div>}
            {q.source && <div className="muted small">Nguồn: {q.source}</div>}
          </div>
        )}
      </div>
      <div className="qrow-actions">
        <button className={"icon-btn" + (p?.flagged ? " flag-on" : "")} title="Đánh dấu" onClick={() => store.toggleFlag(q.id)}>⚑</button>
        <button className="icon-btn" title="Sửa" onClick={onEdit}>✎</button>
      </div>
    </div>
  );
}

function QuestionsTab({ deckId }: { deckId: string }) {
  const store = useStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [topic, setTopic] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const [draft, setDraft] = useState<DraftQuestion>(blankQuestion());
  const [moveOpen, setMoveOpen] = useState(false);
  const [limit, setLimit] = useState(100);

  const all = useMemo(() => store.questions.filter((q) => q.deckId === deckId), [store.questions, deckId]);
  const topics = useMemo(() => [...new Set(all.map((q) => q.topic).filter(Boolean))] as string[], [all]);
  const list = useMemo(() => {
    const nq = normalize(search);
    const now = Date.now();
    return all.filter((q) => {
      const p = store.progress[q.id];
      if (topic && q.topic !== topic) return false;
      if (filter === "wrong" && !(p?.attempts && !p.lastCorrect)) return false;
      if (filter === "flagged" && !p?.flagged) return false;
      if (filter === "unseen" && p?.attempts) return false;
      if (filter === "mastered" && !(p && p.interval >= 7 && p.lastCorrect)) return false;
      if (filter === "due" && !(p?.attempts && p.due <= now)) return false;
      return !nq || normalize(q.question + " " + q.options.join(" ") + " " + (q.explanation ?? "")).includes(nq);
    });
  }, [all, search, filter, topic, store.progress]);

  const openEdit = (q: Question | "new") => {
    setEditing(q);
    setDraft(q === "new" ? { ...blankQuestion(), topic: topic || undefined } : { ...q });
  };
  const saveEdit = async (another = false) => {
    if (!draft.question.trim() || draft.options.filter((o) => o.trim()).length < 2) return store.toast("Cần nội dung câu hỏi và ít nhất 2 phương án", "err");
    const clean = { ...draft, options: draft.options.map((o) => o.trim()) };
    if (editing === "new") {
      const n = await store.addQuestions(deckId, [clean]);
      store.toast(n ? "Đã thêm câu hỏi" : "Câu hỏi bị trùng", n ? "ok" : "err");
    } else if (editing) {
      await store.updateQuestion({ ...editing, ...clean });
      store.toast("Đã lưu");
    }
    if (another) setDraft({ ...blankQuestion(), topic: draft.topic });
    else setEditing(null);
  };
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const selected = [...sel];

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="🔍 Tìm trong câu hỏi, đáp án, giải thích…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Tất cả ({all.length})</option>
          <option value="unseen">Chưa học</option>
          <option value="wrong">Đang sai</option>
          <option value="due">Đến hạn ôn</option>
          <option value="flagged">Đã đánh dấu</option>
          <option value="mastered">Đã thuộc</option>
        </select>
        {topics.length > 0 && (
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Mọi chủ đề</option>
            {topics.map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
        <button className="btn" onClick={() => openEdit("new")}>＋ Thêm câu</button>
      </div>
      {selected.length > 0 && (
        <div className="bulkbar">
          <b>Đã chọn {selected.length}</b>
          <button className="btn sm" onClick={() => setSel(new Set(list.map((q) => q.id)))}>Chọn tất cả {list.length}</button>
          <button className="btn sm" onClick={() => go(`practice/${deckId}/sel:${selected.join(",")}`)}>🎯 Luyện các câu này</button>
          <button className="btn sm" onClick={() => setMoveOpen(true)}>↪ Chuyển / sao chép</button>
          <button className="btn sm" onClick={async () => { await store.resetProgress(selected); store.toast("Đã đặt lại tiến độ"); }}>↺ Đặt lại tiến độ</button>
          <button className="btn sm danger" onClick={async () => {
            if (!confirmBox(`Xoá ${selected.length} câu hỏi?`)) return;
            await store.deleteQuestions(selected);
            setSel(new Set());
          }}>🗑 Xoá</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Bỏ chọn</button>
        </div>
      )}
      {all.length === 0 ? (
        <Empty icon="📝" title="Chưa có câu hỏi">
          <p className="muted">Tạo bằng AI từ giáo trình, nhập file câu hỏi có sẵn, hoặc tự soạn.</p>
          <div className="row gap center">
            <button className="btn primary" onClick={() => go("studio/" + deckId)}>✨ Tạo bằng AI</button>
            <button className="btn" onClick={() => go("import/" + deckId)}>📥 Nhập file</button>
            <button className="btn ghost" onClick={() => openEdit("new")}>✎ Tự soạn</button>
          </div>
        </Empty>
      ) : (
        <div className="stack">
          {list.slice(0, limit).map((q) => (
            <QuestionRow key={q.id} q={q} index={all.indexOf(q)} selected={sel.has(q.id)} onSelect={() => toggle(q.id)} onEdit={() => openEdit(q)} />
          ))}
          {list.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + 200)}>Hiện thêm ({list.length - limit} câu)</button>}
          {list.length === 0 && <p className="muted center">Không có câu nào khớp bộ lọc.</p>}
        </div>
      )}
      {editing && (
        <Modal
          wide
          title={editing === "new" ? "Thêm câu hỏi" : "Sửa câu hỏi"}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing !== "new" && (
                <button className="btn danger ghost" onClick={async () => {
                  await store.deleteQuestions([editing.id]);
                  setEditing(null);
                }}>Xoá</button>
              )}
              <span className="spacer" />
              {editing === "new" && <button className="btn" onClick={() => saveEdit(true)}>Lưu & thêm câu khác</button>}
              <button className="btn primary" onClick={() => saveEdit()}>Lưu</button>
            </>
          }
        >
          <QuestionForm value={draft} onChange={setDraft} />
        </Modal>
      )}
      {moveOpen && <MoveModal ids={selected} fromDeck={deckId} onClose={() => { setMoveOpen(false); setSel(new Set()); }} />}
    </>
  );
}

function MoveModal({ ids, fromDeck, onClose }: { ids: string[]; fromDeck: string; onClose: () => void }) {
  const store = useStore();
  const others = store.decks.filter((d) => d.id !== fromDeck);
  const [target, setTarget] = useState(others[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const run = async (copy: boolean) => {
    let id = target;
    if (target === "__new") {
      if (!newName.trim()) return;
      id = (await store.createDeck({ name: newName.trim() })).id;
    }
    await store.moveQuestions(ids, id, copy);
    store.toast(copy ? "Đã sao chép" : "Đã chuyển");
    onClose();
  };
  return (
    <Modal title={`Chuyển / sao chép ${ids.length} câu`} onClose={onClose} footer={<><button className="btn" onClick={() => run(true)}>Sao chép</button><button className="btn primary" onClick={() => run(false)}>Chuyển</button></>}>
      <label>Tới bộ đề</label>
      <select value={target} onChange={(e) => setTarget(e.target.value)}>
        {others.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
        <option value="__new">＋ Bộ đề mới…</option>
      </select>
      {target === "__new" && <input placeholder="Tên bộ đề mới" value={newName} onChange={(e) => setNewName(e.target.value)} />}
    </Modal>
  );
}

function DocsTab({ deckId }: { deckId: string }) {
  const store = useStore();
  const docs = store.docs.filter((d) => d.deckId === deckId);
  const [busy, setBusy] = useState("");
  const [view, setView] = useState<SourceDoc | null>(null);
  const [paste, setPaste] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (isImage(f.name)) { store.toast(`${f.name}: ảnh hãy dùng mục “Nhập câu hỏi → AI đọc ảnh”`, "info"); continue; }
      try {
        setBusy(`Đang đọc ${f.name}…`);
        const text = await extractText(f, setBusy);
        if (text.trim().length < 20) throw new Error("Không đọc được chữ (có thể là file scan/ảnh).");
        await store.addDoc({ deckId, name: f.name, kind: f.name.split(".").pop() ?? "txt", text, size: text.length });
        store.toast(`Đã thêm ${f.name} (${text.length.toLocaleString()} ký tự)`);
      } catch (e: any) {
        store.toast(`${f.name}: ${e.message}`, "err");
      }
    }
    setBusy("");
  };

  return (
    <>
      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <div>📄 Kéo thả giáo trình vào đây — PDF, Word, PowerPoint, TXT, Markdown, HTML</div>
        <div className="row gap center">
          <label className="btn primary file-btn">
            Chọn file
            <input type="file" multiple hidden accept={DOC_ACCEPT} onChange={(e) => upload(e.target.files)} />
          </label>
          <button className="btn" onClick={() => setPaste(true)}>Dán văn bản</button>
        </div>
        {busy && <div className="muted"><Spinner /> {busy}</div>}
      </div>
      {docs.length === 0 ? (
        <p className="muted center">Chưa có tài liệu. Tài liệu được dùng để AI tạo câu hỏi, giải thích và làm gia sư.</p>
      ) : (
        <div className="stack">
          {docs.map((d) => (
            <div key={d.id} className="card doc-row">
              <div className="doc-ic">{d.kind === "pdf" ? "📕" : d.kind === "pptx" ? "📊" : d.kind === "docx" ? "📘" : "📄"}</div>
              <div className="grow">
                <b>{d.name}</b>
                <div className="muted small">{d.text.length.toLocaleString()} ký tự · ~{Math.ceil(d.text.split(/\s+/).length / 250)} phút đọc · {timeAgo(d.createdAt)}</div>
              </div>
              <button className="btn sm" onClick={() => setView(d)}>Xem</button>
              <button className="btn sm primary" onClick={() => go(`studio/${deckId}/${d.id}`)}>✨ Tạo câu hỏi</button>
              <button className="btn sm" onClick={() => go(`tutor/${deckId}`)}>🤖 Hỏi AI</button>
              <button className="icon-btn" title="Xoá" onClick={() => store.deleteDoc(d.id)}>🗑</button>
            </div>
          ))}
        </div>
      )}
      {view && (
        <Modal wide title={view.name} onClose={() => setView(null)}>
          <pre className="doc-text">{view.text}</pre>
        </Modal>
      )}
      {paste && (
        <Modal
          wide
          title="Dán nội dung giáo trình"
          onClose={() => setPaste(false)}
          footer={<button className="btn primary" disabled={pasteText.trim().length < 20} onClick={async () => {
            await store.addDoc({ deckId, name: pasteName.trim() || "Văn bản dán " + new Date().toLocaleString("vi-VN"), kind: "txt", text: pasteText, size: pasteText.length });
            setPaste(false); setPasteText(""); setPasteName("");
            store.toast("Đã thêm tài liệu");
          }}>Lưu tài liệu</button>}
        >
          <label>Tên tài liệu</label>
          <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="VD: Chương 3 — Cung cầu" />
          <label>Nội dung</label>
          <textarea rows={16} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Dán nội dung bài giảng, ghi chép, sách…" />
        </Modal>
      )}
    </>
  );
}

function StatsTab({ deckId }: { deckId: string }) {
  const store = useStore();
  const qs = store.questions.filter((q) => q.deckId === deckId);
  const st = deckStats(qs, store.progress);
  const byTopic = useMemo(() => {
    const m: Record<string, { total: number; attempts: number; correct: number }> = {};
    for (const q of qs) {
      const k = q.topic || "(Không chủ đề)";
      m[k] ??= { total: 0, attempts: 0, correct: 0 };
      m[k].total++;
      const p = store.progress[q.id];
      if (p) { m[k].attempts += p.attempts; m[k].correct += p.correct; }
    }
    return Object.entries(m).sort((a, b) => (a[1].attempts ? a[1].correct / a[1].attempts : 2) - (b[1].attempts ? b[1].correct / b[1].attempts : 2));
  }, [qs, store.progress]);
  const hardest = qs.filter((q) => store.progress[q.id]?.wrong).sort((a, b) => store.progress[b.id].wrong - store.progress[a.id].wrong).slice(0, 8);
  return (
    <>
      <div className="stats-row">
        <Stat label="Đã học" value={`${st.seen}/${st.total}`} />
        <Stat label="Đã thuộc" value={st.mastered} tone="good" />
        <Stat label="Đang sai" value={st.wrong} tone="bad" />
        <Stat label="Đến hạn" value={st.due} />
        <Stat label="Chính xác" value={st.seen ? Math.round(st.accuracy * 100) + "%" : "—"} />
      </div>
      <h3>Theo chủ đề (yếu nhất trước)</h3>
      <div className="card stack">
        {byTopic.map(([t, v]) => (
          <div key={t} className="topic-row">
            <span className="grow">{t} <span className="muted small">({v.total} câu)</span></span>
            <span className="topic-bar"><Progress value={v.attempts ? v.correct / v.attempts : 0} color={v.attempts && v.correct / v.attempts < 0.6 ? "var(--bad)" : undefined} /></span>
            <b>{v.attempts ? Math.round((v.correct / v.attempts) * 100) + "%" : "—"}</b>
          </div>
        ))}
      </div>
      {hardest.length > 0 && (
        <>
          <h3>Câu hay sai nhất</h3>
          <div className="card list">
            {hardest.map((q) => (
              <div key={q.id} className="list-row">
                <span className="grow">{q.question.slice(0, 140)}</span>
                <span className="pill bad">sai {store.progress[q.id].wrong} lần</span>
              </div>
            ))}
          </div>
          <button className="btn" onClick={() => go(`practice/${deckId}/wrong`)}>🎯 Luyện lại các câu sai</button>
        </>
      )}
    </>
  );
}

export default function DeckPage({ id, tab = "questions" }: { id?: string; tab?: string }) {
  const store = useStore();
  const deck = store.decks.find((d) => d.id === id);
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const qs = useMemo(() => store.questions.filter((q) => q.deckId === id), [store.questions, id]);
  const st = deckStats(qs, store.progress);
  if (!deck) return <div className="page"><Empty icon="🤷" title="Không tìm thấy bộ đề"><a href="#/library">← Về thư viện</a></Empty></div>;

  const exp = (kind: "json" | "csv" | "txt") => {
    const safe = deck.name.replace(/[\\/:*?"<>|]+/g, "_");
    if (kind === "json") download(`${safe}.quizforge.json`, JSON.stringify({ app: "quizforge", version: 1, decks: [deck], questions: qs, docs: store.docs.filter((d) => d.deckId === deck.id) }, null, 2));
    if (kind === "csv") download(`${safe}.csv`, questionsToCSV(qs), "text/csv");
    if (kind === "txt") download(`${safe}.txt`, questionsToText(qs), "text/plain");
    setExportOpen(false);
  };

  const tabs = [
    { id: "questions", label: `Câu hỏi (${qs.length})` },
    { id: "docs", label: `Tài liệu (${store.docs.filter((d) => d.deckId === id).length})` },
    { id: "stats", label: "Tiến độ" },
  ];

  return (
    <div className="page">
      <a className="back" href="#/library">← Thư viện</a>
      <div className="deck-head" style={{ ["--c" as any]: deck.color }}>
        <div className="deck-emoji big">{deck.emoji}</div>
        <div className="grow">
          <h1>{deck.name}</h1>
          {deck.description && <p className="muted">{deck.description}</p>}
          <div className="row gap small">
            {deck.tags.map((t) => <span key={t} className="pill">{t}</span>)}
            <span className="muted">Đã thuộc {st.mastered}/{st.total}</span>
          </div>
          <Progress value={st.total ? st.mastered / st.total : 0} color={deck.color} />
        </div>
        <div className="row gap wrap">
          <button className="btn ghost" onClick={() => setEditing(true)}>✎ Sửa</button>
          <button className="btn ghost" onClick={() => setExportOpen(true)}>⤓ Xuất / In</button>
          <button className="btn ghost danger" onClick={async () => {
            if (!confirmBox(`Xoá bộ đề “${deck.name}” cùng ${qs.length} câu hỏi và tài liệu?`)) return;
            go("library");
            await store.deleteDeck(deck.id);
          }}>🗑</button>
        </div>
      </div>

      <div className="action-grid">
        <button className="action" disabled={!qs.length} onClick={() => go(`practice/${deck.id}`)}><span>🎯</span>Luyện tập<small>Phản hồi ngay từng câu</small></button>
        <button className="action" disabled={!qs.length} onClick={() => go(`practice/${deck.id}/exam`)}><span>📝</span>Thi thử<small>Bấm giờ, chấm cuối bài</small></button>
        <button className="action" disabled={!qs.length} onClick={() => go(`practice/${deck.id}/flash`)}><span>🃏</span>Thẻ ghi nhớ<small>Lặp lại ngắt quãng</small></button>
        <button className="action" disabled={!st.wrong} onClick={() => go(`practice/${deck.id}/wrong`)}><span>🩹</span>Ôn câu sai<small>{st.wrong} câu</small></button>
        <button className="action" onClick={() => go(`studio/${deck.id}`)}><span>✨</span>Tạo thêm bằng AI<small>Từ giáo trình</small></button>
        <button className="action" onClick={() => go(`import/${deck.id}`)}><span>📥</span>Nhập câu hỏi<small>File, văn bản, ảnh</small></button>
        <button className="action" onClick={() => go(`tutor/${deck.id}`)}><span>🤖</span>Gia sư AI<small>Hỏi về giáo trình</small></button>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <a key={t.id} href={`#/deck/${deck.id}/${t.id}`} className={tab === t.id ? "on" : ""}>{t.label}</a>
        ))}
      </div>
      {tab === "docs" ? <DocsTab deckId={deck.id} /> : tab === "stats" ? <StatsTab deckId={deck.id} /> : <QuestionsTab deckId={deck.id} />}

      {editing && <DeckForm deck={deck} onClose={() => setEditing(false)} />}
      {exportOpen && (
        <Modal title="Xuất & in" onClose={() => setExportOpen(false)}>
          <div className="stack">
            <button className="btn" onClick={() => exp("json")}>⤓ JSON (đầy đủ, nhập lại được vào QuizForge)</button>
            <button className="btn" onClick={() => exp("csv")}>⤓ CSV / Excel</button>
            <button className="btn" onClick={() => exp("txt")}>⤓ Văn bản (Câu 1: … A. … Đáp án: …)</button>
            <button className="btn" onClick={() => printQuestions(deck.name, qs, false)}>🖨 In đề (đáp án ở trang cuối)</button>
            <button className="btn" onClick={() => printQuestions(deck.name + " — có đáp án", qs, true)}>🖨 In kèm đáp án & giải thích</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
