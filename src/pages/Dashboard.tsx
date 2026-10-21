import { useMemo } from "react";
import { deckStats, useStore } from "../store";
import { aiReady } from "../ai";
import { go, Progress, Stat, timeAgo } from "../ui";
import { SAMPLE_DECK } from "../sample";

const DAY = 86_400_000;
export const dayKey = (t: number) => new Date(t).toLocaleDateString("sv-SE");

export function useActivity() {
  const { sessions } = useStore();
  return useMemo(() => {
    const byDay: Record<string, { answered: number; correct: number; seconds: number }> = {};
    for (const s of sessions) {
      const k = dayKey(s.at);
      byDay[k] ??= { answered: 0, correct: 0, seconds: 0 };
      byDay[k].answered += s.total;
      byDay[k].correct += s.correct;
      byDay[k].seconds += s.durationSec;
    }
    // Streak stays alive if today has no activity yet but yesterday did.
    let streak = 0;
    let t = byDay[dayKey(Date.now())]?.answered ? Date.now() : Date.now() - DAY;
    while (byDay[dayKey(t)]?.answered) {
      streak++;
      t -= DAY;
    }
    return { byDay, streak, today: byDay[dayKey(Date.now())] ?? { answered: 0, correct: 0, seconds: 0 } };
  }, [sessions]);
}

export default function Dashboard() {
  const store = useStore();
  const { decks, questions, progress, settings, sessions } = store;
  const all = deckStats(questions, progress);
  const { streak, today } = useActivity();
  const goalPct = Math.min(1, today.answered / Math.max(1, settings.dailyGoal));
  const ai = aiReady(settings);

  const createSample = async () => {
    const d = await store.createDeck({ name: SAMPLE_DECK.name, description: SAMPLE_DECK.description, emoji: "🧭" });
    await store.addQuestions(d.id, SAMPLE_DECK.questions);
    store.toast("Đã tạo bộ mẫu — thử luyện tập ngay!");
    go("deck/" + d.id);
  };

  const hour = new Date().getHours();
  const hello = hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>{hello} 👋</h1>
          <p className="muted">Tải lên bất kỳ giáo trình nào (PDF, Word, PowerPoint, ảnh…) — AI sẽ biến nó thành bộ trắc nghiệm để bạn luyện.</p>
          <div className="row gap">
            <button className="btn primary" onClick={() => go("studio")}>✨ Tạo đề từ giáo trình</button>
            <button className="btn" onClick={() => go("import")}>📥 Nhập câu hỏi có sẵn</button>
            {all.due > 0 && <button className="btn accent" onClick={() => go("practice/all/due")}>🔁 Ôn {all.due} câu đến hạn</button>}
          </div>
        </div>
        <div className="goal-ring" style={{ ["--p" as any]: goalPct }}>
          <div>
            <b>{today.answered}</b>
            <small>/ {settings.dailyGoal} câu hôm nay</small>
          </div>
        </div>
      </div>

      {!ai && (
        <div className="callout warn">
          <b>Chưa kết nối AI.</b> Bạn vẫn dùng được mọi tính năng nhập/luyện đề. Để AI tự tạo câu hỏi, giải thích và làm gia sư, hãy{" "}
          <a href="#/settings">nhập API key ChatGPT hoặc Gemini</a> (Gemini có gói miễn phí).
        </div>
      )}

      <div className="stats-row">
        <Stat label="Bộ đề" value={decks.length} />
        <Stat label="Câu hỏi" value={all.total} />
        <Stat label="Đã thuộc" value={all.mastered} sub={all.total ? `${Math.round((all.mastered / all.total) * 100)}%` : undefined} tone="good" />
        <Stat label="Độ chính xác" value={all.seen ? Math.round(all.accuracy * 100) + "%" : "—"} />
        <Stat label="Chuỗi ngày" value={`🔥 ${streak}`} tone="warm" />
      </div>

      <div className="section-head">
        <h2>Bộ đề gần đây</h2>
        <a href="#/library">Xem tất cả →</a>
      </div>
      {decks.length === 0 ? (
        <div className="card center">
          <p>Bạn chưa có bộ đề nào.</p>
          <div className="row gap center">
            <button className="btn primary" onClick={() => go("studio")}>✨ Tạo bằng AI</button>
            <button className="btn" onClick={() => go("library/new")}>＋ Tạo bộ trống</button>
            <button className="btn ghost" onClick={createSample}>🧭 Dùng thử bộ mẫu</button>
          </div>
        </div>
      ) : (
        <div className="deck-grid">
          {decks.slice(0, 6).map((d) => {
            const st = deckStats(questions.filter((q) => q.deckId === d.id), progress);
            return (
              <a key={d.id} className="deck-card" href={"#/deck/" + d.id} style={{ ["--c" as any]: d.color }}>
                <div className="deck-emoji">{d.emoji}</div>
                <div className="deck-name">{d.name}</div>
                <div className="muted small">{st.total} câu · cập nhật {timeAgo(d.updatedAt)}</div>
                <Progress value={st.total ? st.mastered / st.total : 0} color={d.color} />
                <div className="small muted">
                  Đã học {st.seen}/{st.total} {st.due > 0 && <span className="pill warn">{st.due} đến hạn</span>}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="section-head">
            <h2>Lượt làm gần đây</h2>
            <a href="#/stats">Thống kê →</a>
          </div>
          <div className="card list">
            {sessions.slice(0, 5).map((s) => (
              <div key={s.id} className="list-row">
                <span>{s.mode === "exam" ? "📝 Thi thử" : s.mode === "flash" ? "🃏 Thẻ nhớ" : "🎯 Luyện tập"}</span>
                <span className="muted">{s.deckIds.map((id) => decks.find((d) => d.id === id)?.name ?? "—").join(", ")}</span>
                <b className={s.correct / s.total >= 0.8 ? "good" : s.correct / s.total >= 0.5 ? "" : "bad"}>
                  {s.correct}/{s.total}
                </b>
                <span className="muted small">{timeAgo(s.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
