// Resize recognized Apple artwork URLs without changing other image sources.
export function artworkUrl(src?: string | null): string | null {
  if (!src) return null;
  try {
    const url = new URL(src);
    if (
      url.protocol === "https:" &&
      url.hostname.endsWith(".mzstatic.com") &&
      !url.username &&
      !url.password &&
      !url.port
    ) {
      url.pathname = url.pathname.replace(
        /\/\d+x\d+(bb)?\.(jpg|jpeg|png|webp)$/i,
        "/300x300$1.$2"
      );
      return url.href;
    }
  } catch {}
  return src;
}
