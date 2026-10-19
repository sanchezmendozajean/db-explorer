// Apunta los botones de descarga al instalador del último release de GitHub.
// Si la API no responde (límite de peticiones, sin conexión), los botones siguen enlazando a la página de releases.
(function () {
  var REPO = 'sanchezmendozajean/db-explorer';

  function formatSize(bytes) {
    return Math.round(bytes / (1024 * 1024)) + ' MB';
  }

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (release) {
      if (!release || !release.assets) return;
      var setup = release.assets.find(function (a) {
        return /instalador\.exe$/i.test(a.name);
      });
      var portable = release.assets.find(function (a) {
        return /portable\.exe$/i.test(a.name);
      });
      if (!setup) return;
      var version = String(release.tag_name || '').replace(/^v/, '');
      document.querySelectorAll('.js-download').forEach(function (a) {
        a.href = setup.browser_download_url;
      });
      document.querySelectorAll('.js-download-label').forEach(function (s) {
        s.textContent = 'Descargar v' + version;
      });
      document.querySelectorAll('.js-release-meta').forEach(function (p) {
        p.textContent = 'Windows 10 / 11 · 64 bits · ' + formatSize(setup.size);
      });
      if (portable) {
        document.querySelectorAll('.js-portable').forEach(function (a) {
          a.href = portable.browser_download_url;
        });
      }
    })
    .catch(function () {
      /* se conserva el enlace a la página de releases */
    });
})();
