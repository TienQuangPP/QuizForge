import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { Exercise, ExerciseType } from "../types";
import { aiReady } from "../ai";
import { BLOOM, clozeBlanks, EXERCISE_TYPES, generateExercises, gradeCloze, gradeFreeText, gradeMatch, gradeOrder, normalizeExercise, type AIGrade } from "../course";
import { contextFor } from "../theory";
import { Empty, Markdown, Modal, Progress, Rich, shuffle, Spinner } from "../ui";
import { confetti, sound } from "../fx";
import { externalExercisePrompt } from "../externalPrompt";

/** Shows an AI (or self) grade: what was right, missing, misunderstood. */
export function GradeView({ g }: { g: AIGrade }) {
  const tone = g.score >= 8 ? "good" : g.score >= 5 ? "warn" : "bad";
  return (
    <div className={"grade " + tone}>
      <div className="grade-score"><b>{Math.round(g.score * 10) / 10}</b><small>/10</small></div>
      <div className="grow stack">
        {g.feedback && <p>{g.feedback}</p>}
        {g.covered.length > 0 && <div><b className="good">✅ Đã nêu được</b><ul>{g.covered.map((x) => <li key={x}><Rich text={x} /></li>)}</ul></div>}
        {g.missing.length > 0 && <div><b className="warn-text">⚠️ Còn thiếu</b><ul>{g.missing.map((x) => <li key={x}><Rich text={x} /></li>)}</ul></div>}
        {g.misconceptions.length > 0 && <div><b className="bad">❌ Hiểu chưa đúng</b><ul>{g.misconceptions.map((x) => <li key={x}><Rich text={x} /></li>)}</ul></div>}
        {g.improved && <details><summary>📝 Xem bài làm mẫu</summary><Markdown text={g.improved} /></details>}
      </div>
    </div>
  );
}

/** Without AI: the learner ticks which key ideas their answer covered. */
function SelfCheck({ points, reference, onScore }: { points: string[]; reference?: string; onScore: (score: number) => void }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  return (
    <div className="selfcheck">
      {reference && <div className="explain-mini"><b>Đáp án tham khảo:</b> <Markdown text={reference} /></div>}
      {points.length > 0 ? (
        <>
          <p className="muted small">So sánh với câu trả lời của bạn — tích vào những ý bạn đã nêu được:</p>
          {points.map((p, i) => (
            <label key={i} className="check">
              <input type="checkbox" checked={ticked.has(i)} onChange={() => setTicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
              <Rich text={p} />
            </label>
          ))}
          <button className="btn primary" onClick={() => onScore(ticked.size / points.length)}>Xác nhận ({ticked.size}/{points.length} ý)</button>
        </>
      ) : (
        <div className="row gap wrap">
          <span className="muted small">Bài của bạn đúng được bao nhiêu?</span>
          {[["Chưa đúng", 0], ["Một phần", 0.5], ["Đúng ý", 1]].map(([l, v]) => <button key={l as string} className="btn sm" onClick={() => onScore(v as number)}>{l as string}</button>)}
        </div>
      )}
    </div>
  );
}

/** One interactive thinking exercise. Calls onDone(score 0..1) when the learner continues. */
export function ExerciseCard({ ex, context, onDone }: { ex: Exercise; context?: string; onDone: (score: number) => void }) {
  const store = useStore();
  const ai = aiReady(store.settings);
  const info = EXERCISE_TYPES[ex.type];
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [grade, setGrade] = useState<AIGrade | null>(null);
  const [selfMode, setSelfMode] = useState(false);
  // per-type state
  const blanks = useMemo(() => (ex.type === "cloze" ? clozeBlanks(ex.text ?? "") : []), [ex]);
  const [fills, setFills] = useState<string[]>(() => blanks.map(() => ""));
  const [orderList, setOrderList] = useState<string[]>(() => {
    if (ex.type !== "order") return [];
    let s = shuffle(ex.items!);
    for (let i = 0; i < 5 && s.join() === ex.items!.join(); i++) s = shuffle(ex.items!);
    return s;
  });
  const rights = useMemo(() => (ex.type === "match" ? shuffle(ex.pairs!.map((p) => p[1])) : []), [ex]);
  const [matchSel, setMatchSel] = useState<Record<string, string>>({});
  const [tf, setTf] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [marks, setMarks] = useState<boolean[]>([]);

  const finishWith = (s: number) => {
    setScore(s);
    sound(s >= 0.7 ? "right" : "wrong");
    if (s >= 0.999) confetti(50);
  };

  const check = async () => {
    setErr("");
    if (ex.type === "cloze") { const r = gradeCloze(ex.text!, fills); setMarks(r.right); return finishWith(r.score); }
    if (ex.type === "order") { const r = gradeOrder(ex.items!, orderList); setMarks(r.right); return finishWith(r.score); }
    if (ex.type === "match") { const r = gradeMatch(ex.pairs!, matchSel); setMarks(r.right); return finishWith(r.score); }
    const needsText = ex.type === "open" || ex.type === "error";
    if (ex.type === "truefalse" && tf == null) return setErr("Hãy chọn Đúng hoặc Sai trước.");
    if (needsText && text.trim().length < 8) return setErr("Hãy viết câu trả lời (ít nhất một câu).");
    const choicePart = ex.type === "truefalse" ? (tf === ex.isTrue ? 0.6 : 0) : 0;
    const reasonWeight = ex.type === "truefalse" ? 0.4 : 1;
    if (ex.type === "truefalse" && !text.trim()) return finishWith(choicePart);
    if (!ai) { setSelfMode(true); return; }
    setBusy(true);
    try {
      const g = await gradeFreeText(store.settings, {
        title: info.label,
        prompt: [ex.prompt, ex.text, ex.statement && `Nhận định: ${ex.statement} (thực tế: ${ex.isTrue ? "ĐÚNG" : "SAI"})`].filter(Boolean).join("\n"),
        reference: ex.answer,
        rubric: ex.rubric,
        context,
      }, text);
      setGrade(g);
      finishWith(choicePart + reasonWeight * (g.score / 10));
    } catch (e: any) {
      setErr(e.message + " — bạn có thể tự chấm theo đáp án.");
      setSelfMode(true);
    }
    setBusy(false);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= orderList.length || score != null) return;
    const n = [...orderList];
    [n[i], n[j]] = [n[j], n[i]];
    setOrderList(n);
  };

  const done = score != null;
  // Cloze text split into text parts and inputs.
  const clozeParts = ex.type === "cloze" ? (ex.text ?? "").split(/\[\[.+?\]\]/) : [];

  return (
    <div className="exercise card">
      <div className="row between small muted">
        <span>{info.icon} {info.label}{ex.topic && ` · ${ex.topic}`}</span>
        {ex.bloom && <span className="pill">{BLOOM[ex.bloom].icon} {BLOOM[ex.bloom].label}</span>}
      </div>
      <div className="ex-prompt"><Rich text={ex.prompt} /></div>

      {ex.type === "cloze" && (
        <div className="cloze">
          {clozeParts.map((part, i) => (
            <span key={i}>
              <Rich text={part} />
              {i < blanks.length && (
                <span className="blank">
                  <input
                    className={done ? (marks[i] ? "ok" : "no") : ""}
                    value={fills[i]}
                    disabled={done}
                    style={{ width: `${Math.max(6, blanks[i][0].replace(/\$/g, "").length + 2)}ch` }}
                    onChange={(e) => setFills(fills.map((f, j) => (j === i ? e.target.value : f)))}
                    aria-label={`Chỗ trống ${i + 1}`}
                  />
                  {done && !marks[i] && <span className="blank-answer"><Rich text={blanks[i][0]} /></span>}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {ex.type === "order" && (
        <ol className="order-list">
          {orderList.map((it, i) => (
            <li key={it} className={done ? (marks[i] ? "ok" : "no") : ""}>
              <span className="grow"><Rich text={it} /></span>
              {!done && (
                <span className="row">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                  <button className="icon-btn" disabled={i === orderList.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {ex.type === "order" && done && score! < 1 && (
        <div className="explain-mini"><b>Thứ tự đúng:</b> {ex.items!.map((x, i) => <div key={i}>{i + 1}. <Rich text={x} /></div>)}</div>
      )}

      {ex.type === "match" && (
        <div className="match">
          {ex.pairs!.map(([l, r], i) => (
            <div key={l} className={"match-row " + (done ? (marks[i] ? "ok" : "no") : "")}>
              <b className="match-term"><Rich text={l} /></b>
              <select value={matchSel[l] ?? ""} disabled={done} onChange={(e) => setMatchSel({ ...matchSel, [l]: e.target.value })}>
                <option value="">— chọn —</option>
                {rights.map((x) => <option key={x} value={x}>{x.replace(/\$/g, "")}</option>)}
              </select>
              {done && !marks[i] && <small className="good">→ <Rich text={r} /></small>}
            </div>
          ))}
        </div>
      )}

      {ex.type === "truefalse" && (
        <>
          <blockquote className="statement"><Rich text={ex.statement!} /></blockquote>
          <div className="row gap">
            {[true, false].map((v) => (
              <button key={String(v)} disabled={done} className={"btn " + (tf === v ? "primary" : "")} onClick={() => setTf(v)}>{v ? "✅ Đúng" : "❌ Sai"}</button>
            ))}
          </div>
          <textarea rows={3} value={text} disabled={done} onChange={(e) => setText(e.target.value)} placeholder="Vì sao? Giải thích ngắn gọn (càng rõ càng được nhiều điểm)…" />
        </>
      )}

      {(ex.type === "open" || ex.type === "error") && (
        <>
          {ex.type === "error" && <blockquote className="statement"><Rich text={ex.text!} /></blockquote>}
          <textarea rows={5} value={text} disabled={done || selfMode} onChange={(e) => setText(e.target.value)} placeholder={ex.type === "error" ? "Chỗ nào sai? Vì sao sai? Sửa lại thế nào?" : "Trả lời bằng lời của bạn…"} />
        </>
      )}

      {err && <div className="callout bad small">{err}</div>}

      {!done && !selfMode && (
        <button className="btn primary" disabled={busy} onClick={check}>
          {busy ? <><Spinner /> AI đang chấm…</> : ex.type === "open" || ex.type === "error" ? (ai ? "Nộp bài cho AI chấm" : "Nộp & tự chấm") : "Kiểm tra"}
        </button>
      )}
      {selfMode && !done && (
        <SelfCheck
          points={ex.rubric ?? []}
          reference={ex.type === "truefalse" ? `${ex.isTrue ? "ĐÚNG" : "SAI"}. ${ex.answer ?? ""}` : ex.answer}
          onScore={(s) => finishWith(ex.type === "truefalse" ? (tf === ex.isTrue ? 0.6 : 0) + 0.4 * s : s)}
        />
      )}

      {done && (
        <div className="stack">
          {ex.type === "truefalse" && (
            <div className={"callout " + (tf === ex.isTrue ? "good" : "bad")}>
              {tf === ex.isTrue ? "✅ Phán đoán đúng." : `❌ Nhận định này ${ex.isTrue ? "ĐÚNG" : "SAI"}.`} {ex.answer && <Rich text={ex.answer} />}
            </div>
          )}
          {grade && <GradeView g={grade} />}
          {!grade && (ex.type === "open" || ex.type === "error") && ex.answer && <div className="explain-mini"><b>Đáp án tham khảo:</b> <Markdown text={ex.answer} /></div>}
          {ex.explanation && <div className="explain-mini">💡 <Rich text={ex.explanation} /></div>}
          <div className="row between">
            <span className={"pill big " + (score! >= 0.7 ? "good" : score! >= 0.4 ? "warn" : "bad")}>Điểm: {Math.round(score! * 100)}%</span>
            <button className="btn primary" onClick={() => onDone(score!)}>Tiếp tục →</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Runs a list of exercises one by one, saves scores, then shows a summary. */
export function ExerciseSession({ list, context, onFinish, onExit }: { list: Exercise[]; context?: (ex: Exercise) => string; onFinish?: (avg: number) => void; onExit: () => void }) {
  const store = useStore();
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  if (!list.length) return null;
  const finished = idx >= list.length;
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const done = async (s: number) => {
    const ex = list[idx];
    await store.saveExercises([{ ...ex, lastScore: s, attempts: (ex.attempts ?? 0) + 1, lastAt: Date.now() }]);
    store.addXp(Math.round(5 + 15 * s));
    const next = [...scores, s];
    setScores(next);
    setIdx(idx + 1);
    if (idx + 1 >= list.length) {
      const a = next.reduce((x, y) => x + y, 0) / next.length;
      if (a >= 0.8) confetti(150);
      onFinish?.(a);
    }
  };

  if (finished) {
    return (
      <div className="card stack center">
        <h2>{avg >= 0.8 ? "🎉 Xuất sắc!" : avg >= 0.5 ? "👍 Khá tốt!" : "💪 Cần luyện thêm"}</h2>
        <div className="score-ring" style={{ ["--p" as any]: avg, ["--tone" as any]: avg >= 0.7 ? "var(--good)" : avg >= 0.4 ? "var(--warn)" : "var(--bad)", margin: "0 auto" }}>
          <div><b>{Math.round(avg * 100)}%</b><small>{list.length} bài</small></div>
        </div>
        <div className="stack small">
          {list.map((ex, i) => (
            <div key={ex.id} className="row between">
              <span>{EXERCISE_TYPES[ex.type].icon} {ex.prompt.slice(0, 70)}</span>
              <b className={scores[i] >= 0.7 ? "good" : "bad"}>{Math.round(scores[i] * 100)}%</b>
            </div>
          ))}
        </div>
        <button className="btn primary" onClick={onExit}>Xong</button>
      </div>
    );
  }
  const ex = list[idx];
  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost sm" onClick={onExit}>✕ Dừng</button>
        <span className="muted small">Bài {idx + 1}/{list.length}</span>
      </div>
      <Progress value={idx / list.length} />
      <ExerciseCard key={ex.id + idx} ex={ex} context={context?.(ex)} onDone={done} />
    </div>
  );
}

const ALL_TYPES = Object.keys(EXERCISE_TYPES) as ExerciseType[];

/** Modal to have the AI create thinking exercises for a topic. */
export function GenerateExercisesModal({ deckId, topics, defaultTopic, lessonId, objectives, onClose, onCreated }: {
  deckId: string;
  topics: string[];
  defaultTopic?: string;
  lessonId?: string;
  objectives?: string[];
  onClose: () => void;
  onCreated?: (ex: Exercise[]) => void;
}) {
  const store = useStore();
  const deck = store.decks.find((d) => d.id === deckId);
  const [topic, setTopic] = useState(defaultTopic ?? topics[0] ?? "");
  const [count, setCount] = useState(6);
  const [types, setTypes] = useState<ExerciseType[]>(ALL_TYPES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const note = store.notes.find((n) => n.deckId === deckId && n.title === topic);
      const ctx = (note ? `${note.title}\n${note.content}\n\n` : "") + contextFor(topic, deckId, store.docs, store.questions);
      const drafts = await generateExercises(store.settings, topic, ctx, deck?.subject, { count, types, language: "vi", objectives });
      if (!drafts.length) throw new Error("AI chưa tạo được bài tập hợp lệ, hãy thử lại.");
      const items: Exercise[] = drafts.map((d, i) => ({ ...d, id: crypto.randomUUID(), deckId, lessonId, topic, createdAt: Date.now() + i }));
      await store.saveExercises(items);
      store.toast(`Đã tạo ${items.length} bài tập tư duy`);
      onCreated?.(items);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  return (
    <Modal title="✨ AI tạo bài tập tư duy" onClose={onClose} footer={busy ? <div className="gen-status grow"><Spinner /> AI đang ra bài tập…</div> : <button className="btn primary" disabled={!topic.trim() || !types.length} onClick={run}>Tạo {count} bài tập</button>}>
      <label>Chủ đề</label>
      <input list="ex-topics" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="VD: Pha sáng quang hợp" />
      <datalist id="ex-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
      <label>Số bài</label>
      <input type="number" min={2} max={15} value={count} onChange={(e) => setCount(Math.max(2, Math.min(15, +e.target.value || 6)))} />
      <label>Dạng bài</label>
      <div className="chips">
        {ALL_TYPES.map((t) => (
          <button key={t} className={"chip" + (types.includes(t) ? " on" : "")} onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}>{EXERCISE_TYPES[t].icon} {EXERCISE_TYPES[t].label}</button>
        ))}
      </div>
      {err && <div className="callout bad">{err}</div>}
    </Modal>
  );
}

/** Deck tab listing thinking exercises with practice sessions. */
export default function ExercisesTab({ deckId }: { deckId: string }) {
  const store = useStore();
  const ai = aiReady(store.settings);
  const all = useMemo(() => store.exercises.filter((e) => e.deckId === deckId), [store.exercises, deckId]);
  const topics = useMemo(() => [...new Set([...store.notes.filter((n) => n.deckId === deckId).map((n) => n.title), ...store.lessons.filter((l) => l.deckId === deckId).map((l) => l.title), ...(all.map((e) => e.topic).filter(Boolean) as string[])])], [store.notes, store.lessons, all, deckId]);
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState<Exercise[] | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const list = filter ? all.filter((e) => e.topic === filter) : all;
  const weak = list.filter((e) => e.lastScore == null || e.lastScore < 0.7);
  const ctx = (ex: Exercise) => {
    const note = store.notes.find((n) => n.deckId === deckId && n.title === ex.topic);
    return note ? note.content : contextFor(ex.topic ?? "", deckId, store.docs, store.questions);
  };

  if (session) return <ExerciseSession list={session} context={ctx} onExit={() => setSession(null)} />;

  return (
    <>
      <div className="callout small">
        🧩 <b>Bài tập tư duy</b> giúp bạn <b>tự nhớ lại, lập luận và vận dụng</b> thay vì chỉ chọn đáp án có sẵn — cách học nhớ lâu và hiểu sâu nhất.
      </div>
      <div className="toolbar">
        {topics.length > 0 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Mọi chủ đề ({all.length})</option>
            {topics.map((t) => <option key={t} value={t}>{t} ({all.filter((e) => e.topic === t).length})</option>)}
          </select>
        )}
        <button className="btn primary" disabled={!list.length} onClick={() => setSession(shuffle(list).slice(0, 10))}>▶ Làm {Math.min(10, list.length)} bài</button>
        <button className="btn" disabled={!weak.length} onClick={() => setSession(shuffle(weak).slice(0, 10))}>🩹 Bài chưa đạt ({weak.length})</button>
        {ai && <button className="btn" onClick={() => setGenOpen(true)}>✨ AI tạo bài tập</button>}
        <button className="btn ghost" onClick={() => setPasteOpen(true)}>🌐 Dán từ AI bên ngoài</button>
      </div>
      {!all.length ? (
        <Empty icon="🧩" title="Chưa có bài tập tư duy">
          <p className="muted">Gồm 6 dạng: {Object.values(EXERCISE_TYPES).map((t) => t.icon + " " + t.label).join(" · ")}.</p>
          <div className="row gap center wrap">
            {ai ? <button className="btn primary" onClick={() => setGenOpen(true)}>✨ AI tạo bài tập</button> : <a className="btn primary" href="#/settings">Kết nối AI để tạo bài tập</a>}
            <button className="btn" onClick={() => setPasteOpen(true)}>🌐 Dùng ChatGPT/Gemini web</button>
          </div>
        </Empty>
      ) : (
        <div className="stack">
          {list.map((ex) => (
            <div key={ex.id} className="qrow">
              <span className="ex-icon">{EXERCISE_TYPES[ex.type].icon}</span>
              <div className="qrow-main" onClick={() => setSession([ex])}>
                <div className="qrow-title"><Rich text={ex.prompt} /></div>
                <div className="row gap small">
                  <span className="pill">{EXERCISE_TYPES[ex.type].label}</span>
                  {ex.topic && <span className="pill">{ex.topic}</span>}
                  {ex.bloom && <span className="pill">{BLOOM[ex.bloom].icon} {BLOOM[ex.bloom].label}</span>}
                  {ex.lastScore != null ? <span className={"pill " + (ex.lastScore >= 0.7 ? "good" : "bad")}>Lần trước {Math.round(ex.lastScore * 100)}%</span> : <span className="pill muted">Chưa làm</span>}
                </div>
              </div>
              <button className="icon-btn" title="Xoá" onClick={() => store.deleteExercises([ex.id])}>🗑</button>
            </div>
          ))}
        </div>
      )}
      {genOpen && <GenerateExercisesModal deckId={deckId} topics={topics} defaultTopic={filter || undefined} onClose={() => setGenOpen(false)} />}
      {pasteOpen && <PasteExercisesModal deckId={deckId} topics={topics} onClose={() => setPasteOpen(false)} />}
    </>
  );
}

/** Lets no-key users paste exercises produced by a web chat AI (see externalPrompt). */
function PasteExercisesModal({ deckId, topics, onClose }: { deckId: string; topics: string[]; onClose: () => void }) {
  const store = useStore();
  const deck = store.decks.find((d) => d.id === deckId);
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const promptText = useMemo(() => externalExercisePrompt(topic, deck?.subject), [topic, deck?.subject]);
  const save = async () => {
    setErr("");
    let items: any[] = [];
    try {
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const j = JSON.parse((m ? m[1] : text.slice(text.search(/[[{]/))).trim());
      items = Array.isArray(j) ? j : j.exercises ?? [];
    } catch {
      return setErr("Không đọc được JSON. Hãy dán TOÀN BỘ khối ```json mà AI trả về.");
    }
    const ok = items.map((e) => normalizeExercise(e, topic)).filter(Boolean) as Omit<Exercise, "id" | "deckId" | "createdAt">[];
    if (!ok.length) return setErr("Không có bài tập hợp lệ trong nội dung đã dán.");
    await store.saveExercises(ok.map((d, i) => ({ ...d, id: crypto.randomUUID(), deckId, topic: d.topic || topic, createdAt: Date.now() + i })));
    store.toast(`Đã thêm ${ok.length} bài tập tư duy`);
    onClose();
  };
  return (
    <Modal wide title="🌐 Bài tập tư duy từ AI bên ngoài (không cần key)" onClose={onClose} footer={<button className="btn primary" disabled={!text.trim()} onClick={save}>Lưu bài tập</button>}>
      <label>Chủ đề</label>
      <input list="paste-topics" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <datalist id="paste-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
      <ol className="small">
        <li>Bấm <b>Sao chép câu lệnh</b>, mở ChatGPT/Gemini/Claude, đính kèm giáo trình (nếu có) rồi dán và gửi.</li>
        <li>Bấm <b>Copy</b> ở khối code AI trả lời, dán vào ô dưới, bấm Lưu.</li>
      </ol>
      <button className={"btn " + (copied ? "good" : "primary")} disabled={!topic.trim()} onClick={async () => { await navigator.clipboard.writeText(promptText).catch(() => {}); setCopied(true); }}>{copied ? "✓ Đã sao chép" : "📋 Sao chép câu lệnh"}</button>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán câu trả lời của AI (khối ```json …```) vào đây" />
      {err && <div className="callout bad">{err}</div>}
    </Modal>
  );
}
