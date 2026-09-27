import type { ComponentProps } from "react";
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
import { Separator } from "@/components/ui/separator";

export function Benefits7() {
  return (
    <section className="py-6 lg:py-20">
      <div className="mx-auto flex max-w-7xl flex-col gap-16 px-5 lg:px-8">
        {/* Section Heading */}
        <SectionHeading alignment="center" size="lg" className="mx-auto w-full max-w-3xl">
          <SectionHeadingTagline>Built for producers</SectionHeadingTagline>
          <SectionHeadingTitle>Two kinds of producers. Both can raise capital.</SectionHeadingTitle>
        </SectionHeading>

        {/* Benefits */}
        <div className="grid w-full gap-5 md:grid-cols-[1fr_auto_1fr] lg:gap-9">
          <BenefitCard
            title="Cow-calf ranchers"
            body="Raise calves and sell. Bring investor capital directly into your operation to grow the herd or invest in genetics, without waiting on a bank."
            image="/images/producers-cattle-drive.jpg"
          />

          <Separator orientation="vertical" className="hidden h-full md:block" />

          <Separator className="w-full md:hidden" />

          <BenefitCard
            title="Feeders & feedyards"
            body="Buy, finish, and sell cattle at volume. Raise investor capital for feed, facilities, and throughput, on top of any custodial work for retained-ownership herds."
            image="/images/producers-feedyard.jpg"
          />
        </div>
      </div>
    </section>
  );
}

function BenefitCard({
  title,
  body,
  image,
}: ComponentProps<"div"> & { title: string; body: string; image: string }) {
  return (
    <div data-slot="benefit-card" className="flex min-w-0 flex-col gap-5 py-5 lg:py-9">
      <FeatureStack alignment="left" size="lg">
        <FeatureStackHeader>
          <FeatureStackTitle>{title}</FeatureStackTitle>
          <FeatureStackDescription>{body}</FeatureStackDescription>
        </FeatureStackHeader>
      </FeatureStack>

      <div className="relative aspect-square size-full overflow-clip rounded-xl">
        <img src={image} className="size-full object-cover" alt={title} />
      </div>
    </div>
  );
}
