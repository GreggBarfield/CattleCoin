import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  FeatureStack,
  FeatureStackDescription,
  FeatureStackHeader,
  FeatureStackTitle,
} from "@/components/shadcncraft/pro-marketing/feature-stack";
import {
  SectionHeading,
  SectionHeadingTagline,
  SectionHeadingTitle,
} from "@/components/shadcncraft/pro-marketing/section-heading";

export function Benefits6() {
  return (
    <section className="py-6 lg:py-20">
      <div className="mx-auto flex max-w-7xl flex-col gap-16 px-5 lg:px-8">
        {/* Section Heading */}
        <SectionHeading alignment="center" className="mx-auto w-full max-w-3xl">
          <SectionHeadingTagline>How money works</SectionHeadingTagline>
          <SectionHeadingTitle>Real cattle. Verifiable ownership. Careful money.</SectionHeadingTitle>
        </SectionHeading>

        {/* Benefits */}
        <div className="grid w-full grid-cols-1 gap-px overflow-clip rounded-xl border bg-border shadow-sm md:grid-cols-[repeat(auto-fit,minmax(350px,1fr))]">
          {benefitsData.map((benefit) => (
            <BenefitCard
              className="md:even:flex-col-reverse"
              key={benefit.title}
              title={benefit.title}
              body={benefit.body}
              image={benefit.image}
              tag={benefit.tag}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BenefitCard({
  title,
  body,
  image,
  tag,
  className,
}: ComponentProps<"div"> & { title: string; body: string; image: string; tag?: string }) {
  return (
    <div
      data-slot="benefit-card"
      className={cn("flex flex-col gap-5 bg-card p-5", className)}
    >
      <div className="relative aspect-square size-full overflow-clip rounded-xl">
        <img src={image} className="size-full object-cover" alt={title} />
      </div>

      <FeatureStack alignment="left" size="md">
        <FeatureStackHeader>
          <FeatureStackTitle>{title}</FeatureStackTitle>
          <FeatureStackDescription>{body}</FeatureStackDescription>
          {tag && (
            <span className="mt-1 inline-block w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {tag}
            </span>
          )}
        </FeatureStackHeader>
      </FeatureStack>
    </div>
  );
}

const benefitsData: { title: string; body: string; image: string; tag?: string }[] = [
  {
    title: "On-chain herd ownership",
    body: "Each herd's token supply is recorded on a public blockchain ledger, so ownership is verifiable independent of our own records.",
    image: "/images/money-chain-chart.jpg",
  },
  {
    title: "Reviewed fund releases",
    body: "Payouts and releases are checked before anything moves — every dollar in and out is a record you can see in your statement.",
    image: "/images/money-contract.jpg",
  },
  {
    title: "LRP price protection",
    body: "We're exploring built-in USDA Livestock Risk Protection for the retained-ownership track, to lower price risk for producers and investors alike.",
    image: "/images/money-risk-assessment.jpg",
    tag: "In development",
  },
];
