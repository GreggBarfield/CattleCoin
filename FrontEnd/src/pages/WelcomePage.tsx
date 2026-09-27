import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, Beef, Truck, ShieldCheck, FileCheck2, Umbrella } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, homePathForRole } from "@/context/AuthContext";

export function WelcomePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      navigate(homePathForRole(currentUser), { replace: true });
    }
  }, [currentUser, navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* NAV */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur px-6 h-14 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">CattleCoin</span>
        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="outline" size="sm">Sign in</Button>
          </Link>
          <a href="#pilot">
            <Button size="sm">Request Pilot Access</Button>
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO */}
        <section id="top" className="px-4 py-20 text-center sm:px-6">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
              Started at Texas A&amp;M · Built in College Station, TX
            </span>
            <h1 className="text-4xl font-extrabold tracking-tight leading-[1.05] sm:text-6xl">
              Follow the herd.
              <br />
              Own the outcome.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
              CattleCoin lets ranchers and feedyards raise capital straight from
              investors — no bank loan required — and lets investors follow a
              real herd from pasture to the rail, with a payout tied to how
              well it grades.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href="#pilot">
                <Button size="lg" className="gap-2 px-8 text-base">
                  Request Pilot Access <ArrowRight className="h-5 w-5" />
                </Button>
              </a>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="px-8 text-base">
                  See how it works
                </Button>
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
                Cow-calf ranchers
              </span>
              <span className="rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
                Feeders &amp; feedyards
              </span>
              <span className="rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
                Investors
              </span>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-y border-border bg-card/40 px-4 py-20 sm:px-6 scroll-mt-14">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-xl text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                How it works
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                From the pasture to a payout, in three steps.
              </h2>
            </div>
            <div className="mt-10 grid gap-6 text-left md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-7">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  1
                </div>
                <h3 className="text-lg font-semibold">A producer lists a herd</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  A rancher or feedyard opens capital raising directly to
                  investors, choosing retained ownership or an outright sale.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-7">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  2
                </div>
                <h3 className="text-lg font-semibold">Investors buy fractional shares</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Each token represents a real stake in the herd. Ownership is
                  recorded on-chain; the herd's progress shows in a statement.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-7">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  3
                </div>
                <h3 className="text-lg font-semibold">Payout at the rail</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  When cattle sell, proceeds settle back to the producer and
                  investors, weighted by carcass grade at slaughter.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* TWO OWNERSHIP PATHS */}
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-xl text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Two ownership paths
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Producers choose how ownership works.
              </h2>
            </div>
            <div className="mt-10 grid gap-6 text-left md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card/60 p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Retained ownership
                </p>
                <h3 className="mt-2 text-xl font-semibold">The rancher keeps title.</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The producer keeps title to the animal all the way through
                  the feedlot, which acts only as a paid custodian. Investors
                  hold one continuous position, paid out at slaughter based on
                  carcass grade.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card/60 p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Sold outright
                </p>
                <h3 className="mt-2 text-xl font-semibold">A clean transfer of ownership.</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Ownership transfers to the feedlot at purchase. Investors who
                  backed the original raise close out their position at the
                  sale, in the simpler, more familiar structure.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* BUILT FOR PRODUCERS */}
        <section id="producers" className="border-y border-border bg-card/40 px-4 py-20 sm:px-6 scroll-mt-14">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-xl text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Built for producers
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Two kinds of producers. Both can raise capital.
              </h2>
            </div>
            <div className="mt-10 grid gap-6 text-left md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card p-8">
                <Beef className="h-7 w-7 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">Cow-calf ranchers</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Raise calves and sell. Bring investor capital directly into
                  your operation to grow the herd or invest in genetics,
                  without waiting on a bank.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-8">
                <Truck className="h-7 w-7 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">Feeders &amp; feedyards</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Buy, finish, and sell cattle at volume. Raise investor
                  capital for feed, facilities, and throughput, on top of any
                  custodial work for retained-ownership herds.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* HOW MONEY WORKS */}
        <section id="trust" className="px-4 py-20 sm:px-6 scroll-mt-14">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-xl text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                How money works
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Real cattle. Verifiable ownership. Careful money.
              </h2>
            </div>
            <div className="mt-10 grid gap-8 text-left md:grid-cols-3">
              <div>
                <ShieldCheck className="h-6 w-6 text-primary" />
                <h3 className="mt-3 text-base font-semibold">On-chain herd ownership</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Each herd's token supply is recorded on a public blockchain
                  ledger, so ownership is verifiable independent of our own
                  records.
                </p>
              </div>
              <div>
                <FileCheck2 className="h-6 w-6 text-primary" />
                <h3 className="mt-3 text-base font-semibold">Reviewed fund releases</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Payouts and releases are checked before anything moves —
                  every dollar in and out is a record you can see in your
                  statement.
                </p>
              </div>
              <div>
                <Umbrella className="h-6 w-6 text-primary" />
                <h3 className="mt-3 text-base font-semibold">LRP price protection</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  We're exploring built-in USDA Livestock Risk Protection for
                  the retained-ownership track, to lower price risk for
                  producers and investors alike.
                </p>
                <span className="mt-3 inline-block rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  In development
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* PILOT CTA */}
        <section id="pilot" className="bg-foreground px-4 py-24 text-center sm:px-6 scroll-mt-14">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-5">
            <h2 className="text-3xl font-bold tracking-tight text-background">
              We're preparing a pilot with real feedyards.
            </h2>
            <p className="text-base leading-7 text-background/70">
              If you run a cow-calf operation, a feedyard, or you're an
              investor who wants to follow real cattle from pasture to payout,
              we'd like to talk.
            </p>
            <Link to="/signup">
              <Button size="lg" className="mt-2 bg-background px-8 text-base text-foreground hover:bg-background/90">
                Request Pilot Access
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        CattleCoin by BlockTrust Network
      </footer>
    </div>
  );
}
