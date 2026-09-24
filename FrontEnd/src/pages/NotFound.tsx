import { Link } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, homePathForRole } from "@/context/AuthContext";

// E2: the app used to silently redirect any unknown URL straight home (or to
// /login), with no indication that the page it was actually asked for
// doesn't exist. This is what the catch-all route in App.tsx renders
// instead, for anyone still logged in or not.
export function NotFound() {
  const { currentUser } = useAuth();
  const homePath = currentUser ? homePathForRole(currentUser) : "/login";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <CircleHelp className="h-8 w-8 text-primary" />
      </div>
      <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        404
      </p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        The page you're looking for doesn't exist, or the link may be out of date.
      </p>
      <Link to={homePath} className="mt-8">
        <Button>{currentUser ? "Back to my dashboard" : "Back to sign in"}</Button>
      </Link>
    </div>
  );
}
