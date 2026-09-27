import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function ProgressItem({
  direction = "horizontal",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  direction?: "horizontal" | "vertical";
}) {
  return (
    <div
      data-slot="progress-item"
      data-direction={direction}
      className={cn(
        "group/progress flex flex-1 flex-col gap-4 data-[direction=vertical]:flex-row",
        className
      )}
      {...props}
    />
  );
}

function ProgressItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="progress-item-header"
      className={cn(
        "flex items-center gap-1 group-data-[direction=vertical]/progress:flex-col",
        className
      )}
      {...props}
    />
  );
}

const progressItemIndicatorVariants = cva(
  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function ProgressItemIndicator({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof progressItemIndicatorVariants>) {
  return (
    <div
      data-slot="progress-item-indicator"
      className={cn(progressItemIndicatorVariants({ variant }), className)}
      {...props}
    />
  );
}

function ProgressItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="progress-item-content"
      className={cn(
        "space-y-1 pr-4 group-data-[direction=vertical]/progress:pb-8",
        className
      )}
      {...props}
    />
  );
}

function ProgressItemTitle({ className, ...props }: React.ComponentProps<"h4">) {
  return (
    <h4
      data-slot="progress-item-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}

function ProgressItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="progress-item-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ProgressItemSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="none"
      data-slot="progress-item-separator"
      className={cn(
        "h-px w-full flex-1 shrink-0 bg-border group-data-[direction=vertical]/progress:h-full group-data-[direction=vertical]/progress:w-px",
        className
      )}
      {...props}
    />
  );
}

export {
  ProgressItem,
  ProgressItemContent,
  ProgressItemDescription,
  ProgressItemHeader,
  ProgressItemIndicator,
  progressItemIndicatorVariants,
  ProgressItemSeparator,
  ProgressItemTitle,
};
