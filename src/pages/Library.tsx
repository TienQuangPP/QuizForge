import { useMemo, useState } from "react";
import { DECK_COLORS, DECK_EMOJIS, deckStats, normalize, useStore } from "../store";
import type { Deck } from "../types";
import { SUBJECTS, type SubjectId } from "../subjects";
import { Empty, go, Modal, Progress, QuestionPreview, timeAgo, useHashRoute } from "../ui";

export function DeckForm({ deck, onClose, onSaved }: { deck?: Deck; onClose: () => void; onSaved?: (d: Deck) => void }) {
  const store = useStore();
  const [name, setName] = useState(deck?.name ?? "");
  const [description, setDescription] = useState(deck?.description ?? "");
  const [emoji, setEmoji] = useState(deck?.emoji ?? DECK_EMOJIS[0]);
  const [color, setColor] = useState(deck?.color ?? DECK_COLORS[0]);
  const [tags, setTags] = useState((deck?.tags ?? []).join(", "));
  const [subject, setSubject] = useState<SubjectId>(deck?.subject ?? "general");
  const save = async () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), description, emoji, color, subject, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
    if (deck) {
      await store.updateDeck({ ...deck, ...data });
      onSaved?.({ ...deck, ...data });
    } else {
      const d = await store.createDeck(data);
      onSaved?.(d);
    }
    store.toast(deck ? "Đã lưu bộ đề" : "Đã tạo bộ đề");
    onClose();
  };
  return (
    <Modal
      title={deck ? "Sửa bộ đề" : "Tạo bộ đề / giáo trình mới"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Huỷ</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{deck ? "Lưu" : "Tạo"}</button>
        </>
      }
    >
      <label>Tên</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="VD: Kinh tế vi mô — Chương 1-5" />
      <label>Mô tả</label>
      <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Môn học, giảng viên, kỳ thi…" />
      <label>Loại môn học <span className="muted">(giúp AI ra đề, bài tập đúng kiểu môn)</span></label>
      <div className="subject-pick">
        {SUBJECTS.map((s) => (
          <button key={s.id} type="button" className={subject === s.id ? "on" : ""} onClick={() => setSubject(s.id)} title={s.examples}>
            <span>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>
      <label>Thẻ (cách nhau bằng dấu phẩy)</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="giữa kỳ, chương 2, tiếng Anh" />
      <label>Biểu tượng</label>
      <div className="chips">
        {DECK_EMOJIS.map((e) => (
          <button key={e} className={"chip emoji" + (e === emoji ? " on" : "")} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <label>Màu</label>
      <div className="chips">
        {DECK_COLORS.map((c) => (
          <button key={c} className={"swatch" + (c === color ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
    </Modal>
  );
}

export default function Library() {
  const store = useStore();
  const [route] = useHashRoute();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "size" | "due">("recent");
  const [tag, setTag] = useState("");
  const creating = route[1] === "new";

  const tags = useMemo(() => [...new Set(store.decks.flatMap((d) => d.tags))], [store.decks]);
  const rows = useMemo(() => {
    const nq = normalize(q);
    let list = store.decks
      .filter((d) => !tag || d.tags.includes(tag))
      .filter((d) => !nq || normalize(d.name + " " + d.description + " " + d.tags.join(" ")).includes(nq))
      .map((d) => ({ d, st: deckStats(store.questions.filter((x) => x.deckId === d.id), store.progress) }));
    if (sort === "name") list = list.sort((a, b) => a.d.name.localeCompare(b.d.name, "vi"));
    if (sort === "size") list = list.sort((a, b) => b.st.total - a.st.total);
    if (sort === "due") list = list.sort((a, b) => b.st.due - a.st.due);
    return list;
  }, [store.decks, store.questions, store.progress, q, sort, tag]);

  const hits = useMemo(() => {
    const nq = normalize(q);
    if (nq.length < 3) return [];
    return store.questions.filter((x) => normalize(x.question + " " + x.options.join(" ")).includes(nq)).slice(0, 30);
  }, [q, store.questions]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>📚 Thư viện</h1>
          <p className="muted">Mỗi bộ đề có thể chứa tài liệu giáo trình và ngân hàng câu hỏi riêng.</p>
        </div>
        <button className="btn primary" onClick={() => go("library/new")}>＋ Bộ đề mới</button>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="🔍 Tìm bộ đề hoặc câu hỏi…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="recent">Mới cập nhật</option>
          <option value="name">Tên A–Z</option>
          <option value="size">Nhiều câu nhất</option>
          <option value="due">Nhiều câu đến hạn</option>
        </select>
        {tags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Mọi thẻ</option>
            {tags.map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
      </div>

      {store.decks.length === 0 ? (
        <Empty icon="📚" title="Thư viện trống">
          <p className="muted">Tạo bộ đề đầu tiên, rồi thêm giáo trình hoặc câu hỏi vào.</p>
          <button className="btn primary" onClick={() => go("library/new")}>＋ Tạo bộ đề</button>
        </Empty>
      ) : (
        <div className="deck-grid">
          {rows.map(({ d, st }) => (
            <a key={d.id} className="deck-card" href={"#/deck/" + d.id} style={{ ["--c" as any]: d.color }}>
              <div className="deck-emoji">{d.emoji}</div>
              <div className="deck-name">{d.name}</div>
              {d.description && <div className="muted small clamp2">{d.description}</div>}
              <div className="muted small">
                {st.total} câu · {store.docs.filter((x) => x.deckId === d.id).length} tài liệu · {timeAgo(d.updatedAt)}
              </div>
              <Progress value={st.total ? st.mastered / st.total : 0} color={d.color} />
              <div className="row gap small">
                {d.tags.map((t) => <span key={t} className="pill">{t}</span>)}
                {st.due > 0 && <span className="pill warn">{st.due} đến hạn</span>}
                {st.wrong > 0 && <span className="pill bad">{st.wrong} câu sai</span>}
              </div>
            </a>
          ))}
        </div>
      )}

      {hits.length > 0 && (
        <>
          <div className="section-head"><h2>Câu hỏi khớp “{q}”</h2></div>
          <div className="stack">
            {hits.map((h) => (
              <a key={h.id} className="card hover" href={"#/deck/" + h.deckId}>
                <div className="muted small">{store.decks.find((d) => d.id === h.deckId)?.name}</div>
                <QuestionPreview q={h} />
              </a>
            ))}
          </div>
        </>
      )}
      {creating && <DeckForm onClose={() => go("library")} onSaved={(d) => setTimeout(() => go("deck/" + d.id))} />}
    </div>
  );
}
