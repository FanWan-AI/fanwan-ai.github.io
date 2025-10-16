(function(){
  'use strict';

  function ready(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function base64ToUint8(str){
    const binary = atob(str);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function concatUint8(a, b){
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    return merged;
  }

  const STRINGS = {
    zh: {
      title: '文章受保护',
      subtitle: '请输入访问密码以解锁全文。',
      passwordLabel: '访问密码',
      passwordPlaceholder: '输入访问密码',
      submit: '解锁',
      hint: '密码区分大小写，仅向受邀读者提供。',
      loading: '正在验证密码…',
      success: '解锁成功，正在载入内容…',
      errorWrong: '密码不正确，请重试。',
      errorNetwork: '无法载入加密内容，请稍后重试。',
      errorGeneric: '解锁过程中出现异常，请刷新页面后重试。',
      errorCrypto: '当前浏览器不支持本地解密，请使用最新的 Chromium、Firefox 或 Safari。',
      home: '返回博客主页'
    },
    en: {
      title: 'Protected Article',
      subtitle: 'Enter the access passphrase to unlock the full post.',
      passwordLabel: 'Passphrase',
      passwordPlaceholder: 'Enter passphrase',
      submit: 'Unlock',
      hint: 'Case-sensitive; shared only with invited readers.',
      loading: 'Verifying passphrase…',
      success: 'Unlocked. Rendering secured content…',
      errorWrong: 'Incorrect passphrase. Please try again.',
      errorNetwork: 'We could not load the encrypted payload. Please try again shortly.',
      errorGeneric: 'Something went wrong during unlock. Please refresh and try again.',
      errorCrypto: 'Your browser does not support on-device decryption. Try the latest Chromium, Firefox, or Safari.',
      home: 'Back to Blog Home'
    },
    es: {
      title: 'Artículo protegido',
      subtitle: 'Introduce la contraseña para desbloquear el artículo completo.',
      passwordLabel: 'Contraseña',
      passwordPlaceholder: 'Introduce la contraseña',
      submit: 'Desbloquear',
      hint: 'Distingue mayúsculas/minúsculas; solo se comparte con lectores autorizados.',
      loading: 'Verificando contraseña…',
      success: 'Contenido desbloqueado. Cargando…',
      errorWrong: 'Contraseña incorrecta. Inténtalo de nuevo.',
      errorNetwork: 'No pudimos cargar el contenido cifrado. Vuelve a intentarlo más tarde.',
      errorGeneric: 'Ocurrió un problema durante el desbloqueo. Actualiza la página e inténtalo otra vez.',
      errorCrypto: 'Tu navegador no admite el descifrado local. Usa la última versión de Chromium, Firefox o Safari.',
      home: 'Volver al blog'
    }
  };

  function createOverlay(strings, options){
    const homeHref = options && typeof options.homeHref === 'string' && options.homeHref.trim() ? options.homeHref.trim() : '../blog.html';
    const overlay = document.createElement('div');
    overlay.className = 'secure-overlay';
    overlay.innerHTML = `
      <div class="secure-overlay__backdrop" aria-hidden="true"></div>
      <div class="secure-overlay__panel" role="dialog" aria-modal="true" aria-labelledby="secure-overlay-title">
        <div class="secure-overlay__icon" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="28" width="40" height="30" rx="6" ry="6"/><path d="M20 28v-8a12 12 0 0 1 24 0v8"/><circle cx="32" cy="44" r="6"/><path d="M32 50v6"/></g></svg>
        </div>
        <div class="secure-overlay__body">
          <h2 id="secure-overlay-title" class="secure-overlay__title">${strings.title}</h2>
          <p class="secure-overlay__subtitle">${strings.subtitle}</p>
          <form class="secure-overlay__form" autocomplete="off" novalidate>
            <label class="secure-overlay__label" for="secure-overlay-input">${strings.passwordLabel}</label>
            <div class="secure-overlay__input-group">
              <input id="secure-overlay-input" class="secure-overlay__input" type="password" required autocomplete="current-password" placeholder="${strings.passwordPlaceholder}" aria-describedby="secure-overlay-hint secure-overlay-status" />
              <button type="submit" class="secure-overlay__submit">${strings.submit}</button>
            </div>
            <p id="secure-overlay-hint" class="secure-overlay__hint">${strings.hint}</p>
            <p id="secure-overlay-status" class="secure-overlay__status" role="status" aria-live="polite"></p>
          </form>
          <div class="secure-overlay__actions">
            <a class="secure-overlay__home" href="${homeHref}">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.8V20h5.5v-5.6h3V20H19v-9.2"/></g></svg>
              <span>${strings.home}</span>
            </a>
          </div>
        </div>
      </div>
    `;

    const panel = overlay.querySelector('.secure-overlay__panel');
    const form = overlay.querySelector('.secure-overlay__form');
    const input = overlay.querySelector('.secure-overlay__input');
    const submit = overlay.querySelector('.secure-overlay__submit');
    const status = overlay.querySelector('.secure-overlay__status');

    function setBusy(busy, message){
      overlay.classList.toggle('secure-overlay--busy', busy);
      submit.disabled = busy;
      input.disabled = busy;
      submit.setAttribute('aria-busy', busy ? 'true' : 'false');
      panel.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (busy) {
        status.textContent = message || '';
        status.classList.remove('secure-overlay__status--error');
      }
    }

    function setError(text){
      status.textContent = text;
      status.classList.toggle('secure-overlay__status--error', Boolean(text));
    }

    function clearError(){
      setError('');
    }

    function focusInput(){
      try {
        input.focus({ preventScroll: true });
      } catch (err) {
        try { input.focus(); } catch (_) {}
      }
    }

    function close(){
      overlay.classList.add('secure-overlay--closing');
      overlay.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        overlay.remove();
      }, 220);
      document.body.classList.remove('secure-overlay-active');
    }

    document.body.classList.add('secure-overlay-active');

    return {
      root: overlay,
      panel,
      form,
      input,
      submit,
      status,
      setBusy,
      setError,
      clearError,
      focusInput,
      close
    };
  }

  ready(() => {
    const secureMain = document.querySelector('main.blog-post[data-secure-source]');
    if (!secureMain) return;
    const source = secureMain.getAttribute('data-secure-source');
    if (!source) return;
  const contentSlot = secureMain.querySelector('[data-secure-content]');
    if (!contentSlot) return;

    const guardNodes = Array.from(secureMain.querySelectorAll('[data-secure-guard]'));
    const localePref = (secureMain.getAttribute('data-secure-lang') || document.documentElement.lang || 'zh').slice(0, 2).toLowerCase();
    const strings = STRINGS[localePref] || STRINGS.zh;
    const homeHref = secureMain.getAttribute('data-secure-home') || '../blog.html';

    secureMain.classList.add('secure-post--locked');
    contentSlot.hidden = true;

    if (!(window.crypto && window.crypto.subtle)) {
      guardNodes.forEach(node => {
        node.classList.add('secure-post-guard--error');
        const msg = document.createElement('p');
        msg.className = 'secure-post-guard__error';
        msg.textContent = strings.errorCrypto;
        node.appendChild(msg);
      });
      return;
    }

    let unlocked = false;
    let recordPromise = null;

  const overlay = createOverlay(strings, { homeHref });
    document.body.appendChild(overlay.root);
    overlay.focusInput();

    overlay.input.addEventListener('input', () => {
      overlay.clearError();
      overlay.input.setAttribute('aria-invalid', 'false');
    });

    overlay.root.addEventListener('click', (event) => {
      if (event.target === overlay.root || event.target.classList.contains('secure-overlay__backdrop')) {
        overlay.focusInput();
      }
    });

    overlay.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        overlay.focusInput();
      }
    });

    function loadRecord(){
      if (!recordPromise) {
        recordPromise = fetch(source, { cache: 'no-store', credentials: 'omit' })
          .then(resp => {
            if (!resp.ok) throw new Error('secure-fetch');
            return resp.json();
          })
          .catch(err => {
            recordPromise = null;
            throw err;
          });
      }
      return recordPromise;
    }

    async function deriveKey(password, record){
      const enc = new TextEncoder();
      const salt = base64ToUint8(record.salt);
      const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      return window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt,
          iterations: Number(record.iterations) || 210000,
          hash: 'SHA-256'
        },
        keyMaterial,
        {
          name: 'AES-GCM',
          length: 256
        },
        false,
        ['decrypt']
      );
    }

    async function decryptPayload(password){
      const record = await loadRecord();
      const key = await deriveKey(password, record);
      const iv = base64ToUint8(record.iv);
      const cipher = base64ToUint8(record.ciphertext);
      const tag = base64ToUint8(record.tag);
      const payload = concatUint8(cipher, tag);
      const plainBuffer = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
      const decoder = new TextDecoder(record.encoding || 'utf-8');
      return decoder.decode(plainBuffer);
    }

    function classifyError(err){
      if (!err) return 'generic';
      if (err.message === 'secure-fetch') return 'network';
      if (err.message === 'secure-empty') return 'generic';
      const name = err.name || '';
      if (name === 'AbortError') return 'network';
      if (name === 'NotSupportedError') return 'crypto';
      if (name === 'OperationError') return 'auth';
      if (typeof DOMException !== 'undefined') {
        try {
          if (err instanceof DOMException && err.name === 'OperationError') return 'auth';
          if (err.code === DOMException.DATA_ERR || err.code === DOMException.INVALID_ACCESS_ERR) return 'auth';
        } catch (_) {}
      }
      if (err.message && /OperationError/i.test(err.message)) return 'auth';
      if (err instanceof TypeError) return 'network';
      return 'generic';
    }

    function injectContent(html){
      if (unlocked) return;
      unlocked = true;
      const slug = secureMain.getAttribute('data-secure-slug') || '';
      guardNodes.forEach(node => node.remove());
      const template = document.createElement('template');
      template.innerHTML = html;
      let nextMain = null;
      if (template.content.childElementCount === 1) {
        const onlyChild = template.content.firstElementChild;
        if (onlyChild && onlyChild.tagName && onlyChild.tagName.toLowerCase() === 'main') {
          nextMain = onlyChild;
        }
      }

      let activeMain = secureMain;
      if (nextMain) {
        secureMain.replaceWith(nextMain);
        activeMain = nextMain;
        ['data-secure-source','data-secure-slug','data-secure-lang','data-secure-home'].forEach(attr => nextMain.removeAttribute(attr));
        nextMain.classList.remove('secure-post', 'secure-post--locked', 'secure-post--unlocked');
      } else {
        const fragment = template.content;
        secureMain.innerHTML = '';
        secureMain.appendChild(fragment);
        secureMain.classList.remove('secure-post', 'secure-post--locked', 'secure-post--unlocked');
        ['data-secure-source','data-secure-slug','data-secure-lang','data-secure-home'].forEach(attr => secureMain.removeAttribute(attr));
        contentSlot.hidden = false;
        activeMain = secureMain;
      }

      try {
        const sections = activeMain ? activeMain.querySelectorAll('.section') : [];
        sections.forEach(section => section.classList.add('visible'));
        activeMain.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {}

      overlay.close();
      window.dispatchEvent(new CustomEvent('secure-post:rehydrate', {
        detail: {
          source,
          slug
        }
      }));
      try {
        if (typeof window.__fanwanBlogRefresh === 'function') {
          window.__fanwanBlogRefresh();
        }
      } catch (_) {}
    }

    overlay.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (unlocked) return;
      const password = overlay.input.value.trim();
      if (!password) {
        overlay.setError(strings.errorWrong);
        overlay.input.setAttribute('aria-invalid', 'true');
        overlay.focusInput();
        return;
      }
      overlay.clearError();
      overlay.input.setAttribute('aria-invalid', 'false');
      overlay.setBusy(true, strings.loading);
      try {
        const html = await decryptPayload(password);
        if (!html || !html.trim()) {
          throw new Error('secure-empty');
        }
        overlay.setBusy(true, strings.success);
        injectContent(html);
      } catch (err) {
        console.warn('secure-post unlock failed', err);
        const kind = classifyError(err);
        overlay.setBusy(false);
        if (kind === 'crypto') {
          overlay.setError(strings.errorCrypto);
        } else if (kind === 'network') {
          overlay.setError(strings.errorNetwork);
        } else if (kind === 'auth') {
          overlay.setError(strings.errorWrong);
        } else {
          overlay.setError(strings.errorGeneric);
        }
        overlay.input.value = '';
        overlay.input.setAttribute('aria-invalid', kind === 'auth' ? 'true' : 'false');
        overlay.focusInput();
      }
    });
  });
})();
