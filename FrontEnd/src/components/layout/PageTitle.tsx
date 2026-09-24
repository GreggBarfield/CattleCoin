import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pageTitleFor } from "@/lib/pageTitle";

// E3: keeps the browser tab title in step with the page being shown. Renders
// nothing - mount it once, inside the router.
export function PageTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = pageTitleFor(pathname);
  }, [pathname]);

  return null;
}
