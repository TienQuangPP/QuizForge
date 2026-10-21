import { useEffect, useMemo, useState } from "react";
import { deckStats, useStore } from "./store";
import { useHashRoute } from "./ui";
import { aiReady, currentModel, PROVIDER_LABEL } from "./ai";
import Dashboard, { LevelCard, useActivity } from "./pages/Dashboard";
import Library from "./pages/Library";
import DeckPage from "./pages/DeckPage";
import Studio from "./pages/Studio";
import ImportPage from "./pages/ImportPage";
import { PracticeSetup, Player } from "./pages/Practice";
import Tutor from "./pages/Tutor";
import Stats from "./pages/Stats";
import SettingsPage from "./pages/SettingsPage";
import Achievements from "./pages/Achievements";
import Help from "./pages/Help";
import Welcome, { WELCOME_KEY } from "./Welcome";

const NAV = [
  { path: "", icon: "🏠", label: "Trang chủ", mobile: true },
  { path: "library", icon: "📚", label: "Bộ đề", mobile: true },
  { path: "studio", icon: "✨", label: "Tạo đề AI", mobile: true },
  { path: "import", icon: "📥", label: "Nhập câu hỏi" },
  { path: "practice", icon: "🎯", label: "Luyện tập", mobile: true },
  { path: "tutor", icon: "🤖", label: "Gia sư AI" },
  { path: "achievements", icon: "🏆", label: "Thành tích" },
  { path: "stats", icon: "📈", label: "Thống kê" },
  { path: "help", icon: "❓", label: "Hướng dẫn" },
  { path: "settings", icon: "⚙️", label: "Cài đặt", mobile: true },
];

/** Unlocks stat-based achievements whenever the underlying numbers change. */
function GameWatcher() {
  const store = useStore();
  const { streak, answered } = useActivity();
  const mastered = useMemo(() => deckStats(store.questions, store.progress).mastered, [store.questions, store.progress]);
  const { checkAchievements } = store;
  const decks = store.decks.length, questions = store.questions.length;
  useEffect(() => {
    checkAchievements({ answered, streak, mastered, decks, questions });
  }, [answered, streak, mastered, decks, questions, store.game.bestCombo, store.game.bestSpeed, store.game.bestSurvival, store.game.dailyCount, store.game.aiGenerated]); // eslint-disable-line
  return null;
}

export default function App() {
  const store = useStore();
  const [route] = useHashRoute();
  const [page, arg] = route;
  const ai = aiReady(store.settings);
  const [welcome, setWelcome] = useState(() => !localStorage.getItem(WELCOME_KEY));

  const view = useMemo(() => {
    switch (page ?? "") {
      case "": return <Dashboard />;
      case "library": return <Library />;
      case "deck": return <DeckPage id={arg} tab={route[2]} />;
      case "studio": return <Studio deckId={arg} docId={route[2]} />;
      case "import": return <ImportPage deckId={arg} />;
      case "practice": return <PracticeSetup deckId={arg} preset={route[2]} />;
      case "play": return <Player />;
      case "tutor": return <Tutor deckId={arg} />;
      case "stats": return <Stats />;
      case "achievements": return <Achievements />;
      case "help": return <Help />;
      case "settings": return <SettingsPage />;
      default: return <Dashboard />;
    }
  }, [page, arg, route]);

  if (!store.ready) return <div className="boot">⚡ Đang mở QuizForge…</div>;
  const playing = page === "play";
  const active = page ?? "";

  return (
    <div className={"shell" + (playing ? " focus" : "")}>
      <GameWatcher />
      {!playing && (
        <aside className="side">
          <a className="brand" href="#/">
            <span className="logo">⚡</span>
            <span>
              <b>QuizForge</b>
              <small>Mọi giáo trình → trắc nghiệm</small>
            </span>
          </a>
          <div className="side-level"><LevelCard compact /></div>
          <nav>
            {NAV.map((n) => (
              <a key={n.path} href={"#/" + n.path} className={(active === n.path || (n.path === "library" && active === "deck") ? "active" : "") + (n.mobile ? " m" : "")}>
                <span className="nav-ic">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </a>
            ))}
          </nav>
          <a href="#/settings" className={"ai-chip " + (ai ? "on" : "off")} title={ai ? currentModel(store.settings) : "Chưa kết nối AI"}>
            <span className="dot" />
            {ai ? (
              <span>
                AI: {PROVIDER_LABEL[store.settings.provider]}
                <small>{currentModel(store.settings)}</small>
              </span>
            ) : (
              <span>
                Chưa kết nối AI<small>Bấm để xem hướng dẫn</small>
              </span>
            )}
          </a>
        </aside>
      )}
      <main className="main">{view}</main>
      <div className="toasts" role="status" aria-live="polite">
        {store.toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>
            <span className="grow">{t.text}</span>
            {t.action && <button className="toast-btn" onClick={() => { t.action!.run(); store.dismissToast(t.id); }}>{t.action.label}</button>}
            <button className="toast-x" aria-label="Đóng" onClick={() => store.dismissToast(t.id)}>✕</button>
          </div>
        ))}
      </div>
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
    </div>
  );
}
