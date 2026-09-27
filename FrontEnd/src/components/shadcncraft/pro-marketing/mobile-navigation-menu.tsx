"use client";

import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";

type MobileNavigationMenuContextValue = {
  mode: "single" | "multiple";
  expandedItems: Set<string>;
  toggleItem: (value: string) => void;
};

const MobileNavigationMenuContext = React.createContext<
  MobileNavigationMenuContextValue | undefined
>(undefined);

function useMobileNavigationMenu() {
  const context = React.useContext(MobileNavigationMenuContext);
  if (!context) {
    throw new Error(
      "useMobileNavigationMenu must be used within a MobileNavigationMenuProvider"
    );
  }
  return context;
}

type MobileNavigationMenuProviderProps = {
  mode?: MobileNavigationMenuContextValue["mode"];
  defaultExpanded?: MobileNavigationMenuContextValue["expandedItems"];
};

function MobileNavigationMenuProvider({
  children,
  mode = "multiple",
  defaultExpanded,
}: MobileNavigationMenuProviderProps & { children: React.ReactNode }) {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(() => {
    if (defaultExpanded) {
      return new Set(
        Array.isArray(defaultExpanded) ? defaultExpanded : [defaultExpanded]
      );
    }
    return new Set();
  });

  const toggleItem = React.useCallback(
    (itemValue: string) => {
      setExpandedItems((prev) => {
        const next = new Set(prev);
        if (next.has(itemValue)) {
          next.delete(itemValue);
        } else {
          if (mode === "single") {
            next.clear();
          }
          next.add(itemValue);
        }
        return next;
      });
    },
    [mode]
  );

  const contextValue = React.useMemo(
    () => ({ expandedItems, toggleItem, mode }),
    [expandedItems, toggleItem, mode]
  );

  return (
    <MobileNavigationMenuContext.Provider value={contextValue}>
      {children}
    </MobileNavigationMenuContext.Provider>
  );
}

function MobileNavigationMenu({
  className,
  defaultExpanded,
  mode = "multiple",
  ...props
}: React.ComponentProps<"nav"> &
  Pick<MobileNavigationMenuProviderProps, "mode" | "defaultExpanded">) {
  return (
    <MobileNavigationMenuProvider mode={mode} defaultExpanded={defaultExpanded}>
      <nav
        data-mode={mode}
        data-orientation="vertical"
        data-slot="mobile-navigation-menu"
        className={cn(
          "group/mobile-navigation-menu relative flex w-full [scrollbar-width:thin] flex-col overflow-y-auto",
          className
        )}
        {...props}
      />
    </MobileNavigationMenuProvider>
  );
}

function MobileNavigationMenuList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-orientation="vertical"
      data-slot="mobile-navigation-menu-list"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    />
  );
}

function MobileNavigationMenuItem({
  value,
  className,
  ...props
}: React.ComponentProps<typeof Collapsible> & {
  value: string;
}) {
  const { expandedItems, toggleItem } = useMobileNavigationMenu();
  const isOpen = expandedItems.has(value);

  return (
    <li data-slot="mobile-navigation-menu-item">
      <Collapsible
        open={isOpen}
        onOpenChange={() => toggleItem(value)}
        className={cn("group/mobile-navigation-menu-item relative", className)}
        {...props}
      />
    </li>
  );
}

const mobileNavigationMenuTriggerStyle = cva(
  "group/mobile-navigation-menu-trigger inline-flex w-full items-center gap-1.5 rounded-md p-2 text-sm font-medium transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted/50 data-[state=open]:hover:bg-muted data-[state=open]:focus:bg-muted [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
);

function MobileNavigationMenuTrigger({
  className,
  children,
  chevron = true,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  chevron?: boolean;
}) {
  return (
    <CollapsibleTrigger
      data-slot="mobile-navigation-menu-trigger"
      className={cn(mobileNavigationMenuTriggerStyle(), className)}
      {...props}
    >
      <>
        <span className="flex flex-1 items-center gap-2 text-left">{children}</span>
        {chevron && (
          <ChevronDownIcon className="size-4 transition duration-300 group-data-[state=open]/mobile-navigation-menu-trigger:rotate-180" aria-hidden="true" />
        )}
      </>
    </CollapsibleTrigger>
  );
}

function MobileNavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="mobile-navigation-menu-content"
      className={cn(
        "relative flex w-full flex-col gap-2 overflow-hidden pt-0.5 pb-0.5 transition-all duration-150 slide-in-from-top-5 fade-in data-[state=open]:animate-in [&>*:last-child]:mb-2",
        className
      )}
      {...props}
    />
  );
}

function MobileNavigationMenuLink({
  className,
  active,
  asChild,
  ...props
}: React.ComponentProps<"a"> & {
  active?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "a";

  return (
    <Comp
      data-slot="mobile-navigation-menu-link"
      data-active={active ? "true" : undefined}
      className={cn(
        "group/mobile-navigation-link flex w-full items-start gap-1.5 rounded-md p-2 text-sm transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 data-[active=true]:bg-muted/50 data-[active=true]:hover:bg-muted data-[active=true]:focus:bg-muted [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  );
}

// Optional components, just for consistency with the Figma design
function MobileNavigationMenuLinkContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="mobile-navigation-menu-link-content"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  );
}

// Optional components, just for consistency with the Figma design
function MobileNavigationMenuLinkTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="mobile-navigation-menu-link-title"
      className={cn(
        "truncate text-sm leading-tight font-medium",
        className
      )}
      {...props}
    />
  );
}

// Optional components, just for consistency with the Figma design
function MobileNavigationMenuLinkDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="mobile-navigation-menu-link-description"
      className={cn("text-sm font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  MobileNavigationMenu,
  MobileNavigationMenuContent,
  MobileNavigationMenuItem,
  MobileNavigationMenuLink,
  MobileNavigationMenuLinkContent,
  MobileNavigationMenuLinkDescription,
  MobileNavigationMenuLinkTitle,
  MobileNavigationMenuList,
  MobileNavigationMenuProvider,
  MobileNavigationMenuTrigger,
  mobileNavigationMenuTriggerStyle,
  useMobileNavigationMenu,
};
