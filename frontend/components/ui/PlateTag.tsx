/**
 * components/ui/PlateTag.tsx
 * Styled Indonesian license plate tag.
 * Renders the plate text in the dark-blue/white "police plate" style
 * that matches the SIX prototype's `.plate` CSS class.
 *
 * Usage:
 *   <PlateTag plate="D 4321 ITB" />
 *   <PlateTag plate="D 4321 ITB" size="sm" />
 */

type PlateSize = "sm" | "md" | "lg";

interface PlateTagProps {
  plate: string;
  size?: PlateSize;
}

const SIZE_STYLES: Record<PlateSize, React.CSSProperties> = {
  sm: { fontSize: 10,   padding: "2px 8px",   letterSpacing: "1.5px" },
  md: { fontSize: 11.5, padding: "4px 12px",  letterSpacing: "2.5px" },
  lg: { fontSize: 14,   padding: "6px 16px",  letterSpacing: "3px"   },
};

export function PlateTag({ plate, size = "md" }: PlateTagProps) {
  return (
    <span className="plate" style={SIZE_STYLES[size]}>
      {plate}
    </span>
  );
}
