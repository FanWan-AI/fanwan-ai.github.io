'use strict';

(function(){
  if (!document.body || !document.body.classList.contains('zhida-page')) {
    return;
  }

  document.documentElement.setAttribute('data-zhida-lock', 'true');
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  function lockHorizontalScroll() {
    const doc = document.documentElement;
    const body = document.body;
    const currentX = window.pageXOffset || (doc && doc.scrollLeft) || (body && body.scrollLeft) || 0;
    if (!currentX) {
      return;
    }
    const currentY = window.pageYOffset || (doc && doc.scrollTop) || (body && body.scrollTop) || 0;
    try {
      window.scrollTo({ top: currentY, left: 0, behavior: 'auto' });
    } catch (_) {
      window.scrollTo(0, currentY);
    }
    if (doc) {
      doc.scrollLeft = 0;
    }
    if (body) {
      body.scrollLeft = 0;
    }
  }

  window.addEventListener('scroll', lockHorizontalScroll, { passive: true });
  lockHorizontalScroll();

  const body = document.body;
  body.classList.add('zhida-chat-empty');
  const windowConfig = window.ZHIDA_CONFIG || {};
  const proxyAttr = body.getAttribute('data-proxy-endpoint') || '';
  const providerMap = (windowConfig.providers && typeof windowConfig.providers === 'object') ? windowConfig.providers : {};
  const FALLBACK_ENDPOINT = (windowConfig.endpoint || proxyAttr || '').trim();
  const DEFAULT_TEMP = typeof windowConfig.defaultTemperature === 'number' ? windowConfig.defaultTemperature : 0.7;
  const DEFAULT_MAX_TOKENS = typeof windowConfig.defaultMaxTokens === 'number' ? windowConfig.defaultMaxTokens : 1024;
  const MAX_FILES = typeof windowConfig.maxFiles === 'number' ? windowConfig.maxFiles : 6;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const DEFAULT_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'xls', 'xlsx', 'json', 'html'];
  const SUPPORTED_EXT = Array.isArray(windowConfig.allowedFileExtensions) && windowConfig.allowedFileExtensions.length
    ? windowConfig.allowedFileExtensions.map(ext => String(ext || '').toLowerCase().replace(/^[.]/, '')).filter(Boolean)
    : DEFAULT_EXTENSIONS;
  const providerModels = Object.keys(providerMap).filter(key => key && key !== 'default');
  const MODEL_OPTIONS = Array.isArray(windowConfig.modelOptions) && windowConfig.modelOptions.length
    ? windowConfig.modelOptions.slice()
    : (providerModels.length ? providerModels.slice() : ['deepseek-chat']);
  providerModels.forEach(modelKey => {
    if (MODEL_OPTIONS.indexOf(modelKey) === -1) {
      MODEL_OPTIONS.push(modelKey);
    }
  });
  if (!MODEL_OPTIONS.length) {
    MODEL_OPTIONS.push('deepseek-chat');
  }
  const rawDefaultModel = typeof windowConfig.defaultModel === 'string' && windowConfig.defaultModel.trim()
    ? windowConfig.defaultModel.trim()
    : MODEL_OPTIONS[0];
  if (MODEL_OPTIONS.indexOf(rawDefaultModel) === -1) {
    MODEL_OPTIONS.unshift(rawDefaultModel);
  }
  const DEFAULT_MODEL = rawDefaultModel;
  const DOC_CONTEXT_SNIPPET_LIMIT = 900;
  const VIEW_STATE_KEY = 'zhida:view';
  const STORAGE = {
    HISTORY: 'zhida:messages:v1',
    SETTINGS: 'zhida:settings:v1'
  };
  const SESSION_SCOPED_KEYS = [STORAGE.HISTORY, VIEW_STATE_KEY];
  const storageFallback = Object.create(null);
  const DEFAULT_PROMPTS = {
    zh: '你是万凡网站的 AI 智答助手。默认使用简体中文回复，并保持简洁、有条理；只有在用户明确要求使用其他语言（如“请用英文回答”）时才切换到对方指定的语言。引用资料时请标注来源。',
    en: "You are the AI Q&A assistant on Fan Wan's site. Respond in English by default with concise, well-structured answers. Switch to another language only when the user explicitly asks (e.g., 'Please reply in Spanish'), and cite sources when available.",
    es: 'Eres el asistente de preguntas y respuestas del sitio de Fan Wan. Responde en español por defecto con mensajes concisos y organizados; solo cambia a otro idioma cuando el usuario lo solicite explícitamente (por ejemplo, “Responde en inglés”). Cita las fuentes cuando sea posible.'
  };
  const LEGACY_PROMPTS = {
    zh: ['你是万凡网站的 AI 智答助手，请优先使用中文，回答保持简洁并在引用资料时标注来源。'],
    en: ["You are the AI Q&A assistant on Fan Wan's site. Reply concisely, prefer English when unsure, and cite sources when available."],
    es: ['Eres el asistente AI Respuestas del sitio de Fan Wan. Responde con concisión, prioriza el español cuando sea posible y cita las fuentes disponibles.']
  };
  const QUESTION_SYNONYMS = Object.freeze({
    '论文': ['paper', 'article', 'work', 'study'],
    '总结': ['summary', 'overview', 'abstract'],
    '概括': ['summary', 'overview'],
    '介绍': ['introduction', 'overview'],
    '贡献': ['contribution', 'contributions', 'novelty'],
    '动机': ['motivation', 'motives'],
    '方法': ['method', 'approach', 'technique'],
    '实验': ['experiment', 'experiments', 'evaluation'],
    '结果': ['result', 'results', 'finding', 'findings'],
    '结论': ['conclusion', 'conclusions'],
    '未来': ['future', 'future work'],
    '局限': ['limitation', 'limitations', 'weakness'],
    '关键': ['key', 'highlight'],
    '创新': ['innovation', 'novelty'],
    '摘要': ['abstract', 'summary'],
    '背景': ['background', 'context'],
    '相关': ['related', 'related work'],
    '数据': ['data', 'dataset'],
    '性能': ['performance'],
    '优势': ['advantage', 'benefit'],
    '缺点': ['limitation', 'drawback'],
    '理论': ['theory', 'theoretical'],
    '实践': ['practice', 'practical'],
    '应用': ['application', 'applications']
  });
  const GENERIC_QUERY_TOKENS = new Set(['paper', 'article', 'study', 'work', 'document']);
  const FALLBACK_CHUNKS_PER_FILE = 2;
  const MIN_SCORE_THRESHOLD = 0.12;

  function isKnownSystemPrompt(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return false;
    if (Object.values(DEFAULT_PROMPTS).some(prompt => prompt === trimmed)) {
      return true;
    }
    return Object.values(LEGACY_PROMPTS).some(list => Array.isArray(list) && list.includes(trimmed));
  }
  const DEFAULT_MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js';
  const MATH_MARKERS = ['\\(', '\\[', '$$', '\\begin{'];
  const MATH_FENCE_LANGUAGES = ['math', 'latex', 'tex', 'katex'];
  const TABLE_PIPE_PLACEHOLDER = '@@PIPE@@';

  const state = {
    messages: [],
    files: [],
    model: DEFAULT_MODEL,
    streaming: false,
    assistantIndex: null,
    settingsOpen: false,
    autoStick: true,
    manualScrollIntent: false,
    settings: null,
    settingsDraft: null,
    settingsDirty: false,
    activeEndpoint: null,
    activeHeaders: null,
    activePayloadOverrides: null
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
    modelSelect: document.querySelector('[data-model-select]'),
    composerDock: document.querySelector('.zhida-composer-dock'),
    temperature: document.querySelector('[data-temperature]'),
    temperatureValue: document.querySelector('[data-temperature-value]'),
    maxTokens: document.querySelector('[data-max-tokens]'),
    systemPrompt: document.querySelector('[data-system-prompt]'),
    settingsBtn: document.querySelector('[data-action="settings"]'),
    settingsPanel: document.querySelector('[data-settings-panel]'),
    settingsOverlay: document.querySelector('[data-settings-overlay]'),
    settingsClose: document.querySelector('[data-settings-close]'),
    settingsSheet: document.querySelector('[data-settings-panel] .zhida-settings-sheet'),
    settingsSave: document.querySelector('[data-settings-save]')
  };

  refreshSettingsActionRefs();

  function refreshSettingsActionRefs() {
    if (!el.settingsPanel) {
      return;
    }
    const scopedSave = el.settingsPanel.querySelector('[data-settings-save]');
    const scopedClear = el.settingsPanel.querySelector('[data-action="clear"]');
    el.settingsSave = scopedSave || el.settingsSave || null;
    el.clearBtn = scopedClear || el.clearBtn || null;
  }

  function getSettingsSaveButton() {
    if (el.settingsPanel) {
      const current = el.settingsPanel.querySelector('[data-settings-save]');
      if (current && current !== el.settingsSave) {
        el.settingsSave = current;
      }
    }
    return el.settingsSave || null;
  }

  function getProviderConfig(model) {
    if (model && providerMap && Object.prototype.hasOwnProperty.call(providerMap, model)) {
      return providerMap[model];
    }
    if (providerMap && providerMap.default) {
      return providerMap.default;
    }
    return null;
  }

  function resolveEndpointForModel(model) {
    const provider = getProviderConfig(model);
    if (provider && typeof provider.endpoint === 'string') {
      const trimmed = provider.endpoint.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return FALLBACK_ENDPOINT;
  }

  function resolveHeadersForModel(model) {
    const headers = {};
    if (windowConfig.headers && typeof windowConfig.headers === 'object') {
      Object.assign(headers, windowConfig.headers);
    }
    const provider = getProviderConfig(model);
    if (provider && provider.headers && typeof provider.headers === 'object') {
      Object.assign(headers, provider.headers);
    }
    return Object.keys(headers).length ? cloneConfig(headers) : null;
  }

  function resolvePayloadOverrides(model) {
    const provider = getProviderConfig(model);
    if (provider && provider.payloadDefaults && typeof provider.payloadDefaults === 'object') {
      return cloneConfig(provider.payloadDefaults);
    }
    return null;
  }

  function applyActiveModelConfig() {
    const model = getActiveModel();
    const endpoint = resolveEndpointForModel(model);
    const headers = resolveHeadersForModel(model);
    const payloadOverrides = resolvePayloadOverrides(model);
    state.activeEndpoint = endpoint;
    state.activeHeaders = headers;
    state.activePayloadOverrides = payloadOverrides;
    client.setEndpoint(endpoint);
    client.setHeaders(headers);
  }

  function hasActiveEndpoint() {
    return !!(state.activeEndpoint && String(state.activeEndpoint).trim());
  }

  function syncChatStateClasses() {
    const hasMessages = state.messages.length > 0;
    body.classList.toggle('zhida-chat-active', hasMessages);
    body.classList.toggle('zhida-chat-empty', !hasMessages);
  }

  function scrollMessagesToBottom(smooth) {
    if (!el.messages) {
      return;
    }
    const scheduleScroll = () => {
      const metrics = captureScrollMetrics();
      if (!metrics || metrics.bottomGap <= 2) {
        return;
      }
      lockHorizontalScroll();
      const target = metrics.scrollHeight;
      if (typeof el.messages.scrollTo === 'function') {
        try {
          el.messages.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
          return;
        } catch (_) {}
      }
      el.messages.scrollTop = target;
    };

    if (smooth) {
      requestAnimationFrame(() => requestAnimationFrame(scheduleScroll));
    } else {
      requestAnimationFrame(scheduleScroll);
    }
  }

  function captureScrollMetrics() {
    if (!el.messages) {
      return null;
    }
    const { scrollTop, scrollHeight, clientHeight } = el.messages;
    const bottomGap = Math.max(0, scrollHeight - clientHeight - scrollTop);
    return { scrollTop, scrollHeight, clientHeight, bottomGap };
  }

  function hasOverflow(metrics) {
    if (!metrics) {
      return false;
    }
    return metrics.scrollHeight > metrics.clientHeight + 2;
  }

  function setAutoStick(value) {
    const next = !!value;
    if (state.autoStick === next) {
      body.classList.toggle('zhida-scroll-away', !next);
      return;
    }
    state.autoStick = next;
    body.classList.toggle('zhida-scroll-away', !next);
    if (next) {
      state.manualScrollIntent = false;
    }
  }

  function handleMessagesInteraction(event) {
    state.manualScrollIntent = true;
    if (!state.autoStick) {
      return;
    }
    if (event && event.type === 'wheel' && event.deltaY < 0) {
      setAutoStick(false);
    }
  }

  function handleMessagesScroll() {
    const metrics = captureScrollMetrics();
    if (!metrics) {
      return;
    }
    if (!hasOverflow(metrics)) {
      state.manualScrollIntent = false;
      setAutoStick(true);
      return;
    }
    const distance = metrics.bottomGap;
    if (distance <= SCROLL_STICK_THRESHOLD) {
      state.manualScrollIntent = false;
      setAutoStick(true);
      return;
    }
    if (state.manualScrollIntent && distance > MANUAL_SCROLL_DELTA) {
      setAutoStick(false);
      return;
    }
    if (distance >= SCROLL_UNSTICK_THRESHOLD) {
      setAutoStick(false);
    }
  }
  const stageEl = document.querySelector('.zhida-stage');
  const docPipeline = window.ZhidaDocs && typeof window.ZhidaDocs.createPipeline === 'function'
    ? window.ZhidaDocs.createPipeline()
    : null;
  const READY_FILE_STATUSES = { ready: true, success: true, complete: true, processed: true };
  const INPUT_MIN_HEIGHT = 44;
  const SCROLL_STICK_THRESHOLD = 72;
  const SCROLL_UNSTICK_THRESHOLD = 160;
  const MANUAL_SCROLL_DELTA = 6;
  const PASSIVE_EVENT_OPTIONS = { passive: true };

  if (!el.messages || !el.form || !el.input) {
    return;
  }

  class ChatClient {
    constructor(endpointUrl, headers) {
      this.endpoint = endpointUrl || '';
      this.headers = typeof headers === 'function' ? headers : (headers && typeof headers === 'object' ? cloneConfig(headers) : null);
      this.controller = null;
    }

    setEndpoint(endpointUrl) {
      this.endpoint = typeof endpointUrl === 'string' ? endpointUrl : '';
    }

    setHeaders(headers) {
      if (typeof headers === 'function') {
        this.headers = headers;
        return;
      }
      this.headers = headers && typeof headers === 'object' ? cloneConfig(headers) : null;
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
      const headerBag = Object.assign({ 'Content-Type': 'application/json' }, windowConfig.headers && typeof windowConfig.headers === 'object' ? windowConfig.headers : {});
      const dynamicHeaders = typeof this.headers === 'function' ? this.headers() : this.headers;
      if (dynamicHeaders && typeof dynamicHeaders === 'object') {
        Object.keys(dynamicHeaders).forEach(key => {
          headerBag[key] = dynamicHeaders[key];
        });
      }
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: headerBag,
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
  let mathTypesetInFlight = false;
  const mathPendingMessages = new Set();
  let mathJaxLoadingPromise = null;
  const client = new ChatClient(null, null);
  applyActiveModelConfig();

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
    if (el.messages) {
      el.messages.addEventListener('scroll', handleMessagesScroll, PASSIVE_EVENT_OPTIONS);
      el.messages.addEventListener('wheel', handleMessagesInteraction, PASSIVE_EVENT_OPTIONS);
      el.messages.addEventListener('touchstart', handleMessagesInteraction, PASSIVE_EVENT_OPTIONS);
      el.messages.addEventListener('pointerdown', handleMessagesInteraction, PASSIVE_EVENT_OPTIONS);
    }
    el.form.addEventListener('submit', handleSend);
    el.stopBtn.addEventListener('click', handleStop);
    el.input.addEventListener('input', autoResizeInput);
    el.input.addEventListener('keydown', handleInputKeydown);
    if (el.modelSelect) {
      el.modelSelect.addEventListener('change', handleModelChange);
    }
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
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleGlobalKeydown);
    autoResizeInput();
    handleMessagesScroll();
  }

  function loadSettings() {
    refreshSettingsActionRefs();
    const lang = getLang();
    const raw = storageGet(STORAGE.SETTINGS);
    let stored = null;
    if (raw) {
      try {
        stored = JSON.parse(raw);
      } catch (_) {
        stored = null;
      }
    }

    const newDefault = DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.zh;

    const storedPrompt = stored && typeof stored.systemPrompt === 'string' ? stored.systemPrompt.trim() : '';
    const isCustomPrompt = storedPrompt && !isKnownSystemPrompt(storedPrompt);
    const shouldResetPrompt = !storedPrompt || (!isCustomPrompt && storedPrompt !== newDefault);

    const temperatureValue = stored ? Number(stored.temperature) : NaN;
    const temperature = clampTemperature(Number.isFinite(temperatureValue) ? temperatureValue : DEFAULT_TEMP);
    const maxTokensValue = stored ? Number(stored.maxTokens) : NaN;
    const maxTokens = clampMaxTokens(Number.isFinite(maxTokensValue) ? maxTokensValue : DEFAULT_MAX_TOKENS);
    const systemPrompt = shouldResetPrompt ? newDefault : resolveSystemPrompt(storedPrompt, lang);
    const storedModel = stored && typeof stored.model === 'string' ? stored.model.trim() : '';
    const model = normalizeModel(storedModel);

    const settings = {
      temperature,
      maxTokens,
      systemPrompt,
      model,
      lang
    };

    state.settings = Object.assign({}, settings);
    state.settingsDraft = Object.assign({}, settings);
    state.model = settings.model || DEFAULT_MODEL;
    state.settingsDirty = false;

    applyActiveModelConfig();
    applySettingsDraftToInputs();
    syncSettingsDirtyFlag();
  }

  function persistSettings() {
    const lang = getLang();
    const base = state.settings || {
      temperature: DEFAULT_TEMP,
      maxTokens: DEFAULT_MAX_TOKENS,
      systemPrompt: resolveSystemPrompt('', lang),
      model: DEFAULT_MODEL,
      lang
    };
    const settings = Object.assign({}, base, { lang });
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
            id: typeof item.id === 'string' && item.id ? item.id : createMessageId(),
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

    if (ensureMessageIds(state.messages)) {
      persistMessages();
    }
  }

  function ensureMessageIds(list) {
    let changed = false;
    if (!Array.isArray(list)) {
      return changed;
    }
    list.forEach(msg => {
      if (!msg) {
        return;
      }
      if (typeof msg.id !== 'string' || !msg.id) {
        msg.id = createMessageId();
        changed = true;
      }
    });
    return changed;
  }

  function persistMessages() {
    ensureMessageIds(state.messages);
    const payload = state.messages.slice(-60).map(msg => ({
      id: msg.id,
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
    syncChatStateClasses();
    if (!el.messages) {
      return;
    }

    let hasMath = false;
    const messageCount = state.messages.length;

    for (let index = 0; index < messageCount; index += 1) {
      const message = state.messages[index];
      const referenceNode = el.messages.children[index] || null;
      const wrapper = ensureMessageElement(message, referenceNode);
      const contentChanged = updateMessageElement(wrapper, message);
      if (!hasMath && message && typeof message.content === 'string' && containsMathMarkers(message.content)) {
        hasMath = true;
      }
      if (contentChanged && !hasMath && message && typeof message.content === 'string' && containsMathMarkers(message.content)) {
        hasMath = true;
      }
    }

    while (el.messages.children.length > messageCount) {
      const removed = el.messages.lastElementChild;
      if (!removed) {
        break;
      }
      const removedId = removed.getAttribute ? removed.getAttribute('data-message-id') : null;
      if (removedId) {
        mathPendingMessages.delete(removedId);
      }
      el.messages.removeChild(removed);
    }

    if (state.autoStick) {
      scrollMessagesToBottom(!state.streaming);
    }

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

  function trackMathForMessage(wrapper, message, content) {
    if (!wrapper || !message || !message.id) {
      return;
    }
    const signature = computeMathSignature(content);
    wrapper.__mathSignature = signature;
    if (signatureHasMath(signature)) {
      markMessageForMath(message.id);
    } else {
      mathPendingMessages.delete(message.id);
    }
  }

  function markMessageForMath(messageId) {
    if (!messageId) {
      return;
    }
    mathPendingMessages.add(messageId);
    scheduleMathTypeset();
  }

  function computeMathSignature(content) {
    if (!content) {
      return '';
    }
    let source = String(content);
    let envCount = 0;
    let blockCount = 0;
    let bracketCount = 0;
    let parenCount = 0;

    source = source.replace(/\\begin\{([^}]+)\}([\s\S]+?)\\end\{\1\}/g, () => {
      envCount += 1;
      return ' ';
    });
    source = source.replace(/\$\$([\s\S]+?)\$\$/g, () => {
      blockCount += 1;
      return ' ';
    });
    source = source.replace(/\\\[([\s\S]+?)\\\]/g, () => {
      bracketCount += 1;
      return ' ';
    });
    source = source.replace(/\\\(([\s\S]+?)\\\)/g, () => {
      parenCount += 1;
      return ' ';
    });

    const inlineCount = countInlineMathSegments(source);
    if (!inlineCount && !blockCount && !parenCount && !bracketCount && !envCount) {
      return '';
    }
    return [inlineCount, blockCount, parenCount, bracketCount, envCount].join(':');
  }

  function countInlineMathSegments(source) {
    if (!source) {
      return 0;
    }
    let count = 0;
    let index = 0;
    const length = source.length;
    while (index < length) {
      const char = source[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '$') {
        if (source[index + 1] === '$') {
          index += 2;
          continue;
        }
        let end = index + 1;
        let found = false;
        while (end < length) {
          const endChar = source[end];
          if (endChar === '\\') {
            end += 2;
            continue;
          }
          if (endChar === '$') {
            if (end === index + 1) {
              break;
            }
            count += 1;
            index = end + 1;
            found = true;
            break;
          }
          end += 1;
        }
        if (!found) {
          index += 1;
        }
        continue;
      }
      index += 1;
    }
    return count;
  }

  function signatureHasMath(signature) {
    if (!signature) {
      return false;
    }
    const parts = signature.split(':');
    for (let index = 0; index < parts.length; index += 1) {
      if (Number(parts[index] || 0) > 0) {
        return true;
      }
    }
    return false;
  }

  function isMathLanguage(language) {
    if (!language) {
      return false;
    }
    const value = String(language).trim().toLowerCase();
    if (!value) {
      return false;
    }
    return MATH_FENCE_LANGUAGES.indexOf(value) !== -1;
  }

  function isLikelyMathContent(content) {
    if (!content) {
      return false;
    }
    return signatureHasMath(computeMathSignature(String(content)));
  }

  function isLikelyMathBlock(content, fence) {
    if (isMathLanguage(fence)) {
      return true;
    }
    return isLikelyMathContent(content);
  }

  function createMathBlockElement(content) {
    const block = document.createElement('div');
    block.className = 'zhida-math-block';
    block.setAttribute('data-math-block', 'true');
    block.textContent = String(content != null ? content : '');
    return block;
  }

  function buildMessageElement(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'zhida-message';
    wrapper.dataset.messageId = message.id || '';
    wrapper.dataset.role = message.role || 'user';

    const avatar = document.createElement('span');
    avatar.className = 'zhida-message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.dataset.role = message.role || 'user';
    avatar.innerHTML = (message.role === 'assistant' ? assistantIcon() : userIcon());

    const bubble = document.createElement('div');
    bubble.className = 'zhida-message-bubble';

    const text = document.createElement('div');
    text.className = 'zhida-message-text';
    bubble.appendChild(text);

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    return wrapper;
  }

  function ensureMessageElement(message, referenceNode) {
    if (!el.messages) {
      return null;
    }
    let node = null;
    if (message && message.id) {
      node = el.messages.querySelector(`[data-message-id="${message.id}"]`);
    }
    if (!node) {
      node = buildMessageElement(message);
      el.messages.insertBefore(node, referenceNode);
      return node;
    }
    if (referenceNode !== node) {
      el.messages.insertBefore(node, referenceNode);
    }
    return node;
  }

  function updateMessageElement(wrapper, message) {
    if (!wrapper || !message) {
      return false;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    wrapper.dataset.messageId = message.id || '';
    wrapper.dataset.role = role;
    wrapper.className = `zhida-message zhida-message--${role}`;

    if (message.streaming) {
      wrapper.dataset.streaming = 'true';
      wrapper.classList.add('zhida-message--streaming');
    } else {
      wrapper.removeAttribute('data-streaming');
      wrapper.classList.remove('zhida-message--streaming');
    }

    let avatar = wrapper.querySelector('.zhida-message-avatar');
    if (!avatar) {
      avatar = document.createElement('span');
      avatar.className = 'zhida-message-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      wrapper.insertBefore(avatar, wrapper.firstChild);
    }
    if (avatar.dataset.role !== role) {
      avatar.dataset.role = role;
      avatar.innerHTML = role === 'assistant' ? assistantIcon() : userIcon();
    }

    let bubble = wrapper.querySelector('.zhida-message-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'zhida-message-bubble';
      wrapper.appendChild(bubble);
    }

    let text = bubble.querySelector('.zhida-message-text');
    if (!text) {
      text = document.createElement('div');
      text.className = 'zhida-message-text';
      bubble.appendChild(text);
    }

    const nextContent = typeof message.content === 'string' ? message.content : '';
    const previousContent = wrapper.__zhidaContent || '';
    const contentChanged = previousContent !== nextContent;
    if (contentChanged) {
      renderText(text, nextContent);
      wrapper.__zhidaContent = nextContent;
    }
    trackMathForMessage(wrapper, message, nextContent);
    return contentChanged;
  }

  function updateMessageContent(message) {
    if (!message || !message.id || !el.messages) {
      return false;
    }
    let node = el.messages.querySelector(`[data-message-id="${message.id}"]`);
    if (!node) {
      renderMessages();
      node = el.messages.querySelector(`[data-message-id="${message.id}"]`);
      if (!node) {
        return false;
      }
    }
    return updateMessageElement(node, message);
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
        const blockContent = codeLines.join('\n');
        if (isLikelyMathBlock(blockContent, fence)) {
          container.appendChild(createMathBlockElement(blockContent));
          continue;
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence) {
          code.setAttribute('data-language', fence.toLowerCase());
        }
        code.textContent = blockContent;
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
        const blockContent = codeLines.join('\n');
        if (isLikelyMathBlock(blockContent)) {
          container.appendChild(createMathBlockElement(blockContent));
          continue;
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = blockContent;
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

      const tableMatch = parseMarkdownTable(lines, index);
      if (tableMatch) {
        container.appendChild(tableMatch.element);
        index = tableMatch.nextIndex;
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

  function parseMarkdownTable(lines, startIndex) {
    if (!Array.isArray(lines) || startIndex >= lines.length - 1) {
      return null;
    }
    const headerLine = lines[startIndex];
    const separatorLine = lines[startIndex + 1];
    if (!isTableRowCandidate(headerLine) || !isTableSeparatorLine(separatorLine)) {
      return null;
    }
    const headerCells = splitTableCells(headerLine);
    if (headerCells.length < 2) {
      return null;
    }
    const separatorCells = splitTableCells(separatorLine);
    const tableRows = [];
    let nextIndex = startIndex + 2;
    while (nextIndex < lines.length) {
      const raw = lines[nextIndex];
      if (!raw.trim()) {
        break;
      }
      if (!isTableRowCandidate(raw)) {
        break;
      }
      tableRows.push(splitTableCells(raw));
      nextIndex += 1;
    }

    const maxBodyColumns = tableRows.reduce((max, row) => Math.max(max, row.length), 0);
    const columnCount = Math.max(headerCells.length, separatorCells.length, maxBodyColumns);
    if (!columnCount) {
      return null;
    }
    const alignments = buildTableAlignments(separatorCells, columnCount);

    const wrapper = document.createElement('div');
    wrapper.className = 'zhida-table-wrapper';
    const table = document.createElement('table');
    table.className = 'zhida-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let col = 0; col < columnCount; col += 1) {
      const th = document.createElement('th');
      th.innerHTML = parseInline(headerCells[col] != null ? headerCells[col] : '');
      applyTableAlignment(th, alignments[col]);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (tableRows.length) {
      tableRows.forEach(cells => {
        const tr = document.createElement('tr');
        for (let col = 0; col < columnCount; col += 1) {
          const td = document.createElement('td');
          td.innerHTML = parseInline(cells[col] != null ? cells[col] : '');
          applyTableAlignment(td, alignments[col]);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);

    return { element: wrapper, nextIndex };
  }

  function splitTableCells(line) {
    if (line == null) {
      return [];
    }
    const placeholder = TABLE_PIPE_PLACEHOLDER;
    const normalized = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
    if (!normalized) {
      return [''];
    }
    return normalized
      .replace(/\\\|/g, placeholder)
      .split('|')
      .map(cell => cell.replace(new RegExp(placeholder, 'g'), '|').trim());
  }

  function isTableRowCandidate(line) {
    if (!line || !line.trim()) {
      return false;
    }
    if (String(line).indexOf('|') === -1) {
      return false;
    }
    const cells = splitTableCells(line);
    return cells.length > 1;
  }

  function isTableSeparatorLine(line) {
    if (!line || !line.trim()) {
      return false;
    }
    const cells = splitTableCells(line);
    if (!cells.length) {
      return false;
    }
    return cells.every(cell => {
      const token = cell.replace(/\s+/g, '');
      return /^:?[-]{3,}:?$/.test(token);
    });
  }

  function buildTableAlignments(cells, columnCount) {
    const alignments = [];
    for (let index = 0; index < columnCount; index += 1) {
      alignments.push(resolveTableAlignment(cells[index] || ''));
    }
    return alignments;
  }

  function resolveTableAlignment(token) {
    const value = String(token || '').trim();
    const hasStartColon = value.startsWith(':');
    const hasEndColon = value.endsWith(':');
    if (hasStartColon && hasEndColon) {
      return 'center';
    }
    if (hasEndColon) {
      return 'right';
    }
    if (hasStartColon) {
      return 'left';
    }
    return '';
  }

  function applyTableAlignment(cell, alignment) {
    if (!cell || !alignment) {
      return;
    }
    cell.style.textAlign = alignment;
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
      codeTokens.push(code);
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
      const replacement = isLikelyMathContent(code)
        ? renderMathInlineString(code)
        : '<code>' + escapeHtml(code) + '</code>';
      result = result.replace(new RegExp('@@CODE' + idx + '@@', 'g'), replacement);
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

  function renderMathInlineString(content) {
    return '<span class="zhida-math-inline" data-math-inline="true">' + escapeHtml(String(content != null ? content : '')) + '</span>';
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
    let endpoint = state.activeEndpoint;
    if (!endpoint) {
      endpoint = resolveEndpointForModel(getActiveModel());
      state.activeEndpoint = endpoint;
    }
    if (!endpoint) {
      notify(t('ai_qa_error_model_unconfigured'), 'error');
      return;
    }
    const headers = state.activeHeaders || resolveHeadersForModel(getActiveModel());
    if (!state.activeHeaders && headers) {
      state.activeHeaders = headers;
    }
    if (!state.activePayloadOverrides) {
      state.activePayloadOverrides = resolvePayloadOverrides(getActiveModel());
    }
    client.setEndpoint(endpoint);
    client.setHeaders(headers);
    const value = el.input.value.trim();
    if (!value) return;

    clearNotification();

    const userMessage = {
      id: createMessageId(),
      role: 'user',
      content: value,
      createdAt: Date.now()
    };
    state.messages.push(userMessage);
    persistMessages();
    ensureChatView();
    setAutoStick(true);
    state.manualScrollIntent = false;
    el.input.value = '';
    autoResizeInput();
    renderMessages();

    const payload = buildPayload();
    const assistantMessage = {
      id: createMessageId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true
    };
    state.messages.push(assistantMessage);
    state.assistantIndex = state.messages.length - 1;
    setStatus('streaming');
    setStreaming(true);
    setAutoStick(true);
    state.manualScrollIntent = false;
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
    setAutoStick(true);
    state.manualScrollIntent = false;
    renderMessages();
    setStatus('ready');
    clearNotification();
  }

  function handleStreamError(error) {
    if (error && error.name === 'AbortError') {
      finalizeAssistant(true);
      return;
    }
    let message = getErrorMessage(error);
    if (error && error.code === 'network') {
      const activeEndpoint = state.activeEndpoint || resolveEndpointForModel(getActiveModel());
      if (typeof activeEndpoint === 'string' && activeEndpoint.indexOf('gpt-proxy') !== -1) {
        const origin = window.location && window.location.origin ? window.location.origin : 'unknown-origin';
  message = 'OpenAI 代理连接失败：请检查 Cloudflare Worker 是否允许来源 ' + origin + '。';
        console.warn('[zhida] GPT proxy network failure – origin may not be allowlisted.', {
          origin,
          endpoint: activeEndpoint,
          error
        });
      }
    }
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
    const updated = updateMessageContent(assistant);
    if (!updated) {
      return;
    }
    if (state.autoStick) {
      scrollMessagesToBottom(false);
    }
    if (containsMathMarkers(assistant.content)) {
      scheduleMathTypeset();
    }
  }

  function finalizeAssistant(interrupted) {
    let removedAssistant = false;
    if (state.assistantIndex != null) {
      const assistant = state.messages[state.assistantIndex];
      if (assistant) {
        assistant.streaming = false;
        if (interrupted && !assistant.content.trim()) {
          state.messages.splice(state.assistantIndex, 1);
          removedAssistant = true;
        } else {
          updateMessageContent(assistant);
        }
      }
    }
    state.assistantIndex = null;
    setStreaming(false);
    if (!state.streaming) {
      setStatus('ready');
    }
    persistMessages();
    if (removedAssistant) {
      renderMessages();
    } else {
      syncChatStateClasses();
      if (state.autoStick) {
        scrollMessagesToBottom(true);
      }
      scheduleMathTypeset();
    }
  }

  function buildPayload() {
    const messages = [];
    const system = getSystemPrompt();
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    const docContext = buildDocumentContext();
    state.messages.forEach((msg, index) => {
      if (index === state.assistantIndex && msg.streaming) {
        return;
      }
      if (docContext && docContext.text && index === state.messages.length - 1 && msg.role === 'user') {
        messages.push({ role: 'system', content: docContext.text });
      }
      messages.push({ role: msg.role, content: msg.content });
    });
    const model = getActiveModel();
    const payload = {
      model,
      stream: true,
      messages,
      max_tokens: getMaxTokens()
    };
    const supportsDocuments = modelSupportsDocuments(model);

    if (modelSupportsTemperature(model)) {
      payload.temperature = getTemperature();
    }
    if (supportsDocuments && docContext && Array.isArray(docContext.snippets) && docContext.snippets.length) {
      payload.mode = 'rag';
      payload.documents = docContext.snippets.map(snippet => {
        const chunk = snippet.chunk || null;
        const doc = {
          id: snippet.fileId + ':' + snippet.index,
          name: snippet.fileName,
          content: trimSnippet(snippet.content, DOC_CONTEXT_SNIPPET_LIMIT)
        };
        const metadata = {};
        const pages = getChunkPageRange(chunk);
        if (pages && pages.length) {
          metadata.pages = pages;
        }
        if (chunk && chunk.source && typeof chunk.source.section === 'string' && chunk.source.section.trim()) {
          metadata.section = chunk.source.section.trim();
        }
        if (chunk && chunk.source && Array.isArray(chunk.source.tags) && chunk.source.tags.length) {
          metadata.tags = chunk.source.tags.slice(0, 3);
        }
        if (Object.keys(metadata).length) {
          doc.metadata = metadata;
        }
        return doc;
      });
    } else if (supportsDocuments && shouldUseDocumentMode()) {
      payload.mode = 'rag';
    }
    if (state.activePayloadOverrides && typeof state.activePayloadOverrides === 'object') {
      applyPayloadOverrides(payload, state.activePayloadOverrides);
    }
    return payload;
  }

  function autoResizeInput() {
    if (!el.input) return;
    el.input.style.height = 'auto';
    const next = Math.min(Math.max(el.input.scrollHeight, INPUT_MIN_HEIGHT), 96);
    el.input.style.height = next + 'px';
  }

  function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  }

  function handleModelChange(event) {
    const next = normalizeModel(event.target.value);
    if (el.modelSelect) {
      el.modelSelect.value = next;
    }
    state.model = next;
    applyActiveModelConfig();
    refreshControls();
    updateSettingsDraft({ model: next });
  }

  function handleTemperatureChange(event) {
    const value = clampTemperature(event.target.value);
    if (el.temperature) {
      el.temperature.value = String(value);
    }
    updateTemperatureDisplay(value);
    updateSettingsDraft({ temperature: value });
  }

  function updateTemperatureDisplay(value) {
    if (!el.temperatureValue) return;
    const safe = clampTemperature(value);
    el.temperatureValue.textContent = safe.toFixed(1);
  }

  function handleMaxTokensChange() {
    if (!el.maxTokens) return;
    const value = clampMaxTokens(parseInt(el.maxTokens.value, 10));
    el.maxTokens.value = String(value);
    updateSettingsDraft({ maxTokens: value });
  }

  function handleSystemPromptChange() {
    if (!el.systemPrompt) return;
    updateSettingsDraft({ systemPrompt: el.systemPrompt.value });
  }

  function handleDocumentClick(event) {
    if (!event || !el.settingsPanel) {
      return;
    }
    const target = event.target;
    if (!target || !el.settingsPanel.contains(target)) {
      return;
    }
    const saveButton = target.closest('[data-settings-save]');
    if (saveButton) {
      event.preventDefault();
      refreshSettingsActionRefs();
      handleSettingsSave();
      return;
    }
    const clearButton = target.closest('[data-action="clear"]');
    if (clearButton) {
      event.preventDefault();
      refreshSettingsActionRefs();
      handleClear();
    }
  }

  function handleSettingsSave(event) {
    if (event) {
      event.preventDefault();
    }
    if (!state.settingsDraft) {
      return;
    }
    const lang = getLang();
    const nextSettings = {
      temperature: clampTemperature(state.settingsDraft.temperature),
      maxTokens: clampMaxTokens(state.settingsDraft.maxTokens),
      systemPrompt: resolveSystemPrompt(state.settingsDraft.systemPrompt, lang),
      model: normalizeModel(state.settingsDraft.model),
      lang
    };

    state.settings = Object.assign({}, nextSettings);
    state.settingsDraft = Object.assign({}, nextSettings);
    state.model = nextSettings.model;
    state.settingsDirty = false;

    applySettingsDraftToInputs();
    updateTemperatureDisplay(nextSettings.temperature);
    applyActiveModelConfig();
    refreshControls();
    persistSettings();
    syncSettingsDirtyFlag();
  }

  function updateSettingsDraft(patch) {
    if (!patch || typeof patch !== 'object') {
      return;
    }
    if (!state.settingsDraft) {
      state.settingsDraft = state.settings ? Object.assign({}, state.settings) : {
        temperature: DEFAULT_TEMP,
        maxTokens: DEFAULT_MAX_TOKENS,
        systemPrompt: resolveSystemPrompt('', getLang()),
        model: DEFAULT_MODEL,
        lang: getLang()
      };
    }
    Object.assign(state.settingsDraft, patch);
    syncSettingsDirtyFlag();
  }

  function applySettingsDraftToInputs() {
    if (!state.settingsDraft) {
      return;
    }
    if (el.temperature) {
      el.temperature.value = String(clampTemperature(state.settingsDraft.temperature));
    }
    updateTemperatureDisplay(state.settingsDraft.temperature);
    if (el.maxTokens) {
      el.maxTokens.value = String(clampMaxTokens(state.settingsDraft.maxTokens));
    }
    if (el.systemPrompt) {
      el.systemPrompt.value = typeof state.settingsDraft.systemPrompt === 'string'
        ? state.settingsDraft.systemPrompt
        : '';
    }
    if (el.modelSelect) {
      el.modelSelect.value = normalizeModel(state.settingsDraft.model);
    }
  }

  function syncSettingsDirtyFlag() {
    if (!state.settingsDraft || !state.settings) {
      state.settingsDirty = !!state.settingsDraft && !state.settings;
      syncSettingsSaveState();
      return;
    }
    const baseLang = state.settings.lang || getLang();
    const draftTemperature = clampTemperature(state.settingsDraft.temperature);
    const draftMaxTokens = clampMaxTokens(state.settingsDraft.maxTokens);
    const draftPrompt = resolveSystemPrompt(state.settingsDraft.systemPrompt, baseLang);
    const draftModel = normalizeModel(state.settingsDraft.model);

    const savedTemperature = clampTemperature(state.settings.temperature);
    const savedMaxTokens = clampMaxTokens(state.settings.maxTokens);
    const savedPrompt = resolveSystemPrompt(state.settings.systemPrompt, baseLang);
    const savedModel = normalizeModel(state.settings.model);

    state.settingsDirty = (
      draftTemperature !== savedTemperature ||
      draftMaxTokens !== savedMaxTokens ||
      draftPrompt !== savedPrompt ||
      draftModel !== savedModel
    );
    syncSettingsSaveState();
  }

  function syncSettingsSaveState() {
    const saveButton = getSettingsSaveButton();
    if (!saveButton) {
      return;
    }
    saveButton.disabled = !state.settingsDirty;
  }

  function clampTemperature(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return DEFAULT_TEMP;
    }
    return Math.min(Math.max(num, 0), 1);
  }

  function clampMaxTokens(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return DEFAULT_MAX_TOKENS;
    }
    return Math.min(Math.max(Math.round(num), 256), 4096);
  }

  function resolveSystemPrompt(value, lang) {
    const locale = typeof lang === 'string' && lang.trim() ? lang.trim().slice(0, 2) : getLang();
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
    return DEFAULT_PROMPTS[locale] || DEFAULT_PROMPTS.zh;
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
    loadSettings();
    refreshSettingsActionRefs();
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
        progress: 0,
        file,
        error: null,
        chunks: [],
        stats: null,
        preview: ''
      });
    }
    if (!accepted.length) return;
    state.files = state.files.concat(accepted);
    renderFileList();
    accepted.forEach(startFileProcessing);
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
      const displayStatus = normalizeFileStatus(file.status);
      chip.dataset.status = displayStatus;
      chip.title = buildFileTitle(file);
      if (file.status === 'error') {
        chip.dataset.error = 'true';
      } else {
        chip.removeAttribute('data-error');
      }

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

      const header = document.createElement('span');
      header.className = 'zhida-file-chip-header';
      header.appendChild(name);
      header.appendChild(meta);

      const progressWrap = document.createElement('span');
      progressWrap.className = 'zhida-file-chip-progress-wrap';

      const progress = document.createElement('span');
      progress.className = 'zhida-file-chip-progress';
      const progressBar = document.createElement('span');
      progressBar.className = 'zhida-file-chip-progress-bar';
      const progressValue = typeof file.progress === 'number' ? Math.max(0, Math.min(100, Math.round(file.progress))) : 0;
      progressBar.style.width = progressValue + '%';
      progress.appendChild(progressBar);

      const indicator = document.createElement('span');
      indicator.className = 'zhida-file-chip-status-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      if (displayStatus === 'ready') {
        indicator.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.3 10.6 3.7 8l1.06-1.06L6.3 8.48l4.94-4.94L12.3 4.6z" fill="currentColor"></path></svg>';
        indicator.dataset.label = t('ai_qa_file_status_ready');
      } else if (displayStatus === 'error') {
        indicator.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 6.586 4.707 3.293 3.293 4.707 6.586 8l-3.293 3.293 1.414 1.414L8 9.414l3.293 3.293 1.414-1.414L9.414 8l3.293-3.293-1.414-1.414z" fill="currentColor"></path></svg>';
        indicator.dataset.label = t('ai_qa_file_status_error');
      } else if (displayStatus === 'processing') {
        indicator.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 6.46 7.215.75.75 0 0 0-1.488-.158A5 5 0 1 1 8 3.5a.75.75 0 0 0 0-1.5Z" fill="currentColor"></path></svg>';
        indicator.dataset.label = t('ai_qa_file_status_processing');
      }

      if (indicator.dataset.label) {
        indicator.removeAttribute('aria-hidden');
        indicator.setAttribute('role', 'img');
        indicator.setAttribute('aria-label', indicator.dataset.label);
      }

      progressWrap.appendChild(progress);
      progressWrap.appendChild(indicator);

      textWrap.appendChild(header);
      textWrap.appendChild(progressWrap);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'zhida-file-chip-remove';
      remove.setAttribute('data-file-remove', file.id);
      remove.setAttribute('aria-label', t('ai_qa_file_remove'));
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="sr-only">' + t('ai_qa_file_remove') + '</span>';

      chip.appendChild(icon);
      chip.appendChild(textWrap);
      chip.appendChild(remove);
      el.fileList.appendChild(chip);
    });
  }

  function startFileProcessing(fileDescriptor) {
    if (!fileDescriptor || !fileDescriptor.id) {
      return;
    }
    if (!docPipeline) {
      const message = t('ai_qa_error_docs_unavailable');
      updateFileState(fileDescriptor.id, { status: 'error', progress: 0, error: message });
      notify(message, 'error');
      return;
    }
    docPipeline.process(fileDescriptor, {
      onStatus(status) {
        updateFileState(fileDescriptor.id, { status: status || 'processing' });
      },
      onProgress(progress) {
        updateFileState(fileDescriptor.id, { progress });
      },
      onComplete(result) {
        updateFileState(fileDescriptor.id, {
          status: 'ready',
          progress: 100,
          chunks: Array.isArray(result && result.chunks) ? result.chunks : [],
          stats: result && result.stats ? result.stats : null,
          preview: result && result.preview ? result.preview : '',
          error: null,
          file: null
        });
      },
      onError(error) {
        const base = format(t('ai_qa_error_file_parse'), { name: fileDescriptor.name || '' });
        const message = error && error.message ? base + ' — ' + error.message : base;
        updateFileState(fileDescriptor.id, { status: 'error', progress: 0, error: message, file: null });
        notify(message, 'error');
      }
    });
  }

  function updateFileState(id, patch) {
    const target = state.files.find(item => item.id === id);
    if (!target) {
      return;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'progress')) {
      const value = Number(patch.progress);
      patch.progress = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
    }
    Object.assign(target, patch || {});
    renderFileList();
  }

  function normalizeFileStatus(status) {
    if (!status) {
      return 'pending';
    }
    const value = String(status).toLowerCase();
    switch (value) {
      case 'success':
      case 'complete':
      case 'processed':
      case 'parsed':
      case 'finished':
      case 'uploaded':
      case 'done':
        return 'ready';
      case 'parsing':
      case 'analyzing':
      case 'scanning':
      case 'indexing':
      case 'uploading':
        return 'processing';
      default:
        return value;
    }
  }

  function getFileStatusLabel(file, progressValue) {
    const status = normalizeFileStatus(file && file.status);
    const statusKey = getFileStatusKey(status);
    const base = t(statusKey);
    const percent = typeof progressValue === 'number' ? progressValue : 0;
    const showPercent = ['pending', 'reading', 'processing'].includes(status) && percent > 0 && percent < 100;
    const text = showPercent ? base + ' · ' + percent + '%' : base;
    const title = file && file.error ? file.error : '';
    return { text, title };
  }

  function getFileStatusKey(status) {
    const normalized = normalizeFileStatus(status);
    switch (normalized) {
      case 'reading':
        return 'ai_qa_file_status_reading';
      case 'processing':
        return 'ai_qa_file_status_processing';
      case 'ready':
        return 'ai_qa_file_status_ready';
      case 'error':
        return 'ai_qa_file_status_error';
      default:
        return 'ai_qa_file_status_pending';
    }
  }

  function buildFileTitle(file) {
    if (!file) return '';
    let title = `${file.name} · ${formatBytes(file.size)}`;
    if (file.status === 'error' && file.error) {
      title += '\n' + file.error;
    }
    return title;
  }

  function refreshControls() {
    if (el.sendBtn) {
      el.sendBtn.disabled = !hasActiveEndpoint();
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
      el.sendBtn.disabled = value || !hasActiveEndpoint();
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
    if (state.settings && Number.isFinite(state.settings.temperature)) {
      return clampTemperature(state.settings.temperature);
    }
    return DEFAULT_TEMP;
  }

  function getMaxTokens() {
    if (state.settings && Number.isFinite(state.settings.maxTokens)) {
      return clampMaxTokens(state.settings.maxTokens);
    }
    return DEFAULT_MAX_TOKENS;
  }

  function getSystemPrompt() {
    const lang = state.settings ? state.settings.lang || getLang() : getLang();
    if (state.settings && typeof state.settings.systemPrompt === 'string') {
      return resolveSystemPrompt(state.settings.systemPrompt, lang);
    }
    return DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.zh;
  }

  function getActiveModel() {
    if (state && typeof state.model === 'string' && state.model) {
      return state.model;
    }
    return DEFAULT_MODEL;
  }

  function modelSupportsTemperature(model) {
    const name = typeof model === 'string' ? model.trim().toLowerCase() : '';
    if (!name) {
      return true;
    }
    return !name.startsWith('gpt-5');
  }

  function modelSupportsDocuments(model) {
    const provider = getProviderConfig(model);
    if (provider && Object.prototype.hasOwnProperty.call(provider, 'supportsDocuments')) {
      return !!provider.supportsDocuments;
    }
    return true;
  }

  function normalizeModel(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed && MODEL_OPTIONS.indexOf(trimmed) !== -1) {
      return trimmed;
    }
    return DEFAULT_MODEL;
  }

  function applyPayloadOverrides(target, overrides) {
    if (!target || !overrides) {
      return target;
    }
    Object.keys(overrides).forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
        return;
      }
      const overrideValue = overrides[key];
      if (overrideValue === undefined) {
        return;
      }
      if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
        const baseValue = target[key];
        if (!baseValue || typeof baseValue !== 'object' || Array.isArray(baseValue)) {
          target[key] = {};
        }
        applyPayloadOverrides(target[key], overrideValue);
        return;
      }
      if (Array.isArray(overrideValue)) {
        target[key] = overrideValue.slice();
        return;
      }
      target[key] = overrideValue;
    });
    return target;
  }

  function cloneConfig(value) {
    if (Array.isArray(value)) {
      return value.map(item => cloneConfig(item));
    }
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).forEach(key => {
        result[key] = cloneConfig(value[key]);
      });
      return result;
    }
    return value;
  }

  function shouldUseDocumentMode() {
    if (!Array.isArray(state.files) || !state.files.length) {
      return false;
    }
    return state.files.some(file => {
      if (!file) return false;
      const status = normalizeFileStatus(file.status);
      return READY_FILE_STATUSES[status] && Array.isArray(file.chunks) && file.chunks.length > 0;
    });
  }

  function buildDocumentContext() {
    if (!shouldUseDocumentMode()) {
      return null;
    }
    const lastUser = getLastUserMessage();
    if (!lastUser || !lastUser.content || !lastUser.content.trim()) {
      return null;
    }
    const ranked = rankDocumentChunks(lastUser.content, 6);
    if (!ranked.length) {
      return null;
    }
    const header = 'The user supplied reference documents. Use these snippets when answering and cite the document name when you rely on them.';
    const sections = ranked.map((item, index) => {
      const chunk = item.chunk || null;
      const sourceLabel = formatChunkSourceLabel(chunk);
      const label = `[Doc ${index + 1}: ${item.fileName}${sourceLabel ? ' · ' + sourceLabel : ''}]`;
      return label + '\n' + trimSnippet(item.content, DOC_CONTEXT_SNIPPET_LIMIT);
    });
    return {
      text: header + '\n\n' + sections.join('\n\n'),
      snippets: ranked
    };
  }

  function getLastUserMessage() {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message && message.role === 'user') {
        return message;
      }
    }
    return null;
  }

  function rankDocumentChunks(question, limit) {
    const tokens = tokenizeForRanking(question);
    const expanded = dedupeArray(expandQuestionTokens(tokens));
    if (!expanded.length) {
      return buildFallbackSelections([], limit);
    }

    const readyFiles = state.files.filter(file => {
      if (!file) return false;
      const status = normalizeFileStatus(file.status);
      return READY_FILE_STATUSES[status] && Array.isArray(file.chunks) && file.chunks.length > 0;
    });

    const scored = [];
    readyFiles.forEach(file => {
      file.chunks.forEach((chunk, index) => {
        const score = computeChunkScore(expanded, chunk);
        if (score > 0) {
          scored.push({
            fileId: file.id,
            fileName: file.name,
            content: chunk.content,
            score,
            index,
            chunk
          });
        }
      });
    });

    const maxItems = typeof limit === 'number' && limit > 0 ? limit : 5;

    if (!scored.length) {
      return buildFallbackSelections(readyFiles, maxItems);
    }

    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0].score;
    const threshold = Math.max(topScore * 0.35, MIN_SCORE_THRESHOLD);
    const filtered = scored.filter(item => item.score >= threshold).slice(0, maxItems);

    if (!filtered.length) {
      return buildFallbackSelections(readyFiles, maxItems);
    }

    return filtered;
  }

  function computeChunkScore(questionTokens, chunk) {
    if (!chunk || !questionTokens.length) {
      return 0;
    }
    const freq = ensureChunkTermFrequency(chunk);
    let score = 0;
    for (let i = 0; i < questionTokens.length; i += 1) {
      const token = questionTokens[i];
      if (freq[token]) {
        score += freq[token];
      }
    }
    if (!score) {
      return 0;
    }
    const normaliser = Math.sqrt(chunk.tokenCount || Object.keys(freq).length || 1);
    const weight = chunk.weight && Number.isFinite(chunk.weight) ? chunk.weight : 1;
    return (score / normaliser) * weight;
  }

  function ensureChunkTermFrequency(chunk) {
    if (chunk.termFreq) {
      return chunk.termFreq;
    }
    const tokens = tokenizeForRanking(chunk.content);
    const freq = Object.create(null);
    tokens.forEach(token => {
      freq[token] = (freq[token] || 0) + 1;
    });
    chunk.termFreq = freq;
    chunk.tokenCount = tokens.length;
    return freq;
  }

  function expandQuestionTokens(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) {
      return [];
    }
    const expanded = tokens.slice();
    tokens.forEach(token => {
      if (QUESTION_SYNONYMS[token]) {
        Array.prototype.push.apply(expanded, QUESTION_SYNONYMS[token]);
      }
      if (token.length > 3 && token.endsWith('s')) {
        expanded.push(token.slice(0, -1));
      }
    });
    if (tokens.some(token => GENERIC_QUERY_TOKENS.has(token))) {
      expanded.push('overview', 'summary', 'abstract');
    }
    return expanded;
  }

  function dedupeArray(list) {
    if (!Array.isArray(list) || !list.length) {
      return [];
    }
    const seen = new Set();
    const result = [];
    for (let i = 0; i < list.length; i += 1) {
      const value = list[i];
      if (value == null) {
        continue;
      }
      const key = String(value).toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(key);
    }
    return result;
  }

  function buildFallbackSelections(files, limit) {
    const maxItems = typeof limit === 'number' && limit > 0 ? limit : 5;
    const available = Array.isArray(files) && files.length ? files : state.files;
    const fallbacks = [];

    available.forEach(file => {
      if (!file || !Array.isArray(file.chunks) || !file.chunks.length) {
        return;
      }
      const chunks = chooseFallbackChunks(file.chunks, maxItems);
      chunks.forEach(entry => {
        fallbacks.push({
          fileId: file.id,
          fileName: file.name,
          content: entry.content,
          score: entry.score,
          index: entry.index,
          chunk: entry.chunk,
          fallback: true
        });
      });
    });

    fallbacks.sort((a, b) => {
      const aPage = getChunkFirstPage(a.chunk);
      const bPage = getChunkFirstPage(b.chunk);
      if (aPage != null && bPage != null && aPage !== bPage) {
        return aPage - bPage;
      }
      return a.index - b.index;
    });

    return fallbacks.slice(0, maxItems);
  }

  function chooseFallbackChunks(chunks, limit) {
    const result = [];
    if (!Array.isArray(chunks) || !chunks.length) {
      return result;
    }
    const headCount = Math.min(FALLBACK_CHUNKS_PER_FILE, Math.max(1, limit));
    const candidates = chunks.map((chunk, index) => ({ chunk, index })).filter(entry => entry.chunk && entry.chunk.content);
    candidates.sort((a, b) => {
      const weightA = a.chunk.weight && Number.isFinite(a.chunk.weight) ? a.chunk.weight : 1;
      const weightB = b.chunk.weight && Number.isFinite(b.chunk.weight) ? b.chunk.weight : 1;
      if (weightB !== weightA) {
        return weightB - weightA;
      }
      const pageA = getChunkFirstPage(a.chunk);
      const pageB = getChunkFirstPage(b.chunk);
      if (pageA != null && pageB != null && pageA !== pageB) {
        return pageA - pageB;
      }
      return a.index - b.index;
    });
    for (let i = 0; i < candidates.length && result.length < headCount; i += 1) {
      const entry = candidates[i];
      result.push({
        content: entry.chunk.content,
        chunk: entry.chunk,
        index: entry.index,
        score: entry.chunk.weight ? Math.max(0.05, Math.min(entry.chunk.weight, 1.2)) : 0.05
      });
    }
    return result;
  }

  function formatChunkSourceLabel(chunk) {
    if (!chunk || !chunk.source) {
      return '';
    }
    const source = chunk.source;
    if (Array.isArray(source.pages) && source.pages.length) {
      const min = source.pages[0];
      const max = source.pages[source.pages.length - 1];
      if (min != null && max != null) {
        if (min === max) {
          return 'Page ' + min;
        }
        return 'Pages ' + min + '-' + max;
      }
    }
    if (typeof source.section === 'string' && source.section.trim()) {
      return source.section.trim();
    }
    if (Array.isArray(source.tags) && source.tags.length) {
      return source.tags[0];
    }
    return '';
  }

  function getChunkFirstPage(chunk) {
    if (!chunk || !chunk.source) {
      return null;
    }
    if (Array.isArray(chunk.source.pages) && chunk.source.pages.length) {
      return chunk.source.pages[0];
    }
    if (Number.isFinite(chunk.source.firstPage)) {
      return chunk.source.firstPage;
    }
    if (Number.isFinite(chunk.source.page)) {
      return chunk.source.page;
    }
    return null;
  }

  function getChunkPageRange(chunk) {
    if (!chunk || !chunk.source) {
      return null;
    }
    if (Array.isArray(chunk.source.pages) && chunk.source.pages.length) {
      return chunk.source.pages.slice();
    }
    if (Number.isFinite(chunk.source.firstPage)) {
      return [chunk.source.firstPage];
    }
    if (Number.isFinite(chunk.source.page)) {
      return [chunk.source.page];
    }
    return null;
  }

  function tokenizeForRanking(input) {
    const value = (input || '').toLowerCase();
    const matches = value.match(/[a-z0-9\u4e00-\u9fa5]+/g);
    if (!matches) {
      return [];
    }
    const tokens = [];
    for (let i = 0; i < matches.length; i += 1) {
      const token = matches[i];
      if (/^[\u4e00-\u9fa5]+$/.test(token)) {
        for (let j = 0; j < token.length; j += 1) {
          tokens.push(token[j]);
        }
      } else {
        tokens.push(token);
      }
    }
    return tokens;
  }

  function trimSnippet(text, limit) {
    if (!text) return '';
    const boundary = typeof limit === 'number' && limit > 0 ? limit : DOC_CONTEXT_SNIPPET_LIMIT;
    if (text.length <= boundary) {
      return text.trim();
    }
    return text.slice(0, Math.max(0, boundary - 1)).trimEnd() + '…';
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
    if (value.indexOf('$') === -1) {
      return false;
    }
    return signatureHasMath(computeMathSignature(value));
  }

  function scheduleMathTypeset() {
    if (!el.messages) return;
    if (!mathPendingMessages.size) return;
    if (mathTypesetTimer != null || mathTypesetInFlight) {
      return;
    }
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : function(callback) { return window.setTimeout(callback, 16); };
    mathTypesetTimer = raf(() => {
      mathTypesetTimer = null;
      typesetMathIfNeeded();
    });
  }

  function typesetMathIfNeeded() {
    if (!el.messages) return;
    if (!mathPendingMessages.size) return;
    if (mathTypesetInFlight) return;

    const pendingIds = Array.from(mathPendingMessages);
    mathPendingMessages.clear();

    const targets = pendingIds
      .map(id => {
        const node = el.messages.querySelector(`[data-message-id="${id}"] .zhida-message-text`);
        return node || null;
      })
      .filter(Boolean);

    if (!targets.length) {
      return;
    }

    mathTypesetInFlight = true;

    ensureMathJax()
      .then(() => {
        if (!window.MathJax) return;
        if (typeof window.MathJax.typesetClear === 'function') {
          window.MathJax.typesetClear(targets);
        }
        if (typeof window.MathJax.typesetPromise === 'function') {
          return window.MathJax.typesetPromise(targets);
        }
        if (typeof window.MathJax.typeset === 'function') {
          window.MathJax.typeset(targets);
        }
        return null;
      })
      .catch(error => {
        console.error('MathJax error', error);
      })
      .finally(() => {
        mathTypesetInFlight = false;
        if (mathPendingMessages.size) {
          scheduleMathTypeset();
        }
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
    if (isSessionScopedKey(key)) {
      const sessionStore = getSessionStorage();
      if (sessionStore) {
        try {
          const existing = sessionStore.getItem(key);
          if (existing != null) {
            return existing;
          }
        } catch (_) {}
      }

      const migrated = migrateLegacyValue(key, sessionStore);
      if (migrated != null) {
        return migrated;
      }

      return hasFallbackValue(key) ? storageFallback[key] : null;
    }

    const localStore = getLocalStorage();
    if (localStore) {
      try {
        return localStore.getItem(key);
      } catch (_) {}
    }
    return hasFallbackValue(key) ? storageFallback[key] : null;
  }

  function storageSet(key, value) {
    const strValue = value == null ? '' : String(value);

    if (isSessionScopedKey(key)) {
      const sessionStore = getSessionStorage();
      if (sessionStore) {
        try {
          sessionStore.setItem(key, strValue);
          return;
        } catch (_) {}
      }
      storageFallback[key] = strValue;
      const legacyStore = getLocalStorage();
      if (legacyStore) {
        try { legacyStore.removeItem(key); } catch (_) {}
      }
      return;
    }

    const localStore = getLocalStorage();
    if (localStore) {
      try {
        localStore.setItem(key, strValue);
        return;
      } catch (_) {}
    }
    storageFallback[key] = strValue;
  }

  function isSessionScopedKey(key) {
    return SESSION_SCOPED_KEYS.indexOf(key) !== -1;
  }

  function hasFallbackValue(key) {
    return Object.prototype.hasOwnProperty.call(storageFallback, key);
  }

  function getSessionStorage() {
    try {
      return window.sessionStorage;
    } catch (_) {
      return null;
    }
  }

  function getLocalStorage() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function migrateLegacyValue(key, sessionStore) {
    const legacyStore = getLocalStorage();
    if (!legacyStore) {
      return null;
    }
    let legacyValue = null;
    try {
      legacyValue = legacyStore.getItem(key);
    } catch (_) {
      legacyValue = null;
    }
    if (legacyValue == null) {
      return null;
    }
    try { legacyStore.removeItem(key); } catch (_) {}
    if (sessionStore) {
      try {
        sessionStore.setItem(key, legacyValue);
        return legacyValue;
      } catch (_) {}
    }
    storageFallback[key] = legacyValue;
    return legacyValue;
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

  function createMessageId() {
    return 'm_' + Math.random().toString(36).slice(2, 10);
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
