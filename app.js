/**
 * АвтоРадар — Telegram Mini App Frontend
 * Complete client application for car monitoring and search filters management.
 */

(function () {
  'use strict';

  // 1. Telegram WebApp SDK Initialization
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      // Enable closing confirmation if supported
      if (tg.enableClosingConfirmation) {
        tg.enableClosingConfirmation();
      }
    } catch (e) {
      console.warn('Telegram WebApp SDK init error:', e);
    }
  }

  // Haptic feedback helper
  function triggerHaptic(type = 'light') {
    try {
      if (tg?.HapticFeedback) {
        if (type === 'success' || type === 'error' || type === 'warning') {
          tg.HapticFeedback.notificationOccurred(type);
        } else {
          tg.HapticFeedback.impactOccurred(type);
        }
      }
    } catch (e) {
      // Ignore if not supported
    }
  }

  // 2. Resolve API_BASE URL
  // Config constant for Gist raw URL (can be set directly or overridden via window.GIST_RAW_URL or window.APP_CONFIG?.GIST_RAW_URL)
  const GIST_RAW_URL = "https://gist.githubusercontent.com/kia12345671/5534ab2a9ceb849ff045a21fc918b2d8/raw/api_config.json";

  let _resolvedApiBase = null;

  async function resolveApiBase() {
    if (_resolvedApiBase) {
      return _resolvedApiBase;
    }

    // 1) Parameter ?api= from URL query string
    const urlParams = new URLSearchParams(window.location.search);
    const paramApi = urlParams.get('api');
    if (paramApi && paramApi.trim()) {
      _resolvedApiBase = paramApi.trim().replace(/\/+$/, '');
      localStorage.setItem('api_base', _resolvedApiBase);
      return _resolvedApiBase;
    }

    // 2) If GIST_RAW_URL is configured in frontend
    const gistRaw = GIST_RAW_URL || window.GIST_RAW_URL || window.APP_CONFIG?.GIST_RAW_URL || '';
    if (gistRaw && gistRaw.trim()) {
      try {
        const sep = gistRaw.includes('?') ? '&' : '?';
        const gistUrl = gistRaw.trim() + sep + 't=' + Date.now();
        const resp = await fetch(gistUrl);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.api_url && String(data.api_url).trim()) {
            _resolvedApiBase = String(data.api_url).trim().replace(/\/+$/, '');
            localStorage.setItem('api_base', _resolvedApiBase);
            return _resolvedApiBase;
          }
        }
      } catch (e) {
        console.warn('Failed to resolve api_url from GIST_RAW_URL:', e);
      }
    }

    // Fallback: check stored api_base
    const stored = localStorage.getItem('api_base');
    if (stored && stored.trim()) {
      _resolvedApiBase = stored.trim().replace(/\/+$/, '');
      return _resolvedApiBase;
    }

    // 3) window.location.origin (with http fallback for local file:// testing)
    let origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    if (!origin || origin === 'null' || origin === 'file://' || (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')) {
      origin = 'http://127.0.0.1:8000';
    }
    _resolvedApiBase = origin.replace(/\/+$/, '');
    return _resolvedApiBase;
  }

  function getApiBase() {
    if (_resolvedApiBase) {
      return _resolvedApiBase;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const paramApi = urlParams.get('api');
    if (paramApi && paramApi.trim()) {
      _resolvedApiBase = paramApi.trim().replace(/\/+$/, '');
      return _resolvedApiBase;
    }
    const stored = localStorage.getItem('api_base');
    if (stored && stored.trim()) {
      _resolvedApiBase = stored.trim().replace(/\/+$/, '');
      return _resolvedApiBase;
    }
    let origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    if (!origin || origin === 'null' || origin === 'file://' || (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')) {
      origin = 'http://127.0.0.1:8000';
    }
    return origin.replace(/\/+$/, '');
  }

  const FRIENDLY_NETWORK_ERROR = "Нет связи с сервером. Попробуйте через 5 секунд.";
  // Связь с сервером прервалась. Нажмите /start в боте и откройте АвтоРадар заново.

  function isNetworkError(err) {
    if (!err) return false;
    if (err instanceof TypeError) return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('load failed') ||
           msg.includes('failed to fetch') ||
           msg.includes('networkerror') ||
           msg.includes('network request failed') ||
           msg.includes('connection');
  }

  // API Fetch Helper with Telegram auth header and 2 automatic retries on network drops / 502/503/504
  async function apiFetch(path, options = {}) {
    const apiBase = await resolveApiBase();
    const url = `${apiBase}${path}`;
    // Read window.Telegram.WebApp.initData dynamically on every request
    const dynamicInitData = window.Telegram?.WebApp?.initData || tg?.initData || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': dynamicInitData,
      ...(options.headers || {})
    };

    const maxRetries = 2; // 1 initial attempt + 2 automatic retries (delays: 800ms, 1500ms)
    const retryDelays = [800, 1500];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(url, { ...options, headers });
        if (resp.status === 204) {
          return null;
        }

        // Automatic retry on transient tunnel / gateway restart (502, 503, 504)
        if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
          if (attempt < maxRetries) {
            console.warn(`[apiFetch] Server/tunnel status ${resp.status} on ${path}. Retrying in ${retryDelays[attempt]}ms (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise(r => setTimeout(r, retryDelays[attempt]));
            continue;
          }
          const err = new Error(FRIENDLY_NETWORK_ERROR);
          err.status = resp.status;
          err.detail = FRIENDLY_NETWORK_ERROR;
          throw err;
        }

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (resp.status === 401 && (!dynamicInitData || String(data?.detail || '').toLowerCase().includes('missing x-telegram-init-data') || String(data?.detail || '').toLowerCase().includes('init-data'))) {
            const authMsg = "Откройте приложение через кнопку «🚀 Открыть АвтоРадар» в сообщении бота или через левую кнопку меню.";
            const err = new Error(authMsg);
            err.status = 401;
            err.detail = authMsg;
            throw err;
          }
          let errorDetail = `Ошибка сервера (${resp.status})`;
          if (typeof data?.detail === 'string') {
            errorDetail = data.detail;
          } else if (Array.isArray(data?.detail)) {
            errorDetail = data.detail.map(d => d.msg || JSON.stringify(d)).join(', ');
          } else if (data?.detail) {
            errorDetail = JSON.stringify(data.detail);
          }
          const err = new Error(errorDetail);
          err.status = resp.status;
          err.detail = data?.detail;
          throw err;
        }
        return data;
      } catch (err) {
        // If it's a network drop and retries remain, wait and retry
        if (isNetworkError(err) && attempt < maxRetries) {
          console.warn(`[apiFetch] Network error (${err.message}) on ${path}. Retrying in ${retryDelays[attempt]}ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, retryDelays[attempt]));
          continue;
        }

        console.error(`API Error [${options.method || 'GET'} ${path}]:`, err);
        if (isNetworkError(err)) {
          const friendlyErr = new Error(FRIENDLY_NETWORK_ERROR);
          friendlyErr.status = 0;
          friendlyErr.detail = FRIENDLY_NETWORK_ERROR;
          throw friendlyErr;
        }
        throw err;
      }
    }
  }

  // 3. Application State
  const state = {
    user: null,
    filters: [],
    stopwords: [],
    activeTab: 'filters',
    editingFilterId: null,

    // Catalog state
    catalogMakes: [],
    currentMakeModels: [],
    selectedMake: null,     // { id, name, ru_name, display, drom_slug, autoru_slug, avito_slug }
    selectedModel: null,    // { id, model, name, ru_name, display, years, drom_model, autoru_model, avito_query }
    isAnyCar: false,

    // Gearbox state
    selectedGearboxes: new Set(), // Set of 'at', 'amt', 'cvt', 'mt'

    // City & Autocomplete state
    allCities: [],
    citiesMap: {},
    selectedCity: { name: 'Москва', slug: 'moskva', lat: 55.7558, lon: 37.6173 },
    isCitySelected: true,

    // Stopwords in modal state
    modalStopwords: [],

    // Timers
    makeSearchTimer: null,
    modelSearchTimer: null,

    defaultStopwords: [
      'битый', 'после дтп', 'на запчасти', 'разбор', 'не на ходу',
      'без документов', 'без птс', 'запрет', 'арест', 'утиль'
    ]
  };

  // DOM Elements
  const el = {
    subBadge: document.getElementById('sub-badge'),
    btnApiSettings: document.getElementById('btn-api-settings'),
    tabBtnFilters: document.getElementById('tab-btn-filters'),
    tabBtnStopwords: document.getElementById('tab-btn-stopwords'),
    filtersCounter: document.getElementById('filters-counter'),
    stopwordsCounter: document.getElementById('stopwords-counter'),
    tabFilters: document.getElementById('tab-filters'),
    tabStopwords: document.getElementById('tab-stopwords'),
    btnCreateFilter: document.getElementById('btn-create-filter'),
    filtersLoading: document.getElementById('filters-loading'),
    filtersEmpty: document.getElementById('filters-empty'),
    filtersList: document.getElementById('filters-list'),
    newStopwordInput: document.getElementById('new-stopword-input'),
    btnAddStopword: document.getElementById('btn-add-stopword'),
    stopwordsContainer: document.getElementById('stopwords-container'),
    btnSaveStopwords: document.getElementById('btn-save-stopwords'),
    btnResetStopwords: document.getElementById('btn-reset-stopwords'),

    // Modal Filter Elements
    filterModal: document.getElementById('filter-modal'),
    modalTitle: document.getElementById('modal-title'),
    btnModalClose: document.getElementById('btn-modal-close'),
    btnModalCancel: document.getElementById('btn-modal-cancel'),
    filterForm: document.getElementById('filter-form'),

    // Hidden inputs
    fSearchMode: document.getElementById('f-search-mode'),
    fMake: document.getElementById('f-make'),
    fModel: document.getElementById('f-model'),
    fDisplayName: document.getElementById('f-display-name'),
    fDromMake: document.getElementById('f-drom-make'),
    fDromModel: document.getElementById('f-drom-model'),
    fAutoruMake: document.getElementById('f-autoru-make'),
    fAutoruModel: document.getElementById('f-autoru-model'),
    fAvitoQuery: document.getElementById('f-avito-query'),
    fGearbox: document.getElementById('f-gearbox'),

    // Make selector controls
    makeInputWrapper: document.getElementById('make-input-wrapper'),
    makeInput: document.getElementById('make-input'),
    btnClearMake: document.getElementById('btn-clear-make'),
    makeSearchSpinner: document.getElementById('make-search-spinner'),
    selectedMakeBadge: document.getElementById('selected-make-badge'),
    selectedMakeName: document.getElementById('selected-make-name'),
    btnChangeMake: document.getElementById('btn-change-make'),
    makeDropdown: document.getElementById('make-dropdown'),
    makeStatusHint: document.getElementById('make-status-hint'),

    // Model selector controls
    modelSelectionGroup: document.getElementById('model-selection-group'),
    modelInputWrapper: document.getElementById('model-input-wrapper'),
    modelInput: document.getElementById('model-input'),
    btnClearModel: document.getElementById('btn-clear-model'),
    modelSearchSpinner: document.getElementById('model-search-spinner'),
    selectedModelBadge: document.getElementById('selected-model-badge'),
    selectedModelName: document.getElementById('selected-model-name'),
    btnChangeModel: document.getElementById('btn-change-model'),
    modelDropdown: document.getElementById('model-dropdown'),
    modelStatusHint: document.getElementById('model-status-hint'),

    // Specs Inputs
    fPriceMin: document.getElementById('f-price-min'),
    fPriceMax: document.getElementById('f-price-max'),
    fYearMin: document.getElementById('f-year-min'),
    fYearMax: document.getElementById('f-year-max'),
    fMileageMax: document.getElementById('f-mileage-max'),
    fEngineVolumes: document.getElementById('f-engine-volumes'),
    fNotificationsEnabled: document.getElementById('f-notifications-enabled'),
    saveBtnText: document.getElementById('save-btn-text'),

    // City Autocomplete Controls
    cityInput: document.getElementById('city-input'),
    btnClearCity: document.getElementById('btn-clear-city'),
    cityDropdown: document.getElementById('city-dropdown'),
    cityErrorHint: document.getElementById('city-error-hint'),
    cityStatusHint: document.getElementById('city-status-hint'),
    radiusSelectorGroup: document.getElementById('radius-selector-group'),
    fCity: document.getElementById('f-city'),
    fLat: document.getElementById('f-lat'),
    fLon: document.getElementById('f-lon'),
    fRadiusKm: document.getElementById('f-radius-km'),

    // Stopwords Quick Hints & Modal Controls
    quickStopwordsTab: document.getElementById('quick-stopwords-tab'),
    quickStopwordsModal: document.getElementById('quick-stopwords-modal'),
    modalStopwordInput: document.getElementById('modal-stopword-input'),
    btnAddModalStopword: document.getElementById('btn-add-modal-stopword'),
    modalStopwordsContainer: document.getElementById('modal-stopwords-container'),
    btnResetFilterStopwords: document.getElementById('btn-reset-filter-stopwords'),

    // Two-level Gearbox controls
    btnGbAny: document.getElementById('btn-gb-any'),
    btnGbMt: document.getElementById('btn-gb-mt'),
    btnGbAuto: document.getElementById('btn-gb-auto'),
    gearboxSubchips: document.getElementById('gearbox-subchips'),
    gearboxSummaryHint: document.getElementById('gearbox-summary-hint'),

    // Admin Tab Elements
    tabBtnAdmin: document.getElementById('tab-btn-admin'),
    adminUsersCounter: document.getElementById('admin-users-counter'),
    tabAdmin: document.getElementById('tab-admin'),
    btnAdminRefresh: document.getElementById('btn-admin-refresh'),
    adminUsersLoading: document.getElementById('admin-users-loading'),
    adminUsersList: document.getElementById('admin-users-list'),

    // API Modal Elements
    apiModal: document.getElementById('api-modal'),
    btnApiClose: document.getElementById('btn-api-close'),
    apiUrlInput: document.getElementById('api-url-input'),
    btnApiSave: document.getElementById('btn-api-save'),
    btnApiReset: document.getElementById('btn-api-reset'),
    toast: document.getElementById('toast')
  };

  // Supported Cities Dictionary with Coordinates
  const CITIES_DICT = {
    'moskva': { name: 'Москва', lat: 55.7558, lon: 37.6173 },
    'stupino': { name: 'Ступино', lat: 54.8872, lon: 38.0772 },
    'sankt-peterburg': { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351 },
    'krasnodar': { name: 'Краснодар', lat: 45.0355, lon: 38.9753 },
    'kazan': { name: 'Казань', lat: 55.7961, lon: 49.1064 },
    'ekaterinburg': { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057 },
    'nizhniy_novgorod': { name: 'Нижний Новгород', lat: 56.3269, lon: 44.0059 },
    'rostov-na-donu': { name: 'Ростов-на-Дону', lat: 47.2225, lon: 39.7187 },
    'rossiya': { name: 'Вся Россия', lat: 55.7558, lon: 37.6173 }
  };
  // Initialize state.citiesMap immediately with default dictionary
  state.citiesMap = { ...CITIES_DICT };

  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function findNearestCity(lat, lon) {
    let closestKey = 'moskva';
    let minDist = Infinity;
    for (const [key, c] of Object.entries(CITIES_DICT)) {
      if (key === 'rossiya') continue;
      const d = getDistanceKm(lat, lon, c.lat, c.lon);
      if (d < minDist) {
        minDist = d;
        closestKey = key;
      }
    }
    return { key: closestKey, name: CITIES_DICT[closestKey].name, distance: minDist };
  }

  // Toast Helper
  let toastTimer = null;
  function showToast(message, type = 'info') {
    if (!el.toast) return;
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast ${type}`;
    toastTimer = setTimeout(() => {
      el.toast.className = 'toast hidden';
    }, 2800);
  }

  // Helper: Gearbox formatting
  function formatGearboxLabel(gb) {
    if (!gb || gb.toUpperCase() === 'ANY') return null;
    const val = gb.trim().toLowerCase();
    if (val === 'at,amt,cvt') return 'Автомат (все)';
    if (val === 'mt' || val === 'manual') return 'Механика';
    const parts = val.split(',').map(p => p.trim());
    const map = {
      'at': 'АКПП',
      'amt': 'Робот',
      'cvt': 'Вариатор',
      'mt': 'Механика',
      'auto': 'Автомат',
      'manual': 'Механика'
    };
    const labels = parts.map(p => map[p] || p.toUpperCase());
    return labels.join(', ');
  }

  // 4. Initial Load
  async function loadData() {
    // 1. Instant render from local cache
    try {
      const cachedFilters = localStorage.getItem('ar_cached_filters');
      const cachedUser = localStorage.getItem('ar_cached_user');
      if (cachedFilters) {
        const parsed = JSON.parse(cachedFilters);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.filters = parsed;
          if (cachedUser) state.user = JSON.parse(cachedUser);
          renderHeader();
          renderFilters();
        }
      }
    } catch (e) {
      console.warn('Cache restore error:', e);
    }

    try {
      if (!state.filters || state.filters.length === 0) {
        el.filtersLoading.classList.remove('hidden');
        el.filtersEmpty.classList.add('hidden');
        el.filtersList.innerHTML = '';
      }

      const meData = await apiFetch('/api/me');
      state.user = meData;
      state.filters = meData.filters || [];
      state.stopwords = meData.stopwords || [];

      try {
        localStorage.setItem('ar_cached_filters', JSON.stringify(state.filters));
        localStorage.setItem('ar_cached_user', JSON.stringify(state.user));
      } catch (e) {}

      renderHeader();
      renderFilters();
      renderStopwords();

      // Pre-load catalog makes and cities in background
      loadCatalogMakes();
      loadCities();
    } catch (err) {
      console.error('loadData error:', err);
      el.filtersLoading.classList.add('hidden');
      if (err.status === 401 || err.status === 502 || err.status === 503 || err.status === 504) {
        showToast(err.message || String(err), 'error');
      } else {
        showToast('Ошибка загрузки данных: ' + (err.message || err), 'error');
      }
      triggerHaptic('error');
    }
  }

  // Load cities directory from API
  async function loadCities() {
    if (state.allCities && state.allCities.length > 0) return;
    try {
      const data = await apiFetch('/api/cities');
      state.allCities = data.cities || [];
      state.citiesMap = {};
      state.allCities.forEach(c => {
        state.citiesMap[c.slug] = c;
      });
    } catch (e) {
      console.warn('Failed to load cities:', e);
      // Fallback to basic cities
      state.allCities = Object.entries(CITIES_DICT).map(([slug, c]) => ({
        name: c.name,
        slug: slug,
        lat: c.lat,
        lon: c.lon
      }));
      state.citiesMap = { ...CITIES_DICT };
    }
  }

  // Load makes catalog from API
  async function loadCatalogMakes() {
    if (state.catalogMakes.length > 0) return;
    try {
      const data = await apiFetch('/api/catalog/makes');
      state.catalogMakes = data.makes || [];
    } catch (e) {
      console.warn('Failed to load catalog makes:', e);
    }
  }

  // Render Header & Subscription Badge
  function renderHeader() {
    if (!state.user) return;
    const role = state.user.role || 'trial';
    const isAdmin = Boolean(state.user.is_admin || role === 'admin');
    const activeCount = state.user.active_filters_count ?? state.filters.filter(f => f.notifications_enabled).length;
    const limit = state.user.filter_limit ?? 2;
    const limitDisplay = limit === 999999 ? '∞' : limit;

    el.subBadge.className = 'badge-pill';

    if (isAdmin) {
      el.subBadge.textContent = `👑 Admin • ∞ (${activeCount} акт.)`;
      el.subBadge.classList.add('active');
    } else if (role === 'vip') {
      const expStr = state.user.expires_at || state.user.sub_until;
      let dateText = 'активен';
      if (expStr) {
        try {
          const d = new Date(expStr);
          if (d.getFullYear() > 2090) {
            dateText = 'Бессрочно';
          } else {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            dateText = `до ${dd}.${mm}.${d.getFullYear()}`;
          }
        } catch (e) {}
      }
      el.subBadge.textContent = `⭐ VIP ${dateText} (${activeCount}/${limitDisplay})`;
      el.subBadge.classList.add('active');
    } else if (role === 'trial') {
      const expStr = state.user.expires_at || state.user.sub_until;
      let timeText = '24ч';
      if (expStr) {
        try {
          const d = new Date(expStr);
          const now = new Date();
          const diffMs = d - now;
          if (diffMs > 0) {
            const totalMins = Math.floor(diffMs / 60000);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            timeText = `${hrs}ч ${mins}м`;
          } else {
            timeText = '0м';
          }
        } catch (e) {}
      }
      el.subBadge.textContent = `🎁 Триал: ост. ${timeText} (${activeCount}/${limitDisplay})`;
      el.subBadge.classList.add('trial');
    } else {
      el.subBadge.textContent = `🔒 Доступ истёк (${activeCount}/${limitDisplay})`;
      el.subBadge.classList.add('expired');
    }

    if (isAdmin && el.tabBtnAdmin) {
      el.tabBtnAdmin.classList.remove('hidden');
    } else if (el.tabBtnAdmin) {
      el.tabBtnAdmin.classList.add('hidden');
    }

    el.filtersCounter.textContent = state.filters.length;
    el.stopwordsCounter.textContent = state.stopwords.length;
  }

  // Format Helper: numbers with space delimiter
  function formatNum(n) {
    if (n === null || n === undefined || n === '') return '';
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // 5. Render Filters List
  function renderFilters() {
    el.filtersLoading.classList.add('hidden');
    el.filtersCounter.textContent = state.filters.length;

    if (!state.filters || state.filters.length === 0) {
      el.filtersEmpty.classList.remove('hidden');
      el.filtersList.innerHTML = '';
      return;
    }

    el.filtersEmpty.classList.add('hidden');
    el.filtersList.innerHTML = '';

    state.filters.forEach(filter => {
      if (!filter) return;
      try {
        const card = document.createElement('div');
        const isEnabled = Boolean(filter.notifications_enabled);
        card.className = `filter-card ${isEnabled ? '' : 'disabled'}`;
        card.id = `filter-card-${filter.id}`;

        // Mode tag
        let modeText = 'Точный выбор';
        let modeClass = 'exact';
        if (filter.search_mode === 'make_only') {
          modeText = 'Вся марка';
          modeClass = 'make_only';
        } else if (filter.search_mode === 'any_car') {
          modeText = 'Любое авто';
          modeClass = 'any_car';
        }

        // Title
        let title = filter.display_name || filter.model || filter.make || 'Любое авто';
        if (filter.search_mode === 'any_car') {
          title = 'Любое авто по параметрам';
        }

        // Specs chips
        const specs = [];
        // Price
        const pMin = filter.price_min;
        const pMax = filter.price_max;
        if (pMin && pMax) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">💰</span> ${formatNum(pMin)} – ${formatNum(pMax)} ₽</span>`);
        } else if (pMax) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">💰</span> до ${formatNum(pMax)} ₽</span>`);
        } else if (pMin) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">💰</span> от ${formatNum(pMin)} ₽</span>`);
        }

        // Years
        const yMin = filter.year_min;
        const yMax = filter.year_max;
        if (yMin && yMax) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">📅</span> ${yMin}–${yMax} гг.</span>`);
        } else if (yMin) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">📅</span> от ${yMin} г.</span>`);
        } else if (yMax) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">📅</span> до ${yMax} г.</span>`);
        }

        // Mileage
        if (filter.mileage_max) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">🛣</span> до ${formatNum(filter.mileage_max)} км</span>`);
        }

        // Gearbox
        const gbLabel = formatGearboxLabel(filter.gearbox);
        if (gbLabel) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">⚙️</span> ${escapeHtml(gbLabel)}</span>`);
        }

        // Engine volumes
        if (filter.engine_volumes) {
          specs.push(`<span class="spec-chip"><span class="spec-icon">⛽</span> ${escapeHtml(String(filter.engine_volumes))} л</span>`);
        }

        // Location
        let cName = 'Москва';
        const cityKey = filter.city ? String(filter.city).trim().toLowerCase() : '';
        if (cityKey === 'rossiya') {
          cName = 'Вся Россия';
        } else if (cityKey) {
          if (state.citiesMap && state.citiesMap[cityKey] && state.citiesMap[cityKey].name) {
            cName = state.citiesMap[cityKey].name;
          } else if (typeof CITIES_DICT !== 'undefined' && CITIES_DICT[cityKey] && CITIES_DICT[cityKey].name) {
            cName = CITIES_DICT[cityKey].name;
          } else {
            const found = (state.allCities || []).find(c => c && (c.slug === cityKey || (typeof normalizeText === 'function' && normalizeText(c.name) === normalizeText(cityKey))));
            if (found && found.name) {
              cName = found.name;
            } else {
              cName = String(filter.city).charAt(0).toUpperCase() + String(filter.city).slice(1);
            }
          }
        }
        const rad = parseInt(filter.radius_km, 10) || 0;
        const radText = (rad > 0 && cityKey !== 'rossiya') ? ` (+${rad} км)` : '';
        specs.push(`<span class="spec-chip"><span class="spec-icon">📍</span> ${escapeHtml(cName)}${radText}</span>`);

        card.innerHTML = `
          <div class="card-top-row">
            <div class="card-title-group">
              <div class="card-badge-row">
                <span class="card-mode-tag ${modeClass}">${modeText}</span>
              </div>
              <div class="card-title">${escapeHtml(title)}</div>
            </div>
            <label class="toggle-switch" title="Включить/выключить уведомления">
              <input type="checkbox" class="filter-toggle" data-id="${filter.id}" ${isEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>

          <div class="card-specs">
            ${specs.length > 0 ? specs.join('') : '<span class="spec-chip">Без ограничений параметров</span>'}
          </div>

          <div class="card-bottom-row">
            <span class="card-status-text" id="status-text-${filter.id}">
              ${isEnabled ? '🔔 Уведомления включены' : '🔕 Уведомления отключены'}
            </span>
            <div class="card-btn-group">
              <button class="btn-small btn-edit" data-id="${filter.id}">Изменить</button>
              <button class="btn-small danger btn-delete" data-id="${filter.id}">Удалить</button>
            </div>
          </div>
        `;

        el.filtersList.appendChild(card);
      } catch (e) {
        console.error('Card render error:', e, filter);
      }
    });

    attachCardListeners();
  }

  // Dialog Helper: Telegram native showConfirm with window.confirm fallback
  function showConfirmDialog(message) {
    return new Promise(resolve => {
      const tg = window.Telegram?.WebApp;
      if (tg && typeof tg.showConfirm === 'function') {
        tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
      } else {
        resolve(Boolean(window.confirm(message)));
      }
    });
  }

  function attachCardListeners() {
    // Toggle switch handler with Optimistic UI
    document.querySelectorAll('.filter-toggle').forEach(input => {
      input.addEventListener('change', async (e) => {
        triggerHaptic('light');
        const filterId = parseInt(e.target.dataset.id, 10);
        const card = document.getElementById(`filter-card-${filterId}`);
        const statusText = document.getElementById(`status-text-${filterId}`);
        const optimisticEnabled = e.target.checked;

        // Instant optimistic feedback
        card?.classList.toggle('disabled', !optimisticEnabled);
        if (statusText) {
          statusText.textContent = optimisticEnabled ? '🔔 Уведомления включены' : '🔕 Уведомления отключены';
        }

        try {
          const res = await apiFetch(`/api/filters/${filterId}/toggle`, { method: 'PATCH' });
          const newStatus = Boolean(res.notifications_enabled);
          e.target.checked = newStatus;
          card?.classList.toggle('disabled', !newStatus);
          if (statusText) {
            statusText.textContent = newStatus ? '🔔 Уведомления включены' : '🔕 Уведомления отключены';
          }

          if (newStatus) {
            showToast('Уведомления включены', 'success');
          } else {
            showToast('Уведомления выключены');
          }

          const target = state.filters.find(f => f.id === filterId);
          if (target) target.notifications_enabled = res.notifications_enabled;

          try {
            localStorage.setItem('ar_cached_filters', JSON.stringify(state.filters));
          } catch (e) {}
        } catch (err) {
          // Rollback on network/server error
          e.target.checked = !optimisticEnabled;
          card?.classList.toggle('disabled', optimisticEnabled);
          if (statusText) {
            statusText.textContent = !optimisticEnabled ? '🔔 Уведомления включены' : '🔕 Уведомления отключены';
          }
          showToast('Ошибка: ' + err.message, 'error');
          triggerHaptic('error');
        }
      });
    });

    // Edit button handler
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        triggerHaptic('light');
        const filterId = parseInt(btn.dataset.id, 10);
        openEditFilterModal(filterId);
      });
    });

    // Delete button handler
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        triggerHaptic('warning');
        const filterId = parseInt(btn.dataset.id, 10);
        const filter = state.filters.find(f => f.id === filterId);
        const name = filter?.display_name || filter?.model || 'этот поиск';

        const confirmed = await showConfirmDialog(`Удалить поиск "${name}"?`);
        if (!confirmed) return;

        try {
          await apiFetch(`/api/filters/${filterId}`, { method: 'DELETE' });
          state.filters = state.filters.filter(f => f.id !== filterId);
          try {
            localStorage.setItem('ar_cached_filters', JSON.stringify(state.filters));
          } catch (e) {}
          renderFilters();
          showToast('Поиск успешно удалён', 'success');
          triggerHaptic('success');
        } catch (err) {
          showToast('Ошибка удаления: ' + err.message, 'error');
          triggerHaptic('error');
        }
      });
    });
  }

  // 6. Stopwords Screen Logic
  function renderStopwords() {
    el.stopwordsCounter.textContent = state.stopwords.length;
    el.stopwordsContainer.innerHTML = '';

    if (!state.stopwords || state.stopwords.length === 0) {
      el.stopwordsContainer.innerHTML = '<span style="color:var(--tg-theme-hint-color); font-size:13px; align-self:center; margin:auto;">Список пуст</span>';
    } else {
      state.stopwords.forEach(word => {
        const chip = document.createElement('div');
        chip.className = 'stopword-tag';
        chip.innerHTML = `
          <span>${escapeHtml(word)}</span>
          <button type="button" class="tag-remove-btn" data-word="${escapeHtml(word)}" title="Удалить">×</button>
        `;
        el.stopwordsContainer.appendChild(chip);
      });

      el.stopwordsContainer.querySelectorAll('.tag-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerHaptic('light');
          const word = btn.dataset.word;
          state.stopwords = state.stopwords.filter(w => w !== word);
          renderStopwords();
        });
      });
    }

    renderQuickStopwordsTab();
  }

  function renderQuickStopwordsTab() {
    if (!el.quickStopwordsTab) return;
    el.quickStopwordsTab.innerHTML = '';
    state.defaultStopwords.forEach(word => {
      const isSelected = state.stopwords.includes(word);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quick-stopword-chip ${isSelected ? 'selected' : ''}`;
      btn.textContent = isSelected ? `✓ ${word}` : `+ ${word}`;
      if (!isSelected) {
        btn.addEventListener('click', () => {
          triggerHaptic('light');
          state.stopwords.push(word);
          renderStopwords();
        });
      }
      el.quickStopwordsTab.appendChild(btn);
    });
  }

  function addStopword() {
    const val = el.newStopwordInput.value.trim().toLowerCase();
    if (!val) return;

    if (state.stopwords.includes(val)) {
      showToast('Слово уже есть в списке', 'info');
      el.newStopwordInput.value = '';
      return;
    }

    state.stopwords.push(val);
    el.newStopwordInput.value = '';
    renderStopwords();
    triggerHaptic('light');
  }

  async function saveStopwords() {
    triggerHaptic('light');
    try {
      el.btnSaveStopwords.disabled = true;
      el.btnSaveStopwords.textContent = 'Сохранение...';

      const res = await apiFetch('/api/stopwords', {
        method: 'PUT',
        body: JSON.stringify({ words: state.stopwords })
      });

      state.stopwords = res.stopwords || state.stopwords;
      renderStopwords();
      showToast('Стоп-слова сохранены', 'success');
      triggerHaptic('success');
    } catch (err) {
      showToast('Ошибка сохранения: ' + err.message, 'error');
      triggerHaptic('error');
    } finally {
      el.btnSaveStopwords.disabled = false;
      el.btnSaveStopwords.textContent = 'Сохранить стоп-слова';
    }
  }

  async function resetStopwords() {
    triggerHaptic('warning');
    state.stopwords = [];
    if (el.newStopwordInput) el.newStopwordInput.value = '';
    renderStopwords();
    try {
      await apiFetch('/api/stopwords', {
        method: 'PUT',
        body: JSON.stringify({ words: [] })
      });
      showToast('Все стоп-слова сброшены', 'info');
      triggerHaptic('success');
    } catch (err) {
      console.error('resetStopwords error:', err);
      showToast('Ошибка при сбросе стоп-слов: ' + err.message, 'error');
    }
  }

  // Modal Stopwords Logic
  function renderModalStopwords() {
    if (!el.modalStopwordsContainer) return;
    el.modalStopwordsContainer.innerHTML = '';

    if (!state.modalStopwords || state.modalStopwords.length === 0) {
      el.modalStopwordsContainer.innerHTML = '<span style="color:var(--tg-theme-hint-color); font-size:13px; align-self:center; margin:auto;">Список пуст</span>';
    } else {
      state.modalStopwords.forEach(word => {
        const chip = document.createElement('div');
        chip.className = 'stopword-tag';
        chip.innerHTML = `
          <span>${escapeHtml(word)}</span>
          <button type="button" class="tag-remove-btn" data-word="${escapeHtml(word)}" title="Удалить">×</button>
        `;
        el.modalStopwordsContainer.appendChild(chip);
      });

      el.modalStopwordsContainer.querySelectorAll('.tag-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerHaptic('light');
          const word = btn.dataset.word;
          state.modalStopwords = state.modalStopwords.filter(w => w !== word);
          renderModalStopwords();
        });
      });
    }

    renderQuickStopwordsModal();
  }

  function renderQuickStopwordsModal() {
    if (!el.quickStopwordsModal) return;
    el.quickStopwordsModal.innerHTML = '';
    state.defaultStopwords.forEach(word => {
      const isSelected = state.modalStopwords.includes(word);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quick-stopword-chip ${isSelected ? 'selected' : ''}`;
      btn.textContent = isSelected ? `✓ ${word}` : `+ ${word}`;
      if (!isSelected) {
        btn.addEventListener('click', () => {
          triggerHaptic('light');
          state.modalStopwords.push(word);
          renderModalStopwords();
        });
      }
      el.quickStopwordsModal.appendChild(btn);
    });
  }

  function addModalStopword() {
    if (!el.modalStopwordInput) return;
    const val = el.modalStopwordInput.value.trim().toLowerCase();
    if (!val) return;

    if (state.modalStopwords.includes(val)) {
      showToast('Слово уже есть в списке', 'info');
      el.modalStopwordInput.value = '';
      return;
    }

    state.modalStopwords.push(val);
    el.modalStopwordInput.value = '';
    renderModalStopwords();
    triggerHaptic('light');
  }

  function resetModalStopwords() {
    triggerHaptic('warning');
    state.modalStopwords = [];
    if (el.modalStopwordInput) el.modalStopwordInput.value = '';
    renderModalStopwords();
    showToast('Стоп-слова для поиска сброшены', 'info');
  }

  // 7. Cascading Make & Model Selection Logic
  function openCreateFilterModal() {
    triggerHaptic('light');
    state.editingFilterId = null;
    el.modalTitle.textContent = 'Новый поиск авто';
    el.saveBtnText.textContent = 'Создать поиск';

    el.filterForm.reset();
    resetCarSelection();

    // Default location: Москва +100 км
    selectCity({ name: 'Москва', slug: 'moskva', lat: 55.7558, lon: 37.6173 });
    if (el.cityInput) el.cityInput.value = 'Москва';
    if (el.cityErrorHint) el.cityErrorHint.classList.add('hidden');
    setRadiusKm(100);
    if (el.radiusSelectorGroup) el.radiusSelectorGroup.classList.remove('hidden');

    // Modal stopwords: initialize from current user stopwords
    state.modalStopwords = [...state.stopwords];
    renderModalStopwords();

    setGearboxMode('any');
    el.fNotificationsEnabled.checked = true;

    openModal();
    // Pre-load makes and cities if not loaded
    loadCatalogMakes();
    loadCities();
  }

  function resetCarSelection() {
    state.selectedMake = null;
    state.selectedModel = null;
    state.isAnyCar = false;
    state.currentMakeModels = [];

    el.fSearchMode.value = 'exact';
    el.fMake.value = '';
    el.fModel.value = '';
    el.fDisplayName.value = '';
    el.fDromMake.value = '';
    el.fDromModel.value = '';
    el.fAutoruMake.value = '';
    el.fAutoruModel.value = '';
    el.fAvitoQuery.value = '';

    el.makeInput.value = '';
    el.modelInput.value = '';

    el.makeInputWrapper.classList.remove('hidden');
    el.selectedMakeBadge.classList.add('hidden');
    el.btnClearMake.classList.add('hidden');

    el.modelSelectionGroup.classList.add('hidden');
    el.modelInputWrapper.classList.remove('hidden');
    el.selectedModelBadge.classList.add('hidden');
    el.btnClearModel.classList.add('hidden');

    el.makeStatusHint.textContent = 'Выберите или начните ввод';
    el.modelStatusHint.textContent = 'Все модели';

    closeDropdowns();
  }

  function closeDropdowns() {
    el.makeDropdown.classList.add('hidden');
    el.makeDropdown.innerHTML = '';
    el.modelDropdown.classList.add('hidden');
    el.modelDropdown.innerHTML = '';
  }

  function selectAnyCar() {
    triggerHaptic('light');
    state.isAnyCar = true;
    state.selectedMake = null;
    state.selectedModel = null;

    el.fSearchMode.value = 'any_car';
    el.fMake.value = '';
    el.fModel.value = '';
    el.fDisplayName.value = 'Любое авто';
    el.fDromMake.value = '';
    el.fDromModel.value = '';
    el.fAutoruMake.value = '';
    el.fAutoruModel.value = '';
    el.fAvitoQuery.value = '';

    el.selectedMakeName.textContent = '✨ Любое авто (по параметрам)';
    el.selectedMakeBadge.classList.remove('hidden');
    el.makeInputWrapper.classList.add('hidden');
    el.makeStatusHint.textContent = 'Поиск по параметрам';

    el.modelSelectionGroup.classList.add('hidden');
    closeDropdowns();
  }

  function selectMake(makeObj) {
    triggerHaptic('light');
    state.isAnyCar = false;
    state.selectedMake = makeObj;
    state.selectedModel = null;

    el.fSearchMode.value = 'make_only';
    el.fMake.value = makeObj.id;
    el.fModel.value = '';
    el.fDisplayName.value = makeObj.name;
    el.fDromMake.value = makeObj.drom_slug || makeObj.id;
    el.fAutoruMake.value = makeObj.autoru_slug || makeObj.id;
    el.fAvitoQuery.value = makeObj.name;

    // Show Make Badge
    el.selectedMakeName.textContent = makeObj.name;
    el.selectedMakeBadge.classList.remove('hidden');
    el.makeInputWrapper.classList.add('hidden');
    el.makeStatusHint.textContent = 'Марка выбрана';

    // Show Model Selection Group
    el.modelSelectionGroup.classList.remove('hidden');
    el.modelInputWrapper.classList.remove('hidden');
    el.selectedModelBadge.classList.add('hidden');
    el.modelInput.value = '';
    el.btnClearModel.classList.add('hidden');
    el.modelStatusHint.textContent = `Все модели ${makeObj.name}`;

    closeDropdowns();

    // Fetch models for this make
    loadModelsForMake(makeObj.id);
  }

  async function loadModelsForMake(makeId) {
    try {
      el.modelSearchSpinner.classList.remove('hidden');
      const data = await apiFetch(`/api/catalog/models?make=${encodeURIComponent(makeId)}`);
      state.currentMakeModels = data.models || [];
    } catch (err) {
      console.warn('Failed to load models for make:', err);
      state.currentMakeModels = [];
    } finally {
      el.modelSearchSpinner.classList.add('hidden');
    }
  }

  function selectMakeOnly() {
    triggerHaptic('light');
    if (!state.selectedMake) return;

    state.selectedModel = null;
    el.fSearchMode.value = 'make_only';
    el.fModel.value = '';
    el.fDisplayName.value = state.selectedMake.name;
    el.fDromModel.value = '';
    el.fAutoruModel.value = '';
    el.fAvitoQuery.value = state.selectedMake.name;

    el.selectedModelName.textContent = `🌐 Все модели ${state.selectedMake.name}`;
    el.selectedModelBadge.classList.remove('hidden');
    el.modelInputWrapper.classList.add('hidden');
    el.modelStatusHint.textContent = 'Все модели марки';

    closeDropdowns();
  }

  function selectModel(modelObj) {
    triggerHaptic('light');
    if (!state.selectedMake) return;

    state.selectedModel = modelObj;
    el.fSearchMode.value = 'exact';
    el.fModel.value = modelObj.model || modelObj.id;
    el.fDisplayName.value = `${state.selectedMake.name} ${modelObj.name}`;
    el.fDromModel.value = modelObj.drom_model || modelObj.model || modelObj.id;
    el.fAutoruModel.value = modelObj.autoru_model || modelObj.model || modelObj.id;
    el.fAvitoQuery.value = modelObj.avito_query || `${state.selectedMake.name} ${modelObj.name}`;

    // Auto-fill typical years if empty
    if (modelObj.years && Array.isArray(modelObj.years) && modelObj.years.length === 2) {
      if (!el.fYearMin.value) el.fYearMin.value = modelObj.years[0];
      if (!el.fYearMax.value) el.fYearMax.value = modelObj.years[1];
    }

    el.selectedModelName.textContent = modelObj.name;
    el.selectedModelBadge.classList.remove('hidden');
    el.modelInputWrapper.classList.add('hidden');
    el.modelStatusHint.textContent = 'Модель выбрана';

    closeDropdowns();
  }

  // Cross-search selection (1-click make + model)
  function selectCrossResult(item) {
    triggerHaptic('success');
    state.isAnyCar = false;

    // Find make in catalog or synthesize makeObj
    let makeObj = state.catalogMakes.find(m => m.id === item.make);
    if (!makeObj) {
      makeObj = {
        id: item.make,
        name: item.make.charAt(0).toUpperCase() + item.make.slice(1),
        drom_slug: item.drom_make || item.make,
        autoru_slug: item.autoru_make || item.make,
        avito_slug: item.make
      };
    }
    state.selectedMake = makeObj;

    const modelObj = {
      id: item.model,
      model: item.model,
      name: item.model.charAt(0).toUpperCase() + item.model.slice(1),
      display: item.display,
      drom_model: item.drom_model || item.model,
      autoru_model: item.autoru_model || item.model,
      avito_query: item.avito_query || item.display,
      years: (item.year_from && item.year_to) ? [item.year_from, item.year_to] : null
    };
    state.selectedModel = modelObj;

    el.fSearchMode.value = 'exact';
    el.fMake.value = item.make;
    el.fModel.value = item.model;
    el.fDisplayName.value = item.display;
    el.fDromMake.value = item.drom_make || item.make;
    el.fDromModel.value = item.drom_model || item.model;
    el.fAutoruMake.value = item.autoru_make || item.make;
    el.fAutoruModel.value = item.autoru_model || item.model;
    el.fAvitoQuery.value = item.avito_query || item.display;

    // Years pre-fill
    if (item.year_from && !el.fYearMin.value) el.fYearMin.value = item.year_from;
    if (item.year_to && !el.fYearMax.value) el.fYearMax.value = item.year_to;

    // Update Make UI
    el.selectedMakeName.textContent = makeObj.name;
    el.selectedMakeBadge.classList.remove('hidden');
    el.makeInputWrapper.classList.add('hidden');
    el.makeStatusHint.textContent = 'Марка выбрана';

    // Update Model UI
    el.modelSelectionGroup.classList.remove('hidden');
    el.selectedModelName.textContent = item.display.replace(new RegExp(`^${makeObj.name}\\s*`, 'i'), '').trim() || item.model;
    el.selectedModelBadge.classList.remove('hidden');
    el.modelInputWrapper.classList.add('hidden');
    el.modelStatusHint.textContent = 'Модель выбрана';

    closeDropdowns();
    // Load models for this make in background so subsequent edits have model list
    loadModelsForMake(makeObj.id);
  }

  // Render Make Dropdown
  async function renderMakeDropdown(query = '') {
    await loadCatalogMakes();
    const qClean = query.trim().toLowerCase().replace(/ё/g, 'е');

    el.makeDropdown.innerHTML = '';

    // 1. Cross-search query if user typed something
    let crossSuggestions = [];
    if (qClean.length >= 2) {
      try {
        el.makeSearchSpinner.classList.remove('hidden');
        const searchData = await apiFetch(`/api/catalog/search?q=${encodeURIComponent(qClean)}`);
        crossSuggestions = (searchData.results || []).filter(r => r.type === 'exact' && r.make && r.model);
      } catch (e) {
        // Ignore search errors in background
      } finally {
        el.makeSearchSpinner.classList.add('hidden');
      }
    }

    // Render cross suggestions if available
    if (crossSuggestions.length > 0) {
      crossSuggestions.slice(0, 3).forEach(cs => {
        const card = document.createElement('div');
        card.className = 'cross-suggestion-card';
        card.innerHTML = `
          <div class="cross-left">
            <span class="cross-header">🎯 Найдена модель</span>
            <span class="cross-title">${escapeHtml(cs.display)}</span>
            <span class="cross-subtitle">Заполнить марку и модель в 1 клик</span>
          </div>
          <span class="cross-action">Выбрать</span>
        `;
        card.addEventListener('click', () => selectCrossResult(cs));
        el.makeDropdown.appendChild(card);
      });
    }

    // 2. "Любое авто (по параметрам)" option
    const anyCarItem = document.createElement('div');
    anyCarItem.className = 'dropdown-item featured';
    anyCarItem.innerHTML = `
      <div class="dropdown-item-main">
        <span class="dropdown-item-title">✨ Любое авто (по параметрам)</span>
        <span class="dropdown-item-sub">Поиск по цене, годам и пробегу без привязки к марке</span>
      </div>
      <span class="dropdown-item-badge">Любая марка</span>
    `;
    anyCarItem.addEventListener('click', selectAnyCar);
    el.makeDropdown.appendChild(anyCarItem);

    // 3. Filter makes list
    let filteredMakes = state.catalogMakes;
    if (qClean.length > 0) {
      filteredMakes = state.catalogMakes.filter(m => {
        const nameMatch = m.name.toLowerCase().replace(/ё/g, 'е').includes(qClean);
        const ruMatch = (m.ru_name || '').toLowerCase().replace(/ё/g, 'е').includes(qClean);
        const idMatch = m.id.toLowerCase().includes(qClean);
        return nameMatch || ruMatch || idMatch;
      });
    }

    const titleSec = document.createElement('div');
    titleSec.className = 'dropdown-section-title';
    titleSec.textContent = qClean.length > 0 ? 'Подходящие марки' : 'Популярные и все марки';
    el.makeDropdown.appendChild(titleSec);

    if (filteredMakes.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'dropdown-item';
      emptyDiv.style.color = 'var(--tg-theme-hint-color)';
      emptyDiv.style.justifyContent = 'center';
      emptyDiv.textContent = 'Марка не найдена в каталоге';
      el.makeDropdown.appendChild(emptyDiv);
    } else {
      // Show up to 50 makes in dropdown for performance
      filteredMakes.slice(0, 50).forEach(m => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = `
          <div class="dropdown-item-main">
            <span class="dropdown-item-title">${escapeHtml(m.name)}</span>
            ${m.ru_name && m.ru_name !== m.name ? `<span class="dropdown-item-sub">${escapeHtml(m.ru_name)}</span>` : ''}
          </div>
          <span class="dropdown-item-badge">Марка</span>
        `;
        item.addEventListener('click', () => selectMake(m));
        el.makeDropdown.appendChild(item);
      });
    }

    el.makeDropdown.classList.remove('hidden');
  }

  // Render Model Dropdown
  function renderModelDropdown(query = '') {
    if (!state.selectedMake) return;
    const qClean = query.trim().toLowerCase().replace(/ё/g, 'е');
    el.modelDropdown.innerHTML = '';

    // 1. "Все модели [Марка]" item
    const makeOnlyItem = document.createElement('div');
    makeOnlyItem.className = 'dropdown-item featured';
    makeOnlyItem.innerHTML = `
      <div class="dropdown-item-main">
        <span class="dropdown-item-title">🌐 Все модели ${escapeHtml(state.selectedMake.name)}</span>
        <span class="dropdown-item-sub">Искать все модели марки ${escapeHtml(state.selectedMake.name)}</span>
      </div>
      <span class="dropdown-item-badge">Вся марка</span>
    `;
    makeOnlyItem.addEventListener('click', selectMakeOnly);
    el.modelDropdown.appendChild(makeOnlyItem);

    // 2. Filter models list
    let filteredModels = state.currentMakeModels;
    if (qClean.length > 0) {
      filteredModels = state.currentMakeModels.filter(m => {
        const nameMatch = m.name.toLowerCase().replace(/ё/g, 'е').includes(qClean);
        const ruMatch = (m.ru_name || '').toLowerCase().replace(/ё/g, 'е').includes(qClean);
        const idMatch = (m.id || '').toLowerCase().includes(qClean);
        return nameMatch || ruMatch || idMatch;
      });
    }

    const titleSec = document.createElement('div');
    titleSec.className = 'dropdown-section-title';
    titleSec.textContent = `Модели ${state.selectedMake.name}`;
    el.modelDropdown.appendChild(titleSec);

    if (filteredModels.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'dropdown-item';
      emptyDiv.style.color = 'var(--tg-theme-hint-color)';
      emptyDiv.style.justifyContent = 'center';
      emptyDiv.textContent = 'Модель не найдена в списке этой марки';
      el.modelDropdown.appendChild(emptyDiv);
    } else {
      filteredModels.slice(0, 60).forEach(m => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        let yearsStr = '';
        if (m.years && Array.isArray(m.years) && m.years.length === 2) {
          yearsStr = `${m.years[0]}–${m.years[1]}`;
        }
        item.innerHTML = `
          <div class="dropdown-item-main">
            <span class="dropdown-item-title">${escapeHtml(m.name)}</span>
            ${m.ru_name && m.ru_name !== m.name ? `<span class="dropdown-item-sub">${escapeHtml(m.ru_name)}</span>` : ''}
          </div>
          ${yearsStr ? `<span class="dropdown-item-badge">${escapeHtml(yearsStr)}</span>` : ''}
        `;
        item.addEventListener('click', () => selectModel(m));
        el.modelDropdown.appendChild(item);
      });
    }

    el.modelDropdown.classList.remove('hidden');
  }

  // 8. Gearbox Selector Logic (Two-Level: Any / MT / AT (all) + Subchips AT/AMT/CVT)
  function setGearboxMode(mode) {
    if (mode === 'mt') {
      state.selectedGearboxes = new Set(['mt']);
      if (el.btnGbMt) el.btnGbMt.classList.add('active');
      if (el.btnGbAny) el.btnGbAny.classList.remove('active');
      if (el.btnGbAuto) el.btnGbAuto.classList.remove('active');
      document.querySelectorAll('.gb-subchip').forEach(chip => {
        chip.classList.add('disabled');
        chip.classList.remove('active');
      });
      el.fGearbox.value = 'mt';
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = 'Механика';
    } else if (mode === 'at_all') {
      state.selectedGearboxes = new Set(['at', 'amt', 'cvt']);
      if (el.btnGbAuto) el.btnGbAuto.classList.add('active');
      if (el.btnGbAny) el.btnGbAny.classList.remove('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      document.querySelectorAll('.gb-subchip').forEach(chip => {
        chip.classList.remove('disabled');
        chip.classList.add('active');
      });
      el.fGearbox.value = 'at,amt,cvt';
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = 'Автомат (все: АКПП, Робот, Вариатор)';
    } else { // any
      state.selectedGearboxes.clear();
      if (el.btnGbAny) el.btnGbAny.classList.add('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      if (el.btnGbAuto) el.btnGbAuto.classList.remove('active');
      document.querySelectorAll('.gb-subchip').forEach(chip => {
        chip.classList.remove('disabled');
        chip.classList.remove('active');
      });
      el.fGearbox.value = 'ANY';
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = 'Любая';
    }
  }

  function toggleSubchip(chipKey) {
    // If was in 'mt' mode, re-enable subchips
    document.querySelectorAll('.gb-subchip').forEach(c => c.classList.remove('disabled'));
    state.selectedGearboxes.delete('mt');

    const activeChips = new Set();
    document.querySelectorAll('.gb-subchip.active').forEach(c => activeChips.add(c.dataset.chip));

    if (activeChips.has(chipKey)) {
      activeChips.delete(chipKey);
    } else {
      activeChips.add(chipKey);
    }

    state.selectedGearboxes = activeChips;
    document.querySelectorAll('.gb-subchip').forEach(chip => {
      chip.classList.toggle('active', activeChips.has(chip.dataset.chip));
    });

    if (activeChips.size === 3) {
      if (el.btnGbAuto) el.btnGbAuto.classList.add('active');
      if (el.btnGbAny) el.btnGbAny.classList.remove('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      el.fGearbox.value = 'at,amt,cvt';
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = 'Автомат (все: АКПП, Робот, Вариатор)';
    } else if (activeChips.size === 0) {
      if (el.btnGbAny) el.btnGbAny.classList.add('active');
      if (el.btnGbAuto) el.btnGbAuto.classList.remove('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      el.fGearbox.value = 'ANY';
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = 'Любая';
    } else {
      if (el.btnGbAuto) el.btnGbAuto.classList.add('active');
      if (el.btnGbAny) el.btnGbAny.classList.remove('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      const names = { 'at': 'АКПП', 'amt': 'Робот', 'cvt': 'Вариатор' };
      const list = ['at', 'amt', 'cvt'].filter(k => activeChips.has(k));
      el.fGearbox.value = list.join(',');
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = list.map(k => names[k]).join(', ');
    }
  }

  function setGearboxFromValue(val) {
    if (!val || val.toUpperCase() === 'ANY') {
      setGearboxMode('any');
      return;
    }
    const clean = val.trim().toLowerCase();
    if (clean === 'mt' || clean === 'manual') {
      setGearboxMode('mt');
      return;
    }
    if (clean === 'at,amt,cvt' || clean === 'auto') {
      setGearboxMode('at_all');
      return;
    }

    const parts = clean.split(',').map(p => p.trim());
    const valid = ['at', 'amt', 'cvt'].filter(k => parts.includes(k));

    if (valid.length === 3) {
      setGearboxMode('at_all');
    } else if (valid.length === 0) {
      if (parts.includes('mt')) {
        setGearboxMode('mt');
      } else {
        setGearboxMode('any');
      }
    } else {
      document.querySelectorAll('.gb-subchip').forEach(c => {
        c.classList.remove('disabled');
        c.classList.toggle('active', valid.includes(c.dataset.chip));
      });
      state.selectedGearboxes = new Set(valid);
      if (el.btnGbAuto) el.btnGbAuto.classList.add('active');
      if (el.btnGbAny) el.btnGbAny.classList.remove('active');
      if (el.btnGbMt) el.btnGbMt.classList.remove('active');
      const names = { 'at': 'АКПП', 'amt': 'Робот', 'cvt': 'Вариатор' };
      el.fGearbox.value = valid.join(',');
      if (el.gearboxSummaryHint) el.gearboxSummaryHint.textContent = valid.map(k => names[k]).join(', ');
    }
  }

  // 9. Strict City Autocomplete & Radius Logic
  function setRadiusKm(val) {
    const num = parseInt(val, 10) || 0;
    if (el.fRadiusKm) el.fRadiusKm.value = num;
    document.querySelectorAll('.radius-chip').forEach(c => {
      c.classList.toggle('active', parseInt(c.dataset.radius, 10) === num);
    });
  }

  function normalizeText(str) {
    if (!str) return '';
    return str.toString().toLowerCase().replace(/ё/g, 'е').trim();
  }

  function selectCity(cityObj) {
    if (!cityObj) return;
    state.selectedCity = cityObj;
    state.isCitySelected = true;
    if (el.cityInput) el.cityInput.value = cityObj.name;
    if (el.fCity) el.fCity.value = cityObj.slug;
    if (el.fLat) el.fLat.value = cityObj.lat !== undefined ? cityObj.lat : 55.7558;
    if (el.fLon) el.fLon.value = cityObj.lon !== undefined ? cityObj.lon : 37.6173;

    if (cityObj.slug === 'rossiya') {
      if (el.radiusSelectorGroup) el.radiusSelectorGroup.classList.add('hidden');
      setRadiusKm(0);
    } else {
      if (el.radiusSelectorGroup) el.radiusSelectorGroup.classList.remove('hidden');
      const currentRadius = parseInt(el.fRadiusKm ? el.fRadiusKm.value : '100', 10);
      if (currentRadius === 0 && (!state.selectedCity || state.selectedCity.slug === 'rossiya')) {
        setRadiusKm(100);
      } else {
        setRadiusKm(currentRadius);
      }
    }

    if (el.cityDropdown) el.cityDropdown.classList.add('hidden');
    if (el.cityErrorHint) el.cityErrorHint.classList.add('hidden');
    if (el.cityStatusHint) el.cityStatusHint.textContent = 'Город выбран';
  }

  function renderCityDropdown(query = '') {
    if (!el.cityDropdown) return;
    const q = normalizeText(query);
    let matches = [];

    if (!q) {
      matches = (state.allCities || []).slice(0, 40);
    } else {
      const filtered = (state.allCities || []).filter(c => {
        const normName = normalizeText(c.name);
        return normName.includes(q);
      });

      filtered.sort((a, b) => {
        const aNorm = normalizeText(a.name);
        const bNorm = normalizeText(b.name);

        const aExact = aNorm === q;
        const bExact = bNorm === q;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aNorm.startsWith(q);
        const bStarts = bNorm.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return aNorm.localeCompare(bNorm, 'ru');
      });

      matches = filtered.slice(0, 40);
    }

    if (matches.length === 0) {
      el.cityDropdown.innerHTML = '<div style="padding:10px 14px; color:var(--tg-theme-hint-color); font-size:13px;">Город не найден</div>';
      el.cityDropdown.classList.remove('hidden');
      return;
    }

    el.cityDropdown.innerHTML = matches.map(c => `
      <div class="dropdown-item city-dropdown-item" data-slug="${escapeHtml(c.slug)}" data-name="${escapeHtml(c.name)}">
        <span class="item-name">${escapeHtml(c.name)}</span>
        <span class="item-badge" style="font-size:11px; color:var(--tg-theme-hint-color);">${c.slug === 'rossiya' ? 'Вся РФ' : 'Город'}</span>
      </div>
    `).join('');

    el.cityDropdown.querySelectorAll('.city-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerHaptic('light');
        const slug = item.dataset.slug;
        const found = state.allCities.find(c => c.slug === slug);
        if (found) {
          selectCity(found);
        } else {
          selectCity({ name: item.dataset.name, slug: slug });
        }
      });
    });

    el.cityDropdown.classList.remove('hidden');
  }

  function setupCityAutocomplete() {
    if (!el.cityInput) return;

    el.cityInput.addEventListener('input', () => {
      state.isCitySelected = false;
      const q = el.cityInput.value.trim();
      if (el.cityStatusHint) el.cityStatusHint.textContent = 'Выберите из списка';
      if (el.cityErrorHint) el.cityErrorHint.classList.add('hidden');
      renderCityDropdown(q);
    });

    el.cityInput.addEventListener('focus', () => {
      renderCityDropdown(el.cityInput.value.trim());
    });

    el.cityInput.addEventListener('blur', () => {
      setTimeout(() => {
        const val = normalizeText(el.cityInput.value);
        if (val) {
          const exact = (state.allCities || []).find(c => normalizeText(c.name) === val);
          if (exact) {
            selectCity(exact);
          }
        }
      }, 150);
    });

    if (el.btnClearCity) {
      el.btnClearCity.addEventListener('click', () => {
        triggerHaptic('light');
        selectCity({ name: 'Москва', slug: 'moskva', lat: 55.7558, lon: 37.6173 });
        if (el.cityInput) el.cityInput.value = 'Москва';
      });
    }

    // Radius chips listener
    document.querySelectorAll('.radius-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic('light');
        const rad = parseInt(chip.dataset.radius, 10) || 0;
        setRadiusKm(rad);
      });
    });

    document.addEventListener('click', (e) => {
      if (el.cityDropdown && !el.cityDropdown.contains(e.target) && e.target !== el.cityInput) {
        el.cityDropdown.classList.add('hidden');
      }
    });
  }

  // 10. Open Edit Filter Modal
  function openEditFilterModal(filterId) {
    const f = state.filters.find(item => item.id === filterId);
    if (!f) return;

    state.editingFilterId = filterId;
    el.modalTitle.textContent = 'Редактирование поиска';
    el.saveBtnText.textContent = 'Сохранить изменения';

    el.filterForm.reset();
    resetCarSelection();

    // Inputs
    el.fPriceMin.value = f.price_min || '';
    el.fPriceMax.value = f.price_max || '';
    el.fYearMin.value = f.year_min || '';
    el.fYearMax.value = f.year_max || '';
    el.fMileageMax.value = f.mileage_max || '';
    el.fEngineVolumes.value = f.engine_volumes || '';
    el.fNotificationsEnabled.checked = Boolean(f.notifications_enabled);

    // City Selection
    const citySlug = f.city || 'moskva';
    let cityObj = (state.citiesMap && state.citiesMap[citySlug]) || (state.allCities && state.allCities.find(c => c.slug === citySlug));
    if (!cityObj && CITIES_DICT[citySlug]) {
      cityObj = { name: CITIES_DICT[citySlug].name, slug: citySlug, lat: CITIES_DICT[citySlug].lat, lon: CITIES_DICT[citySlug].lon };
    }
    if (!cityObj) {
      cityObj = { name: citySlug, slug: citySlug, lat: f.lat || 55.7558, lon: f.lon || 37.6173 };
    }
    selectCity(cityObj);
    if (el.cityInput) el.cityInput.value = cityObj.name;
    if (el.cityErrorHint) el.cityErrorHint.classList.add('hidden');

    // Restore Radius
    const rad = f.radius_km !== null && f.radius_km !== undefined ? parseInt(f.radius_km, 10) : 0;
    setRadiusKm(rad);
    if (citySlug === 'rossiya') {
      if (el.radiusSelectorGroup) el.radiusSelectorGroup.classList.add('hidden');
    } else {
      if (el.radiusSelectorGroup) el.radiusSelectorGroup.classList.remove('hidden');
    }

    // Modal stopwords
    state.modalStopwords = [...state.stopwords];
    renderModalStopwords();

    // Car selection state with pretty names from catalog
    if (f.search_mode === 'any_car') {
      selectAnyCar();
    } else if (f.search_mode === 'make_only') {
      const catMake = (state.catalogMakes || []).find(m =>
        m.id.toLowerCase() === (f.make || '').toLowerCase() ||
        m.name.toLowerCase() === (f.make || '').toLowerCase() ||
        (m.drom_slug && m.drom_slug.toLowerCase() === (f.drom_make || '').toLowerCase()) ||
        (m.autoru_slug && m.autoru_slug.toLowerCase() === (f.autoru_make || '').toLowerCase())
      );
      const prettyMakeName = catMake ? catMake.name : (
        f.display_name ? f.display_name.split(' ')[0] : (
          f.make ? (f.make.charAt(0).toUpperCase() + f.make.slice(1)) : ''
        )
      );
      const makeObj = catMake ? { ...catMake } : {
        id: f.make,
        name: prettyMakeName,
        drom_slug: f.drom_make || f.make,
        autoru_slug: f.autoru_make || f.make,
        avito_slug: f.make
      };
      makeObj.name = prettyMakeName;
      selectMake(makeObj);
      selectMakeOnly();
    } else {
      // exact mode
      const catMake = (state.catalogMakes || []).find(m =>
        m.id.toLowerCase() === (f.make || '').toLowerCase() ||
        m.name.toLowerCase() === (f.make || '').toLowerCase() ||
        (m.drom_slug && m.drom_slug.toLowerCase() === (f.drom_make || '').toLowerCase()) ||
        (m.autoru_slug && m.autoru_slug.toLowerCase() === (f.autoru_make || '').toLowerCase())
      );
      const prettyMakeName = catMake ? catMake.name : (
        f.display_name ? f.display_name.split(' ')[0] : (
          f.make ? (f.make.charAt(0).toUpperCase() + f.make.slice(1)) : ''
        )
      );
      let prettyModelName = f.model ? (f.model.charAt(0).toUpperCase() + f.model.slice(1)) : '';
      if (f.display_name && prettyMakeName && f.display_name.toLowerCase().startsWith(prettyMakeName.toLowerCase())) {
        prettyModelName = f.display_name.slice(prettyMakeName.length).trim() || prettyModelName;
      } else if (f.display_name) {
        prettyModelName = f.display_name;
      }

      const makeObj = catMake ? { ...catMake } : {
        id: f.make,
        name: prettyMakeName,
        drom_slug: f.drom_make || f.make,
        autoru_slug: f.autoru_make || f.make,
        avito_slug: f.make
      };
      makeObj.name = prettyMakeName;
      selectMake(makeObj);

      const modelObj = {
        id: f.model,
        model: f.model,
        name: prettyModelName,
        display: f.display_name || `${prettyMakeName} ${prettyModelName}`.trim(),
        drom_model: f.drom_model || f.model,
        autoru_model: f.autoru_model || f.model,
        avito_query: f.avito_query || f.display_name || `${prettyMakeName} ${prettyModelName}`.trim()
      };
      selectModel(modelObj);
    }

    // Set Gearbox
    setGearboxFromValue(f.gearbox);

    openModal();
  }

  function openModal() {
    el.filterModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.filterModal.classList.add('hidden');
    document.body.style.overflow = '';
    closeDropdowns();
  }

  // 11. Filter Submit Handler (POST / PUT)
  async function handleFilterSubmit(e) {
    e.preventDefault();
    triggerHaptic('light');

    const mode = el.fSearchMode.value || 'exact';
    const gearbox = el.fGearbox.value || 'ANY';

    let make = el.fMake.value.trim();
    let model = el.fModel.value.trim();
    let displayName = el.fDisplayName.value.trim();
    let dromMake = el.fDromMake.value.trim();
    let dromModel = el.fDromModel.value.trim();
    let autoruMake = el.fAutoruMake.value.trim();
    let autoruModel = el.fAutoruModel.value.trim();
    let avitoQuery = el.fAvitoQuery.value.trim();

    if (mode === 'any_car') {
      displayName = 'Любое авто';
    }

    const parseNum = (val) => {
      if (!val) return null;
      const n = parseInt(val, 10);
      return Number.isFinite(n) ? n : null;
    };

    const yearMin = parseNum(el.fYearMin.value);
    const yearMax = parseNum(el.fYearMax.value);
    const priceMin = parseNum(el.fPriceMin.value);
    const priceMax = parseNum(el.fPriceMax.value);
    const mileageMax = parseNum(el.fMileageMax.value);

    // Validation rules
    if (mode === 'exact') {
      if (!make || !model) {
        showToast('Выберите марку и модель автомобиля', 'error');
        if (!make) {
          el.makeInputWrapper.classList.remove('hidden');
          el.makeInput.focus();
        } else {
          el.modelInputWrapper.classList.remove('hidden');
          el.modelInput.focus();
        }
        triggerHaptic('error');
        return;
      }
    } else if (mode === 'make_only') {
      if (!make) {
        showToast('Выберите марку автомобиля', 'error');
        el.makeInputWrapper.classList.remove('hidden');
        el.makeInput.focus();
        triggerHaptic('error');
        return;
      }
    } else if (mode === 'any_car') {
      if (priceMin === null && priceMax === null && yearMin === null && yearMax === null && mileageMax === null) {
        showToast('Для поиска любого авто укажите хотя бы одно ограничение (цену, год или пробег)', 'error');
        triggerHaptic('error');
        return;
      }
    }

    if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
      showToast('Минимальное значение не может быть больше максимального', 'error');
      el.fPriceMin.focus();
      triggerHaptic('error');
      return;
    }

    if (yearMin !== null && (yearMin < 1980 || yearMin > 2026)) {
      showToast('Год должен быть в диапазоне от 1980 до 2026', 'error');
      el.fYearMin.focus();
      triggerHaptic('error');
      return;
    }

    if (yearMax !== null && (yearMax < 1980 || yearMax > 2026)) {
      showToast('Год должен быть в диапазоне от 1980 до 2026', 'error');
      el.fYearMax.focus();
      triggerHaptic('error');
      return;
    }

    if (yearMin !== null && yearMax !== null && yearMin > yearMax) {
      showToast('Минимальное значение не может быть больше максимального', 'error');
      el.fYearMin.focus();
      triggerHaptic('error');
      return;
    }

    // Strict City validation
    if (!state.isCitySelected) {
      const typed = normalizeText(el.cityInput ? el.cityInput.value : '');
      if (!typed) {
        selectCity({ name: 'Москва', slug: 'moskva', lat: 55.7558, lon: 37.6173 });
        if (el.cityInput) el.cityInput.value = 'Москва';
      } else {
        const exact = (state.allCities || []).find(c => normalizeText(c.name) === typed);
        if (exact) {
          selectCity(exact);
        } else {
          if (el.cityErrorHint) el.cityErrorHint.classList.remove('hidden');
          if (el.cityInput) el.cityInput.focus();
          triggerHaptic('error');
          return;
        }
      }
    }

    const payload = {
      search_mode: mode,
      make: make,
      model: model,
      display_name: displayName,
      drom_make: dromMake,
      drom_model: dromModel,
      autoru_make: autoruMake,
      autoru_model: autoruModel,
      avito_query: avitoQuery,
      year_min: yearMin,
      year_max: yearMax,
      price_min: priceMin,
      price_max: priceMax,
      mileage_max: mileageMax,
      gearbox: gearbox,
      engine_volumes: el.fEngineVolumes.value.trim(),
      city: el.fCity.value || 'moskva',
      lat: parseFloat(el.fLat.value) || 55.7558,
      lon: parseFloat(el.fLon.value) || 37.6173,
      radius_km: parseInt(el.fRadiusKm ? el.fRadiusKm.value : '0', 10) || 0,
      notifications_enabled: el.fNotificationsEnabled.checked ? 1 : 0,
      stopwords: state.modalStopwords
    };

    const isEdit = state.editingFilterId !== null;
    const path = isEdit ? `/api/filters/${state.editingFilterId}` : '/api/filters';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const btn = document.getElementById('btn-modal-save');
      btn.disabled = true;
      el.saveBtnText.textContent = 'Сохранение...';

      const res = await apiFetch(path, {
        method: method,
        body: JSON.stringify(payload)
      });

      if (isEdit) {
        const idx = state.filters.findIndex(f => f.id === state.editingFilterId);
        if (idx !== -1) state.filters[idx] = res.filter;
        showToast('Поиск обновлён', 'success');
      } else {
        state.filters.unshift(res.filter);
        showToast('Поиск успешно добавлен', 'success');
      }

      try {
        localStorage.setItem('ar_cached_filters', JSON.stringify(state.filters));
      } catch (e) {}

      triggerHaptic('success');
      closeModal();
      renderFilters();

      // Update local stopwords state
      state.stopwords = [...state.modalStopwords];
      renderStopwords();

      // Refresh user stats (slot usage, active count)
      const meData = await apiFetch('/api/me').catch(() => null);
      if (meData) {
        state.user = meData;
        try {
          localStorage.setItem('ar_cached_user', JSON.stringify(state.user));
        } catch (e) {}
        renderHeader();
      }
    } catch (err) {
      let errMsg = err?.message || 'Ошибка сохранения';
      if (/load failed|failed to fetch|networkerror/i.test(errMsg)) {
        errMsg = FRIENDLY_NETWORK_ERROR;
      }
      showToast(errMsg, 'error');
      triggerHaptic('error');
    } finally {
      const btn = document.getElementById('btn-modal-save');
      btn.disabled = false;
      el.saveBtnText.textContent = isEdit ? 'Сохранить изменения' : 'Создать поиск';
    }
  }

  // 12. Admin Management Screen
  async function loadAdminUsers() {
    if (!el.adminUsersList) return;
    try {
      if (el.adminUsersLoading) el.adminUsersLoading.classList.remove('hidden');
      el.adminUsersList.innerHTML = '';

      const data = await apiFetch('/api/admin/users');
      const users = data.users || [];
      if (el.adminUsersCounter) el.adminUsersCounter.textContent = users.length;

      renderAdminUsers(users);
    } catch (err) {
      console.error('loadAdminUsers error:', err);
      showToast('Ошибка загрузки пользователей: ' + err.message, 'error');
    } finally {
      if (el.adminUsersLoading) el.adminUsersLoading.classList.add('hidden');
    }
  }

  function renderAdminUsers(users) {
    if (!el.adminUsersList) return;
    el.adminUsersList.innerHTML = '';

    if (users.length === 0) {
      el.adminUsersList.innerHTML = '<p class="section-hint" style="text-align: center; padding: 20px;">Нет зарегистрированных пользователей</p>';
      return;
    }

    users.forEach(u => {
      const card = document.createElement('div');
      card.className = 'admin-user-card';

      const roleClass = `role-${u.role || 'trial'}`;
      const roleName = (u.role || 'trial').toUpperCase();
      const limitText = u.effective_limit === 999999 ? '∞' : (u.effective_limit ?? 2);
      const isCustomLimit = u.custom_limit ? ` (индивид. ${u.custom_limit})` : '';

      let expText = 'Бессрочно';
      if (u.expires_at) {
        try {
          const d = new Date(u.expires_at);
          if (d.getFullYear() <= 2090) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            expText = `${dd}.${mm}.${d.getFullYear()} ${hh}:${mi}`;
          }
        } catch (e) {
          expText = u.expires_at;
        }
      }

      const displayName = [u.first_name, u.username ? `@${u.username}` : ''].filter(Boolean).join(' ') || `ID ${u.chat_id || u.user_id}`;

      card.innerHTML = `
        <div class="admin-user-top">
          <div class="admin-user-info">
            <span class="admin-user-name">${escapeHtml(displayName)}</span>
            <span class="admin-user-meta">TG ID: <code>${u.chat_id || u.user_id}</code> • До: ${escapeHtml(expText)}</span>
          </div>
          <span class="role-tag ${roleClass}">${roleName}</span>
        </div>

        <div class="admin-user-stats">
          <span>Слоты: <b>${u.active_filter_count || 0} / ${limitText}</b>${isCustomLimit}</span>
          <span>Всего поисков: <b>${u.filter_count || 0}</b></span>
        </div>

        <div class="admin-user-actions">
          <button class="btn-act" data-act="vip" data-uid="${u.chat_id || u.user_id}" data-days="7">⭐ +7д</button>
          <button class="btn-act" data-act="vip" data-uid="${u.chat_id || u.user_id}" data-days="30">⭐ +30д</button>
          <button class="btn-act" data-act="vip" data-uid="${u.chat_id || u.user_id}" data-days="0">👑 Навсегда</button>
          <button class="btn-act" data-act="limit" data-uid="${u.chat_id || u.user_id}" data-val="5">📈 5 слотов</button>
          ${((u.effective_limit ?? 0) < 999999) ? `<button class="btn-act" data-act="limit" data-uid="${u.chat_id || u.user_id}" data-val="${(u.effective_limit ?? 0) + 1}">➕ +1 слот</button>` : ''}
          <button class="btn-act" data-act="limit" data-uid="${u.chat_id || u.user_id}" data-val="">🔄 Сброс лимита</button>
          <button class="btn-act btn-act-danger" data-act="revoke" data-uid="${u.chat_id || u.user_id}">❌ Убрать VIP (Обнулить)</button>
        </div>
      `;

      el.adminUsersList.appendChild(card);
    });

    // Attach actions
    el.adminUsersList.querySelectorAll('.btn-act').forEach(btn => {
      btn.addEventListener('click', async () => {
        triggerHaptic('medium');
        const act = btn.dataset.act;
        const uid = btn.dataset.uid;
        try {
          btn.disabled = true;
          if (act === 'vip') {
            const days = parseInt(btn.dataset.days, 10);
            await apiFetch(`/api/admin/users/${uid}/vip`, {
              method: 'POST',
              body: JSON.stringify({ days })
            });
            showToast(`VIP обновлён для ${uid}`, 'success');
          } else if (act === 'limit') {
            const val = btn.dataset.val ? parseInt(btn.dataset.val, 10) : null;
            await apiFetch(`/api/admin/users/${uid}/limit`, {
              method: 'POST',
              body: JSON.stringify({ limit: val })
            });
            showToast(`Лимит обновлён для ${uid}`, 'success');
          } else if (act === 'revoke' || act === 'unvip') {
            await apiFetch(`/api/admin/users/${uid}/revoke`, {
              method: 'POST'
            });
            showToast(`VIP сброшен и поиски отключены для ${uid}`, 'info');
          }
          await loadAdminUsers();
        } catch (err) {
          showToast('Ошибка операции: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // 13. Tab Navigation Switching
  function switchTab(tabName) {
    triggerHaptic('light');
    state.activeTab = tabName;

    el.tabBtnFilters.classList.toggle('active', tabName === 'filters');
    el.tabBtnStopwords.classList.toggle('active', tabName === 'stopwords');
    if (el.tabBtnAdmin) el.tabBtnAdmin.classList.toggle('active', tabName === 'admin');

    el.tabFilters.classList.toggle('hidden', tabName !== 'filters');
    el.tabStopwords.classList.toggle('hidden', tabName !== 'stopwords');
    if (el.tabAdmin) el.tabAdmin.classList.toggle('hidden', tabName !== 'admin');

    if (tabName === 'admin') {
      loadAdminUsers();
    }
  }

  // 14. Event Listeners Setup
  function initEvents() {
    // Navigation Tabs
    el.tabBtnFilters.addEventListener('click', () => switchTab('filters'));
    el.tabBtnStopwords.addEventListener('click', () => switchTab('stopwords'));
    if (el.tabBtnAdmin) {
      el.tabBtnAdmin.addEventListener('click', () => switchTab('admin'));
    }
    if (el.btnAdminRefresh) {
      el.btnAdminRefresh.addEventListener('click', () => {
        triggerHaptic('light');
        loadAdminUsers();
      });
    }

    // Create filter button
    el.btnCreateFilter.addEventListener('click', openCreateFilterModal);

    // Modal controls
    el.btnModalClose.addEventListener('click', () => {
      triggerHaptic('light');
      closeModal();
    });
    el.btnModalCancel.addEventListener('click', () => {
      triggerHaptic('light');
      closeModal();
    });
    el.filterModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

    // Make field events
    el.makeInput.addEventListener('focus', () => {
      renderMakeDropdown(el.makeInput.value);
    });

    el.makeInput.addEventListener('input', (e) => {
      const val = e.target.value;
      el.btnClearMake.classList.toggle('hidden', val.length === 0);
      clearTimeout(state.makeSearchTimer);
      state.makeSearchTimer = setTimeout(() => {
        renderMakeDropdown(val);
      }, 200);
    });

    el.btnClearMake.addEventListener('click', () => {
      el.makeInput.value = '';
      el.btnClearMake.classList.add('hidden');
      el.makeInput.focus();
      renderMakeDropdown('');
    });

    el.btnChangeMake.addEventListener('click', () => {
      triggerHaptic('light');
      el.selectedMakeBadge.classList.add('hidden');
      el.makeInputWrapper.classList.remove('hidden');
      el.modelSelectionGroup.classList.add('hidden');
      el.makeInput.value = '';
      el.makeInput.focus();
      renderMakeDropdown('');
    });

    // Model field events
    el.modelInput.addEventListener('focus', () => {
      renderModelDropdown(el.modelInput.value);
    });

    el.modelInput.addEventListener('input', (e) => {
      const val = e.target.value;
      el.btnClearModel.classList.toggle('hidden', val.length === 0);
      clearTimeout(state.modelSearchTimer);
      state.modelSearchTimer = setTimeout(() => {
        renderModelDropdown(val);
      }, 150);
    });

    el.btnClearModel.addEventListener('click', () => {
      el.modelInput.value = '';
      el.btnClearModel.classList.add('hidden');
      el.modelInput.focus();
      renderModelDropdown('');
    });

    el.btnChangeModel.addEventListener('click', () => {
      triggerHaptic('light');
      el.selectedModelBadge.classList.add('hidden');
      el.modelInputWrapper.classList.remove('hidden');
      el.modelInput.value = '';
      el.modelInput.focus();
      renderModelDropdown('');
    });

    // Close dropdowns on outside click inside modal
    document.addEventListener('click', (e) => {
      if (!el.makeInputWrapper.contains(e.target) && !el.makeDropdown.contains(e.target)) {
        el.makeDropdown.classList.add('hidden');
      }
      if (!el.modelInputWrapper.contains(e.target) && !el.modelDropdown.contains(e.target)) {
        el.modelDropdown.classList.add('hidden');
      }
    });

    // City autocomplete
    setupCityAutocomplete();

    // Modal stopwords events
    if (el.btnAddModalStopword) {
      el.btnAddModalStopword.addEventListener('click', addModalStopword);
    }
    if (el.modalStopwordInput) {
      el.modalStopwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addModalStopword();
        }
      });
    }
    if (el.btnResetFilterStopwords) {
      el.btnResetFilterStopwords.addEventListener('click', resetModalStopwords);
    }

    // Two-Level Gearbox Events
    if (el.btnGbAny) {
      el.btnGbAny.addEventListener('click', () => {
        triggerHaptic('light');
        setGearboxMode('any');
      });
    }
    if (el.btnGbMt) {
      el.btnGbMt.addEventListener('click', () => {
        triggerHaptic('light');
        setGearboxMode('mt');
      });
    }
    if (el.btnGbAuto) {
      el.btnGbAuto.addEventListener('click', () => {
        triggerHaptic('light');
        setGearboxMode('at_all');
      });
    }

    document.querySelectorAll('.gb-subchip').forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic('light');
        toggleSubchip(chip.dataset.chip);
      });
    });

    // Preset price chips
    document.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic('light');
        const maxVal = chip.dataset.maxPrice;
        if (maxVal) {
          el.fPriceMax.value = maxVal;
        }
      });
    });

    // Filter Form Submit
    el.filterForm.addEventListener('submit', handleFilterSubmit);

    // Stopwords events
    el.btnAddStopword.addEventListener('click', addStopword);
    el.newStopwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStopword();
      }
    });
    el.btnSaveStopwords.addEventListener('click', saveStopwords);
    el.btnResetStopwords.addEventListener('click', resetStopwords);

    // API settings modal
    el.btnApiSettings.addEventListener('click', () => {
      triggerHaptic('light');
      el.apiUrlInput.value = getApiBase();
      el.apiModal.classList.remove('hidden');
    });
    el.btnApiClose.addEventListener('click', () => {
      el.apiModal.classList.add('hidden');
    });
    el.apiModal.querySelector('.modal-backdrop').addEventListener('click', () => {
      el.apiModal.classList.add('hidden');
    });
    el.btnApiReset.addEventListener('click', () => {
      triggerHaptic('light');
      localStorage.removeItem('api_base');
      el.apiUrlInput.value = 'http://127.0.0.1:8000';
      showToast('Сброшено на http://127.0.0.1:8000', 'info');
    });
    el.btnApiSave.addEventListener('click', () => {
      triggerHaptic('success');
      const val = el.apiUrlInput.value.trim();
      if (val) {
        localStorage.setItem('api_base', val);
      } else {
        localStorage.removeItem('api_base');
      }
      el.apiModal.classList.add('hidden');
      showToast('Адрес API сохранён', 'success');
      loadData();
    });
  }

  // Security Helper: escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start the application
  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData();

    // Background keep-alive every 25 seconds while Mini App window is open
    setInterval(() => {
      apiFetch('/api/health').catch(e => console.debug('Keep-alive ping error:', e));
    }, 25000);
  });
})();
