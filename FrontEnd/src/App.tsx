import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { InvestorDashboard } from "@/pages/InvestorDashboard";
import { Holdings } from "@/pages/Holdings";
import { PoolDetail } from "@/pages/PoolDetail";
import { CowDetail } from "@/pages/CowDetail";
import { Rancher } from "@/pages/Rancher";
import { Login } from "@/pages/Login";
import { SignUp } from "@/pages/SignUp";
import { Admin } from "@/pages/Admin";
import { InvestPage } from "@/pages/InvestPage";
import { FeedlotPage } from "@/pages/FeedlotPage";
import { WelcomePage } from "@/pages/WelcomePage";
import { FAQPage } from "@/pages/FAQPage";
import { MyMoney } from "@/pages/MyMoney";
import { Statement } from "@/pages/Statement";
import { AuthProvider, useAuth, homePathForRole } from "@/context/AuthContext";

// ── Route guard ───────────────────────────────────────────────────────────────
// Redirects to /login if not authenticated.
// Optionally restricts to a specific role; wrong-role users go to their own home.
function Protected({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: string;
}) {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (role && currentUser.role !== role) {
    return <Navigate to={homePathForRole(currentUser)} replace />;
  }
  return <>{children}</>;
}

// ── Inner app (needs AuthContext already mounted) ─────────────────────────────
function AppRoutes() {
  const { currentUser } = useAuth();

  return (
    <Routes>
      {/* Welcome / landing */}
      <Route path="/" element={<WelcomePage />} />

      {/* Auth */}
      <Route path="/login"  element={<Login />} />
      <Route path="/signup" element={<SignUp />} />

      {/* All routes inside the AppShell layout */}
      <Route element={<AppShell />}>
        {/* Investor routes */}
        <Route
          path="/investor/:slug/dashboard"
          element={<Protected role="investor"><InvestorDashboard /></Protected>}
        />
        <Route
          path="/investor/:slug/holdings"
          element={<Protected role="investor"><Holdings /></Protected>}
        />
        <Route
          path="/investor/:slug/holdings/:id"
          element={<Protected role="investor"><PoolDetail /></Protected>}
        />
        <Route
          path="/investor/:slug/cow/:cowId"
          element={<Protected role="investor"><CowDetail /></Protected>}
        />
        <Route
          path="/invest/:herdId"
          element={<Protected role="investor"><InvestPage /></Protected>}
        />

        <Route
          path="/investor/:slug/money"
          element={<Protected role="investor"><MyMoney /></Protected>}
        />
        <Route
          path="/investor/:slug/statements/:saleId"
          element={<Protected role="investor"><Statement /></Protected>}
        />

        {/* Rancher portal */}
        <Route
          path="/rancher"
          element={<Protected role="rancher"><Rancher /></Protected>}
        />

        {/* Feedlot portal */}
        <Route
          path="/feedlot"
          element={<Protected role="feedlot"><FeedlotPage /></Protected>}
        />

        {/* Admin portal */}
        <Route
          path="/admin"
          element={<Protected role="admin"><Admin /></Protected>}
        />

        <Route
          path="/FAQ"
          element={<FAQPage />}
        />
      </Route>

      {/* Catch-all: if logged in go home, otherwise login */}
      <Route
        path="*"
        element={
          currentUser
            ? <Navigate to={homePathForRole(currentUser)} replace />
            : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
