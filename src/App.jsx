import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ParentDiary from "./pages/ParentDiary.jsx";
import AppLayout from "./components/AppLayout.jsx";
import { CaregiverProvider } from "./context/CaregiverContext.jsx";
import { useCaregiver } from "./context/CaregiverContext.jsx";
import { ProfileProvider } from "./context/ProfileContext.jsx";
import { useNativeRecordingSync } from "./hooks/useNativeRecordingSync.js";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useCaregiver();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AccountProfileProvider({ children }) {
  const { caregiverId } = useCaregiver();
  return <ProfileProvider key={caregiverId ?? "guest"}>{children}</ProfileProvider>;
}

function NativeRecordingSync() {
  const { caregiverId } = useCaregiver();
  useNativeRecordingSync(caregiverId);
  return null;
}

export default function App() {
  return (
    <CaregiverProvider>
      <NativeRecordingSync />
      <AccountProfileProvider>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <AppLayout active="dashboard">
                    <Dashboard />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/parent-diary"
              element={
                <ProtectedRoute>
                  <AppLayout active="parent-diary">
                    <ParentDiary />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </AccountProfileProvider>
    </CaregiverProvider>
  );
}
