"use client";

import { cn } from "@repo/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The visible path: strips the internal /s/<host> prefix the proxy rewrites to (seen during SSR). */
function visiblePath(pathname: string): string {
  return pathname.replace(/^\/s\/[^/]+/, "") || "/";
}

export function isActive(pathname: string, href: string, exact?: boolean): boolean {
  const path = visiblePath(pathname);
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}

/** A navigation link that highlights itself on the current page (plain link: works without JS). */
export function NavLink({
  href,
  exact,
  className,
  activeClassName,
  children,
  testId,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
  testId?: string;
}) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
      data-nav={testId}
    >
      {children}
    </Link>
  );
}
