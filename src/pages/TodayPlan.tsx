import { useMemo } from "react";
import { deckStats, useStore } from "../store";
import { lessonDue, MASTERED } from "../course";
import { nextLessonOf } from "./CourseTab";
import { go } from "../ui";

interface Task { icon: string; title: string; detail: string; action: string; go: string }

/** "What should I study today?" — one ordered list with one button per task. */
export default function TodayPlan() {
  const store = useStore();
  const tasks = useMemo(() => {
    const out: Task[] = [];
    const st = deckStats(store.questions, store.progress);
    const deckName = (id: string) => store.decks.find((d) => d.id === id)?.name ?? "";

    // 1. Misconceptions first: sure-but-wrong answers are the most damaging.
    const mis = store.questions.filter((q) => { const p = store.progress[q.id]; return p?.lastConf === 2 && !p.lastCorrect; });
    if (mis.length) out.push({ icon: "⚠️", title: `Sửa ${mis.length} hiểu lầm`, detail: "Câu bạn chắc chắn nhưng lại sai — ưu tiên số 1", action: "Sửa ngay", go: "practice/all/misconception" });

    // 2. Spaced review of lessons and questions.
    const dueLessons = store.lessons.filter(lessonDue);
    if (dueLessons.length) out.push({ icon: "🔁", title: `Ôn lại bài: ${dueLessons[0].title}`, detail: `${deckName(dueLessons[0].deckId)}${dueLessons.length > 1 ? ` · còn ${dueLessons.length - 1} bài khác` : ""}`, action: "Ôn bài", go: `deck/${dueLessons[0].deckId}/course/${dueLessons[0].id}` });
    if (st.due) out.push({ icon: "🃏", title: `Ôn ${st.due} câu đến hạn`, detail: "Ôn đúng lúc sắp quên giúp nhớ lâu nhất", action: "Ôn câu hỏi", go: "practice/all/due" });

    // 3. Next new lesson in the most recently active learning path.
    const byDeck = [...new Set(store.lessons.map((l) => l.deckId))]
      .map((id) => ({ id, deck: store.decks.find((d) => d.id === id), lessons: store.lessons.filter((l) => l.deckId === id) }))
      .filter((x) => x.deck)
      .sort((a, b) => b.deck!.updatedAt - a.deck!.updatedAt);
    for (const x of byDeck) {
      const nx = nextLessonOf(x.lessons);
      if (nx) {
        const done = x.lessons.filter((l) => l.mastery >= MASTERED).length;
        out.push({ icon: "📖", title: `Học bài mới: ${nx.title}`, detail: `${x.deck!.name} · đã xong ${done}/${x.lessons.length} bài`, action: nx.mastery > 0 ? "Học tiếp" : "Bắt đầu", go: `deck/${x.id}/course/${nx.id}` });
        break;
      }
    }

    // 4. Thinking exercises not yet passed.
    const weak = store.exercises.filter((e) => e.lastScore != null && e.lastScore < 0.7);
    if (weak.length) out.push({ icon: "🧩", title: `Làm lại ${weak.length} bài tập tư duy chưa đạt`, detail: deckName(weak[0].deckId), action: "Làm lại", go: `deck/${weak[0].deckId}/exercises` });

    // 5. Nothing structured yet: guide the first step.
    if (!out.length && store.decks.length && !store.lessons.length) {
      const d = store.decks[0];
      out.push({ icon: "🗺️", title: `Lập lộ trình học cho “${d.name}”`, detail: "Chia giáo trình thành từng bài, học theo thứ tự", action: "Lập lộ trình", go: `deck/${d.id}/course` });
    }
    return out.slice(0, 5);
  }, [store.questions, store.progress, store.lessons, store.exercises, store.decks]);

  if (!store.decks.length) return null;
  return (
    <div className="today card">
      <div className="row between">
        <h2>📋 Hôm nay học gì?</h2>
        <span className="muted small">{tasks.length ? `${tasks.length} việc, làm lần lượt từ trên xuống` : ""}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="muted">🎉 Bạn đã xong mọi việc cần ôn hôm nay. Muốn học thêm? Mở một bộ đề và làm <b>Bài tập tư duy</b> nhé.</p>
      ) : (
        <ol className="today-list">
          {tasks.map((t, i) => (
            <li key={i}>
              <span className="today-icon">{t.icon}</span>
              <span className="grow"><b>{t.title}</b><small>{t.detail}</small></span>
              <button className={"btn " + (i === 0 ? "primary" : "")} onClick={() => go(t.go)}>{t.action}</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
