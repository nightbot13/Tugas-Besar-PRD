/**
 * components/ui/Badge.tsx
 * Reusable semantic badge chip.
 * Color variants match the SIX portal CSS classes defined in layout.tsx.
 */

type BadgeVariant =
  | "green"
  | "red"
  | "blue"
  | "orange"
  | "gray"
  | "purple";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Badge({ variant, children, style }: BadgeProps) {
  return (
    <span className={`badge badge-${variant}`} style={style}>
      {children}
    </span>
  );
}
