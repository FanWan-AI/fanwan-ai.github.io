(function(){
  var doc = document.documentElement;
  if (!doc) { return; }

  // Mark language as loading so CSS can hide translatable content
  doc.setAttribute('data-lang-loading', 'true');

  var forced = doc.getAttribute('data-force-lang');
  var allowed = { zh: true, en: true, es: true };
  var lang = 'zh';

  try {
    var stored = forced ? forced : (window.localStorage ? window.localStorage.getItem('lang') : null);
    var candidate = forced || stored || doc.getAttribute('lang') || 'zh';
    candidate = (candidate || 'zh').toLowerCase().slice(0, 2);
    lang = allowed[candidate] ? candidate : 'zh';
    if (forced && window.localStorage) {
      window.localStorage.setItem('lang', lang);
    }
  } catch (err) {
    lang = (forced && allowed[forced]) ? forced : 'zh';
  }

  doc.setAttribute('lang', lang);

  try {
    if (typeof window !== 'undefined') {
      window.__langReadyFallback = window.setTimeout(function(){
        doc.removeAttribute('data-lang-loading');
        doc.setAttribute('data-lang-timeout', 'true');
      }, 2000);
    }
  } catch {}
})();
