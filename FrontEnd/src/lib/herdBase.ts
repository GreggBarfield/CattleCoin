// Fix #14: a feedlot runs its own herds with the same screens a rancher uses
// (My Herds, Post a Lot, Herd Stages). The screens live at /rancher/... for a
// rancher and /feedlot/... for a feedlot, so each link inside them starts from
// the base path of whoever is logged in.
import { useAuth } from "@/context/AuthContext";

/** "/feedlot" for a feedlot, "/rancher" for everyone else who reaches these screens. */
export function herdBaseFor(role: string | null | undefined): "/feedlot" | "/rancher" {
  return role === "feedlot" ? "/feedlot" : "/rancher";
}

/** The base path for the logged-in person, e.g. `${base}/new` or `${base}/stages`. */
export function useHerdBase(): "/feedlot" | "/rancher" {
  const { currentUser } = useAuth();
  return herdBaseFor(currentUser?.role);
}

/** What an empty herd list says. A feedlot's herds arrive by accepting a sale, so it needs a next step. */
export function noHerdsMessage(role: string | null | undefined): string {
  if (role === "feedlot") {
    return "You don't have any herds yet. A herd shows up here once you accept an offer to buy it and CattleCoin approves the sale, or you can post one of your own.";
  }
  return "You don't have any herds yet.";
}
