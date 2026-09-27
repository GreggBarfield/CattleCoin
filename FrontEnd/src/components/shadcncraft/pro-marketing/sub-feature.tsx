import * as React from "react";

import { cn } from "@/lib/utils";

function SubFeature({
  leftBorder = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  leftBorder?: boolean;
}) {
  return (
    <div
      data-slot="sub-feature"
      data-left-border={leftBorder}
      className={cn(
        "flex max-w-xl flex-col gap-3 data-[left-border=true]:border-l data-[left-border=true]:pl-6 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

function SubFeatureTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="sub-feature-title"
      className={cn(
        "flex items-center gap-2 text-xl font-medium tracking-tight text-balance [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  );
}

function SubFeatureIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sub-feature-icon"
      className={cn(
        "shrink-0 translate-y-0.5 self-start [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  );
}

function SubFeatureDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sub-feature-description"
      className={cn("text-base text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

export { SubFeature, SubFeatureDescription, SubFeatureIcon, SubFeatureTitle };
