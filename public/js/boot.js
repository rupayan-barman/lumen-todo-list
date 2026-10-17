// Runs before first paint (classic script in <head>): applies the last-used theme variables so there is no flash.
(function () {
  try {
    var b = JSON.parse(localStorage.getItem('lumen.boot') || 'null');
    if (!b || !b.vars) return;
    var r = document.documentElement;
    for (var k in b.vars) r.style.setProperty(k, b.vars[k]);
    if (b.mode) r.setAttribute('data-mode', b.mode);
    if (b.scheme) r.style.colorScheme = b.scheme;
  } catch (e) { /* first run or storage blocked: stylesheet defaults apply */ }
})();
