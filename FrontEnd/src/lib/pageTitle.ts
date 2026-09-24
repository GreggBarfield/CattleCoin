// E3: one browser-tab title format for the whole app - "<Page> - CattleCoin".
// The brand is always "CattleCoin" (never "Cattle Token"). A page that isn't in
// the list below (an unknown URL) gets the "Page not found" title, matching the
// real 404 page the router shows for it.

export const BRAND = "CattleCoin";

// Exact-match routes, checked in order. Each pattern is compared against the
// lower-cased path with any trailing slash removed, so "/FAQ" and "/faq" both
// match (the router treats them the same way).
const ROUTE_TITLES: Array<[RegExp, string | null]> = [
  [/^\/$/, null], // Welcome page: just the brand
  [/^\/login$/, "Sign in"],
  [/^\/signup$/, "Create account"],

  [/^\/investor\/[^/]+\/dashboard$/, "Dashboard"],
  [/^\/investor\/[^/]+\/holdings$/, "Marketplace"],
  [/^\/investor\/[^/]+\/holdings\/[^/]+$/, "Herd details"],
  [/^\/investor\/[^/]+\/cow\/[^/]+$/, "Animal details"],
  [/^\/investor\/[^/]+\/money$/, "My Money"],
  [/^\/investor\/[^/]+\/statements\/[^/]+$/, "Settlement statement"],
  [/^\/invest\/[^/]+$/, "Invest"],

  [/^\/rancher$/, "My Herds"],
  [/^\/rancher\/new$/, "Post a Lot"],
  [/^\/rancher\/stages$/, "Herd Stages"],

  [/^\/feedlot$/, "My Herds"],
  [/^\/feedlot\/new$/, "Post a Lot"],
  [/^\/feedlot\/stages$/, "Herd Stages"],
  [/^\/feedlot\/carcass$/, "Carcass Records"],

  [/^\/admin$/, "Admin"],
  [/^\/admin\/fees$/, "Fee setup"],
  [/^\/admin\/herd-ops$/, "Herd operations"],

  [/^\/account$/, "My Account"],
  [/^\/faq$/, "FAQ"],
];

/** The tab title for a URL path, e.g. "/rancher" -> "My Herds - CattleCoin". */
export function pageTitleFor(pathname: string): string {
  const path = (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname).toLowerCase() || "/";
  for (const [pattern, label] of ROUTE_TITLES) {
    if (pattern.test(path)) return label ? `${label} - ${BRAND}` : BRAND;
  }
  return `Page not found - ${BRAND}`;
}
