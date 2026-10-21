import { useStore } from "../store";
import { ACHIEVEMENTS } from "../game";
import { LevelCard } from "./Dashboard";

export default function Achievements() {
  const { game } = useStore();
  const got = ACHIEVEMENTS.filter((a) => game.unlocked[a.id]).length;
  return (
    <div className="page narrow">
      <h1>🏆 Thành tích</h1>
      <p className="muted">Mỗi câu trả lời đúng được <b>+10 XP</b> (thêm thưởng khi có combo), mỗi huy hiệu <b>+50 XP</b>. Lên cấp để mở danh hiệu mới!</p>
      <LevelCard />
      <div className="stats-row">
        <div className="stat"><div className="stat-value">{got}/{ACHIEVEMENTS.length}</div><div className="stat-label">Huy hiệu</div></div>
        <div className="stat warm"><div className="stat-value">🔥 x{game.bestCombo}</div><div className="stat-label">Combo cao nhất</div></div>
        <div className="stat"><div className="stat-value">⚡ {game.bestSpeed}</div><div className="stat-label">Kỷ lục Đua tốc độ</div></div>
        <div className="stat"><div className="stat-value">❤️ {game.bestSurvival}</div><div className="stat-label">Kỷ lục Sinh tồn</div></div>
      </div>
      <div className="badge-grid">
        {ACHIEVEMENTS.map((a) => {
          const at = game.unlocked[a.id];
          return (
            <div key={a.id} className={"badge-card" + (at ? " got" : "")}>
              <div className="badge-icon">{at ? a.icon : "🔒"}</div>
              <b>{a.title}</b>
              <small>{a.desc}</small>
              {at && <small className="muted">Đạt ngày {new Date(at).toLocaleDateString("vi-VN")}</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
