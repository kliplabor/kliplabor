/* Belépés / Regisztráció / Elfelejtett jelszó */
(function () {
  'use strict';
  var KL = window.KL;
  var $ = KL.$;
  var TABS = ['belepes', 'regisztracio', 'elfelejtett'];
  var TITLES = { belepes: 'Belépés', regisztracio: 'Regisztráció', elfelejtett: 'Új jelszó kérése' };
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // Csak a saját oldalainkra engedünk visszairányítani (nyitott átirányítás ellen).
  function target(isAdmin) {
    var v = new URLSearchParams(window.location.search).get('vissza');
    if (v === 'clipper.html' || v === 'admin.html') { return v; }
    return isAdmin ? 'admin.html' : 'clipper.html';
  }
  function pageUrl(file) { return new URL(file, window.location.href).href.split('#')[0].split('?')[0]; }

  /* ---------- Fülek ---------- */
  function showTab(name, focus) {
    if (TABS.indexOf(name) === -1) { name = 'belepes'; }
    TABS.forEach(function (t) {
      var tab = $('#tab-' + t);
      var on = t === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('#panel-' + t).hidden = !on;
    });
    $('#auth-title').textContent = TITLES[name];
    document.title = TITLES[name] + ' – KlipLabor';
    if (focus) { $('#tab-' + name).focus(); }
  }
  KL.$$('[role="tab"]').forEach(function (tab, i, all) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab');
      showTab(name);
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* nem baj */ }
    });
    tab.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) { return; }
      e.preventDefault();
      var next = all[(i + d + all.length) % all.length];
      next.click();
      next.focus();
    });
  });
  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('[data-goto]') : null;
    if (!g) { return; }
    e.preventDefault();
    var name = g.getAttribute('data-goto');
    showTab(name, true);
    try { history.replaceState(null, '', '#' + name); } catch (err) { /* nem baj */ }
  });
  window.addEventListener('hashchange', function () { showTab((window.location.hash || '').slice(1)); });

  var linkError = KL.hashError();
  showTab((window.location.hash || '').slice(1));
  if (linkError) { KL.say($('#page-msg'), linkError, 'err'); }

  /* ---------- Mező hibák ---------- */
  function fieldError(input, text) {
    var err = $('#' + input.id + '-err');
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      if (err) { err.textContent = text; err.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (err) { err.textContent = ''; err.hidden = true; }
    }
    return !text;
  }

  var sb = KL.client();
  if (!sb) {
    KL.say($('#page-msg'), KL.NO_CLIENT, 'err');
  } else if (!linkError) {
    // Ha már be van lépve, továbbküldjük.
    KL.getSession().then(function (s) {
      if (!s) { return; }
      return KL.loadProfile(s.user.id).then(function (p) {
        window.location.replace(target(p && p.role === 'admin'));
      });
    }).catch(function () { /* marad a belépő oldalon */ });
  }

  /* ---------- Belépés ---------- */
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#login-msg');
    var email = $('#login-email').value.trim();
    var pw = $('#login-password').value;
    if (!EMAIL_RE.test(email) || !pw) {
      KL.say(msg, 'Add meg az e-mail címedet és a jelszavadat.', 'err');
      (!EMAIL_RE.test(email) ? $('#login-email') : $('#login-password')).focus();
      return;
    }
    if (!sb) { KL.say(msg, KL.NO_CLIENT, 'err'); return; }
    var btn = e.submitter || $('#login-form button[type="submit"]');
    KL.busy(btn, true, 'Belépés…');
    KL.say(msg, '', 'info');
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (res) {
      if (res.error) { throw res.error; }
      KL.say(msg, 'Sikeres belépés, továbbviszünk…', 'ok');
      return KL.loadProfile(res.data.user.id).then(function (p) {
        window.location.href = target(p && p.role === 'admin');
      });
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });

  /* ---------- Regisztráció ---------- */
  $('#signup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#signup-msg');
    var name = $('#su-name'), email = $('#su-email'), pw = $('#su-password'), adult = $('#su-adult'), rules = $('#su-rules');
    var ok = true;
    ok = fieldError(name, name.value.trim().length < 2 ? 'Add meg a neved (legalább 2 karakter).' : '') && ok;
    ok = fieldError(email, !EMAIL_RE.test(email.value.trim()) ? 'Adj meg egy érvényes e-mail címet.' : '') && ok;
    ok = fieldError(pw, pw.value.length < 8 ? 'A jelszó legalább 8 karakter legyen.' : '') && ok;
    ok = fieldError(adult, !adult.checked ? 'A regisztrációhoz be kell töltened a 18. életévedet.' : '') && ok;
    ok = fieldError(rules, !rules.checked ? 'A regisztrációhoz el kell fogadnod a szabályzatot és az adatkezelési tájékoztatót.' : '') && ok;
    if (!ok) {
      KL.say(msg, 'Nézd át a pirossal jelölt mezőket.', 'err');
      var first = $('#signup-form [aria-invalid="true"]');
      if (first) { first.focus(); }
      return;
    }
    if (!sb) { KL.say(msg, KL.NO_CLIENT, 'err'); return; }
    var btn = e.submitter || $('#signup-form button[type="submit"]');
    KL.busy(btn, true, 'Regisztráció…');
    KL.say(msg, '', 'info');
    sb.auth.signUp({
      email: email.value.trim(),
      password: pw.value,
      options: {
        emailRedirectTo: pageUrl('clipper.html'),
        data: { full_name: name.value.trim(), adult_confirmed: true, rules_accepted: true }
      }
    }).then(function (res) {
      if (res.error) { throw res.error; }
      KL.busy(btn, false);
      if (res.data && res.data.session) {
        // Ha az e-mail megerősítés ki van kapcsolva, rögtön beléptet.
        window.location.href = 'clipper.html';
        return;
      }
      $('#signup-done-email').textContent = email.value.trim();
      $('#signup-form').hidden = true;
      $('#signup-done').hidden = false;
      $('#signup-done').focus();
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });
  ['#su-name', '#su-email', '#su-password', '#su-adult', '#su-rules'].forEach(function (sel) {
    var input = $(sel);
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', function () {
      if (input.getAttribute('aria-invalid') === 'true') { fieldError(input, ''); }
    });
  });

  /* ---------- Elfelejtett jelszó ---------- */
  $('#reset-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#reset-msg');
    var email = $('#reset-email').value.trim();
    if (!EMAIL_RE.test(email)) {
      KL.say(msg, 'Adj meg egy érvényes e-mail címet.', 'err');
      $('#reset-email').focus();
      return;
    }
    if (!sb) { KL.say(msg, KL.NO_CLIENT, 'err'); return; }
    var btn = e.submitter || $('#reset-form button[type="submit"]');
    KL.busy(btn, true, 'Küldés…');
    sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('uj-jelszo.html') }).then(function (res) {
      if (res.error) { throw res.error; }
      KL.busy(btn, false);
      KL.say(msg, 'Ha ezzel a címmel van fiók, pár percen belül megérkezik a link. Nézd meg a spam mappát is.', 'ok');
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });
})();
