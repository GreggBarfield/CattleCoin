import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageTitle } from "@/components/layout/PageTitle";
import { InvestorDashboard } from "@/pages/InvestorDashboard";
import { Holdings } from "@/pages/Holdings";
import { PoolDetail } from "@/pages/PoolDetail";
import { CowDetail } from "@/pages/CowDetail";
import { Rancher } from "@/pages/Rancher";
import { MyHerds } from "@/pages/MyHerds";
import { StageUpdate } from "@/pages/StageUpdate";
import { CarcassEntry } from "@/pages/CarcassEntry";
import { Login } from "@/pages/Login";
import { SignUp } from "@/pages/SignUp";
import { Admin } from "@/pages/Admin";
import { FeeSetup } from "@/pages/FeeSetup";
import { HerdOps } from "@/pages/HerdOps";
import { InvestPage } from "@/pages/InvestPage";
import { WelcomePage } from "@/pages/WelcomePage";
import { FAQPage } from "@/pages/FAQPage";
import { NotFound } from "@/pages/NotFound";
import { Account } from "@/pages/Account";
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
          element={<Protected role="rancher"><MyHerds /></Protected>}
        />
        <Route
          path="/rancher/new"
          element={<Protected role="rancher"><Rancher /></Protected>}
        />
        <Route
          path="/rancher/stages"
          element={<Protected role="rancher"><StageUpdate /></Protected>}
        />
        <Route
          path="/rancher/carcass"
          element={<Protected role="rancher"><CarcassEntry /></Protected>}
        />

        {/* Feedlot portal */}
        {/* Fix #14: a feedlot runs its herds with the same screens a rancher
            uses (offers to buy, costs, LRP, sale, stages, payouts), under /feedlot. */}
        <Route
          path="/feedlot"
          element={<Protected role="feedlot"><MyHerds /></Protected>}
        />
        <Route
          path="/feedlot/new"
          element={<Protected role="feedlot"><Rancher /></Protected>}
        />
        <Route
          path="/feedlot/stages"
          element={<Protected role="feedlot"><StageUpdate /></Protected>}
        />
        <Route
          path="/feedlot/carcass"
          element={<Protected role="feedlot"><CarcassEntry /></Protected>}
        />

        {/* Admin portal */}
        <Route
          path="/admin"
          element={<Protected role="admin"><Admin /></Protected>}
        />
        <Route
          path="/admin/fees"
          element={<Protected role="admin"><FeeSetup /></Protected>}
        />
        <Route
          path="/admin/herd-ops"
          element={<Protected role="admin"><HerdOps /></Protected>}
        />

        {/* D8 (fix #10): My Account - any logged-in role, no role restriction. */}
        <Route
          path="/account"
          element={<Protected><Account /></Protected>}
        />

        <Route
          path="/FAQ"
          element={<FAQPage />}
        />
      </Route>

      {/* Catch-all: E2 - a real 404 page for an unknown URL, instead of a
          silent redirect home. NotFound itself offers a way back in. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* E3: keeps the browser tab title in step with the page shown. */}
      <PageTitle />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
