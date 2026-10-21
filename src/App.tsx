import { useMemo } from "react";
import { useStore } from "./store";
import { useHashRoute } from "./ui";
import { aiReady, currentModel, PROVIDER_LABEL } from "./ai";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import DeckPage from "./pages/DeckPage";
import Studio from "./pages/Studio";
import ImportPage from "./pages/ImportPage";
import { PracticeSetup, Player } from "./pages/Practice";
import Tutor from "./pages/Tutor";
import Stats from "./pages/Stats";
import SettingsPage from "./pages/SettingsPage";

const NAV = [
  { path: "", icon: "🏠", label: "Tổng quan" },
  { path: "library", icon: "📚", label: "Thư viện" },
  { path: "studio", icon: "✨", label: "Tạo đề bằng AI" },
  { path: "import", icon: "📥", label: "Nhập câu hỏi" },
  { path: "practice", icon: "🎯", label: "Luyện tập" },
  { path: "tutor", icon: "🤖", label: "Gia sư AI" },
  { path: "stats", icon: "📈", label: "Thống kê" },
  { path: "settings", icon: "⚙️", label: "Cài đặt" },
];

export default function App() {
  const store = useStore();
  const [route] = useHashRoute();
  const [page, arg] = route;
  const ai = aiReady(store.settings);

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
      case "settings": return <SettingsPage />;
      default: return <Dashboard />;
    }
  }, [page, arg, route]);

  if (!store.ready) return <div className="boot">⚡ Đang tải QuizForge…</div>;
  const playing = page === "play";
  const active = page ?? "";

  return (
    <div className={"shell" + (playing ? " focus" : "")}>
      {!playing && (
        <aside className="side">
          <a className="brand" href="#/">
            <span className="logo">⚡</span>
            <span>
              <b>QuizForge</b>
              <small>Mọi giáo trình → trắc nghiệm</small>
            </span>
          </a>
          <nav>
            {NAV.map((n) => (
              <a key={n.path} href={"#/" + n.path} className={active === n.path || (n.path === "library" && active === "deck") ? "active" : ""}>
                <span className="nav-ic">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </a>
            ))}
          </nav>
          <a href="#/settings" className={"ai-chip " + (ai ? "on" : "off")} title={ai ? currentModel(store.settings) : "Chưa cấu hình AI"}>
            <span className="dot" />
            {ai ? (
              <span>
                {PROVIDER_LABEL[store.settings.provider]}
                <small>{currentModel(store.settings)}</small>
              </span>
            ) : (
              <span>
                Chưa kết nối AI<small>Bấm để nhập API key</small>
              </span>
            )}
          </a>
        </aside>
      )}
      <main className="main">{view}</main>
      <div className="toasts">
        {store.toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
