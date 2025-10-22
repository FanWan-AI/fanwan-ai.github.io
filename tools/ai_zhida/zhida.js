'use strict';

(function(){
  if (!document.body || !document.body.classList.contains('zhida-page')) {
    return;
  }

  const body = document.body;
  const windowConfig = window.ZHIDA_CONFIG || {};
  const proxyAttr = body.getAttribute('data-proxy-endpoint') || '';
  const endpoint = (windowConfig.endpoint || proxyAttr || '').trim();
  const DEFAULT_TEMP = typeof windowConfig.defaultTemperature === 'number' ? windowConfig.defaultTemperature : 0.7;
  const DEFAULT_MAX_TOKENS = typeof windowConfig.defaultMaxTokens === 'number' ? windowConfig.defaultMaxTokens : 1024;
  const MAX_FILES = typeof windowConfig.maxFiles === 'number' ? windowConfig.maxFiles : 6;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const SUPPORTED_EXT = ['pdf', 'txt', 'md', 'docx', 'xlsx'];
  const STORAGE = {
    HISTORY: 'zhida:messages:v1',
    SETTINGS: 'zhida:settings:v1'
  };
  const DEFAULT_PROMPTS = {
    zh: '你是万凡网站的 AI 智答助手，请优先使用中文，回答保持简洁并在引用资料时标注来源。',
    en: "You are the AI Q&A assistant on Fan Wan's site. Reply concisely, prefer English when unsure, and cite sources when available.",
    es: 'Eres el asistente AI Respuestas del sitio de Fan Wan. Responde con concisión, prioriza el español cuando sea posible y cita las fuentes disponibles.'
  };

  const state = {
    messages: [],
    files: [],
    mode: 'chat',
    streaming: false,
    assistantIndex: null,
    settingsOpen: false
  };

  const el = {
    app: document.querySelector('[data-zhida-app]'),
    messages: document.querySelector('[data-chat-messages]'),
    form: document.querySelector('[data-chat-form]'),
    input: document.querySelector('[data-chat-input]'),
    sendBtn: document.querySelector('[data-action="send"]'),
    stopBtn: document.querySelector('[data-action="stop"]'),
    clearBtn: document.querySelector('[data-action="clear"]'),
    statusText: document.querySelector('[data-status-text]'),
    proxyWarning: document.querySelector('[data-proxy-warning]'),
    toast: document.querySelector('[data-chat-error]'),
    fileInput: document.querySelector('[data-file-input]'),
    chooseFileBtn: document.querySelector('[data-action="choose-file"]'),
    fileList: document.querySelector('[data-file-list]'),
    modeInputs: document.querySelectorAll('[data-mode-input]'),
    temperature: document.querySelector('[data-temperature]'),
    temperatureValue: document.querySelector('[data-temperature-value]'),
    maxTokens: document.querySelector('[data-max-tokens]'),
    systemPrompt: document.querySelector('[data-system-prompt]'),
    settingsBtn: document.querySelector('[data-action="settings"]'),
    settingsPanel: document.querySelector('[data-settings-panel]'),
    settingsOverlay: document.querySelector('[data-settings-overlay]'),
    settingsClose: document.querySelector('[data-settings-close]'),
    settingsSheet: document.querySelector('[data-settings-panel] .zhida-settings-sheet')
  };

  if (!el.messages || !el.form || !el.input) {
    return;
  }

  let toastTimer = null;
  const client = new DeepSeekClient(endpoint);

  init();

  function init() {
    loadSettings();
    loadMessages();
    ensureWelcomeMessage();
    renderMessages();
    renderFileList();
    bindEvents();
    refreshControls();
    if (!endpoint) {
      toggleProxyWarning(true);
      notify(t('ai_qa_proxy_missing'), 'warning');
    } else {
      setStatus('ready');
    }
  }

  function bindEvents() {
    el.form.addEventListener('submit', handleSend);
    el.clearBtn.addEventListener('click', handleClear);
    el.stopBtn.addEventListener('click', handleStop);
    el.input.addEventListener('input', autoResizeInput);
    el.input.addEventListener('keydown', handleInputKeydown);
    el.modeInputs.forEach(radio => radio.addEventListener('change', handleModeChange));
    if (el.temperature) {
      el.temperature.addEventListener('input', handleTemperatureChange);
    }
    if (el.maxTokens) {
      el.maxTokens.addEventListener('input', handleMaxTokensChange);
      el.maxTokens.addEventListener('change', handleMaxTokensChange);
    }
    if (el.systemPrompt) {
      el.systemPrompt.addEventListener('input', handleSystemPromptChange);
    }
    if (el.app) {
      el.app.addEventListener('dragover', handleDragOver);
      el.app.addEventListener('dragleave', handleDragLeave);
      el.app.addEventListener('drop', handleDrop);
    }
    if (el.fileInput) {
      el.fileInput.addEventListener('change', handleFileSelect);
    }
    if (el.chooseFileBtn && el.fileInput) {
      el.chooseFileBtn.addEventListener('click', handleChooseFileClick);
    }
    if (el.fileList) {
      el.fileList.addEventListener('click', handleFileListClick);
    }
    if (el.settingsBtn) {
      el.settingsBtn.addEventListener('click', openSettingsPanel);
    }
    if (el.settingsOverlay) {
      el.settingsOverlay.addEventListener('click', closeSettingsPanel);
    }
    if (el.settingsClose) {
      el.settingsClose.addEventListener('click', closeSettingsPanel);
    }
    document.addEventListener('keydown', handleGlobalKeydown);
    autoResizeInput();
  }

  function loadSettings() {
    const lang = getLang();
    const raw = storageGet(STORAGE.SETTINGS);
    let settings = null;
    if (raw) {
      try {
        settings = JSON.parse(raw);
      } catch (_) {
        settings = null;
      }
    }
    if (!settings) {
      settings = {
        temperature: DEFAULT_TEMP,
        maxTokens: DEFAULT_MAX_TOKENS,
        systemPrompt: DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.zh,
        mode: 'chat'
      };
    }
    state.mode = settings.mode === 'rag' ? 'rag' : 'chat';
    if (el.temperature && typeof settings.temperature === 'number') {
      el.temperature.value = String(settings.temperature);
      updateTemperatureDisplay(settings.temperature);
    }
    if (el.maxTokens && typeof settings.maxTokens === 'number') {
      el.maxTokens.value = String(settings.maxTokens);
    }
    if (el.systemPrompt) {
      el.systemPrompt.value = settings.systemPrompt || DEFAULT_PROMPTS[lang] || '';
    }
    el.modeInputs.forEach(radio => {
      radio.checked = radio.value === state.mode;
    });
  }

  function persistSettings() {
    const settings = {
      temperature: getTemperature(),
      maxTokens: getMaxTokens(),
      systemPrompt: getSystemPrompt(),
      mode: state.mode
    };
    storageSet(STORAGE.SETTINGS, JSON.stringify(settings));
  }

  function loadMessages() {
    const raw = storageGet(STORAGE.HISTORY);
    if (!raw) {
      state.messages = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.messages = parsed.slice(-60).map(item => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: typeof item.content === 'string' ? item.content : '',
          createdAt: item.createdAt || Date.now()
        }));
      } else {
        state.messages = [];
      }
    } catch (_) {
      state.messages = [];
    }
  }

  function persistMessages() {
    const payload = state.messages.slice(-60).map(msg => ({
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt || Date.now()
    }));
    storageSet(STORAGE.HISTORY, JSON.stringify(payload));
  }

  function ensureWelcomeMessage() {
    if (!state.messages.length || state.messages[0].role !== 'assistant') {
      state.messages.unshift({
        role: 'assistant',
        content: t('ai_qa_welcome'),
        createdAt: Date.now()
      });
      persistMessages();
    }
  }

  function renderMessages() {
    el.messages.innerHTML = '';
    state.messages.forEach((msg, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = `zhida-message zhida-message--${msg.role}`;

      const avatar = document.createElement('span');
      avatar.className = 'zhida-message-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = msg.role === 'assistant' ? assistantIcon() : userIcon();

      const bubble = document.createElement('div');
      bubble.className = 'zhida-message-bubble';

      const text = document.createElement('div');
      text.className = 'zhida-message-text';
      renderText(text, msg.content);

      bubble.appendChild(text);
      wrapper.appendChild(avatar);
      wrapper.appendChild(bubble);
      el.messages.appendChild(wrapper);

      if (index === state.messages.length - 1) {
        wrapper.scrollIntoView({ block: 'end' });
      }
    });
  }

  function renderText(container, content) {
    container.innerHTML = '';
    const lines = String(content || '').split('\n');
    lines.forEach(line => {
      const p = document.createElement('p');
      p.textContent = line;
      container.appendChild(p);
    });
    if (!container.children.length) {
      const p = document.createElement('p');
      p.textContent = '';
      container.appendChild(p);
    }
  }

  function handleSend(event) {
    event.preventDefault();
    if (state.streaming) return;
    if (!endpoint) {
      toggleProxyWarning(true);
      notify(t('ai_qa_proxy_missing'), 'warning');
      return;
    }
    const value = el.input.value.trim();
    if (!value) return;

    clearNotification();

    const userMessage = {
      role: 'user',
      content: value,
      createdAt: Date.now()
    };
    state.messages.push(userMessage);
    persistMessages();
    el.input.value = '';
    autoResizeInput();
    renderMessages();

    const payload = buildPayload();
    const assistantMessage = {
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true
    };
    state.messages.push(assistantMessage);
    state.assistantIndex = state.messages.length - 1;
    setStatus('streaming');
    setStreaming(true);
    renderMessages();

    client.streamChat(payload, {
      onStart: clearNotification,
      onDelta: appendAssistantChunk,
      onComplete: () => finalizeAssistant(false),
      onError: handleStreamError
    }).catch(error => {
      if (error && error.name === 'AbortError') {
        return;
      }
      console.error(error);
    });
  }

  function handleStop() {
    if (!state.streaming) return;
    client.cancel();
    finalizeAssistant(true);
  }

  function handleClear() {
    state.messages = [];
    ensureWelcomeMessage();
    persistMessages();
    renderMessages();
    setStatus('ready');
    clearNotification();
  }

  function handleStreamError(error) {
    if (error && error.name === 'AbortError') {
      finalizeAssistant(true);
      return;
    }
    const message = getErrorMessage(error);
    if (state.assistantIndex != null) {
      const assistant = state.messages[state.assistantIndex];
      if (assistant && !assistant.content.trim()) {
        assistant.content = message;
      }
    }
    finalizeAssistant(false);
    notify(message, 'error');
  }

  function appendAssistantChunk(chunk) {
    if (typeof chunk !== 'string' || !chunk) return;
    if (state.assistantIndex == null) return;
    const assistant = state.messages[state.assistantIndex];
    if (!assistant) return;
    assistant.content += chunk;
    renderMessages();
  }

  function finalizeAssistant(interrupted) {
    if (state.assistantIndex != null) {
      const assistant = state.messages[state.assistantIndex];
      if (assistant) {
        assistant.streaming = false;
        if (interrupted && !assistant.content.trim()) {
          state.messages.splice(state.assistantIndex, 1);
        }
      }
    }
    state.assistantIndex = null;
    setStreaming(false);
    if (!state.streaming) {
      setStatus('ready');
    }
    persistMessages();
    renderMessages();
  }

  function buildPayload() {
    const messages = [];
    const system = getSystemPrompt();
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    state.messages.forEach((msg, index) => {
      if (index === state.assistantIndex && msg.streaming) {
        return;
      }
      messages.push({ role: msg.role, content: msg.content });
    });
    const payload = {
      model: windowConfig.model || 'deepseek-chat',
      stream: true,
      messages,
      temperature: getTemperature(),
      max_tokens: getMaxTokens()
    };
    if (state.mode === 'rag') {
      payload.mode = 'rag';
    }
    return payload;
  }

  function autoResizeInput() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 220) + 'px';
  }

  function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  }

  function handleModeChange(event) {
    if (!event.target.checked) return;
    state.mode = event.target.value === 'rag' ? 'rag' : 'chat';
    persistSettings();
    if (state.mode === 'rag') {
      notify(t('ai_qa_docs_coming_soon'), 'warning');
    } else {
      clearNotification();
      setStatus('ready');
    }
  }

  function handleTemperatureChange(event) {
    const value = Number(event.target.value);
    updateTemperatureDisplay(value);
    persistSettings();
  }

  function updateTemperatureDisplay(value) {
    if (!el.temperatureValue) return;
    const safe = Number.isFinite(value) ? value : DEFAULT_TEMP;
    el.temperatureValue.textContent = safe.toFixed(1);
  }

  function handleMaxTokensChange() {
    persistSettings();
  }

  function handleSystemPromptChange() {
    persistSettings();
  }

  function handleDragOver(event) {
    if (!el.app) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    el.app.classList.add('is-drop-active');
  }

  function handleDragLeave(event) {
    if (!el.app) return;
    event.preventDefault();
    const toElement = event.relatedTarget;
    if (!toElement || !el.app.contains(toElement)) {
      el.app.classList.remove('is-drop-active');
    }
  }

  function handleDrop(event) {
    if (!el.app) return;
    event.preventDefault();
    el.app.classList.remove('is-drop-active');
    const files = Array.from(event.dataTransfer.files || []);
    processFiles(files);
  }

  function handleChooseFileClick() {
    if (el.fileInput) {
      el.fileInput.click();
    }
  }

  function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    processFiles(files);
    event.target.value = '';
  }

  function handleFileListClick(event) {
    const button = event.target.closest('[data-file-remove]');
    if (!button) return;
    const id = button.getAttribute('data-file-remove');
    state.files = state.files.filter(file => file.id !== id);
    renderFileList();
  }

  function openSettingsPanel() {
    if (!el.settingsPanel || state.settingsOpen) return;
    el.settingsPanel.hidden = false;
    el.settingsPanel.setAttribute('aria-hidden', 'false');
    body.classList.add('zhida-settings-open');
    state.settingsOpen = true;
    focusSettingsPanel();
  }

  function closeSettingsPanel() {
    if (!el.settingsPanel || !state.settingsOpen) return;
    el.settingsPanel.hidden = true;
    el.settingsPanel.setAttribute('aria-hidden', 'true');
    body.classList.remove('zhida-settings-open');
    state.settingsOpen = false;
    if (el.settingsBtn) {
      el.settingsBtn.focus();
    }
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape' && state.settingsOpen) {
      event.preventDefault();
      closeSettingsPanel();
    }
  }

  function focusSettingsPanel() {
    if (!el.settingsSheet) return;
    const focusable = el.settingsSheet.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const target = focusable[0];
    window.requestAnimationFrame(() => target.focus());
  }

  function processFiles(files) {
    if (!files.length) return;
    const accepted = [];
    for (const file of files) {
      if (state.files.length + accepted.length >= MAX_FILES) {
        notify(format(t('ai_qa_file_limit_reached'), { count: String(MAX_FILES) }), 'warning');
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        notify(format(t('ai_qa_error_file_too_large'), { name: file.name }), 'warning');
        continue;
      }
      const ext = getExtension(file.name);
      if (!SUPPORTED_EXT.includes(ext)) {
        notify(format(t('ai_qa_error_file_type'), { name: file.name }), 'warning');
        continue;
      }
      accepted.push({
        id: createId(),
        name: file.name,
        size: file.size,
        type: ext,
        status: 'pending',
        file
      });
    }
    if (!accepted.length) return;
    state.files = state.files.concat(accepted);
    renderFileList();
  }

  function renderFileList() {
    if (!el.fileList) return;
    el.fileList.innerHTML = '';
    el.fileList.classList.toggle('is-empty', state.files.length === 0);
    state.files.forEach(file => {
      const chip = document.createElement('span');
      chip.className = 'zhida-file-chip';
      chip.dataset.status = file.status;
      chip.title = `${file.name} · ${formatBytes(file.size)}`;

      const name = document.createElement('span');
      name.className = 'zhida-file-chip-name';
      name.textContent = truncate(file.name, 40);

      const status = document.createElement('span');
      status.className = 'zhida-file-chip-status';
      status.textContent = t('ai_qa_file_status_pending');

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'zhida-file-chip-remove';
      remove.setAttribute('data-file-remove', file.id);
      remove.setAttribute('aria-label', t('ai_qa_file_remove'));
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="sr-only">' + t('ai_qa_file_remove') + '</span>';

      chip.appendChild(name);
      chip.appendChild(status);
      chip.appendChild(remove);
      el.fileList.appendChild(chip);
    });
  }

  function refreshControls() {
    if (el.sendBtn) {
      el.sendBtn.disabled = !endpoint;
    }
    if (el.stopBtn) {
      el.stopBtn.hidden = true;
      el.stopBtn.disabled = true;
    }
  }

  function setStreaming(value) {
    state.streaming = value;
    body.classList.toggle('zhida-streaming', value);
    if (el.stopBtn) {
      el.stopBtn.hidden = !value;
      el.stopBtn.disabled = !value;
    }
    if (el.sendBtn) {
      el.sendBtn.disabled = value || !endpoint;
    }
  }

  function setStatus(status) {
    if (!el.statusText) return;
    const spans = el.statusText.querySelectorAll('[data-state]');
    spans.forEach(span => {
      span.hidden = span.getAttribute('data-state') !== status;
    });
    if (status === 'error') {
      body.classList.add('zhida-error');
    } else {
      body.classList.remove('zhida-error');
    }
  }

  function toggleProxyWarning(show) {
    if (!el.proxyWarning) return;
    el.proxyWarning.hidden = !show;
  }

  function notify(message, variant = 'error') {
    if (!el.toast || !message) return;
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.classList.remove('zhida-toast--error', 'zhida-toast--warning');
    el.toast.classList.add(variant === 'warning' ? 'zhida-toast--warning' : 'zhida-toast--error');
    if (variant === 'error') {
      setStatus('error');
    }
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
      if (!state.streaming) {
        setStatus('ready');
      }
    }, variant === 'error' ? 7000 : 4500);
  }

  function clearNotification() {
    if (!el.toast) return;
    clearTimeout(toastTimer);
    el.toast.hidden = true;
    if (!state.streaming) {
      setStatus('ready');
    }
  }

  function getTemperature() {
    if (!el.temperature) return DEFAULT_TEMP;
    const value = Number(el.temperature.value);
    return Number.isFinite(value) ? value : DEFAULT_TEMP;
  }

  function getMaxTokens() {
    if (!el.maxTokens) return DEFAULT_MAX_TOKENS;
    const value = parseInt(el.maxTokens.value, 10);
    if (Number.isNaN(value)) return DEFAULT_MAX_TOKENS;
    return Math.min(Math.max(value, 256), 4096);
  }

  function getSystemPrompt() {
    if (!el.systemPrompt) {
      const lang = getLang();
      return DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.zh;
    }
    const value = el.systemPrompt.value.trim();
    if (value) return value;
    const lang = getLang();
    return DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.zh;
  }

  function getErrorMessage(error) {
    if (!error) return t('ai_qa_error_generic');
    if (error.code === 'network') return t('ai_qa_error_network');
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
    return t('ai_qa_error_generic');
  }

  function getLang() {
    try {
      if (typeof resolveLang === 'function') {
        return (resolveLang() || 'zh').slice(0, 2);
      }
    } catch (_) {}
    return (document.documentElement.lang || 'zh').slice(0, 2);
  }

  function t(key) {
    const lang = getLang();
    if (typeof translations !== 'undefined') {
      if (translations[lang] && translations[lang][key]) {
        return translations[lang][key];
      }
      if (translations.zh && translations.zh[key]) {
        return translations.zh[key];
      }
    }
    return key;
  }

  function truncate(value, max) {
    const str = String(value || '');
    const limit = typeof max === 'number' && max > 0 ? max : 32;
    if (str.length <= limit) {
      return str;
    }
    return str.slice(0, Math.max(0, limit - 1)) + '…';
  }

  function format(template, params) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\w+)\}/g, function(_, token) {
      return Object.prototype.hasOwnProperty.call(params || {}, token) ? params[token] : '';
    });
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_) {}
  }

  function getExtension(name) {
    const parts = String(name || '').toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function createId() {
    return 'f_' + Math.random().toString(36).slice(2, 10);
  }

  function assistantIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a7 7 0 0 1 7 7c0 2.08-.9 3.9-2.37 5.2-.8.7-1.38 1.65-1.58 2.7h-6.1c-.2-1.05-.78-2-1.58-2.7A6.96 6.96 0 0 1 5 10.5a7 7 0 0 1 7-7z"/><path d="M10 19.5h4"/><path d="M9.5 21h5"/></g></svg>';
  }

  function userIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/></g></svg>';
  }

  function parseError(response) {
    return response.json().then(data => {
      const error = new Error(data && data.error && data.error.message ? data.error.message : t('ai_qa_error_generic'));
      if (data && data.error && data.error.code) {
        error.code = data.error.code;
      }
      return error;
    }).catch(() => new Error(t('ai_qa_error_generic')));
  }

  function extractDelta(json) {
    if (!json || !Array.isArray(json.choices) || !json.choices.length) return '';
    const choice = json.choices[0];
    if (choice.delta && typeof choice.delta.content === 'string') {
      return choice.delta.content;
    }
    if (choice.message && typeof choice.message.content === 'string') {
      return choice.message.content;
    }
    return '';
  }

  class DeepSeekClient {
    constructor(endpointUrl) {
      this.endpoint = endpointUrl;
      this.controller = null;
    }

    cancel() {
      if (this.controller) {
        this.controller.abort();
      }
      this.controller = null;
    }

    async streamChat(payload, handlers) {
      if (!this.endpoint) {
        throw new Error('Missing proxy endpoint');
      }
      this.cancel();
      this.controller = new AbortController();
      const signal = this.controller.signal;
      const headers = Object.assign({ 'Content-Type': 'application/json' }, windowConfig.headers || {});
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal
        });

        if (!response.ok) {
          const err = await parseError(response);
          handlers && handlers.onError && handlers.onError(err);
          throw err;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!response.body || contentType.indexOf('text/event-stream') === -1) {
          const data = await response.json().catch(() => ({}));
          handlers && handlers.onStart && handlers.onStart();
          const text = extractDelta(data);
          if (text) {
            handlers && handlers.onDelta && handlers.onDelta(text);
          }
          handlers && handlers.onComplete && handlers.onComplete();
          return;
        }

        handlers && handlers.onStart && handlers.onStart();

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let doneStreaming = false;

        while (!doneStreaming) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const result = processBuffer(buffer, handlers);
          buffer = result.buffer;
          doneStreaming = result.done;
        }

        if (buffer && !doneStreaming) {
          processBuffer(buffer, handlers);
        }

        handlers && handlers.onComplete && handlers.onComplete();
      } catch (error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        const err = error && error.code ? error : new Error(t('ai_qa_error_network'));
        err.code = err.code || 'network';
        handlers && handlers.onError && handlers.onError(err);
        throw err;
      } finally {
        this.controller = null;
      }
    }
  }

  function processBuffer(buffer, handlers) {
    const segments = buffer.split('\n\n');
    buffer = segments.pop() || '';
    let done = false;
    segments.forEach(segment => {
      const lines = segment.split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') {
          done = true;
          return;
        }
        let json;
        try {
          json = JSON.parse(payload);
        } catch (_) {
          return;
        }
        const text = extractDelta(json);
        if (text && handlers && handlers.onDelta) {
          handlers.onDelta(text);
        }
      });
    });
    return { buffer, done };
  }

})();
