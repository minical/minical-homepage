/*!
 * MiniCal site analytics — first-party visitor/session tracking.
 *
 * One script, loaded on every page, that:
 *   1. gives every browser a stable first-party visitor id (localStorage +
 *      `.minical.io` cookie, so the id survives the hop to web./demo.minical.io),
 *   2. maintains a 30-minute rolling session and a session counter,
 *   3. records first-touch and last-touch attribution (utm_*, gclid, referrer),
 *   4. boots GA4 with all of the above attached to every event,
 *   5. auto-tracks the interactions this site actually converts on
 *      (CTA clicks, Calendly funnel, scroll depth, section views, engagement),
 *   6. exposes `window.mcAnalytics` so other destinations (e.g. a RunHQ SDK)
 *      can receive the same event stream — see ANALYTICS.md.
 *
 * No build step: plain ES5, no dependencies. Loaded synchronously from <head>
 * so the visitor/session identifiers exist before GA4's first page_view.
 */
(function (window, document) {
  'use strict';

  var CONFIG = {
    measurementId: 'G-5JMCT393M0',
    // Cookie is shared across *.minical.io so the app can join a signup back to
    // the marketing visit. Falls back to host-only on preview/localhost.
    cookieBaseDomain: 'minical.io',
    cookieMaxAgeDays: 730,
    sessionTimeoutMinutes: 30,
    scrollDepths: [25, 50, 75, 90],
    // Flip to true to drop tracking for browsers sending Global Privacy Control.
    respectGpc: false,
    maxReplayEvents: 50
  };

  var KEYS = {
    visitor: 'mc_visitor',
    firstTouch: 'mc_first_touch',
    user: 'mc_user',
    lastActivity: 'mc_last_activity',
    optOut: 'mc_optout',
    session: 'mc_session'
  };

  var COOKIE_VISITOR = 'mc_vid';
  var COOKIE_USER = 'mc_uid';

  /* ----------------------------------------------------------------- utils */

  function now() { return Date.now ? Date.now() : new Date().getTime(); }

  function safeGet(store, key) {
    try { return window[store].getItem(key); } catch (e) { return null; }
  }

  function safeSet(store, key, value) {
    try { window[store].setItem(key, value); return true; } catch (e) { return false; }
  }

  function safeRemove(store, key) {
    try { window[store].removeItem(key); } catch (e) { /* ignore */ }
  }

  function readJson(store, key) {
    var raw = safeGet(store, key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function writeJson(store, key, value) {
    try { return safeSet(store, key, JSON.stringify(value)); } catch (e) { return false; }
  }

  function cookieDomain() {
    var host = window.location.hostname || '';
    if (host === CONFIG.cookieBaseDomain || host.slice(-(CONFIG.cookieBaseDomain.length + 1)) === '.' + CONFIG.cookieBaseDomain) {
      return '.' + CONFIG.cookieBaseDomain;
    }
    return null; // preview deploys, localhost, file:// — host-only cookie
  }

  function readCookie(name) {
    var parts = ('; ' + document.cookie).split('; ' + name + '=');
    if (parts.length !== 2) return null;
    try { return decodeURIComponent(parts.pop().split(';').shift()); } catch (e) { return null; }
  }

  function writeCookie(name, value, days) {
    var chunks = [
      name + '=' + encodeURIComponent(value),
      'path=/',
      'max-age=' + Math.round(days * 86400),
      'SameSite=Lax'
    ];
    var domain = cookieDomain();
    if (domain) chunks.push('domain=' + domain);
    if (window.location.protocol === 'https:') chunks.push('Secure');
    try { document.cookie = chunks.join('; '); } catch (e) { /* ignore */ }
  }

  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        var buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        buf[6] = (buf[6] & 0x0f) | 0x40;
        buf[8] = (buf[8] & 0x3f) | 0x80;
        var hex = [];
        for (var i = 0; i < buf.length; i++) hex.push((buf[i] + 0x100).toString(16).slice(1));
        return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
               hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
      }
    } catch (e) { /* fall through */ }
    return 'x' + now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function param(name) {
    try {
      var match = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
      return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
    } catch (e) { return null; }
  }

  function text(el) {
    var value = (el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '';
    return value.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function hostnameOf(url) {
    try { return new URL(url, window.location.href).hostname; } catch (e) { return ''; }
  }

  /* --------------------------------------------------------------- opt-out */

  var optedOut = (function () {
    if (param('mc_optout') === '1') { safeSet('localStorage', KEYS.optOut, '1'); return true; }
    if (param('mc_optout') === '0') { safeRemove('localStorage', KEYS.optOut); return false; }
    if (safeGet('localStorage', KEYS.optOut) === '1') return true;
    if (CONFIG.respectGpc && window.navigator && window.navigator.globalPrivacyControl) return true;
    return false;
  })();

  var debug = param('mc_debug') === '1';

  function log() {
    if (debug && window.console && window.console.log) {
      window.console.log.apply(window.console, ['[mc]'].concat([].slice.call(arguments)));
    }
  }

  /* ---------------------------------------------------- visitor & session */

  // A visitor is one browser profile. The id lives in localStorage *and* a
  // `.minical.io` cookie; either survivor rehydrates the other, so clearing one
  // (or arriving from a subdomain) does not mint a duplicate visitor.
  function loadVisitor() {
    var record = readJson('localStorage', KEYS.visitor) || {};
    var cookieId = readCookie(COOKIE_VISITOR);
    var isNew = false;

    if (!record.id) {
      record = { id: cookieId || uuid(), firstSeen: now(), sessions: 0, pageviews: 0 };
      isNew = !cookieId;
    } else if (cookieId && cookieId !== record.id) {
      // Cookie wins: it is the id other *.minical.io properties already saw.
      record.id = cookieId;
    }

    record.lastSeen = now();
    writeJson('localStorage', KEYS.visitor, record);
    writeCookie(COOKIE_VISITOR, record.id, CONFIG.cookieMaxAgeDays);
    record.isNew = isNew;
    return record;
  }

  // The session lives in localStorage, not sessionStorage: a second tab opened
  // within the timeout is the same visit, and sessionStorage would split it.
  function loadSession(visitor) {
    var timeout = CONFIG.sessionTimeoutMinutes * 60 * 1000;
    var lastActivity = parseInt(safeGet('localStorage', KEYS.lastActivity) || '0', 10);
    var session = readJson('localStorage', KEYS.session);
    var expired = !lastActivity || (now() - lastActivity) > timeout;

    if (!session || !session.id || expired) {
      visitor.sessions = (visitor.sessions || 0) + 1;
      session = {
        id: uuid(),
        start: now(),
        number: visitor.sessions,
        pageviews: 0,
        landingPage: window.location.pathname + window.location.search,
        referrer: document.referrer || '',
        lastTouch: null
      };
    }

    session.pageviews = (session.pageviews || 0) + 1;
    visitor.pageviews = (visitor.pageviews || 0) + 1;
    writeJson('localStorage', KEYS.session, session);
    writeJson('localStorage', KEYS.visitor, visitor);
    safeSet('localStorage', KEYS.lastActivity, String(now()));
    return session;
  }

  // Throttled: this is bound to scroll, so it must not write storage per event.
  var lastActivityWrite = 0;

  function touchActivity() {
    var stamp = now();
    if (stamp - lastActivityWrite < 5000) return;
    lastActivityWrite = stamp;
    safeSet('localStorage', KEYS.lastActivity, String(stamp));
  }

  /* ----------------------------------------------------------- attribution */

  function currentTouch() {
    var referrer = document.referrer || '';
    var referrerHost = referrer ? hostnameOf(referrer) : '';
    var external = referrerHost && referrerHost !== window.location.hostname;

    var touch = {
      source: param('utm_source'),
      medium: param('utm_medium'),
      campaign: param('utm_campaign'),
      term: param('utm_term'),
      content: param('utm_content'),
      gclid: param('gclid'),
      fbclid: param('fbclid'),
      referrer: external ? referrer : '',
      landingPage: window.location.pathname,
      timestamp: now()
    };

    if (!touch.source) {
      if (touch.gclid) { touch.source = 'google'; touch.medium = 'cpc'; }
      else if (external) { touch.source = referrerHost; touch.medium = 'referral'; }
      else { touch.source = 'direct'; touch.medium = 'none'; }
    }
    return touch;
  }

  function loadAttribution(session) {
    var touch = currentTouch();
    var first = readJson('localStorage', KEYS.firstTouch);
    if (!first) {
      first = touch;
      writeJson('localStorage', KEYS.firstTouch, first);
    }
    // Last touch only advances on a genuinely new campaign/referrer, so internal
    // navigation does not overwrite the source that brought the session in.
    var hasNewSource = !!(param('utm_source') || param('gclid') || param('fbclid') || touch.referrer);
    if (!session.lastTouch || hasNewSource) {
      session.lastTouch = touch;
      writeJson('localStorage', KEYS.session, session);
    }
    return { first: first, last: session.lastTouch };
  }

  /* ------------------------------------------------------------- identity */

  function loadUser() {
    var fromUrl = param('mc_uid');
    if (fromUrl) {
      var record = { id: fromUrl, identifiedAt: now() };
      writeJson('localStorage', KEYS.user, record);
      writeCookie(COOKIE_USER, fromUrl, CONFIG.cookieMaxAgeDays);
      return record;
    }
    var stored = readJson('localStorage', KEYS.user);
    if (stored && stored.id) return stored;
    var cookieId = readCookie(COOKIE_USER);
    if (cookieId) return { id: cookieId, identifiedAt: now() };
    return null;
  }

  /* -------------------------------------------------------------- state */

  var visitor = optedOut ? { id: 'opted-out', isNew: false, sessions: 0 } : loadVisitor();
  var session = optedOut ? { id: 'opted-out', number: 0 } : loadSession(visitor);
  var attribution = optedOut ? { first: {}, last: {} } : loadAttribution(session);
  var user = optedOut ? null : loadUser();

  var adapters = [];
  var replayBuffer = [];

  function baseParams() {
    return {
      visitor_id: visitor.id,
      visitor_type: visitor.isNew ? 'new' : 'returning',
      mc_session_id: session.id,
      session_number: session.number || visitor.sessions || 1,
      first_touch_source: attribution.first.source || 'direct',
      first_touch_medium: attribution.first.medium || 'none',
      first_touch_campaign: attribution.first.campaign || '(none)',
      last_touch_source: attribution.last.source || 'direct',
      last_touch_medium: attribution.last.medium || 'none',
      page_group: pageGroup()
    };
  }

  function pageGroup() {
    var file = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return file.replace(/\.html$/, '') || 'index';
  }

  /* ------------------------------------------------------------ GA4 boot */

  function gtag() { window.dataLayer.push(arguments); }

  function bootGa() {
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) window.gtag = gtag;

    var loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + CONFIG.measurementId;
    (document.head || document.documentElement).appendChild(loader);

    gtag('js', new Date());

    var settings = baseParams();
    settings.transport_type = 'beacon';
    if (user && user.id) settings.user_id = user.id;

    // Config params ride along on the automatic page_view and every later event
    // sent to this measurement id, so no pageview is missing the visitor fields.
    gtag('config', CONFIG.measurementId, settings);

    gtag('set', 'user_properties', {
      visitor_id: visitor.id,
      visitor_type: visitor.isNew ? 'new' : 'returning',
      first_touch_source: attribution.first.source || 'direct',
      first_touch_medium: attribution.first.medium || 'none',
      first_touch_campaign: attribution.first.campaign || '(none)'
    });
  }

  /* ------------------------------------------------------------ dispatch */

  function toAdapters(method, a, b) {
    for (var i = 0; i < adapters.length; i++) {
      var adapter = adapters[i];
      if (typeof adapter[method] !== 'function') continue;
      try { adapter[method](a, b); } catch (e) { log('adapter error', adapter.name, e); }
    }
  }

  function remember(method, a, b) {
    replayBuffer.push([method, a, b]);
    if (replayBuffer.length > CONFIG.maxReplayEvents) replayBuffer.shift();
  }

  function track(name, params) {
    if (optedOut || !name) return;
    var payload = baseParams();
    for (var key in (params || {})) {
      if (Object.prototype.hasOwnProperty.call(params, key)) payload[key] = params[key];
    }
    touchActivity();
    log('event', name, payload);
    try { window.gtag('event', name, payload); } catch (e) { log('gtag error', e); }
    remember('track', name, payload);
    toAdapters('track', name, payload);
  }

  function identify(userId, traits) {
    if (optedOut || !userId) return;
    user = { id: String(userId), identifiedAt: now(), traits: traits || null };
    writeJson('localStorage', KEYS.user, user);
    writeCookie(COOKIE_USER, user.id, CONFIG.cookieMaxAgeDays);
    try {
      window.gtag('set', { user_id: user.id });
      window.gtag('set', 'user_properties', traits || {});
    } catch (e) { log('gtag identify error', e); }
    log('identify', user.id, traits);
    remember('identify', user.id, traits || {});
    toAdapters('identify', user.id, traits || {});
  }

  function use(adapter) {
    if (!adapter || typeof adapter !== 'object') return;
    adapters.push(adapter);
    if (typeof adapter.init === 'function') {
      try { adapter.init(api.context()); } catch (e) { log('adapter init error', adapter.name, e); }
    }
    for (var i = 0; i < replayBuffer.length; i++) {
      var entry = replayBuffer[i];
      if (typeof adapter[entry[0]] !== 'function') continue;
      try { adapter[entry[0]](entry[1], entry[2]); } catch (e) { log('adapter replay error', adapter.name, e); }
    }
    log('adapter registered', adapter.name || '(unnamed)');
  }

  /* -------------------------------------------------------- auto-tracking */

  var lastCtaLabel = null;

  function sectionOf(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.getAttribute) {
        var explicit = node.getAttribute('data-mc-section');
        if (explicit) return explicit;
        var tag = (node.tagName || '').toLowerCase();
        if (tag === 'header') return 'header';
        if (tag === 'footer') return 'footer';
        if (tag === 'section' && node.id) return node.id;
      }
      node = node.parentNode;
    }
    return 'body';
  }

  function linkType(el, href) {
    if (el.classList && el.classList.contains('ext-tab')) return 'tab';
    if (!href || href === '' || href === '#') {
      var onclick = el.getAttribute && el.getAttribute('onclick');
      if (onclick && onclick.indexOf('openCalendly') !== -1) return 'calendly';
      return 'button';
    }
    if (href.indexOf('mailto:') === 0) return 'email';
    if (href.indexOf('tel:') === 0) return 'phone';
    if (href.charAt(0) === '#') return 'anchor';
    var host = hostnameOf(href);
    if (!host || host === window.location.hostname) return 'internal';
    if (host === 'web.minical.io' || host === 'demo.minical.io') return 'app';
    if (host.slice(-('minical.io'.length + 1)) === '.minical.io' || host === 'minical.io') return 'internal';
    return 'outbound';
  }

  function trackClicks() {
    document.addEventListener('click', function (event) {
      var el = event.target;
      while (el && el !== document.body && !(el.tagName === 'A' || el.tagName === 'BUTTON' || (el.hasAttribute && el.hasAttribute('data-mc-cta')))) {
        el = el.parentNode;
      }
      if (!el || el === document.body || !el.hasAttribute) return;
      if (el.hasAttribute('data-mc-ignore')) return;

      var href = el.getAttribute('href');
      var type = linkType(el, href);
      var label = el.getAttribute('data-mc-cta') || text(el) || href || '(unlabelled)';

      if (type === 'tab') {
        track('ext_tab_select', { tab_name: el.getAttribute('data-tab') || label });
        return;
      }

      lastCtaLabel = label;
      var params = {
        cta_label: label,
        cta_location: sectionOf(el),
        link_type: type
      };
      if (href) {
        params.link_url = href;
        params.link_domain = hostnameOf(href) || window.location.hostname;
      }
      track('cta_click', params);

      // The app is where a marketing visit turns into a real user, so call the
      // handoff out explicitly rather than leaving it inside cta_click.
      if (type === 'app') {
        track('app_handoff', { destination: params.link_domain, cta_label: label });
      }
    }, true);
  }

  function trackCalendly() {
    // Booking a call is this site's conversion. Wrap the popup opener and listen
    // to Calendly's postMessage funnel so the whole path is measurable.
    var original = window.openCalendly;
    if (typeof original === 'function') {
      window.openCalendly = function (url) {
        track('calendly_open', { cta_label: lastCtaLabel || '(unknown)', calendly_url: url || window.CALENDLY_PARTNER_URL || '' });
        return original.apply(this, arguments);
      };
    }

    window.addEventListener('message', function (event) {
      if (!event.data || typeof event.data.event !== 'string') return;
      if (event.data.event.indexOf('calendly.') !== 0) return;
      var name = event.data.event.replace('calendly.', '');
      track('calendly_' + name, { cta_label: lastCtaLabel || '(unknown)' });
      if (name === 'event_scheduled') {
        // GA4 recommended event — usable directly as a conversion/key event.
        track('generate_lead', { lead_source: 'calendly', cta_label: lastCtaLabel || '(unknown)' });
      }
    });
  }

  var maxScroll = 0;

  function trackScrollDepth() {
    var fired = {};
    function onScroll() {
      var doc = document.documentElement;
      var body = document.body;
      var height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0) - window.innerHeight;
      if (height <= 0) return;
      var percent = Math.min(100, Math.round((window.pageYOffset / height) * 100));
      if (percent > maxScroll) maxScroll = percent;
      for (var i = 0; i < CONFIG.scrollDepths.length; i++) {
        var mark = CONFIG.scrollDepths[i];
        if (percent >= mark && !fired[mark]) {
          fired[mark] = true;
          track('scroll_depth', { percent_scrolled: mark });
        }
      }
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.setTimeout(function () { ticking = false; onScroll(); }, 250);
    }, { passive: true });
  }

  function trackSectionViews() {
    if (!window.IntersectionObserver) return;
    var sections = document.querySelectorAll('section[id], [data-mc-section]');
    if (!sections.length) return;
    var observer = new window.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        track('section_view', { section_id: entry.target.getAttribute('data-mc-section') || entry.target.id });
      }
    }, { threshold: 0.4 });
    for (var i = 0; i < sections.length; i++) observer.observe(sections[i]);
  }

  function trackFaq() {
    var items = document.querySelectorAll('details.faq-item');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        item.addEventListener('toggle', function () {
          var summary = item.querySelector('summary');
          track('faq_toggle', {
            faq_question: summary ? text(summary).replace(/\s*\+$/, '') : '(unknown)',
            faq_state: item.open ? 'open' : 'closed'
          });
        });
      })(items[i]);
    }
  }

  function trackEngagement() {
    var start = now();
    var engagedMs = 0;
    var lastTick = now();
    var active = !document.hidden;

    function accumulate() {
      if (active) engagedMs += now() - lastTick;
      lastTick = now();
    }

    document.addEventListener('visibilitychange', function () {
      accumulate();
      active = !document.hidden;
      if (document.hidden) send();
    });

    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function (name) {
      window.addEventListener(name, touchActivity, { passive: true });
    });

    // Sends a chunk each time the page is backgrounded and once on unload.
    // engagedMs resets after each send, so a visitor who tabs away and comes
    // back is still counted and the same second is never reported twice.
    function send() {
      accumulate();
      if (engagedMs < 1000) return;
      var chunk = engagedMs;
      engagedMs = 0;
      track('page_engagement', {
        engaged_seconds: Math.round(chunk / 1000),
        time_on_page_seconds: Math.round((now() - start) / 1000),
        max_scroll_percent: maxScroll
      });
    }

    window.addEventListener('pagehide', send);
  }

  /* ------------------------------------------------------------ public API */

  var api = {
    version: '1.0.0',
    track: track,
    identify: identify,
    use: use,
    optedOut: function () { return optedOut; },
    optOut: function () {
      safeSet('localStorage', KEYS.optOut, '1');
      optedOut = true;
    },
    optIn: function () {
      safeRemove('localStorage', KEYS.optOut);
      optedOut = false;
    },
    reset: function () {
      safeRemove('localStorage', KEYS.visitor);
      safeRemove('localStorage', KEYS.firstTouch);
      safeRemove('localStorage', KEYS.user);
      safeRemove('localStorage', KEYS.session);
      safeRemove('localStorage', KEYS.lastActivity);
      writeCookie(COOKIE_VISITOR, '', -1);
      writeCookie(COOKIE_USER, '', -1);
    },
    context: function () {
      return {
        visitorId: visitor.id,
        visitorType: visitor.isNew ? 'new' : 'returning',
        sessionId: session.id,
        sessionNumber: session.number || visitor.sessions || 1,
        userId: user ? user.id : null,
        firstTouch: attribution.first,
        lastTouch: attribution.last,
        page: pageGroup()
      };
    }
  };

  window.mcAnalytics = api;
  if (!window.mc) window.mc = api;

  /* ----------------------------------------------------------------- init */

  function bindDom() {
    trackClicks();
    trackCalendly();
    trackScrollDepth();
    trackSectionViews();
    trackFaq();
    trackEngagement();
  }

  if (optedOut) {
    log('opted out — no tracking');
    return;
  }

  bootGa();
  log('booted', api.context());

  // Adapters can be queued before this script runs (see ANALYTICS.md).
  var queued = window.MC_ANALYTICS_ADAPTERS;
  if (queued && queued.length) {
    for (var q = 0; q < queued.length; q++) use(queued[q]);
  }
  window.MC_ANALYTICS_ADAPTERS = { push: use };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDom);
  } else {
    bindDom();
  }
})(window, document);
