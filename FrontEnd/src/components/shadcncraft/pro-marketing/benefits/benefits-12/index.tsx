import type { ReactNode } from "react";
import {
  SectionHeading,
  SectionHeadingTagline,
  SectionHeadingTitle,
} from "@/components/shadcncraft/pro-marketing/section-heading";
import {
  SubFeature,
  SubFeatureDescription,
  SubFeatureTitle,
} from "@/components/shadcncraft/pro-marketing/sub-feature";
import { Lock, Handshake } from "lucide-react";

export function Benefits12() {
  return (
    <section className="border-b border-border bg-muted py-6 lg:py-20">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-16 px-5 lg:flex-row lg:gap-8 lg:px-8">
        {/* Section Heading */}
        <div className="w-full lg:max-w-xs">
          <SectionHeading>
            <SectionHeadingTagline className="text-xs font-semibold uppercase tracking-[0.14em]">
              Two ownership paths
            </SectionHeadingTagline>
            <SectionHeadingTitle>
              Producers choose how ownership works.
            </SectionHeadingTitle>
          </SectionHeading>
        </div>

        {/* Benefits Content */}
        <div className="grid w-full gap-8 lg:max-w-3xl">
          {benefits.map((feature) => (
            <SubFeature key={feature.title}>
              <SubFeatureTitle>
                {feature.icon}
                {feature.title}
              </SubFeatureTitle>
              <SubFeatureDescription className="text-pretty">
                {feature.description}
              </SubFeatureDescription>
            </SubFeature>
          ))}
        </div>
      </div>
    </section>
  );
}

const benefits: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <Lock />,
    title: "Retained ownership: the rancher keeps title.",
    description:
      "The producer keeps title to the animal all the way through the feedlot, which acts only as a paid custodian. Investors hold one continuous position, paid out at slaughter based on carcass grade.",
  },
  {
    icon: <Handshake />,
    title: "Sold outright: a clean transfer of ownership.",
    description:
      "Ownership transfers to the feedlot at purchase. Investors who backed the original raise close out their position at the sale, in the simpler, more familiar structure.",
  },
];
