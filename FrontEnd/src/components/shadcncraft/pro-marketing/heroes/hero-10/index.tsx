import { TopNavigation1 } from "@/components/shadcncraft/pro-marketing/top-navigation/top-navigation-1";
import { Button } from "@/components/ui/button";
import {
  PageHeading,
  PageHeadingActions,
  PageHeadingBody,
  PageHeadingTagline,
  PageHeadingTitle,
} from "@/components/shadcncraft/pro-marketing/page-heading";
import { ArrowRight } from "lucide-react";

export function Hero10() {
  return (
    <>
      <div className="sticky top-0 z-50">
        <TopNavigation1 />
      </div>

      <section
        id="top"
        className="relative isolate h-145 w-full bg-cover bg-top bg-no-repeat py-10 md:h-170 lg:h-195"
        style={{
          backgroundImage: "url('/images/hero-pasture.jpg')",
        }}
      >
        {/* Background Gradient Effect */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-1 h-1/3 bg-linear-to-t from-black to-transparent" />
        <div className="pointer-events-none absolute inset-0 -z-1 bg-linear-to-t from-black/60 via-black/40 to-transparent" />

        {/* Content */}
        <div className="relative mx-auto h-full max-w-7xl content-end px-5 lg:px-8">
          <PageHeading className="z-10">
            <PageHeadingTagline className="border-white/30 bg-white/10 text-white backdrop-blur-sm">
              Piloting with real herds in 2026
            </PageHeadingTagline>
            <PageHeadingTitle className="text-white">
              Follow the herd.
              <br />
              Own the outcome.
            </PageHeadingTitle>
            <PageHeadingBody className="max-w-xl text-white/85">
              CattleCoin lets ranchers and feedyards raise capital straight from
              investors — no bank loan required — and lets investors follow a
              real herd from pasture to the rail, with a payout tied to how
              well it grades.
            </PageHeadingBody>
            <PageHeadingActions>
              <a href="#pilot" className="w-full sm:w-fit">
                <Button size="lg" className="w-full gap-2 bg-white text-black hover:bg-white/90 sm:w-fit">
                  Request Pilot Access <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
              <a href="#how-it-works" className="w-full sm:w-fit">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white sm:w-fit"
                >
                  See how it works
                </Button>
              </a>
            </PageHeadingActions>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white/85 backdrop-blur-sm">
                Cow-calf ranchers
              </span>
              <span className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white/85 backdrop-blur-sm">
                Feeders &amp; feedyards
              </span>
              <span className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white/85 backdrop-blur-sm">
                Investors
              </span>
            </div>
          </PageHeading>
        </div>
      </section>
    </>
  );
}
