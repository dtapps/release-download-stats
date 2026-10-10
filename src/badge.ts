const COLORS: Record<string, string> = {
  blue: "#007ec6",
  brightgreen: "#4c1",
  green: "#97ca00",
  yellow: "#dfb317",
  orange: "#fe7d37",
  red: "#e05d44",
  grey: "#555",
};

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function renderBadge(label: string, message: string, color = "blue"): string {
  const left = escapeXml(label);
  const right = escapeXml(message);
  const rightColor = COLORS[color] ?? COLORS.blue;
  const leftWidth = Math.ceil(Math.max(38, left.length * 6.7 + 12));
  const rightWidth = Math.ceil(Math.max(34, right.length * 6.7 + 12));
  const width = leftWidth + rightWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${left}: ${right}"><title>${left}: ${right}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${leftWidth}" height="20" fill="#555"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${rightColor}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${leftWidth / 2}" y="14">${left}</text><text x="${leftWidth + rightWidth / 2}" y="14">${right}</text></g></svg>`;
}

export function formatCount(value: number): string {
  return compact(value);
}