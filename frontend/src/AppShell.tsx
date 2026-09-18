import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

// アプリ全体の骨格。左のNavigation（サイドバー/モバイルではボトムナビ）は常にマウントされたまま、
// 右側のMain Contentだけがrouteに応じて切り替わる。「掘る」⇄「自分の理解」の行き来で
// ヘッダー位置や幅が変わってガタつく問題を避けるため、Navigationと各Pageを分離している。
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <h1 className="brand">
          <img className="brand-icon" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
          Digger
        </h1>
        <p className="tagline">掘って、繋がる、私の理解</p>

        <nav className="app-nav">
          <NavLink to="/dig" className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}>
            掘る
          </NavLink>
          <NavLink
            to="/understanding"
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            自分の理解
          </NavLink>
        </nav>
      </aside>

      {/* サイドバーが隠れるモバイル幅でも、ブランドだけは見失わないよう軽量なヘッダーを出す
          （デスクトップでは.app-sidebarに同じ内容があるため、CSSで非表示にする）。 */}
      <h1 className="brand app-mobile-header">
        <img className="brand-icon" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
        Digger
      </h1>

      <main className="app-main">{children}</main>

      <nav className="app-bottom-nav">
        <NavLink to="/dig" className={({ isActive }) => (isActive ? "app-bottom-nav-link active" : "app-bottom-nav-link")}>
          掘る
        </NavLink>
        <NavLink
          to="/understanding"
          className={({ isActive }) => (isActive ? "app-bottom-nav-link active" : "app-bottom-nav-link")}
        >
          自分の理解
        </NavLink>
      </nav>
    </div>
  );
}
