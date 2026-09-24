import { useState } from "react";
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Settings,
  User,
  Warehouse,
  LogOut,
  CircleHelp,
  Wallet,
  Milestone,
  ClipboardList,
  PlusCircle,
  Menu,
  UserCog,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

type NavItem = {
  to: string;
  label: string;
  icon: typeof User;
  end: boolean;
};

type CurrentUser = { slug: string; role: string };

// The sidebar's nav links, FAQ link, user line and Sign out button - shared
// between the always-visible desktop sidebar and the mobile drawer (E1) so
// both stay in sync with one definition.
function SidebarNavContent({
  navItems,
  currentUser,
  onLogout,
  onNavigate,
}: {
  navItems: NavItem[];
  currentUser: CurrentUser | null | undefined;
  onLogout: () => void;
  // E1: only the mobile drawer instance passes this, to close itself the
  // moment a link is clicked - the desktop sidebar has no drawer to close,
  // so it leaves this out.
  onNavigate?: () => void;
}) {
  return (
    <>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
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
        {/* D8 (fix #10): every logged-in role gets its own account page. */}
        {currentUser && (
          <NavLink
            to="/account"
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )
            }
          >
            <UserCog className="h-4 w-4" />
            My Account
          </NavLink>
        )}

        <NavLink
          to="/FAQ"
          end
          onClick={onNavigate}
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
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const investorMatch = useMatch("/investor/:slug/*");
  const urlSlug = investorMatch?.params?.slug;

  // E4: on the FAQ page, keep whichever portal the person is logged into in
  // the label instead of replacing it outright - a rancher who follows the
  // FAQ link from their portal still sees "Rancher Portal - FAQ", not just
  // the unqualified "FAQ" (which is still what a signed-out visitor sees).
  const roleLabel =
    currentUser?.role === "admin"
      ? "Administrator Portal"
      : currentUser?.role === "rancher"
        ? "Rancher Portal"
        : currentUser?.role === "feedlot"
          ? "Feedlot Portal"
          : currentUser?.role === "investor"
            ? "Investor Portal"
            : null;

  const sectionLabel = location.pathname.startsWith("/admin")
    ? "Administrator Portal"
    : location.pathname.startsWith("/rancher")
      ? "Rancher Portal"
      : location.pathname.startsWith("/feedlot")
        ? "Feedlot Portal"
        : location.pathname.startsWith("/FAQ")
          ? roleLabel
            ? `${roleLabel} - FAQ`
            : "FAQ"
          : location.pathname.startsWith("/account")
            ? roleLabel
              ? `${roleLabel} - My Account`
              : "My Account"
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
      ? [
          { to: "/rancher", label: "My Herds", icon: User, end: true },
          { to: "/rancher/new", label: "Post a Lot", icon: PlusCircle, end: false },
          { to: "/rancher/stages", label: "Herd Stages", icon: Milestone, end: false },
        ]
      : []),
    ...(currentUser?.role === "feedlot"
      ? [
          { to: "/feedlot", label: "My Herds", icon: User, end: true },
          { to: "/feedlot/new", label: "Post a Lot", icon: PlusCircle, end: false },
          { to: "/feedlot/stages", label: "Herd Stages", icon: Milestone, end: false },
          { to: "/feedlot/carcass", label: "Carcass Records", icon: ClipboardList, end: false },
        ]
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
        <SidebarNavContent navItems={navItems} currentUser={currentUser} onLogout={handleLogout} />
      </aside>

      {/* E1: mobile nav drawer - the desktop sidebar above is hidden below md,
          so this is the only way to reach the nav links, FAQ and Sign out on
          a phone. Opened by the header's menu button, closed by its own X
          button, the overlay, Escape, or clicking any link inside it
          (SidebarNavContent's onNavigate below). */}
      <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 md:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar md:hidden"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Navigation menu</Dialog.Title>
            <div className="flex h-14 items-center justify-between px-4">
              <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
                CattleCoin
              </span>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" className="px-2" aria-label="Close menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </Dialog.Close>
            </div>
            <Separator />
            <SidebarNavContent
              navItems={navItems}
              currentUser={currentUser}
              onLogout={handleLogout}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mr-2 px-2 md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
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
