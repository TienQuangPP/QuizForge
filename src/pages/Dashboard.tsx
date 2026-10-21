import { useMemo, useState } from "react";
import { deckStats, useStore } from "../store";
import { aiReady } from "../ai";
import { go, Progress, Stat, timeAgo } from "../ui";
import { SAMPLE_DECK } from "../sample";
import { levelOf, levelTitle, xpForLevel } from "../game";
import { discardSavedRun, loadSavedRun, MODE_INFO, startDaily } from "./Practice";
import TodayPlan from "./TodayPlan";

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
    const answered = sessions.reduce((n, s) => n + s.total, 0);
    return { byDay, streak, answered, today: byDay[dayKey(Date.now())] ?? { answered: 0, correct: 0, seconds: 0 } };
  }, [sessions]);
}

export function LevelCard({ compact }: { compact?: boolean }) {
  const { game } = useStore();
  const lv = levelOf(game.xp);
  const t = levelTitle(lv);
  const from = xpForLevel(lv), to = xpForLevel(lv + 1);
  return (
    <a className={"level-card" + (compact ? " compact" : "")} href="#/achievements" title="Xem thành tích">
      <span className="level-badge">{t.icon}</span>
      <span className="grow">
        <b>Cấp {lv} · {t.name}</b>
        <Progress value={(game.xp - from) / (to - from)} />
        <small>{game.xp - from}/{to - from} XP lên cấp {lv + 1}</small>
      </span>
    </a>
  );
}

export default function Dashboard() {
  const store = useStore();
  const { decks, questions, progress, settings, sessions, game } = store;
  const all = deckStats(questions, progress);
  const { streak, today } = useActivity();
  // Count questions touched today too, so an unfinished quiz still moves the ring.
  const todayCount = useMemo(() => {
    const k = dayKey(Date.now());
    const touched = Object.values(progress).filter((p) => p.attempts && dayKey(p.lastAt) === k).length;
    return Math.max(today.answered, touched);
  }, [progress, today.answered]);
  const goalPct = Math.min(1, todayCount / Math.max(1, settings.dailyGoal));
  const ai = aiReady(settings);
  const [saved, setSaved] = useState(() => {
    const s = loadSavedRun();
    // A paused quiz whose questions were all deleted can't be resumed.
    if (s && !s.run.items.some((it) => questions.some((q) => q.id === it.id))) {
      discardSavedRun();
      return null;
    }
    return s;
  });
  const dailyDone = game.dailyDone === dayKey(Date.now());
  const lastBackup = +(localStorage.getItem("quizforge-last-backup") || 0);
  const needBackup = questions.length >= 20 && Date.now() - lastBackup > 14 * DAY;

  const createSample = async () => {
    const d = await store.createDeck({ name: SAMPLE_DECK.name, description: SAMPLE_DECK.description, emoji: "🧭" });
    await store.addQuestions(d.id, SAMPLE_DECK.questions);
    store.toast("Đã tạo bộ mẫu — bấm Luyện tập để thử!");
    go("deck/" + d.id);
  };

  const hour = new Date().getHours();
  const hello = hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  return (
    <div className="page">
      <div className="hero">
        <div className="grow">
          <h1>{hello} 👋</h1>
          <p className="muted">Đưa tài liệu học vào, AI sẽ biến nó thành câu hỏi trắc nghiệm để bạn luyện và nhớ lâu.</p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => go("studio")}>✨ Tạo đề từ tài liệu</button>
            <button className="btn" onClick={() => go("import")}>📥 Nhập câu hỏi có sẵn</button>
            {all.due > 0 && <button className="btn accent" onClick={() => go("practice/all/due")}>🔁 Ôn {all.due} câu đến hạn</button>}
          </div>
        </div>
        <div className="goal-ring" style={{ ["--p" as any]: goalPct }} title="Mục tiêu hôm nay — đổi trong Cài đặt">
          <div>
            <b>{todayCount}</b>
            <small>/ {settings.dailyGoal} câu<br />hôm nay</small>
          </div>
        </div>
      </div>

      {saved && (
        <div className="callout resume">
          <span className="grow">
            ⏸️ Bạn đang làm dở <b>{saved.run.title}</b> ({MODE_INFO[saved.run.mode].title}, câu {saved.idx + 1}/{saved.run.items.length})
          </span>
          <button className="btn primary sm" onClick={() => go("play")}>▶ Làm tiếp</button>
          <button className="btn ghost sm" onClick={() => { discardSavedRun(); setSaved(null); }}>Bỏ bài này</button>
        </div>
      )}

      {!ai && (
        <div className="callout warn">
          <b>Chưa kết nối AI.</b> Bạn vẫn luyện và nhập đề bình thường được. Muốn AI tự soạn câu hỏi từ tài liệu thì{" "}
          <a href="#/settings">làm theo 5 bước hướng dẫn tại đây</a> (miễn phí với Gemini).
        </div>
      )}
      {needBackup && (
        <div className="callout">
          💾 Đã lâu bạn chưa sao lưu. Dữ liệu chỉ nằm trong trình duyệt này — <a href="#/settings">bấm vào đây để sao lưu</a> phòng khi máy hỏng hoặc xoá lịch sử duyệt web.
        </div>
      )}

      <TodayPlan />

      <div className="dash-grid">
        <LevelCard />
        {questions.length > 0 && (
          <div className={"daily" + (dailyDone ? " done" : "")}>
            <div className="daily-icon">{dailyDone ? "✅" : "🎯"}</div>
            <div className="grow">
              <b>Thử thách hôm nay</b>
              <small>{dailyDone ? `Đã hoàn thành! Đã làm ${game.dailyCount} thử thách. Quay lại ngày mai nhé.` : "10 câu chọn riêng cho bạn · thưởng +100 XP"}</small>
            </div>
            {!dailyDone && <button className="btn primary" onClick={() => startDaily(questions, progress)}>Chơi</button>}
          </div>
        )}
      </div>

      <div className="stats-row">
        <Stat label="Chuỗi ngày học" value={`🔥 ${streak}`} tone="warm" />
        <Stat label="Câu hỏi" value={all.total} sub={`${decks.length} bộ đề`} />
        <Stat label="Đã thuộc" value={all.mastered} sub={all.total ? `${Math.round((all.mastered / all.total) * 100)}% tổng số` : undefined} tone="good" />
        <Stat label="Độ chính xác" value={all.seen ? Math.round(all.accuracy * 100) + "%" : "—"} />
      </div>

      <div className="section-head">
        <h2>Bộ đề của bạn</h2>
        <a href="#/library">Xem tất cả →</a>
      </div>
      {decks.length === 0 ? (
        <div className="card center start-cards">
          <h3>Bắt đầu thế nào?</h3>
          <div className="start-grid">
            <button className="start" onClick={createSample}><span>🧭</span><b>Dùng thử ngay</b><small>Mở bộ câu hỏi mẫu để xem app hoạt động ra sao</small></button>
            <button className="start" onClick={() => go("studio")}><span>✨</span><b>Tôi có tài liệu</b><small>PDF, Word, PowerPoint… để AI ra câu hỏi</small></button>
            <button className="start" onClick={() => go("import")}><span>📥</span><b>Tôi có sẵn câu hỏi</b><small>File Excel, Word hoặc ảnh chụp đề</small></button>
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
                  Đã học {st.seen}/{st.total} {st.due > 0 && <span className="pill warn">{st.due} cần ôn</span>}
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
                <span>{MODE_INFO[s.mode]?.icon} {s.daily ? "Thử thách ngày" : MODE_INFO[s.mode]?.title}</span>
                <span className="muted">{s.deckIds.map((id) => decks.find((d) => d.id === id)?.name ?? "—").join(", ")}</span>
                <b className={s.correct / s.total >= 0.8 ? "good" : s.correct / s.total >= 0.5 ? "" : "bad"}>{s.correct}/{s.total}</b>
                <span className="muted small">{timeAgo(s.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
