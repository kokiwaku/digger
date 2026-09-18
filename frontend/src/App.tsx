import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import AppShell from "./AppShell";
import DigPage from "./DigPage";
import UnderstandingPage from "./UnderstandingPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dig" replace />} />
        <Route path="/dig" element={<DigPage />} />
        <Route path="/understanding/*" element={<UnderstandingPage />} />
      </Routes>
    </AppShell>
  );
}
