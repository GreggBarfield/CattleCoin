import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, Shield, TrendingUp, Beef } from "lucide-react";
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
      <header className="border-b border-border px-6 h-14 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">CattleCoin</span>
        <Link to="/login">
          <Button variant="outline" size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="flex-1 px-4 py-10 text-center sm:px-6">
        <section className="mx-auto max-w-3xl">
          <div className="rounded-[2rem] border border-border bg-card px-6 py-10 shadow-sm sm:px-10 sm:py-14">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Beef className="h-8 w-8 text-primary" />
            </div>

            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Tokenized Cattle Investing
            </p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">
              CattleCoin
            </h1>
            <p className="mt-5 text-xl leading-8 text-muted-foreground">
              The transparent marketplace connecting ranchers, feedlots, and
              investors through tokenized cattle herds.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/login">
                <Button size="lg" className="gap-2 px-8 text-base">
                  Get started <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="px-8 text-base">
                  See How It Works
                </Button>
              </a>
              <Link to="/FAQ">
                <Button variant="ghost" size="lg" className="px-6 text-base">
                  Read FAQs
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-12 max-w-5xl text-left">
          <div className="mb-5 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Marketplace Roles
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Who uses CattleCoin
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Beef className="h-5 w-5 text-green-700" />
              </div>
              <h3 className="font-semibold">Ranchers</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                List your herd, register your animals, and choose how much of
                its value to open to investors.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Shield className="h-5 w-5 text-orange-700" />
              </div>
              <h3 className="font-semibold">Feedlots</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Buy cattle from ranchers to finish them, or list a herd you own,
                and decide how much of it opens to investors.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-blue-700" />
              </div>
              <h3 className="font-semibold">Investors</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Browse verified cattle opportunities and buy tokens for the
                portion a producer has opened to investors.
              </p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto mt-12 max-w-5xl scroll-mt-8">
          <div className="mx-auto max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              How It Works
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              A simple way to understand the platform
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              CattleCoin helps ranchers, feedlots, and investors work together.
              Each token stands for a small piece of the investor-open portion of
              a real cattle lot.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4 text-left">
            <div className="rounded-2xl border bg-card p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-700">
                1
              </div>
              <h3 className="text-lg font-semibold">A rancher lists cattle</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The rancher adds herd and animal details so the opportunity can be
                reviewed.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">
                2
              </div>
              <h3 className="text-lg font-semibold">The owner opens a share</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Whoever owns the herd - a rancher or a feedlot - chooses what
                percent of its value to open to investors. No one has to go first.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                3
              </div>
              <h3 className="text-lg font-semibold">Investors buy tokens</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Individual investors buy token pieces of the open portion
                instead of paying for the whole herd.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">
                4
              </div>
              <h3 className="text-lg font-semibold">Everyone tracks progress</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The platform shows herd data, health records, and value updates
                tied to real cattle.
              </p>
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border bg-muted/40 p-6 text-left md:p-8">
            <h3 className="text-xl font-semibold">Why tokenize cattle?</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Whole herds can be expensive. Tokens let the open share be split
              into smaller pieces, which makes it easier for more people to take
              part while staying connected to real ranch operations.
            </p>
            <div className="mt-5">
              <Link to="/FAQ" className="text-sm font-medium text-primary hover:underline">
                Read the full FAQ
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        CattleCoin by BlockTrust Network
      </footer>
    </div>
  );
}
