import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ParentDiary from "./pages/ParentDiary.jsx";
import AppLayout from "./components/AppLayout.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <AppLayout active="dashboard">
              <Dashboard />
            </AppLayout>
          }
        />
        <Route
          path="/parent-diary"
          element={
            <AppLayout active="parent-diary">
              <ParentDiary />
            </AppLayout>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  );
}
