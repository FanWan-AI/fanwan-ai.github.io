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
  const VIEW_STATE_KEY = 'zhida:view';
  const STORAGE = {
    HISTORY: 'zhida:messages:v1',
    SETTINGS: 'zhida:settings:v1'
  };
  const DEFAULT_PROMPTS = {
    zh: '你是万凡网站的 AI 智答助手，请优先使用中文，回答保持简洁并在引用资料时标注来源。',
    en: "You are the AI Q&A assistant on Fan Wan's site. Reply concisely, prefer English when unsure, and cite sources when available.",
    es: 'Eres el asistente AI Respuestas del sitio de Fan Wan. Responde con concisión, prioriza el español cuando sea posible y cita las fuentes disponibles.'
  };
  const DEFAULT_MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js';
  const MATH_MARKERS = ['\\(', '\\[', '$$', '\\begin{'];

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
  const stageEl = document.querySelector('.zhida-stage');

  if (!el.messages || !el.form || !el.input) {
    return;
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

  let toastTimer = null;
  let lastFocusedElement = null;
  let settingsFocusTrapListener = null;
  let mathTypesetTimer = null;
  let mathJaxLoadingPromise = null;
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
    setStatus('ready');
  }

  function bindEvents() {
    el.form.addEventListener('submit', handleSend);
    if (el.clearBtn) {
      el.clearBtn.addEventListener('click', handleClear);
    }
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
    if (!state.messages.length) {
      return;
    }
    const welcomeText = t('ai_qa_welcome');
    const originalLength = state.messages.length;
    state.messages = state.messages.filter(msg => {
      if (!msg || msg.role !== 'assistant') {
        return true;
      }
      const content = typeof msg.content === 'string' ? msg.content.trim() : '';
      return content !== welcomeText;
    });
    if (state.messages.length !== originalLength) {
      persistMessages();
    }
  }

  function renderMessages() {
    el.messages.innerHTML = '';
    let hasMath = false;
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

      if (!hasMath && msg && typeof msg.content === 'string' && containsMathMarkers(msg.content)) {
        hasMath = true;
      }
    });

    if (hasMath) {
      scheduleMathTypeset();
    }
  }

  function renderText(container, content) {
    container.innerHTML = '';
    renderMarkdown(container, String(content || ''));
    if (!container.children.length) {
      const p = document.createElement('p');
      p.textContent = '';
      container.appendChild(p);
    }
  }

  function renderMarkdown(container, markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        const fence = trimmed.slice(3).trim();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          index += 1;
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence) {
          code.setAttribute('data-language', fence.toLowerCase());
        }
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      if (/^(?: {4}|\t)/.test(rawLine)) {
        const codeLines = [];
        while (index < lines.length) {
          const current = lines[index];
          if (!current.trim()) {
            codeLines.push('');
            index += 1;
            continue;
          }
          if (!/^(?: {4}|\t)/.test(current)) {
            break;
          }
          codeLines.push(current.replace(/^(?: {4}|\t)/, ''));
          index += 1;
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      const ruleCandidate = trimmed.replace(/\s+/g, '');
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(ruleCandidate)) {
        container.appendChild(document.createElement('hr'));
        index += 1;
        continue;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        const level = trimmed.match(/^#{1,6}/)[0].length;
        const text = trimmed.slice(level).trim();
        const heading = document.createElement('h' + level);
        heading.innerHTML = parseInline(text);
        container.appendChild(heading);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quoteLines.push(lines[index].replace(/^ {0,3}>\s?/, ''));
          index += 1;
        }
        const blockquote = document.createElement('blockquote');
        renderMarkdown(blockquote, quoteLines.join('\n'));
        container.appendChild(blockquote);
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        const list = document.createElement('ul');
        while (index < lines.length) {
          const current = lines[index];
          const currentTrim = current.trim();
          if (!currentTrim || !/^[-*+]\s+/.test(currentTrim)) {
            break;
          }
          const item = document.createElement('li');
          item.innerHTML = parseInline(currentTrim.replace(/^[-*+]\s+/, ''));
          list.appendChild(item);
          index += 1;
        }
        container.appendChild(list);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const list = document.createElement('ol');
        while (index < lines.length) {
          const current = lines[index];
          const currentTrim = current.trim();
          if (!currentTrim || !/^\d+\.\s+/.test(currentTrim)) {
            break;
          }
          const item = document.createElement('li');
          item.innerHTML = parseInline(currentTrim.replace(/^\d+\.\s+/, ''));
          list.appendChild(item);
          index += 1;
        }
        container.appendChild(list);
        continue;
      }

      const paragraphLines = [];
      while (index < lines.length) {
        const current = lines[index];
        const currentTrim = current.trim();
        if (!currentTrim) {
          index += 1;
          break;
        }
        if (paragraphLines.length && isBlockToken(currentTrim)) {
          break;
        }
        if (!paragraphLines.length && isBlockToken(currentTrim)) {
          break;
        }
        paragraphLines.push(current);
        index += 1;
      }
      if (!paragraphLines.length) {
        continue;
      }
      const paragraph = document.createElement('p');
      const paragraphText = paragraphLines.join('\n').trim();
      paragraph.innerHTML = parseInline(paragraphText);
      container.appendChild(paragraph);
      continue;
    }
  }

  function isBlockToken(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^```/.test(trimmed)) return true;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^>\s?/.test(trimmed)) return true;
    if (/^[-*+]\s+/.test(trimmed)) return true;
    if (/^\d+\.\s+/.test(trimmed)) return true;
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed.replace(/\s+/g, ''))) return true;
    return false;
  }

  function parseInline(text) {
    if (!text) return '';
    const codeTokens = [];
    let result = String(text).replace(/`([^`]+?)`/g, function(_, code) {
      const token = `@@CODE${codeTokens.length}@@`;
      codeTokens.push(escapeHtml(code));
      return token;
    });
    result = escapeHtml(result);
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
    result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
    result = result.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    result = result.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, label, href) {
      const cleanHref = sanitizeUrl(href);
      if (!cleanHref) return label;
      return '<a href="' + cleanHref + '" target="_blank" rel="nofollow noopener noreferrer">' + label + '</a>';
    });
    codeTokens.forEach((code, idx) => {
      result = result.replace(new RegExp('@@CODE' + idx + '@@', 'g'), '<code>' + code + '</code>');
    });
    result = result.replace(/\n/g, '<br />');
    return result;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
      return '';
    }
    if (!/^https?:/i.test(trimmed) && !trimmed.startsWith('mailto:') && !trimmed.startsWith('#')) {
      return '';
    }
    return escapeAttribute(trimmed);
  }

  function handleSend(event) {
    event.preventDefault();
    if (state.streaming) return;
    if (!endpoint) {
      notify(t('ai_qa_error_generic'), 'error');
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
    ensureChatView();
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
    el.input.style.height = Math.min(el.input.scrollHeight, 96) + 'px';
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
    if (!el.fileInput) return;
    if (state.files.length >= MAX_FILES) {
      notify(format(t('ai_qa_file_limit_reached'), { count: String(MAX_FILES) }), 'warning');
      return;
    }
    el.fileInput.click();
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
    lastFocusedElement = document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null;
    el.settingsPanel.hidden = false;
    el.settingsPanel.setAttribute('aria-hidden', 'false');
    body.classList.add('zhida-settings-open');
    state.settingsOpen = true;
    if (el.settingsSheet) {
      el.settingsSheet.addEventListener('keydown', handleSettingsKeydown);
    }
    activateSettingsFocusTrap();
    focusSettingsPanel();
  }

  function closeSettingsPanel() {
    if (!el.settingsPanel || !state.settingsOpen) return;
    el.settingsPanel.hidden = true;
    el.settingsPanel.setAttribute('aria-hidden', 'true');
    body.classList.remove('zhida-settings-open');
    state.settingsOpen = false;
    deactivateSettingsFocusTrap();
    if (el.settingsSheet) {
      el.settingsSheet.removeEventListener('keydown', handleSettingsKeydown);
    }
    if (el.settingsBtn) {
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      } else {
        el.settingsBtn.focus();
      }
    }
    lastFocusedElement = null;
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape' && state.settingsOpen) {
      event.preventDefault();
      closeSettingsPanel();
    }
  }

  function focusSettingsPanel() {
    const focusable = getSettingsFocusableElements();
    if (!focusable.length) return;
    const target = focusable[0];
    window.requestAnimationFrame(() => target.focus());
  }

  function getSettingsFocusableElements() {
    if (!el.settingsSheet) return [];
    const candidates = el.settingsSheet.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    return Array.from(candidates).filter(node => !node.disabled && node.tabIndex !== -1 && node.getAttribute('aria-hidden') !== 'true' && isElementVisible(node));
  }

  function activateSettingsFocusTrap() {
    if (!el.settingsSheet || settingsFocusTrapListener) return;
    settingsFocusTrapListener = function(event) {
      if (!state.settingsOpen) return;
      if (!el.settingsSheet.contains(event.target)) {
        const focusable = getSettingsFocusableElements();
        if (!focusable.length) return;
        focusable[0].focus();
        event.preventDefault();
      }
    };
    document.addEventListener('focus', settingsFocusTrapListener, true);
  }

  function deactivateSettingsFocusTrap() {
    if (!settingsFocusTrapListener) return;
    document.removeEventListener('focus', settingsFocusTrapListener, true);
    settingsFocusTrapListener = null;
  }

  function handleSettingsKeydown(event) {
    if (event.key !== 'Tab') return;
    const focusable = getSettingsFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
    const hasFiles = state.files.length > 0;
    el.fileList.classList.toggle('is-empty', !hasFiles);
    el.fileList.hidden = !hasFiles;
    body.classList.toggle('zhida-has-files', hasFiles);
    if (!hasFiles) {
      return;
    }
    state.files.forEach(file => {
      const chip = document.createElement('span');
      chip.className = 'zhida-file-chip';
      chip.dataset.status = file.status;
      chip.title = `${file.name} · ${formatBytes(file.size)}`;

      const icon = document.createElement('span');
      icon.className = 'zhida-file-chip-icon';
      icon.textContent = fileBadge(file.type);

      const textWrap = document.createElement('span');
      textWrap.className = 'zhida-file-chip-text';

      const name = document.createElement('span');
      name.className = 'zhida-file-chip-name';
      name.textContent = truncate(file.name, 40);

      const meta = document.createElement('span');
      meta.className = 'zhida-file-chip-meta';
      meta.textContent = formatBytes(file.size);

      textWrap.appendChild(name);
      textWrap.appendChild(meta);

      const status = document.createElement('span');
      status.className = 'zhida-file-chip-status';
      status.textContent = t('ai_qa_file_status_pending');

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'zhida-file-chip-remove';
      remove.setAttribute('data-file-remove', file.id);
      remove.setAttribute('aria-label', t('ai_qa_file_remove'));
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="sr-only">' + t('ai_qa_file_remove') + '</span>';

      chip.appendChild(icon);
      chip.appendChild(textWrap);
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
    if (status === 'error') {
      body.classList.add('zhida-error');
    } else {
      body.classList.remove('zhida-error');
    }
    if (!el.statusText) return;
    const spans = el.statusText.querySelectorAll('[data-state]');
    spans.forEach(span => {
      span.hidden = span.getAttribute('data-state') !== status;
    });
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

  function isElementVisible(node) {
    if (!node) return false;
    return !!(node.offsetWidth || node.offsetHeight || (typeof node.getClientRects === 'function' && node.getClientRects().length));
  }

  function containsMathMarkers(text) {
    if (text == null) return false;
    const value = String(text);
    for (let index = 0; index < MATH_MARKERS.length; index += 1) {
      if (value.indexOf(MATH_MARKERS[index]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function scheduleMathTypeset() {
    if (!el.messages) return;
    if (mathTypesetTimer != null) {
      clearTimeout(mathTypesetTimer);
    }
    mathTypesetTimer = window.setTimeout(() => {
      mathTypesetTimer = null;
      typesetMathIfNeeded();
    }, 120);
  }

  function typesetMathIfNeeded() {
    if (!el.messages) return;
    const hasMath = state.messages.some(msg => msg && typeof msg.content === 'string' && containsMathMarkers(msg.content));
    if (!hasMath) {
      return;
    }
    ensureMathJax()
      .then(() => {
        if (!window.MathJax) return;
        if (typeof window.MathJax.typesetClear === 'function') {
          window.MathJax.typesetClear([el.messages]);
        }
        if (typeof window.MathJax.typesetPromise === 'function') {
          return window.MathJax.typesetPromise([el.messages]);
        }
        if (typeof window.MathJax.typeset === 'function') {
          window.MathJax.typeset([el.messages]);
        }
      })
      .catch(error => {
        console.error('MathJax error', error);
      });
  }

  function ensureMathJax() {
    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
      return window.MathJax.startup.promise;
    }
    if (mathJaxLoadingPromise) {
      return mathJaxLoadingPromise;
    }
    mathJaxLoadingPromise = new Promise((resolve, reject) => {
      setupMathJaxConfig();
      const script = document.createElement('script');
      script.async = true;
      script.src = getMathJaxSrc();
      script.setAttribute('data-mathjax-loader', 'true');
      script.onload = () => {
        const ready = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise
          ? window.MathJax.startup.promise
          : Promise.resolve();
        ready.then(() => resolve()).catch(reject);
      };
      script.onerror = () => {
        mathJaxLoadingPromise = null;
        reject(new Error('Failed to load MathJax'));
      };
      document.head.appendChild(script);
    });
    return mathJaxLoadingPromise;
  }

  function setupMathJaxConfig() {
    const config = window.MathJax || {};
    config.tex = Object.assign({
      inlineMath: [['\\(', '\\)'], ['$', '$']],
      displayMath: [['\\[', '\\]'], ['$$', '$$']],
      processEscapes: true
    }, config.tex || {});
    config.options = Object.assign({
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    }, config.options || {});
    config.svg = Object.assign({
      fontCache: 'global'
    }, config.svg || {});
    config.startup = Object.assign({
      typeset: false
    }, config.startup || {});
    window.MathJax = config;
  }

  function getMathJaxSrc() {
    if (windowConfig.mathJaxSrc) {
      return windowConfig.mathJaxSrc;
    }
    const attr = body.getAttribute('data-mathjax-src');
    if (attr) {
      return attr;
    }
    return DEFAULT_MATHJAX_SRC;
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

  function ensureChatView() {
    if (stageEl && stageEl.getAttribute('data-view') !== 'chat') {
      stageEl.setAttribute('data-view', 'chat');
    }
    storageSet(VIEW_STATE_KEY, 'chat');
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

  function fileBadge(ext) {
    const safe = String(ext || '').trim().slice(0, 3).toUpperCase();
    if (safe) return safe;
    return 'FILE';
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
