"use client";

import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  MobileNavigationMenu,
  MobileNavigationMenuItem,
  MobileNavigationMenuLink,
  MobileNavigationMenuList,
  mobileNavigationMenuTriggerStyle,
} from "@/components/shadcncraft/pro-marketing/mobile-navigation-menu";
import { X, Menu, Beef } from "lucide-react";

// Defaults to Tailwind's md: breakpoint.
const MOBILE_BREAKPOINT = 768;

export function TopNavigation1() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  const navigationContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile(MOBILE_BREAKPOINT);

  useClickOutside(navigationContainerRef, () => {
    if (isMobile && isMenuOpen) {
      setIsMenuOpen(false);
    }
  });

  return (
    <div
      className="w-full bg-background py-5 transition-all ease-in-out md:py-3.5"
      role="navigation"
      aria-label="Website top navigation"
      ref={navigationContainerRef}
    >
      <div className="relative mx-auto flex max-w-7xl flex-col justify-between px-6 md:flex-row lg:gap-4 lg:px-10">
        {/* Logo and Toggle Mobile Nav Button */}
        <div className="flex items-center justify-between">
          <a href="/" aria-label="Go to home page" className="flex shrink-0 items-center gap-2">
            <Beef className="size-6 shrink-0 text-primary" />
            <span className="text-sm font-medium text-nowrap text-foreground">CattleCoin</span>
          </a>

          {/* Toggle Mobile Nav Button - Visible on screen sizes < 768px */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={toggleMenu}
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {isMenuOpen ? (
              <X className="animate-in zoom-in-50" />
            ) : (
              <Menu className="animate-in zoom-in-50" />
            )}
          </Button>
        </div>

        {/* Desktop Navigation - Visible on screen sizes >= 768px */}
        <div className="hidden flex-1 justify-between gap-4 md:flex">
          <DesktopNavigation />
          <ActionButtons />
        </div>

        {/* Mobile Navigation - Visible on screen sizes < 768px */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out md:hidden",
            isMenuOpen
              ? "grid-rows-[1fr] pt-6 opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0"
          )}
        >
          <div
            className={cn(isMenuOpen ? "overflow-visible" : "overflow-hidden")}
            inert={!isMenuOpen || undefined}
            aria-hidden={!isMenuOpen}
          >
            <div className="flex flex-col gap-9">
              <MobileNavigation />
              <ActionButtons />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButtons() {
  return (
    <div className="flex flex-col gap-2 md:flex-row">
      <Link to="/login" className="w-full md:w-fit">
        <Button variant="outline" className="w-full md:w-fit">
          Sign in
        </Button>
      </Link>
      <a href="#pilot" className="w-full md:w-fit">
        <Button className="w-full md:w-fit">Request Pilot Access</Button>
      </a>
    </div>
  );
}

function DesktopNavigation() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        {NAV_ITEMS.map((item) => (
          <NavigationMenuItem key={item.label}>
            <NavigationMenuLink
              className={cn(navigationMenuTriggerStyle(), "bg-transparent")}
              asChild
            >
              <a href={item.href}>{item.label}</a>
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function MobileNavigation() {
  return (
    <MobileNavigationMenu mode="single">
      <MobileNavigationMenuList>
        {NAV_ITEMS.map((item) => (
          <MobileNavigationMenuItem key={item.label} value={item.label}>
            <MobileNavigationMenuLink
              className={mobileNavigationMenuTriggerStyle()}
              asChild
            >
              <a href={item.href}>{item.label}</a>
            </MobileNavigationMenuLink>
          </MobileNavigationMenuItem>
        ))}
      </MobileNavigationMenuList>
    </MobileNavigationMenu>
  );
}

type NavigationItem = {
  label: string;
  href: string;
};

const NAV_ITEMS: NavigationItem[] = [
  { label: "How it works", href: "#how-it-works" },
  { label: "For producers", href: "#producers" },
  { label: "How money works", href: "#trust" },
];
