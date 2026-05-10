/**
 * components/layout/Breadcrumb.tsx
 * SIX ITB breadcrumb trail, preserving Bootstrap 3 "breadcrumb" class.
 * Accepts an array of crumb items; the last item is rendered as plain text.
 */

export interface Crumb {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  crumbs: Crumb[];
}

export function Breadcrumb({ crumbs }: BreadcrumbProps) {
  return (
    <ol className="breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <li key={i} className={isLast ? "active" : ""}>
            {!isLast && crumb.href ? (
              <a href={crumb.href}>{crumb.label}</a>
            ) : (
              crumb.label
            )}
            {!isLast && <span className="bc-sep">&#187;</span>}
          </li>
        );
      })}
    </ol>
  );
}
