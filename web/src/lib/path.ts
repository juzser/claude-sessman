/**
 * Shortens an absolute cwd for card display: home-relative paths become
 * `~/…/<lastSegment>`, everything else becomes `/…/<lastSegment>`. Short
 * paths (<= 1 segment past the anchor) are shown in full, uncollapsed.
 */
export function shortenPath(cwd: string, home: string, tailSegments = 1): string {
  const isHomeRelative = home !== "" && (cwd === home || cwd.startsWith(`${home}/`));
  const anchor = isHomeRelative ? "~" : "";
  const rest = isHomeRelative ? cwd.slice(home.length) : cwd;
  const segments = rest.split("/").filter(Boolean);

  if (segments.length === 0) {
    return anchor || "/";
  }
  if (segments.length <= tailSegments) {
    return `${anchor}/${segments.join("/")}`;
  }
  const tail = segments.slice(-tailSegments);
  return `${anchor}/…/${tail.join("/")}`;
}
