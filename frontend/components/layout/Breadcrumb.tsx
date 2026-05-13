/**
 * components/layout/Breadcrumb.tsx
 *
 * Dari source HTML asli SIX (struktur.html):
 * <div class="container">
 *   <ol class="breadcrumb hidden-xs">
 *     <li><a href="...">SIX</a></li>
 *     <li><a href="...">Kurikulum</a></li>
 *     <li>Struktur Kurikulum</li>   ← last item: no link, no .active class
 *   </ol>
 * </div>
 *
 * Bootstrap .breadcrumb (dari bootstrap.min.css):
 *   padding: 8px 15px
 *   margin-bottom: 20px
 *   list-style: none
 *   background-color: #f5f5f5
 *   border-radius: 4px
 *   separator: style-20200730.css → content: "\00BB" (»)
 *
 * Perbedaan dengan versi sebelumnya:
 *   - Dibungkus dalam .container (padding 0 15px) persis seperti aslinya
 *   - Breadcrumb langsung menyambung setelah navbar tanpa gap besar
 *   - Separator >> bukan › 
 *   - Background #f5f5f5 Bootstrap default
 *   - Border-radius 4px (Bootstrap default)
 *   - Tidak menggunakan margin atas — langsung di bawah navbar
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
    /*
     * Uses .site-container class — same as navbar inner div and .page.
     * This guarantees pixel-perfect left-edge alignment across all three.
     * margin-top creates the visual gap between navbar and breadcrumb.
     */
    <div className="site-container" style={{ marginTop: 18, marginBottom: 0 }}>
      {/* Bootstrap ol.breadcrumb — hidden-xs di aslinya, tapi kita tampilkan semua */}
      <ol
        className="breadcrumb"
        style={{
          /* padding, border-radius, margin all controlled by globals.css .breadcrumb */
          listStyle: "none",
          marginBottom: 20,
          display: "block",
        }}
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li
              key={i}
              style={{
                display: "inline",
                /* Bootstrap li+li:before separator — kita handle manual */
              }}
            >
              {/* Separator » sebelum setiap item kecuali yang pertama */}
              {i > 0 && (
                <span
                  style={{
                    padding: "0 5px",
                    color: "#ccc",
                    /* style-20200730.css: content: "\00BB" = » */
                  }}
                >
                  »
                </span>
              )}
              {!isLast && crumb.href ? (
                <a
                  href={crumb.href}
                  style={{
                    color: "#337ab7",
                    textDecoration: "none",
                    fontFamily: "'Roboto', sans-serif",
                    fontSize: 14,
                  }}
                >
                  {crumb.label}
                </a>
              ) : (
                <span
                  style={{
                    color: "#777",
                    fontFamily: "'Roboto', sans-serif",
                    fontSize: 14,
                  }}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
