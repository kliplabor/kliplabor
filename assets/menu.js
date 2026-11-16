/* KlipLabor – főoldali menü: "Fiókom" lenyíló (belépve) és mobil menü.
   Nem igényel belépést: ha nincs munkamenet, a Belépés / Regisztráció linkek látszanak. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var btn, panel, open = false;

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
    document.documentElement.classList.toggle('menu-open', v);
    if (v) {
      var first = panel.querySelector('a, button');
      if (first) { first.focus(); }
    }
  }

  function close(returnFocus) {
    if (!open) { return; }
    setOpen(false);
    if (returnFocus) { btn.focus(); }
  }

  function showAccount(session, profile) {
    var loggedIn = !!session;
    document.documentElement.classList.toggle('logged-in', loggedIn);
    $('menu-guest').hidden = loggedIn;
    $('menu-account').hidden = !loggedIn;
    $('nav-login').hidden = loggedIn;
    var label = $('menu-btn-label');
    if (label) { label.textContent = loggedIn ? 'Fiókom' : 'Menü'; }
    if (!loggedIn) { return; }
    var name = profile && profile.full_name ? String(profile.full_name).trim() : '';
    var email = session.user && session.user.email ? session.user.email : '';
    $('menu-who-name').textContent = name || 'Bejelentkezve';
    $('menu-who-mail').textContent = email;
    $('menu-admin').hidden = !(profile && profile.role === 'admin');
  }

  function init() {
    btn = $('menu-btn');
    panel = $('menu-panel');
    if (!btn || !panel) { return; }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!open);
    });
    panel.addEventListener('click', function (e) {
      var t = e.target.closest('a');
      if (t) { close(false); }
    });
    document.addEventListener('click', function (e) {
      if (open && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { close(false); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { close(true); }
    });
    window.addEventListener('resize', function () { if (open) { close(false); } });

    var out = $('menu-logout');
    if (out) {
      out.addEventListener('click', function () {
        if (window.KL && KL.signOut) { KL.signOut(); } else { window.location.href = 'belepes.html'; }
      });
    }

    showAccount(null, null);

    if (!window.KL || !KL.getSession) { return; }
    KL.getSession().then(function (session) {
      if (!session) { showAccount(null, null); return; }
      showAccount(session, null);
      return KL.loadProfile(session.user.id).then(function (profile) {
        showAccount(session, profile);
      }, function () { /* profil nélkül is működik a menü */ });
    }, function () { showAccount(null, null); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
