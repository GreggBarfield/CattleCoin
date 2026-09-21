import { NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  User,
  Warehouse,
  Tractor,
  LogOut,
  CircleHelp,
  Wallet,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();

  const investorMatch = useMatch("/investor/:slug/*");
  const urlSlug = investorMatch?.params?.slug;

  const sectionLabel = location.pathname.startsWith("/admin")
    ? "Administrator Portal"
    : location.pathname.startsWith("/rancher")
      ? "Rancher Portal"
      : location.pathname.startsWith("/feedlot")
        ? "Feedlot Portal"
        : location.pathname.startsWith("/FAQ")
          ? "FAQ"
          : urlSlug
            ? `Investor Portal - ${urlSlug}`
            : "Portal";

  const investorSlug = currentUser?.role === "investor" ? currentUser.slug : "";

  const navItems = [
    ...(currentUser?.role === "investor"
      ? [
          {
            to: `/investor/${investorSlug}/dashboard`,
            label: "Dashboard",
            icon: LayoutDashboard,
            end: true,
          },
          {
            to: `/investor/${investorSlug}/holdings`,
            label: "Marketplace",
            icon: Warehouse,
            end: false,
          },
          {
            to: `/investor/${investorSlug}/money`,
            label: "My Money",
            icon: Wallet,
            end: false,
          },
        ]
      : []),
    ...(currentUser?.role === "rancher"
      ? [{ to: "/rancher", label: "My Herds", icon: User, end: false }]
      : []),
    ...(currentUser?.role === "feedlot"
      ? [{ to: "/feedlot", label: "Feedlot", icon: Tractor, end: false }]
      : []),
    ...(currentUser?.role === "admin"
      ? [{ to: "/admin", label: "Admin", icon: Settings, end: false }]
      : []),
  ];

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
        <div className="flex h-14 items-center px-4">
          <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
            CattleCoin
          </span>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 px-2 py-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-4 py-3 space-y-2">
          <NavLink
            to="/FAQ"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )
            }
          >
            <CircleHelp className="h-4 w-4" />
            FAQ
          </NavLink>

          {currentUser && (
            <div className="text-xs text-muted-foreground truncate">
              <span className="font-medium text-foreground">{currentUser.slug}</span>
              <span className="ml-1 capitalize text-muted-foreground">
                ({currentUser.role})
              </span>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-0 text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-6">
          <h1 className="text-sm font-semibold md:hidden">CattleCoin</h1>
          <div className="ml-auto flex items-center gap-4">
            <span className="text-xs text-muted-foreground">{sectionLabel}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
