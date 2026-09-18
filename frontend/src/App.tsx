import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import AppShell from "./AppShell";
import DigPage from "./DigPage";
import { ConceptDigPage, TopicDigPage } from "./EntityDigPage";
import UnderstandingPage from "./UnderstandingPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dig" replace />} />
        <Route path="/dig" element={<DigPage />} />
        {/* 「自分の理解」画面のConcept/Topicを起点に、既存の理解からさらに掘るための画面。
            通常のComposer（URL/text/image起点）とは別ルートにし、直接URLアクセス・
            リロードでも動作するようにしている（EntityDigPage.tsx参照）。 */}
        <Route path="/dig/concept/:conceptId" element={<ConceptDigPage />} />
        <Route path="/dig/topic/:topicId" element={<TopicDigPage />} />
        <Route path="/understanding/*" element={<UnderstandingPage />} />
      </Routes>
    </AppShell>
  );
}
