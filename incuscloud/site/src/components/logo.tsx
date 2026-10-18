// The IncusCloud mark: a light tile with one hub joined to three clusters, then the wordmark
// over "by hyprr". Monochrome, like the rest of the site.
export const Mark = ({ className = "size-7" }: { className?: string }) => (
  <span className={`grid shrink-0 place-items-center rounded-lg bg-fd-primary text-fd-primary-foreground ${className}`}>
    <svg viewBox="0 0 24 24" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="19.5" r="2.2" />
    </svg>
  </span>
);

export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`inline-flex items-center gap-2 select-none ${className}`}>
    <Mark />
    <span className="flex flex-col -space-y-1 leading-tight">
      <span className="text-lg font-semibold tracking-tight text-fd-foreground">IncusCloud</span>
      <span className="text-[9px] text-fd-muted-foreground">by hyprr</span>
    </span>
  </span>
);

// Incendio's mark: its white flame on its own orange tile, the one place the site uses a brand hue.
export const IncendioMark = ({ className = "size-7" }: { className?: string }) => (
  <span className={`grid shrink-0 place-items-center rounded-lg bg-[#E95420] ${className}`}>
    <svg viewBox="16 162 220 220" className="size-[78%]" aria-hidden>
      <path
        fill="#fff"
        d="M105.034 183.864C108.107 181.283 112.634 181.382 115.575 184.162C119.639 188.001 123.274 192.237 126.777 196.539C131.237 201.999 136.59 209.213 141.745 217.784C143.463 215.534 145.049 213.548 146.437 211.86C146.801 211.43 147.164 210.967 147.528 210.503C150.138 207.26 153.376 203.19 157.705 203.19C162.133 203.19 165.239 207.128 167.882 210.503C168.312 211.066 168.741 211.596 169.171 212.092C172.574 216.195 177.101 222.119 181.628 229.432C190.616 243.96 200 264.642 200 287.873C200 328.808 166.858 362 125.983 362C85.1092 362 52 328.842 52 287.906C52 257.759 65.5807 231.649 78.5997 213.449C85.1753 204.282 91.7178 196.936 96.6412 191.906C99.3507 189.126 102.093 186.379 105.067 183.897L105.034 183.864ZM126.578 330.264C134.938 330.264 142.34 327.948 149.312 323.315C163.223 313.586 166.957 294.128 158.597 278.839C157.11 275.861 153.31 275.662 151.162 278.177L142.835 287.873C140.655 290.388 136.722 290.322 134.674 287.708C128.957 280.394 118.45 267.058 113.097 260.241C111.312 257.958 108.074 257.594 105.992 259.612C99.9455 265.503 88.9752 278.409 88.9752 294.128C88.9752 316.829 105.695 330.264 126.545 330.264H126.578Z"
      />
    </svg>
  </span>
);
