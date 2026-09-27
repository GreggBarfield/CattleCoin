import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homePathForRole } from "@/context/AuthContext";
import {
  ProgressItem,
  ProgressItemContent,
  ProgressItemDescription,
  ProgressItemHeader,
  ProgressItemIndicator,
  ProgressItemSeparator,
  ProgressItemTitle,
} from "@/components/shadcncraft/pro-application/progress-item-1";
import { Hero10 } from "@/components/shadcncraft/pro-marketing/heroes/hero-10";
import { Benefits12 } from "@/components/shadcncraft/pro-marketing/benefits/benefits-12";
import { Benefits7 } from "@/components/shadcncraft/pro-marketing/benefits/benefits-7";
import { Benefits6 } from "@/components/shadcncraft/pro-marketing/benefits/benefits-6";
import { InlineCTA3 } from "@/components/shadcncraft/pro-application/inline-cta/inline-cta-3";

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
      <Hero10 />

      <main className="flex-1">
        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-y border-border bg-card px-4 py-20 sm:px-6 scroll-mt-14">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-xl text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                How it works
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                From the pasture to a payout, in three steps.
              </h2>
            </div>
            <div className="mt-10 flex flex-col gap-10 text-left sm:flex-row sm:gap-6">
              <ProgressItem>
                <ProgressItemHeader>
                  <ProgressItemIndicator>1</ProgressItemIndicator>
                  <ProgressItemSeparator />
                </ProgressItemHeader>
                <ProgressItemContent>
                  <ProgressItemTitle>A producer lists a herd</ProgressItemTitle>
                  <ProgressItemDescription>
                    A rancher or feedyard opens capital raising directly to
                    investors, choosing retained ownership or an outright sale.
                  </ProgressItemDescription>
                </ProgressItemContent>
              </ProgressItem>
              <ProgressItem>
                <ProgressItemHeader>
                  <ProgressItemIndicator>2</ProgressItemIndicator>
                  <ProgressItemSeparator />
                </ProgressItemHeader>
                <ProgressItemContent>
                  <ProgressItemTitle>Investors buy fractional shares</ProgressItemTitle>
                  <ProgressItemDescription>
                    Each token represents a real stake in the herd. Ownership
                    is recorded on-chain; the herd's progress shows in a
                    statement.
                  </ProgressItemDescription>
                </ProgressItemContent>
              </ProgressItem>
              <ProgressItem>
                <ProgressItemHeader>
                  <ProgressItemIndicator>3</ProgressItemIndicator>
                </ProgressItemHeader>
                <ProgressItemContent>
                  <ProgressItemTitle>Payout at the rail</ProgressItemTitle>
                  <ProgressItemDescription>
                    When cattle sell, proceeds settle back to the producer and
                    investors, weighted by carcass grade at slaughter.
                  </ProgressItemDescription>
                </ProgressItemContent>
              </ProgressItem>
            </div>
          </div>
        </section>

        {/* TWO OWNERSHIP PATHS */}
        <Benefits12 />

        {/* BUILT FOR PRODUCERS */}
        <div id="producers" className="border-y border-border bg-card scroll-mt-14">
          <Benefits7 />
        </div>

        {/* HOW MONEY WORKS */}
        <div id="trust" className="border-b border-border bg-muted scroll-mt-14">
          <Benefits6 />
        </div>

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
            <div className="mt-2 flex justify-center">
              <InlineCTA3 />
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
