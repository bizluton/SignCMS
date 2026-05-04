import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ChatPage    from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-full max-w-lg mx-auto relative overflow-hidden">
        <Routes>
          <Route path="/"         element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
