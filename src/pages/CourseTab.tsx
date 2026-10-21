import { useEffect, useMemo, useState } from "react";
import { normalize, useStore } from "../store";
import type { Exercise, Lesson, Question, TheoryNote } from "../types";
import { aiReady, generateQuestions } from "../ai";
import { advanceReview, courseFromNotes, generateCourse, gradeFreeText, keyPointsOf, lessonDue, MASTERED, newLesson, updateLesson, type AIGrade } from "../course";
import { contextFor, questionsForNote, theorySource, writeTopicNote } from "../theory";
import { Empty, go, Markdown, Modal, Progress, Rich, shuffle, Spinner } from "../ui";
import { canSpeak, confetti, sound, speak, stopSpeaking } from "../fx";
import { letter } from "../parsers";
import { ExerciseSession, GenerateExercisesModal, GradeView } from "./Exercises";
import { subjectOf } from "../subjects";

const pct = (x?: number) => `${Math.round((x ?? 0) * 100)}%`;

/** Short multiple-choice check used as the last step of a lesson. */
function QuickQuiz({ questions, onFinish }: { questions: Question[]; onFinish: (score: number) => void }) {
  const store = useStore();
  const [list] = useState(() => shuffle(questions).slice(0, 6));
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(0);
  if (idx >= list.length) return null;
  const q = list[idx];
  const multi = q.answers.length > 1;
  const ok = [...chosen].sort().join() === [...q.answers].sort().join();
  const check = (ans = chosen) => {
    if (!ans.length) return;
    const good = [...ans].sort().join() === [...q.answers].sort().join();
    setChosen(ans);
    setChecked(true);
    if (good) setRight((r) => r + 1);
    sound(good ? "right" : "wrong");
    store.recordAnswer(q.id, good);
  };
  const next = () => {
    if (idx + 1 >= list.length) onFinish((right) / list.length);
    else { setIdx(idx + 1); setChosen([]); setChecked(false); }
  };
  return (
    <div className="card stack">
      <div className="row between small muted"><span>Câu {idx + 1}/{list.length}</span><span>Đúng {right}</span></div>
      <div className="qbig"><Rich text={q.question} /></div>
      {multi && <div className="pill warn">Chọn {q.answers.length} đáp án</div>}
      <div className="choices">
        {q.options.map((o, i) => {
          const sel = chosen.includes(i);
          const cls = checked ? (q.answers.includes(i) ? " right" : sel ? " wrong" : " dim") : sel ? " sel" : "";
          return (
            <button key={i} className={"choice" + cls} disabled={checked} onClick={() => (multi ? setChosen(sel ? chosen.filter((x) => x !== i) : [...chosen, i]) : check([i]))}>
              <span className="key">{letter(i)}</span><Rich className="grow" text={o} />
            </button>
          );
        })}
      </div>
      {checked && (
        <div className={"feedback " + (ok ? "ok" : "no")}>
          <b className="fb-title">{ok ? "🎉 Chính xác!" : `❌ Đáp án đúng: ${q.answers.map(letter).join(", ")}`}</b>
          {q.explanation && <p><Rich text={q.explanation} /></p>}
        </div>
      )}
      {!checked && multi && <button className="btn primary" disabled={!chosen.length} onClick={() => check()}>Kiểm tra</button>}
      {checked && <button className="btn primary" onClick={next}>{idx + 1 >= list.length ? "Xem kết quả" : "Câu tiếp →"}</button>}
    </div>
  );
}

const STEPS = [
  { key: "theory", icon: "📖", label: "Học lý thuyết" },
  { key: "explain", icon: "🗣️", label: "Tự giải thích" },
  { key: "exercises", icon: "🧩", label: "Bài tập tư duy" },
  { key: "quiz", icon: "✅", label: "Kiểm tra nhanh" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

function LessonView({ lesson, lessons }: { lesson: Lesson; lessons: Lesson[] }) {
  const store = useStore();
  const ai = aiReady(store.settings);
  const deck = store.decks.find((d) => d.id === lesson.deckId)!;
  const idx = lessons.findIndex((l) => l.id === lesson.id);
  const nextLesson = lessons[idx + 1];
  const note: TheoryNote | undefined =
    store.notes.find((n) => n.id === lesson.noteId) ?? store.notes.find((n) => n.deckId === lesson.deckId && normalize(n.title) === normalize(lesson.title));
  const firstOpen = (STEPS.find((s) => lesson.steps[s.key] == null)?.key ?? "quiz") as StepKey;
  const [step, setStep] = useState<StepKey>(lessonDue(lesson) ? "explain" : firstOpen);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [explain, setExplain] = useState(lesson.explainText ?? "");
  const [grade, setGrade] = useState<AIGrade | null>(null);
  const [selfPoints, setSelfPoints] = useState<Set<number> | null>(null);
  // The session list is fixed when the learner starts, so re-renders never reshuffle it.
  const [exSession, setExSession] = useState<Exercise[] | null>(null);
  const [genEx, setGenEx] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  useEffect(() => () => void stopSpeaking(), []);

  const pseudoNote = (note ?? { id: "", deckId: lesson.deckId, title: lesson.title, content: [...lesson.objectives, ...lesson.concepts].join("\n"), order: 0, source: "manual", createdAt: 0, updatedAt: 0 }) as TheoryNote;
  const quizQs = useMemo(() => questionsForNote(pseudoNote, store.questions, 8), [store.questions, lesson.id, note?.id]); // eslint-disable-line
  const exList = store.exercises.filter((e) => e.deckId === lesson.deckId && (e.lessonId === lesson.id || (e.topic && normalize(e.topic) === normalize(lesson.title))));
  const context = () => (note ? `${note.title}\n${note.content}\n\n` : "") + contextFor(lesson.title + " " + lesson.concepts.join(" "), lesson.deckId, store.docs, store.questions);
  const points = keyPointsOf(note, lesson);

  const save = async (patch: Partial<Lesson["steps"]>, extra: Partial<Lesson> = {}) => {
    const before = lesson.mastery;
    const updated = updateLesson(lesson, patch, extra);
    await store.saveLessons([updated]);
    if (before < MASTERED && updated.mastery >= MASTERED) {
      confetti(180);
      sound("level");
      store.addXp(100);
      store.toast(`🏅 Đã thành thạo bài “${lesson.title}” (+100 XP). Bài sẽ được nhắc ôn lại sau 1 ngày.`, "win");
    }
    return updated;
  };

  const writeLesson = async () => {
    setBusy("AI đang soạn bài giảng…");
    setErr("");
    try {
      const d = await writeTopicNote(store.settings, lesson.title, context(), { language: "vi", depth: "detailed", instructions: `Bám sát các mục tiêu: ${lesson.objectives.join("; ")}. ${subjectOf(deck.subject).hint}` });
      const [n] = await store.addNotes(lesson.deckId, [{ ...d, title: lesson.title, source: "ai" }]);
      await store.saveLessons([{ ...lesson, noteId: n.id }]);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const submitExplain = async () => {
    setErr("");
    if (explain.trim().length < 30) return setErr("Hãy viết ít nhất 2–3 câu bằng lời của bạn.");
    if (!ai) return setSelfPoints(new Set());
    setBusy("AI đang đọc bài giải thích của bạn…");
    try {
      const g = await gradeFreeText(store.settings, { title: `Tự giải thích: ${lesson.title}`, prompt: `Giải thích lại "${lesson.title}" bằng lời của mình. Mục tiêu: ${lesson.objectives.join("; ")}`, rubric: points, context: context() }, explain);
      setGrade(g);
      const l = await save({ explain: g.score / 10 }, { explainText: explain });
      if (lessonDue(lesson)) await store.saveLessons([advanceReview(l, g.score >= 7)]);
      store.addXp(Math.round(g.score * 3));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const makeQuiz = async () => {
    setBusy("AI đang ra câu hỏi kiểm tra…");
    setErr("");
    try {
      const qs = await generateQuestions(store.settings, context(), { count: 5, language: "vi", difficulty: "mixed", optionCount: 4, types: ["understanding", "application", "compare"], instructions: `Kiểm tra các mục tiêu: ${lesson.objectives.join("; ")}`, withExplanation: true, subject: deck.subject }, lesson.title, () => {});
      await store.addQuestions(lesson.deckId, qs.map((q) => ({ ...q, topic: lesson.title })));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const status = (k: StepKey) => {
    const v = lesson.steps[k];
    return v == null ? "" : k === "theory" ? "✓" : pct(v);
  };

  return (
    <div className="lesson stack">
      <a className="back" href={`#/deck/${lesson.deckId}/course`}>← Lộ trình</a>
      <div className="lesson-head card">
        <div className="muted small">{lesson.module} · Bài {idx + 1}/{lessons.length}</div>
        <h2>{lesson.title}</h2>
        <div className="row gap">
          <span className="grow"><Progress value={lesson.mastery} color={lesson.mastery >= MASTERED ? "var(--good)" : undefined} /></span>
          <b>{pct(lesson.mastery)} thành thạo</b>
        </div>
        {lessonDue(lesson) && <div className="callout warn small">🔁 Đến lúc ôn lại bài này — hãy thử tự giải thích lại hoặc làm bài kiểm tra nhanh mà không xem lý thuyết.</div>}
        {lesson.objectives.length > 0 && (
          <div className="objectives">
            <b>🎯 Sau bài này bạn sẽ:</b>
            <ul>{lesson.objectives.map((o) => <li key={o}><Rich text={o} /></li>)}</ul>
          </div>
        )}
        {lesson.concepts.length > 0 && <div className="chips">{lesson.concepts.map((c) => <span key={c} className="pill"><Rich text={c} /></span>)}</div>}
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <button key={s.key} className={(step === s.key ? "on " : "") + (lesson.steps[s.key] != null ? "done" : "")} onClick={() => { setStep(s.key); setExSession(null); setQuiz(false); }}>
            <span className="step-num">{lesson.steps[s.key] != null ? "✓" : i + 1}</span>
            <span>{s.icon} {s.label}</span>
            {status(s.key) && <small>{status(s.key)}</small>}
          </button>
        ))}
      </div>
      {busy && <div className="gen-status"><Spinner /> {busy}</div>}
      {err && <div className="callout bad">{err}</div>}

      {step === "theory" && (
        <div className="card stack">
          {note ? (
            <>
              <div className="row gap wrap">
                {canSpeak() && <button className="btn sm" onClick={() => speak(`${note.title}. ${note.content.replace(/[#*`>|]/g, " ")}`)}>🔊 Nghe đọc</button>}
                <a className="btn sm ghost" href={`#/deck/${lesson.deckId}/theory/${note.id}`}>Mở trong sổ tay →</a>
              </div>
              <Markdown text={note.content} className="note-body" />
            </>
          ) : (
            <Empty icon="📖" title="Bài này chưa có bài giảng">
              <div className="row gap center wrap">
                {ai && <button className="btn primary" disabled={!!busy} onClick={writeLesson}>✨ AI soạn bài giảng theo mục tiêu</button>}
                <a className="btn" href={`#/import/${lesson.deckId}/external-theory`}>🌐 Dùng ChatGPT/Gemini web</a>
                <a className="btn ghost" href={`#/deck/${lesson.deckId}/docs`}>Đọc tài liệu gốc</a>
              </div>
            </Empty>
          )}
          <button className="btn primary big" onClick={async () => { await save({ theory: 1 }); setStep("explain"); }}>✓ Tôi đã học xong phần này → Tự giải thích</button>
        </div>
      )}

      {step === "explain" && (
        <div className="card stack">
          <div className="callout small">
            🗣️ <b>Kỹ thuật Feynman:</b> giải thích lại “{lesson.title}” bằng lời của bạn như đang dạy một người bạn chưa biết gì. <b>Đừng nhìn tài liệu.</b> Chỗ nào bạn lúng túng chính là chỗ chưa hiểu.
          </div>
          <ul className="small muted tips">
            <li>Bắt đầu bằng: “Hiểu đơn giản thì… ”</li>
            <li>Nêu <b>vì sao</b> và cho <b>một ví dụ</b> của riêng bạn.</li>
            <li>Nếu có quy trình, kể theo thứ tự.</li>
          </ul>
          <textarea rows={7} value={explain} onChange={(e) => setExplain(e.target.value)} placeholder="Hiểu đơn giản thì…" />
          {!grade && !selfPoints && (
            <button className="btn primary" disabled={!!busy} onClick={submitExplain}>{ai ? "🧠 Nhờ AI nhận xét" : "Tự đối chiếu với ý chính"}</button>
          )}
          {grade && <GradeView g={grade} />}
          {selfPoints && (
            <div className="selfcheck">
              <p className="muted small">Tích vào những ý chính bạn đã nêu được:</p>
              {points.map((p, i) => (
                <label key={i} className="check">
                  <input type="checkbox" checked={selfPoints.has(i)} onChange={() => setSelfPoints((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                  <Rich text={p} />
                </label>
              ))}
              <button className="btn primary" onClick={async () => { await save({ explain: points.length ? selfPoints.size / points.length : 0.5 }, { explainText: explain }); setSelfPoints(null); setStep("exercises"); }}>Xác nhận</button>
            </div>
          )}
          {(grade || lesson.steps.explain != null) && !selfPoints && (
            <div className="row gap wrap">
              {grade && <button className="btn" onClick={() => setGrade(null)}>✍️ Viết lại và chấm lại</button>}
              <button className="btn primary" onClick={() => setStep("exercises")}>Tiếp: Bài tập tư duy →</button>
            </div>
          )}
        </div>
      )}

      {step === "exercises" && (
        exSession ? (
          <ExerciseSession list={exSession} context={() => context()} onExit={() => setExSession(null)} onFinish={(avg) => save({ exercises: avg })} />
        ) : (
          <div className="card stack">
            <p>🧩 {exList.length ? `${exList.length} bài tập tư duy cho bài này (điền khuyết, sắp xếp, nối, tình huống…).` : "Chưa có bài tập cho bài này."}</p>
            <div className="row gap wrap">
              {exList.length > 0 && <button className="btn primary" onClick={() => setExSession(shuffle(exList).slice(0, 6))}>▶ Làm bài tập</button>}
              {ai && <button className="btn" onClick={() => setGenEx(true)}>✨ AI tạo bài tập</button>}
              {!ai && <a className="btn" href={`#/deck/${lesson.deckId}/exercises`}>🌐 Thêm bài tập từ AI bên ngoài</a>}
              <button className="btn ghost" onClick={() => setStep("quiz")}>Bỏ qua →</button>
            </div>
            {lesson.steps.exercises != null && <div className="muted small">Lần gần nhất: {pct(lesson.steps.exercises)}</div>}
          </div>
        )
      )}

      {step === "quiz" && (
        quiz ? (
          <QuickQuiz questions={quizQs} onFinish={async (sc) => {
            setQuiz(false);
            setQuizScore(sc);
            const l = await save({ quiz: sc });
            if (lessonDue(lesson)) await store.saveLessons([advanceReview(l, sc >= 0.7)]);
          }} />
        ) : (
          <div className="card stack">
            {quizScore != null && <div className={"callout " + (quizScore >= 0.7 ? "good" : "warn")}>Kết quả: <b>{pct(quizScore)}</b> — {quizScore >= 0.7 ? "tốt lắm!" : "hãy xem lại lý thuyết và thử lại nhé."}</div>}
            <p>✅ {quizQs.length >= 2 ? `${Math.min(6, quizQs.length)} câu trắc nghiệm kiểm tra nhanh bài này.` : "Chưa đủ câu hỏi cho bài này."}</p>
            <div className="row gap wrap">
              {quizQs.length >= 2 && <button className="btn primary" onClick={() => setQuiz(true)}>▶ Làm kiểm tra</button>}
              {ai && <button className="btn" disabled={!!busy} onClick={makeQuiz}>✨ AI ra thêm 5 câu</button>}
            </div>
          </div>
        )
      )}

      {lesson.mastery >= MASTERED && nextLesson && (
        <button className="btn primary big" onClick={() => go(`deck/${lesson.deckId}/course/${nextLesson.id}`)}>🎉 Sang bài tiếp: {nextLesson.title} →</button>
      )}
      {genEx && <GenerateExercisesModal deckId={lesson.deckId} topics={[lesson.title]} defaultTopic={lesson.title} lessonId={lesson.id} objectives={lesson.objectives} onClose={() => setGenEx(false)} />}
    </div>
  );
}

export function nextLessonOf(lessons: Lesson[]) {
  return lessons.find((l) => l.mastery > 0 && l.mastery < MASTERED) ?? lessons.find((l) => l.mastery < MASTERED);
}

export default function CourseTab({ deckId, lessonId }: { deckId: string; lessonId?: string }) {
  const store = useStore();
  const ai = aiReady(store.settings);
  const deck = store.decks.find((d) => d.id === deckId)!;
  const lessons = useMemo(() => store.lessons.filter((l) => l.deckId === deckId), [store.lessons, deckId]);
  const notes = store.notes.filter((n) => n.deckId === deckId);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const current = lessons.find((l) => l.id === lessonId);
  if (current) return <LessonView lesson={current} lessons={lessons} />;

  const linkNote = (title: string) => notes.find((n) => normalize(n.title) === normalize(title))?.id;
  const replaceWith = async (drafts: ReturnType<typeof courseFromNotes>) => {
    if (lessons.length) await store.deleteLessons(lessons.map((l) => l.id), false);
    const base = Date.now();
    await store.saveLessons(drafts.map((d, i) => newLesson(d, deckId, base + i, linkNote(d.title))));
  };

  const generate = async () => {
    if (lessons.length && !confirm("Lập lại lộ trình mới? Tiến độ các bài hiện tại sẽ bị thay thế.")) return;
    setBusy("AI đang đọc giáo trình và thiết kế lộ trình…");
    setErr("");
    try {
      const src = theorySource(deckId, store.docs, store.questions);
      const material = [notes.map((n) => `## ${n.title}\n${n.content}`).join("\n\n"), src.text].filter(Boolean).join("\n\n");
      if (material.trim().length < 80) throw new Error("Bộ đề chưa có tài liệu, lý thuyết hay câu hỏi để lập lộ trình. Hãy thêm tài liệu ở tab Tài liệu.");
      const drafts = await generateCourse(store.settings, material, deck.subject, "vi", notes.map((n) => n.title));
      await replaceWith(drafts);
      store.toast(`Đã lập lộ trình ${drafts.length} bài học`);
      store.addXp(30);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  };

  const done = lessons.filter((l) => l.mastery >= MASTERED).length;
  const due = lessons.filter(lessonDue);
  const next = nextLessonOf(lessons);
  const modules = [...new Set(lessons.map((l) => l.module))];

  const addModal = addOpen && (
    <Modal title="Thêm bài học" onClose={() => setAddOpen(false)} footer={
      <button className="btn primary" disabled={!newTitle.trim()} onClick={async () => {
        await store.saveLessons([newLesson({ module: lessons.at(-1)?.module ?? "Chương 1", title: newTitle.trim(), objectives: [], concepts: [] }, deckId, Date.now(), linkNote(newTitle))]);
        setNewTitle("");
        setAddOpen(false);
      }}>Thêm</button>
    }>
      <label>Tên bài học</label>
      <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="VD: Định luật Ohm" />
    </Modal>
  );

  if (!lessons.length) {
    return (
      <>
        <Empty icon="🗺️" title="Chưa có lộ trình học">
          <p className="muted">Lộ trình chia giáo trình thành <b>chương → bài</b> theo thứ tự như sách giáo khoa. Mỗi bài học qua 4 bước: <b>Học lý thuyết → Tự giải thích → Bài tập tư duy → Kiểm tra</b>, có điểm thành thạo và lịch ôn lại để nhớ lâu.</p>
          <div className="row gap center wrap">
            {ai && <button className="btn primary" disabled={!!busy} onClick={generate}>✨ AI lập lộ trình từ giáo trình</button>}
            {notes.length > 0 && <button className="btn" onClick={() => replaceWith(courseFromNotes(notes))}>📖 Tạo từ sổ tay lý thuyết ({notes.length} chủ đề)</button>}
            <button className="btn ghost" onClick={() => setAddOpen(true)}>＋ Tự thêm bài học</button>
          </div>
          {!ai && !notes.length && <p className="muted small">Chưa kết nối AI? Hãy tạo <a href={`#/import/${deckId}/external-theory`}>sổ tay lý thuyết bằng ChatGPT/Gemini web</a>, rồi quay lại tạo lộ trình từ sổ tay.</p>}
        </Empty>
        {busy && <div className="gen-status"><Spinner /> {busy}</div>}
        {err && <div className="callout bad">{err}</div>}
        {addModal}
      </>
    );
  }

  return (
    <div className="stack">
      <div className="course-head card">
        <div className="grow">
          <b>🗺️ Lộ trình: {done}/{lessons.length} bài đã thành thạo</b>
          <Progress value={done / lessons.length} color="var(--good)" />
        </div>
        <div className="row gap wrap">
          {next && <button className="btn primary" onClick={() => go(`deck/${deckId}/course/${next.id}`)}>▶ Học tiếp: {next.title}</button>}
          {due.length > 0 && <button className="btn accent" onClick={() => go(`deck/${deckId}/course/${due[0].id}`)}>🔁 Ôn lại {due.length} bài</button>}
        </div>
      </div>
      {busy && <div className="gen-status"><Spinner /> {busy}</div>}
      {err && <div className="callout bad">{err}</div>}
      {modules.map((m) => (
        <div key={m} className="stack">
          <h3 className="module-title">{m}</h3>
          {lessons.filter((l) => l.module === m).map((l) => {
            const n = lessons.indexOf(l) + 1;
            const icon = lessonDue(l) ? "🔁" : l.mastery >= MASTERED ? "✅" : l.mastery > 0 ? "📖" : "⭕";
            return (
              <a key={l.id} className={"lesson-card" + (l.id === next?.id ? " next" : "")} href={`#/deck/${deckId}/course/${l.id}`}>
                <span className="lesson-num">{icon}</span>
                <span className="grow">
                  <b>Bài {n}. {l.title}</b>
                  {l.objectives[0] && <small className="muted"><Rich text={l.objectives.slice(0, 2).join(" · ")} /></small>}
                  <span className="row gap small">
                    <span className="lesson-bar"><Progress value={l.mastery} color={l.mastery >= MASTERED ? "var(--good)" : undefined} /></span>
                    <span className="muted">{pct(l.mastery)}</span>
                    {STEPS.map((s) => <span key={s.key} title={s.label} className={"dot-step" + (l.steps[s.key] != null ? " on" : "")}>{s.icon}</span>)}
                  </span>
                </span>
                <button className="icon-btn" title="Xoá bài" onClick={(e) => { e.preventDefault(); store.deleteLessons([l.id]); }}>🗑</button>
              </a>
            );
          })}
        </div>
      ))}
      <div className="row gap wrap">
        <button className="btn ghost" onClick={() => setAddOpen(true)}>＋ Thêm bài học</button>
        {ai && <button className="btn ghost" disabled={!!busy} onClick={generate}>✨ Lập lại lộ trình bằng AI</button>}
        {notes.length > 0 && <button className="btn ghost" onClick={() => confirm("Tạo lại lộ trình từ sổ tay? Tiến độ hiện tại sẽ bị thay thế.") && replaceWith(courseFromNotes(notes))}>📖 Tạo lại từ sổ tay</button>}
      </div>
      {addModal}
    </div>
  );
}
