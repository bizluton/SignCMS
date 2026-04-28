import { NavLink as RouterNavLink, NavLinkProps } from "react-router-dom";
import { forwardRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/routePrefetch";

interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, onMouseEnter, onFocus, ...props }, ref) => {
    const target = typeof to === "string" ? to : (to as { pathname?: string })?.pathname;

    // Warm the lazy() chunk on hover/focus so the click feels instant.
    const handleEnter = useCallback(
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (target) prefetchRoute(target);
        onMouseEnter?.(e);
      },
      [target, onMouseEnter],
    );
    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLAnchorElement>) => {
        if (target) prefetchRoute(target);
        onFocus?.(e);
      },
      [target, onFocus],
    );

    return (
      <RouterNavLink
        ref={ref}
        to={to}
        onMouseEnter={handleEnter}
        onFocus={handleFocus}
        className={({ isActive, isPending }) =>
          cn(className, isActive && activeClassName, isPending && pendingClassName)
        }
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
