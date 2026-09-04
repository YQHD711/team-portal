/**
 * Dot-grid background pattern as a data-URI SVG.
 * Shared by the dashboard hero and sidebar brand header.
 */
export function dotGridPattern(opacity = 0.03): string {
  const svg =
    '<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' +
    '<g fill="none" fill-rule="evenodd"><g fill="#fff" fill-opacity="' + opacity + '">' +
    '<circle cx="30" cy="30" r="2"/></g></g></svg>';
  return "data:image/svg+xml;base64," + btoa(svg);
}
