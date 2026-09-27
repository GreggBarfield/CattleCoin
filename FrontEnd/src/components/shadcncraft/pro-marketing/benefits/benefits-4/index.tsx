import type { ReactNode } from "react";
import {
  FeatureStack,
  FeatureStackDescription,
  FeatureStackHeader,
  FeatureStackMedia,
  FeatureStackTitle,
} from "@/components/shadcncraft/pro-marketing/feature-stack";
import {
  SectionHeading,
  SectionHeadingTagline,
  SectionHeadingTitle,
} from "@/components/shadcncraft/pro-marketing/section-heading";
import { ShieldCheck, FileCheck2, Umbrella } from "lucide-react";

export function Benefits4() {
  return (
    <section className="py-6 lg:py-20">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        {/* Section Heading */}
        <SectionHeading alignment="left" size="lg" className="max-w-xl">
          <SectionHeadingTagline>How money works</SectionHeadingTagline>
          <SectionHeadingTitle>Real cattle. Verifiable ownership. Careful money.</SectionHeadingTitle>
        </SectionHeading>

        {/* Features */}
        <div className="mt-10 grid gap-12 lg:grid-cols-3 lg:gap-9">
          {features.map((feature) => (
            <FeatureStack key={feature.title} alignment="left" className="max-w-none">
              <FeatureStackMedia variant="featured">{feature.icon}</FeatureStackMedia>
              <FeatureStackHeader>
                <FeatureStackTitle>{feature.title}</FeatureStackTitle>
                <FeatureStackDescription>{feature.description}</FeatureStackDescription>
                {feature.tag && (
                  <span className="mt-3 inline-block w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {feature.tag}
                  </span>
                )}
              </FeatureStackHeader>
            </FeatureStack>
          ))}
        </div>
      </div>
    </section>
  );
}

const features: {
  icon: ReactNode;
  title: string;
  description: string;
  tag?: string;
}[] = [
  {
    icon: <ShieldCheck />,
    title: "On-chain herd ownership",
    description:
      "Each herd's token supply is recorded on a public blockchain ledger, so ownership is verifiable independent of our own records.",
  },
  {
    icon: <FileCheck2 />,
    title: "Reviewed fund releases",
    description:
      "Payouts and releases are checked before anything moves — every dollar in and out is a record you can see in your statement.",
  },
  {
    icon: <Umbrella />,
    title: "LRP price protection",
    description:
      "We're exploring built-in USDA Livestock Risk Protection for the retained-ownership track, to lower price risk for producers and investors alike.",
    tag: "In development",
  },
];
