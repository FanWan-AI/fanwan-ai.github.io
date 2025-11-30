/**
 * Site Assistant - RAG powered Q&A for FanWan-AI
 * Uses MiniSearch for client-side retrieval and DeepSeek for generation.
 */

(function(global) {
  const CONFIG = {
    dataPath: '/data/ai/siteAI/bus/doc_chunk.jsonl',
    proxyEndpoint: 'https://deepseek-proxy.fan-wan-uk.workers.dev/chat',
    webSearchEndpoint: 'https://websearch-proxy.fan-wan-uk.workers.dev/search',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
      { id: 'gpt-4.1', name: 'OpenAI GPT-4.1' }
    ],
    maxContextChars: 12000,
    minScore: 0.3
  };

  // --- UI Styles ---
  const STYLES = `
    #site-assistant-widget {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      font-family: var(--font-body, system-ui, sans-serif);
    }
    #site-assistant-toggle {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border: none;
      box-shadow: 0 8px 24px -6px rgba(37, 99, 235, 0.5);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #site-assistant-toggle:hover {
      transform: scale(1.05);
      box-shadow: 0 12px 32px -8px rgba(37, 99, 235, 0.6);
    }
    #site-assistant-toggle svg {
      width: 28px;
      height: 28px;
    }
    #site-assistant-window {
      position: absolute;
      bottom: 72px;
      right: 0;
      width: 380px;
      height: 600px;
      max-height: calc(100vh - 100px);
      background: var(--rad-surface, #fff);
      border: 1px solid var(--rad-border, #e2e8f0);
      border-radius: 16px;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
    }
    #site-assistant-window.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .sa-header {
      padding: 16px;
      background: var(--rad-surface, #f8fafc);
      border-bottom: 1px solid var(--rad-border, #e2e8f0);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sa-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--rad-text-strong, #0f172a);
    }
    .sa-header-actions {
      display: flex;
      gap: 8px;
    }
    .sa-btn-icon {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--rad-text-muted, #64748b);
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sa-btn-icon:hover {
      background: rgba(0,0,0,0.05);
      color: var(--rad-text-body, #334155);
    }
    .sa-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--rad-bg, #fff);
    }
    .sa-message {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .sa-message.user {
      align-self: flex-end;
      background: #eff6ff;
      color: #1e40af;
      border-bottom-right-radius: 4px;
    }
    .sa-message.assistant {
      align-self: flex-start;
      background: var(--rad-surface, #f1f5f9);
      color: var(--rad-text-body, #334155);
      border-bottom-left-radius: 4px;
    }
    .sa-message.system {
      align-self: center;
      font-size: 12px;
      color: #94a3b8;
      background: transparent;
      padding: 0;
    }
    .sa-input-area {
      padding: 16px;
      border-top: 1px solid var(--rad-border, #e2e8f0);
      background: var(--rad-surface, #fff);
      display: flex;
      gap: 8px;
    }
    .sa-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--rad-input-border, #cbd5e1);
      border-radius: 8px;
      font-size: 14px;
      background: var(--rad-input-bg, #fff);
      color: var(--rad-text-body, #0f172a);
    }
    .sa-input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    .sa-send {
      padding: 0 16px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .sa-send:hover {
      background: #1d4ed8;
    }
    .sa-send:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .sa-loading {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Settings Panel */
    #sa-settings-panel {
      position: absolute;
      inset: 0;
      background: var(--rad-surface, #fff);
      z-index: 10;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.2s ease;
    }
    #sa-settings-panel.open {
      transform: translateX(0);
    }
    .sa-settings-header {
      padding: 16px;
      border-bottom: 1px solid var(--rad-border, #e2e8f0);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sa-settings-back {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--rad-text-body, #334155);
    }
    .sa-settings-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--rad-text-strong, #0f172a);
    }
    .sa-settings-body {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    }
    .sa-setting-group {
      margin-bottom: 24px;
    }
    .sa-setting-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--rad-text-body, #334155);
    }
    .sa-setting-desc {
      font-size: 12px;
      color: var(--rad-text-muted, #64748b);
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .sa-select {
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--rad-input-border, #cbd5e1);
      background: var(--rad-input-bg, #fff);
      color: var(--rad-text-body, #0f172a);
      font-size: 14px;
    }
    .sa-range-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sa-range {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: #cbd5e1;
      outline: none;
      -webkit-appearance: none;
    }
    .sa-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #2563eb;
      cursor: pointer;
    }
    .sa-range-val {
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      color: var(--rad-text-muted, #64748b);
      width: 32px;
      text-align: right;
    }
    .sa-toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sa-toggle {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }
    .sa-toggle input {
      opacity: 0;
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 2;
      cursor: pointer;
    }
    .sa-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #cbd5e1;
      transition: .4s;
      border-radius: 24px;
      z-index: 1;
    }
    .sa-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .sa-slider {
      background-color: #2563eb;
    }
    input:checked + .sa-slider:before {
      transform: translateX(20px);
    }
    
    /* Dark mode overrides */
    :root[data-theme="dark"] #site-assistant-window {
      background: #1e293b;
      border-color: #334155;
    }
    :root[data-theme="dark"] .sa-header {
      background: #0f172a;
      border-color: #334155;
    }
    :root[data-theme="dark"] .sa-header h3 {
      color: #f8fafc;
    }
    :root[data-theme="dark"] .sa-messages {
      background: #1e293b;
    }
    :root[data-theme="dark"] .sa-message.user {
      background: #1e3a8a;
      color: #bfdbfe;
    }
    :root[data-theme="dark"] .sa-message.assistant {
      background: #334155;
      color: #e2e8f0;
    }
    :root[data-theme="dark"] .sa-input-area {
      background: #0f172a;
      border-color: #334155;
    }
    :root[data-theme="dark"] .sa-input {
      background: #1e293b;
      border-color: #475569;
      color: #f8fafc;
    }
    :root[data-theme="dark"] #sa-settings-panel {
      background: #1e293b;
    }
    :root[data-theme="dark"] .sa-settings-header {
      border-color: #334155;
    }
    :root[data-theme="dark"] .sa-settings-title {
      color: #f8fafc;
    }
    :root[data-theme="dark"] .sa-setting-label {
      color: #e2e8f0;
    }
    :root[data-theme="dark"] .sa-setting-desc {
      color: #94a3b8;
    }
    :root[data-theme="dark"] .sa-btn-icon {
      color: #94a3b8;
    }
    :root[data-theme="dark"] .sa-btn-icon:hover {
      color: #f8fafc;
      background: rgba(255,255,255,0.1);
    }
    :root[data-theme="dark"] .sa-select {
      background: #1e293b;
      border-color: #475569;
      color: #f8fafc;
    }
    :root[data-theme="dark"] .sa-range {
      background: #475569;
    }
  `;

  // --- Logic ---

  class SiteAssistant {
    constructor() {
      this.miniSearch = null;
      this.documents = [];
      this.isReady = false;
      this.isLoading = false;
      
      // Settings
      this.settings = {
        model: CONFIG.defaultModel,
        temperature: 0.7,
        webSearch: false
      };
      
      this.init();
    }

    async init() {
      this.injectStyles();
      this.renderUI();
      this.log('Initializing...', 'system');
      
      try {
        await this.loadDependencies();
        await this.loadData();
        this.isReady = true;
        this.log('Ready to answer questions about the site!', 'system');
      } catch (e) {
        console.error(e);
        this.log('Failed to initialize: ' + e.message, 'system');
      }
    }

    injectStyles() {
      const style = document.createElement('style');
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    async loadDependencies() {
      if (window.MiniSearch) return;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/minisearch@7.1.0/dist/umd/index.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    async loadData() {
      const response = await fetch(CONFIG.dataPath);
      if (!response.ok) throw new Error('Failed to fetch data');
      
      const text = await response.text();
      // Parse JSONL
      this.documents = text.trim().split('\n').map(line => {
        try {
          return JSON.parse(line);
        } catch (e) { return null; }
      }).filter(Boolean);

      // Initialize MiniSearch
      this.miniSearch = new MiniSearch({
        fields: ['title', 'text', 'meta.tags'], // fields to index for full-text search
        storeFields: ['title', 'text', 'url', 'meta', 'source', 'docId'], // fields to return with search results
        searchOptions: {
          boost: { title: 2 },
          fuzzy: 0.2
        },
        extractField: (document, fieldName) => {
          return fieldName.split('.').reduce((doc, key) => doc && doc[key], document);
        }
      });

      this.miniSearch.addAll(this.documents);
      console.log(`Indexed ${this.documents.length} documents.`);
    }

    renderUI() {
      const container = document.createElement('div');
      container.id = 'site-assistant-widget';
      container.innerHTML = `
        <div id="site-assistant-window">
          <div class="sa-header">
            <h3>AI Site Assistant</h3>
            <div class="sa-header-actions">
              <button id="sa-settings-btn" class="sa-btn-icon" title="Settings">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
              <button id="sa-close" class="sa-btn-icon" title="Close">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          
          <div id="sa-settings-panel">
            <div class="sa-settings-header">
              <button class="sa-settings-back" id="sa-settings-back">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <span class="sa-settings-title">Settings</span>
            </div>
            <div class="sa-settings-body">
              <div class="sa-setting-group">
                <span class="sa-setting-label">Model</span>
                <select id="sa-model-select" class="sa-select">
                  ${CONFIG.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
                </select>
              </div>
              
              <div class="sa-setting-group">
                <div class="sa-toggle-row">
                  <span class="sa-setting-label">Temperature</span>
                  <span class="sa-range-val" id="sa-temp-val">0.7</span>
                </div>
                <input type="range" id="sa-temp-range" class="sa-range" min="0" max="1" step="0.1" value="0.7">
              </div>

              <div class="sa-setting-group">
                <div class="sa-toggle-row">
                  <div>
                    <span class="sa-setting-label">Web Search</span>
                    <div class="sa-setting-desc">Allow the assistant to search the web for latest info.</div>
                  </div>
                  <label class="sa-toggle">
                    <input type="checkbox" id="sa-websearch-toggle">
                    <span class="sa-slider"></span>
                  </label>
                </div>
                <div id="sa-websearch-test-area" style="margin-top: 12px; display: none;">
                  <button id="sa-test-search-btn" style="background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #475569;">Test Search Connection</button>
                  <div id="sa-test-status" style="margin-top: 8px; font-size: 12px; color: #64748b;"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="sa-messages" id="sa-messages"></div>
          <div class="sa-input-area">
            <input type="text" class="sa-input" id="sa-input" placeholder="Ask about AI news, models, papers..." />
            <button class="sa-send" id="sa-send">Send</button>
          </div>
        </div>
        <button id="site-assistant-toggle" aria-label="Open AI Assistant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </button>
      `;
      document.body.appendChild(container);

      const toggle = document.getElementById('site-assistant-toggle');
      const windowEl = document.getElementById('site-assistant-window');
      const closeBtn = document.getElementById('sa-close');
      const input = document.getElementById('sa-input');
      const sendBtn = document.getElementById('sa-send');
      
      // Settings elements
      const settingsBtn = document.getElementById('sa-settings-btn');
      const settingsPanel = document.getElementById('sa-settings-panel');
      const settingsBack = document.getElementById('sa-settings-back');
      const modelSelect = document.getElementById('sa-model-select');
      const tempRange = document.getElementById('sa-temp-range');
      const tempVal = document.getElementById('sa-temp-val');
      const webSearchToggle = document.getElementById('sa-websearch-toggle');
      const testSearchArea = document.getElementById('sa-websearch-test-area');
      const testSearchBtn = document.getElementById('sa-test-search-btn');
      const testStatus = document.getElementById('sa-test-status');

      const toggleOpen = () => windowEl.classList.toggle('open');
      toggle.addEventListener('click', toggleOpen);
      closeBtn.addEventListener('click', toggleOpen);

      // Settings logic
      settingsBtn.addEventListener('click', () => {
        settingsPanel.classList.add('open');
      });
      settingsBack.addEventListener('click', () => {
        settingsPanel.classList.remove('open');
      });
      
      modelSelect.addEventListener('change', (e) => {
        this.settings.model = e.target.value;
      });
      
      tempRange.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.settings.temperature = val;
        tempVal.textContent = val.toFixed(1);
      });

      webSearchToggle.addEventListener('change', (e) => {
        this.settings.webSearch = e.target.checked;
        this.log(`Web search ${this.settings.webSearch ? 'enabled' : 'disabled'}.`, 'system');
        testSearchArea.style.display = this.settings.webSearch ? 'block' : 'none';
      });

      testSearchBtn.addEventListener('click', async () => {
        testStatus.textContent = 'Testing connection...';
        testStatus.style.color = '#64748b';
        try {
          const results = await this.performWebSearch('test', 'day');
          if (Array.isArray(results)) {
            testStatus.textContent = `Success! Found ${results.length} results.`;
            testStatus.style.color = '#16a34a';
          } else {
            throw new Error('Invalid response format');
          }
        } catch (e) {
          testStatus.textContent = 'Connection failed: ' + e.message;
          testStatus.style.color = '#dc2626';
        }
      });

      const handleSend = () => {
        const text = input.value.trim();
        if (!text || this.isLoading) return;
        input.value = '';
        this.handleUserQuery(text);
      };

      sendBtn.addEventListener('click', handleSend);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
      });
    }

    log(text, type = 'assistant') {
      const container = document.getElementById('sa-messages');
      const msg = document.createElement('div');
      msg.className = `sa-message ${type}`;
      msg.textContent = text;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
      return msg;
    }

    async handleUserQuery(query) {
      this.log(query, 'user');
      
      if (!this.isReady) {
        this.log('System is still initializing, please wait...', 'system');
        return;
      }

      this.isLoading = true;
      const loadingMsg = this.log('Thinking...', 'assistant');
      
      try {
        // 1. Analyze Intent & Filter
        const filters = this.analyzeIntent(query);
        
        // 2. Search (Local)
        let results = this.search(query, filters);
        let webResults = [];

        // 3. Web Search (if enabled)
        if (this.settings.webSearch) {
          loadingMsg.textContent = 'Searching the web...';
          try {
            // Determine freshness based on intent
            let freshness = 'month';
            if (filters.dateRange === 'today') freshness = 'day';
            else if (query.includes('recent') || query.includes('latest')) freshness = 'week';
            
            webResults = await this.performWebSearch(query, freshness);
          } catch (e) {
            console.error('Web search failed', e);
            this.log('Web search failed, falling back to local data.', 'system');
          }
        }
        
        // 4. Generate Answer
        loadingMsg.textContent = 'Generating answer...';
        const answer = await this.generateAnswer(query, results, webResults);
        
        loadingMsg.textContent = answer;
      } catch (e) {
        console.error(e);
        loadingMsg.textContent = 'Sorry, I encountered an error processing your request.';
      } finally {
        this.isLoading = false;
      }
    }

    async performWebSearch(query, freshness = 'week') {
      const response = await fetch(CONFIG.webSearchEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          maxResults: 5,
          freshness: freshness
        })
      });
      
      if (!response.ok) throw new Error('Web search API error');
      const data = await response.json();
      return data.results || [];
    }

    analyzeIntent(query) {
      const q = query.toLowerCase();
      const filters = {};
      
      // Source filtering
      if (q.includes('news') || q.includes('trend') || q.includes('radar') || q.includes('新闻') || q.includes('资讯') || q.includes('动态')) {
        filters.source = 'airadar';
      } else if (q.includes('model') || q.includes('llm') || q.includes('repo') || q.includes('模型') || q.includes('开源') || q.includes('项目')) {
        filters.source = 'modelswatch'; 
      } else if (q.includes('paper') || q.includes('research') || q.includes('arxiv') || q.includes('论文') || q.includes('学术')) {
        filters.source = 'scholarpush';
      } else if (q.includes('who is') || q.includes('about') || q.includes('fan wan') || q.includes('万凡') || q.includes('关于')) {
        filters.source = 'site_docs';
      }

      // Date filtering
      // We need to check if the user asks for "today", "yesterday", "this week"
      // doc_chunk.jsonl has meta.updated_at (ISO string)
      const now = new Date();
      if (q.includes('today') || q.includes('latest') || q.includes('new') || q.includes('今天') || q.includes('最新') || q.includes('今日')) {
        // We'll filter results in the search step
        filters.dateRange = 'today';
      }

      return filters;
    }

    search(query, filters) {
      // Basic search
      let results = this.miniSearch.search(query, {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true
      });

      // Apply filters
      if (filters.source) {
        // Note: MiniSearch filter option is exact match. 
        // Our source in doc_chunk might be 'scholarpush', 'modelswatch_gh', etc.
        // If filter is 'modelswatch', we want to match 'modelswatch_gh' and 'modelswatch_hf'.
        results = results.filter(r => r.source && r.source.includes(filters.source));
      }

      if (filters.dateRange === 'today') {
        // Filter for items updated in the last 48 hours (to be safe with timezones and update delays)
        const now = new Date();
        const twoDays = 48 * 60 * 60 * 1000;
        results = results.filter(r => {
          if (!r.meta || !r.meta.updated_at) return false;
          const date = new Date(r.meta.updated_at);
          return (now - date) < twoDays;
        });
        
        // If "today" is asked, we sort by date descending
        results.sort((a, b) => {
          const da = new Date(a.meta.updated_at || 0);
          const db = new Date(b.meta.updated_at || 0);
          return db - da;
        });
      }

      return results.slice(0, 15); // Top 15 chunks
    }

    async generateAnswer(query, results, webResults = []) {
      // Construct Context
      let context = '';
      
      if (results.length > 0) {
        context += '--- Local Site Content ---\n';
        context += results.map(r => {
          const date = r.meta && r.meta.updated_at ? r.meta.updated_at.split('T')[0] : 'Unknown Date';
          return `[${r.source} | ${date}] ${r.title}\n${r.text}\nURL: ${r.url}`;
        }).join('\n\n');
        context += '\n\n';
      }

      if (webResults.length > 0) {
        context += '--- Web Search Results ---\n';
        context += webResults.map(r => {
          return `[Web] ${r.title}\n${r.description}\nURL: ${r.url}`;
        }).join('\n\n');
      }

      const systemPrompt = `You are the AI Assistant for FanWan-AI. 
      Answer the user's question based ONLY on the provided context.
      If the context doesn't contain the answer, say you don't know.
      
      Current Date: ${new Date().toISOString().split('T')[0]}
      
      Context:
      ${context}
      `;

      const response = await fetch(CONFIG.proxyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          model: this.settings.model,
          temperature: this.settings.temperature
        })
      });

      if (!response.ok) throw new Error('LLM API Error');
      
      const data = await response.json();
      return data.choices[0].message.content;
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new SiteAssistant());
  } else {
    new SiteAssistant();
  }

})(window);
