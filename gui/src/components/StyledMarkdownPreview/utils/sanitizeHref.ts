/** Keep AI-generated Markdown links limited to ordinary web destinations. */
export function sanitizeMarkdownHref(href: string, baseUrl: string): string {
  try {
    const url = new URL(href, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? href : "#";
  } catch {
    return "#";
  }
}
