// Set data-theme before first paint so switching pages / reloading never flashes the wrong theme.
// Kept as a separate file (not inline in index.html) so it's covered by the
// script-src 'self' CSP directive without needing a content hash.
(function () {
  var saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
})();
