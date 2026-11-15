/* KlipLabor – közös segédfüggvények (Supabase kliens, formázás, üzenetek, belépés-ellenőrzés).
   Biztonsági alapelv: felhasználótól származó szöveget soha nem teszünk innerHTML-be,
   mindig textContent-tel vagy az el() segédfüggvénnyel rakjuk ki. */
(function () {
  'use strict';

  var NBSP = ' ';
  var cfg = window.KL_CONFIG || {};
  var KL = window.KL = {};
  var client = null;

  KL.cfg = cfg;
  KL.NBSP = NBSP;

  /* ---------------- Formázás ---------------- */
  KL.fmt = function (n) {
    var v = Math.round(Number(n) || 0);
    var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return (v < 0 ? '−' : '') + s;
  };
  KL.ft = function (n) { return KL.fmt(n) + NBSP + 'Ft'; };
  KL.views = function (n) { return KL.fmt(n) + NBSP + 'megtekintés'; };

  function toDate(v) {
    if (!v) { return null; }
    var d = (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(v + 'T00:00:00') : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  KL.date = function (v) {
    var d = toDate(v);
    if (!d) { return '–'; }
    return d.getFullYear() + '. ' + String(d.getMonth() + 1).padStart(2, '0') + '. ' + String(d.getDate()).padStart(2, '0') + '.';
  };
  KL.dateTime = function (v) {
    var d = toDate(v);
    if (!d) { return '–'; }
    return KL.date(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  KL.isoDate = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  KL.PLATFORMS = { tiktok: 'TikTok', instagram: 'Instagram Reels', youtube: 'YouTube Shorts' };
  KL.PLATFORM_RE = {
    tiktok: /^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//i,
    instagram: /^https:\/\/([a-z0-9-]+\.)*instagram\.com\//i,
    youtube: /^https:\/\/(([a-z0-9-]+\.)*youtube\.com|youtu\.be)\//i
  };
  KL.CLIP_STATUS = {
    bekuldve: { label: 'Ellenőrzésre vár', cls: 'badge' },
    jovahagyva: { label: 'Jóváhagyva', cls: 'badge badge-ok' },
    elutasitva: { label: 'Elutasítva', cls: 'badge badge-err' }
  };
  KL.CAMPAIGN_STATUS = {
    aktiv: { label: 'Aktív', cls: 'badge badge-ok' },
    szunetel: { label: 'Szünetel', cls: 'badge badge-warn' },
    lezart: { label: 'Lezárva', cls: 'badge badge-muted' }
  };
  KL.APP_STATUS = { uj: 'Új', kapcsolat: 'Kapcsolatban', elfogadva: 'Elfogadva', elutasitva: 'Elutasítva' };
  KL.BUDGET_BANDS = {
    proba: 'Először az ingyenes próbakampány érdekel',
    '50_100': '50 000 – 100 000 Ft / hó',
    '100_250': '100 000 – 250 000 Ft / hó',
    '250_500': '250 000 – 500 000 Ft / hó',
    '500_felett': '500 000 Ft / hó felett',
    nem_tudom: 'Még nem tudom'
  };

  /* ---------------- DOM ---------------- */
  // el('a', {class: 'x', text: 'szöveg', attrs: {href: ...}, on: {click: fn}}, [gyerekek])
  KL.el = function (tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    if (props['class']) { node.className = props['class']; }
    if (props.text !== undefined && props.text !== null) { node.textContent = String(props.text); }
    if (props.attrs) {
      Object.keys(props.attrs).forEach(function (k) {
        var v = props.attrs[k];
        if (v === false || v === null || v === undefined) { return; }
        node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (props.on) {
      Object.keys(props.on).forEach(function (k) { node.addEventListener(k, props.on[k]); });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) { return; }
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  };
  KL.clear = function (node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } return node; };
  KL.$ = function (sel, root) { return (root || document).querySelector(sel); };
  KL.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // Csak http(s) linkeket engedünk; minden mást (javascript:, data: stb.) eldobunk.
  KL.safeUrl = function (u) {
    if (!u || typeof u !== 'string') { return null; }
    try {
      var url = new URL(u.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') { return url.href; }
    } catch (e) { /* érvénytelen */ }
    return null;
  };
  KL.extLink = function (u, label) {
    var safe = KL.safeUrl(u);
    if (!safe) { return KL.el('span', { 'class': 'muted', text: label || '–' }); }
    return KL.el('a', { text: label || safe, attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer nofollow' } });
  };
  KL.badge = function (map, key) {
    var m = map[key] || { label: key, cls: 'badge' };
    return KL.el('span', { 'class': m.cls, text: m.label });
  };

  /* ---------------- Üzenetek ---------------- */
  KL.say = function (node, text, kind) {
    if (!node) { return; }
    node.className = 'msg msg-' + (kind || 'info');
    node.textContent = text || '';
    node.hidden = !text;
  };
  var toastBox = null;
  KL.toast = function (text, kind) {
    if (!toastBox) {
      toastBox = KL.el('div', { 'class': 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
      document.body.appendChild(toastBox);
    }
    var t = KL.el('div', { 'class': 'toast' + (kind === 'err' ? ' toast-err' : ''), text: text });
    toastBox.appendChild(t);
    setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, kind === 'err' ? 8000 : 4500);
  };
  KL.busy = function (btn, on, busyLabel) {
    if (!btn) { return; }
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      if (busyLabel) { btn.textContent = busyLabel; }
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
    }
  };

  KL.errorText = function (err) {
    if (!err) { return 'Ismeretlen hiba történt. Próbáld újra.'; }
    var msg = String(err.message || err.error_description || err.msg || err || '');
    var code = String(err.code || err.error_code || '');
    var status = Number(err.status || err.statusCode || 0);
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) ||
        /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg)) {
      return 'Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot, és próbáld újra.';
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
      return 'Még nem erősítetted meg az e-mail címedet. Nézd meg a postafiókodat (a spam mappát is), és kattints a megerősítő linkre.';
    }
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) { return 'Hibás e-mail cím vagy jelszó.'; }
    if (code === 'user_already_exists' || /already registered/i.test(msg)) { return 'Ezzel az e-mail címmel már van fiók. Lépj be, vagy kérj új jelszót.'; }
    if (code === 'same_password' || /should be different/i.test(msg)) { return 'Az új jelszó nem lehet ugyanaz, mint a régi.'; }
    if (code === 'weak_password' || /password should|password is too/i.test(msg)) { return 'A jelszó túl gyenge. Legalább 8 karakter legyen, és ne legyen könnyen kitalálható.'; }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || /rate limit|too many/i.test(msg)) {
      return 'Túl sok próbálkozás rövid idő alatt. Várj pár percet, és próbáld újra.';
    }
    if (code === 'PGRST301' || code === 'session_not_found' || /jwt expired|invalid jwt|auth session missing/i.test(msg) || status === 401) {
      return 'Lejárt a bejelentkezésed. Lépj be újra.';
    }
    if (code === '42501' || /row-level security|permission denied|nem módosítható|csak admin/i.test(msg) || status === 403) {
      return 'Ehhez nincs jogosultságod. Ha szerinted ez hiba, lépj ki, majd be újra.';
    }
    if (code === '23505' || /duplicate key/i.test(msg)) { return 'Ez már szerepel a rendszerben (például ezt a linket már beküldték).'; }
    if (code === '23514' || code === '22P02' || code === '22001' || /check constraint/i.test(msg)) {
      return 'Valamelyik mező formátuma nem megfelelő. Ellenőrizd az adatokat.';
    }
    if (code === '23503') { return 'A kapcsolódó adat nem található (lehet, hogy közben törölték). Frissítsd az oldalt.'; }
    if (status === 413 || /too large|maximum allowed size/i.test(msg)) { return 'A fájl túl nagy (legfeljebb 5 MB lehet).'; }
    if (/mime type|invalid_mime|not supported/i.test(msg)) { return 'Csak PNG, JPG vagy WEBP képet tölthetsz fel.'; }
    return 'Hiba történt: ' + msg;
  };

  // A Supabase e-mailes linkjei hiba esetén a címsorba írják az okot (#error=...).
  KL.hashError = function () {
    var h = window.location.hash || '';
    if (h.indexOf('error') === -1) { return null; }
    var p = new URLSearchParams(h.replace(/^#/, ''));
    if (!p.get('error') && !p.get('error_code')) { return null; }
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* nem baj */ }
    var code = p.get('error_code') || '';
    if (code === 'otp_expired' || /expired|invalid/i.test(p.get('error_description') || '')) {
      return 'A link lejárt vagy már felhasználták. Kérj újat.';
    }
    return 'A link nem működött. Próbáld újra, vagy kérj újat.';
  };

  /* ---------------- Supabase ---------------- */
  KL.client = function () {
    if (client) { return client; }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { return null; }
    if (!cfg.supabaseUrl || !cfg.supabaseKey) { return null; }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  };
  KL.NO_CLIENT = 'Nem sikerült betölteni a szükséges szkriptet. Ellenőrizd az internetkapcsolatot, kapcsold ki a reklámblokkolót ezen az oldalon, és frissítsd az oldalt.';

  KL.getSession = function () {
    var sb = KL.client();
    if (!sb) { return Promise.reject(new Error(KL.NO_CLIENT)); }
    return sb.auth.getSession().then(function (res) {
      if (res.error) { throw res.error; }
      return res.data ? res.data.session : null;
    });
  };

  // Belépést igénylő oldalak őre: ha nincs munkamenet, a belépő oldalra küld.
  KL.requireSession = function (page) {
    return KL.getSession().then(function (session) {
      if (!session) {
        window.location.replace('belepes.html?vissza=' + encodeURIComponent(page || 'clipper.html'));
        return null;
      }
      return session;
    });
  };

  KL.signOut = function () {
    var sb = KL.client();
    var done = function () { window.location.href = 'belepes.html'; };
    if (!sb) { done(); return; }
    sb.auth.signOut().then(done, done);
  };

  KL.loadProfile = function (uid) {
    return KL.client().from('profiles').select('*').eq('id', uid).maybeSingle().then(function (res) {
      if (res.error) { throw res.error; }
      return res.data;
    });
  };

  // Egyszerű lekérdezés-segéd: hibánál kivételt dob, különben a sorokat adja vissza.
  KL.q = function (promise) {
    return Promise.resolve(promise).then(function (res) {
      if (res && res.error) { throw res.error; }
      return res ? res.data : null;
    });
  };

  /* ---------------- Lábléc linkek ---------------- */
  KL.applyLinks = function () {
    var links = cfg.links || {};
    KL.$$('[data-link]').forEach(function (a) {
      var key = a.getAttribute('data-link');
      var val = String(links[key] || '').trim();
      if (!val) { a.hidden = true; return; }
      if (key === 'email') {
        var cim = val.replace(/^mailto:/i, '');
        if (!/^[^@\s?&#]+@[^@\s?&#]+\.[^@\s?&#]+$/.test(cim)) { a.hidden = true; return; }
        a.href = 'mailto:' + cim;
        a.textContent = cim;
        a.hidden = false;
        return;
      }
      var safe = KL.safeUrl(val);
      if (!safe) { a.hidden = true; return; }
      a.href = safe;
      a.target = '_blank';
      a.rel = 'noopener';
      a.hidden = false;
    });
  };

  // Egyszerű, közös fejléc-gombok
  KL.wireSignOut = function () {
    KL.$$('[data-action="kilepes"]').forEach(function (b) {
      b.addEventListener('click', function () { KL.busy(b, true, 'Kilépés…'); KL.signOut(); });
    });
  };

  // CSV egy cellája: idézőjelezés + táblázatkezelő-képlet elleni védelem.
  KL.csvCell = function (v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) { s = "'" + s; }
    return '"' + s.replace(/"/g, '""') + '"';
  };
  KL.download = function (filename, text, mime) {
    var blob = new Blob(['﻿' + text], { type: mime || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = KL.el('a', { attrs: { href: url, download: filename } });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };

  document.addEventListener('DOMContentLoaded', function () {
    KL.applyLinks();
    KL.wireSignOut();
  });
})();
