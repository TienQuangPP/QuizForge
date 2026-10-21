import { useMemo } from "react";
import { deckStats, useStore } from "../store";
import { dayKey, useActivity } from "./Dashboard";
import { Empty, fmtDuration, Progress, Stat } from "../ui";

const DAY = 86_400_000;

export default function Stats() {
  const store = useStore();
  const { byDay, streak } = useActivity();
  const all = deckStats(store.questions, store.progress);
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => {
    const t = Date.now() - (27 - i) * DAY;
    return { key: dayKey(t), label: new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }), ...(byDay[dayKey(t)] ?? { answered: 0, correct: 0, seconds: 0 }) };
  }), [byDay]);
  const max = Math.max(1, ...days.map((d) => d.answered));
  const totalTime = store.sessions.reduce((n, s) => n + s.durationSec, 0);
  const totalAnswered = store.sessions.reduce((n, s) => n + s.total, 0);
  const exams = store.sessions.filter((s) => s.mode === "exam").slice(0, 10).reverse();

  // Upcoming review forecast for the next 7 days.
  const forecast = useMemo(() => {
    const f = Array(7).fill(0);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    for (const p of Object.values(store.progress)) {
      if (!p.attempts) continue;
      const d = Math.floor((p.due - start.getTime()) / DAY);
      f[Math.max(0, Math.min(6, d))] += d <= 6 ? 1 : 0;
    }
    return f;
  }, [store.progress]);
  const fmax = Math.max(1, ...forecast);

  if (!store.sessions.length && !all.seen) return <div className="page"><h1>📈 Thống kê</h1><Empty icon="📈" title="Chưa có dữ liệu">Hãy làm vài lượt luyện tập nhé.</Empty></div>;

  return (
    <div className="page">
      <h1>📈 Thống kê</h1>
      <div className="stats-row">
        <Stat label="Câu đã trả lời" value={totalAnswered.toLocaleString()} />
        <Stat label="Thời gian học" value={fmtDuration(totalTime)} />
        <Stat label="Độ chính xác" value={all.seen ? Math.round(all.accuracy * 100) + "%" : "—"} />
        <Stat label="Đã thuộc" value={`${all.mastered}/${all.total}`} tone="good" />
        <Stat label="Chuỗi ngày" value={`🔥 ${streak}`} tone="warm" />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Hoạt động 28 ngày</h3>
          <div className="chart">
            {days.map((d) => (
              <div key={d.key} className="col" title={`${d.label}: ${d.answered} câu, đúng ${d.correct}`}>
                <span className="b total" style={{ height: `${(d.answered / max) * 100}%` }}>
                  <span className="b ok" style={{ height: d.answered ? `${(d.correct / d.answered) * 100}%` : 0 }} />
                </span>
              </div>
            ))}
          </div>
          <div className="row between muted small"><span>{days[0].label}</span><span>Hôm nay</span></div>
          <div className="legend small"><span className="lg ok" /> đúng <span className="lg total" /> sai</div>
        </div>
        <div className="card">
          <h3>Lịch ôn 7 ngày tới</h3>
          <div className="chart">
            {forecast.map((n, i) => (
              <div key={i} className="col" title={`${n} câu`}>
                <span className="b due" style={{ height: `${(n / fmax) * 100}%` }} />
                <small>{i === 0 ? "Nay" : `+${i}`}</small>
              </div>
            ))}
          </div>
          <p className="muted small">Số câu đến hạn ôn theo thuật toán lặp lại ngắt quãng.</p>
        </div>
      </div>

      {exams.length > 1 && (
        <div className="card">
          <h3>Điểm thi thử gần đây</h3>
          <div className="chart">
            {exams.map((s) => (
              <div key={s.id} className="col" title={`${s.correct}/${s.total}`}>
                <span className="b ok" style={{ height: `${(s.correct / s.total) * 100}%` }} />
                <small>{Math.round((s.correct / s.total) * 100) / 10}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>Theo bộ đề</h3>
      <div className="card stack">
        {store.decks.map((d) => {
          const st = deckStats(store.questions.filter((q) => q.deckId === d.id), store.progress);
          return (
            <a key={d.id} className="topic-row" href={`#/deck/${d.id}/stats`}>
              <span className="grow">{d.emoji} {d.name} <span className="muted small">{st.seen}/{st.total} đã học · {st.due} đến hạn</span></span>
              <span className="topic-bar"><Progress value={st.total ? st.mastered / st.total : 0} color={d.color} /></span>
              <b>{st.seen ? Math.round(st.accuracy * 100) + "%" : "—"}</b>
            </a>
          );
        })}
      </div>
    </div>
  );
}
