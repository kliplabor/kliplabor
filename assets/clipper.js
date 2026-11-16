/* Clipper felület */
(function () {
  'use strict';
  var KL = window.KL, $ = KL.$, el = KL.el;
  var sb = KL.client();
  var MAX_FILE = 5 * 1024 * 1024;
  var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  var S = { uid: null, profile: null, campaigns: [], member: {}, clips: [], earnings: {}, latestStat: {}, payouts: [], balance: null };
  var statClip = null;

  function fail(err) {
    $('#page-loading').hidden = true;
    KL.say($('#page-msg'), typeof err === 'string' ? err : KL.errorText(err), 'err');
  }

  if (!sb) { fail(KL.NO_CLIENT); return; }

  KL.requireSession('clipper.html').then(function (session) {
    if (!session) { return; }
    S.uid = session.user.id;
    return KL.loadProfile(S.uid).then(function (p) {
      if (!p) { throw new Error('A profilod nem található. Lépj ki, majd be újra; ha ez sem segít, írj nekünk.'); }
      S.profile = p;
      renderHeader();
      return loadAll();
    }).then(function () {
      $('#page-loading').hidden = true;
      $('#app').hidden = false;
      var h = KL.hashError();
      if (h) { KL.say($('#page-msg'), h, 'err'); }
      initSubnav();
    });
  }).catch(fail);

  /* Al-menü: a betöltés után a címsorban kért részre görget, és jelzi, hol jársz. */
  function initSubnav() {
    var bar = document.getElementById('subnav');
    if (!bar) { return; }
    var links = Array.prototype.slice.call(bar.querySelectorAll('a[href^="#"]'));
    function mark(id) {
      links.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + id;
        if (on) { a.setAttribute('aria-current', 'true'); } else { a.removeAttribute('aria-current'); }
        if (on && a.scrollIntoView && bar.scrollWidth > bar.clientWidth) {
          bar.scrollLeft = a.offsetLeft - 12;
        }
      });
    }
    var target = (window.location.hash || '').replace(/^#/, '');
    if (target && /^[a-z]+$/.test(target)) {
      var el = document.getElementById(target);
      if (el) { setTimeout(function () { el.scrollIntoView(); mark(target); }, 0); }
    }
    if (!('IntersectionObserver' in window)) { return; }
    var sections = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      if (visible.length) { mark(visible[0].target.id); }
    }, { rootMargin: '-160px 0px -55% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  function loadAll() {
    return Promise.all([
      KL.q(sb.from('campaigns').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('campaign_members').select('*').eq('clipper_id', S.uid)),
      KL.q(sb.from('clips').select('*').eq('clipper_id', S.uid).order('created_at', { ascending: false })),
      KL.q(sb.from('clip_earnings').select('*').eq('clipper_id', S.uid)),
      KL.q(sb.from('clip_stats').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('payouts').select('*').eq('clipper_id', S.uid).order('paid_at', { ascending: false })),
      KL.q(sb.from('clipper_balances').select('*').eq('clipper_id', S.uid).maybeSingle())
    ]).then(function (r) {
      S.campaigns = r[0] || [];
      S.member = {};
      (r[1] || []).forEach(function (m) { S.member[m.campaign_id] = true; });
      S.clips = r[2] || [];
      S.earnings = {};
      (r[3] || []).forEach(function (e) { S.earnings[e.clip_id] = e; });
      S.latestStat = {};
      (r[4] || []).forEach(function (s) { if (!S.latestStat[s.clip_id]) { S.latestStat[s.clip_id] = s; } });
      S.payouts = r[5] || [];
      S.balance = r[6];
      renderAll();
    });
  }

  function reload() {
    return loadAll().catch(function (err) { KL.toast(KL.errorText(err), 'err'); });
  }

  function canParticipate() { return !!(S.profile && S.profile.adult_confirmed && S.profile.rules_accepted_at); }
  function campaignById(id) { for (var i = 0; i < S.campaigns.length; i++) { if (S.campaigns[i].id === id) { return S.campaigns[i]; } } return null; }

  /* ---------------- Render ---------------- */
  function renderHeader() {
    var name = (S.profile.full_name || '').trim();
    $('#nav-user').textContent = name;
    $('#hello').textContent = name ? 'Szia, ' + name.split(/\s+/).slice(-1)[0] + '!' : 'Szia!';
    $('#nav-admin').hidden = S.profile.role !== 'admin';
    $('#rules-gate').hidden = canParticipate();
    $('#pf-name').value = S.profile.full_name || '';
    $('#pf-tiktok').value = S.profile.tiktok_url || '';
    $('#pf-instagram').value = S.profile.instagram_url || '';
    $('#pf-youtube').value = S.profile.youtube_url || '';
    $('#pf-payout').value = S.profile.payout_name || '';
  }

  function renderAll() {
    renderSummary();
    renderCampaigns();
    renderSubmitForm();
    renderClips();
    renderPayouts();
  }

  function renderSummary() {
    var b = S.balance || { approved_views: 0, earned: 0, paid: 0, owed: 0 };
    $('#sum-views').textContent = KL.fmt(b.approved_views);
    $('#sum-earned').textContent = KL.ft(b.earned);
    $('#sum-paid').textContent = KL.ft(b.paid);
    $('#sum-owed').textContent = KL.ft(Math.max(0, b.owed));
  }

  function renderCampaigns() {
    var box = KL.clear($('#campaigns'));
    var list = S.campaigns.filter(function (c) { return c.status === 'aktiv'; });
    if (!list.length) {
      box.appendChild(el('p', { 'class': 'empty', text: 'Most nincs aktív kampány. Amint indul egy, itt látod.' }));
      return;
    }
    list.forEach(function (c) {
      var joined = !!S.member[c.id];
      var details = el('details', { 'class': 'more' }, [
        el('summary', { text: 'Leírás és szabályok' }),
        el('div', { 'class': 'more-body' }, [
          el('h4', { text: 'Leírás' }),
          el('p', { 'class': 'pre', text: c.description || 'Nincs megadva.' }),
          el('h4', { text: 'Szabályok' }),
          el('p', { 'class': 'pre', text: c.rules || 'A clipper szabályzat érvényes.' })
        ])
      ]);
      var action;
      if (joined) {
        action = el('p', { 'class': 'badge badge-ok', text: 'Jelentkeztél' });
      } else {
        action = el('button', {
          'class': 'btn btn-accent btn-sm', text: 'Jelentkezem',
          attrs: { type: 'button', 'data-join': c.id, disabled: !canParticipate(), 'aria-describedby': canParticipate() ? null : 'rules-gate-title' },
          on: { click: function (e) { join(c, e.currentTarget); } }
        });
      }
      var dates = (c.starts_on || c.ends_on) ? (KL.date(c.starts_on) + ' – ' + KL.date(c.ends_on)) : 'Folyamatos';
      box.appendChild(el('article', { 'class': 'card card-tight stack', attrs: { 'data-campaign': c.id } }, [
        el('div', {}, [
          el('h3', { 'class': 'h-card', text: c.title }),
          el('p', { 'class': 'meta' }, [
            el('span', { text: c.creator_name }),
            c.creator_platform ? el('span', { text: c.creator_platform }) : null
          ])
        ]),
        el('dl', { 'class': 'kv' }, [
          el('dt', { text: 'Díj' }), el('dd', { 'class': 'num', text: KL.ft(c.clipper_rate) + ' / 1000 megtekintés' }),
          el('dt', { text: 'Keret' }), el('dd', { 'class': 'num', text: KL.ft(c.budget) }),
          el('dt', { text: 'Időszak' }), el('dd', { text: dates })
        ]),
        details,
        el('div', {}, [action])
      ]));
    });
  }

  function join(c, btn) {
    KL.busy(btn, true, 'Jelentkezés…');
    KL.q(sb.from('campaign_members').insert({ campaign_id: c.id, clipper_id: S.uid })).then(function () {
      KL.toast('Jelentkeztél a(z) „' + c.title + '” kampányra. Most már beküldheted a klipjeidet.');
      return reload();
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.toast(KL.errorText(err), 'err');
    });
  }

  function renderSubmitForm() {
    var sel = KL.clear($('#clip-campaign'));
    var joined = S.campaigns.filter(function (c) { return c.status === 'aktiv' && S.member[c.id]; });
    var btn = $('#clip-submit');
    if (!joined.length) {
      sel.appendChild(el('option', { text: 'Előbb jelentkezz egy aktív kampányra', attrs: { value: '' } }));
      sel.disabled = true;
      btn.disabled = true;
      return;
    }
    sel.disabled = false;
    btn.disabled = false;
    joined.forEach(function (c) { sel.appendChild(el('option', { text: c.title + ' – ' + c.creator_name, attrs: { value: c.id } })); });
  }

  function renderClips() {
    var box = KL.clear($('#clips'));
    if (!S.clips.length) {
      box.appendChild(el('p', { 'class': 'empty', text: 'Még nem küldtél be klipet.' }));
      return;
    }
    var tbody = el('tbody');
    S.clips.forEach(function (clip) {
      var c = campaignById(clip.campaign_id);
      var e = S.earnings[clip.id] || { base_amount: 0, bonus_amount: 0, total_amount: 0 };
      var st = S.latestStat[clip.id];
      var statusCell = el('td', { attrs: { 'data-label': 'Állapot' } }, [
        el('div', { 'class': 'stack-r' }, [
          KL.badge(KL.CLIP_STATUS, clip.status),
          clip.status === 'elutasitva' && clip.reject_reason ? el('span', { 'class': 'reason', text: 'Ok: ' + clip.reject_reason }) : null
        ])
      ]);
      var earnText = clip.status === 'jovahagyva' ? KL.ft(e.total_amount) : '–';
      var earnSub = clip.status === 'jovahagyva' && e.bonus_amount > 0 ? el('span', { 'class': 'sub', text: 'benne ' + KL.ft(e.bonus_amount) + ' bónusz' }) : null;
      var canStat = clip.status !== 'elutasitva' && c && c.status !== 'lezart';
      tbody.appendChild(el('tr', { attrs: { 'data-clip': clip.id } }, [
        el('td', { 'class': 'cell-main' }, [
          KL.extLink(clip.post_url, KL.PLATFORMS[clip.platform] || clip.platform),
          el('span', { 'class': 'sub', text: c ? c.title : '' })
        ]),
        el('td', { 'class': 'nowrap', attrs: { 'data-label': 'Beküldve' }, text: KL.date(clip.created_at) }),
        statusCell,
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Hitelesített megtekintés' }, text: KL.fmt(clip.verified_views) }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Kereset' } }, [el('div', { 'class': 'stack-r' }, [earnText, earnSub])]),
        el('td', { attrs: { 'data-label': 'Utolsó statisztika' }, text: st ? KL.date(st.created_at) + ', ' + KL.fmt(st.views) : 'Még nincs' }),
        el('td', { 'class': 'cell-actions' }, [
          canStat ? el('button', {
            'class': 'btn btn-ghost btn-sm', text: 'Heti statisztika',
            attrs: { type: 'button', 'data-stat': clip.id, 'aria-label': 'Heti statisztika: ' + (KL.PLATFORMS[clip.platform] || '') + ' klip, ' + KL.date(clip.created_at) },
            on: { click: function () { openStat(clip); } }
          }) : null
        ])
      ]));
    });
    box.appendChild(el('div', { 'class': 'tbl-wrap' }, [
      el('table', { 'class': 'tbl' }, [
        el('caption', { 'class': 'sr-only', text: 'Saját klipjeim' }),
        el('thead', {}, [el('tr', {}, [
          el('th', { attrs: { scope: 'col' }, text: 'Klip' }),
          el('th', { attrs: { scope: 'col' }, text: 'Beküldve' }),
          el('th', { attrs: { scope: 'col' }, text: 'Állapot' }),
          el('th', { 'class': 'r', attrs: { scope: 'col' }, text: 'Hitelesített megtekintés' }),
          el('th', { 'class': 'r', attrs: { scope: 'col' }, text: 'Kereset' }),
          el('th', { attrs: { scope: 'col' }, text: 'Utolsó statisztika' }),
          el('th', { attrs: { scope: 'col' } }, [el('span', { 'class': 'sr-only', text: 'Művelet' })])
        ])]),
        tbody
      ])
    ]));
  }

  function renderPayouts() {
    var box = KL.clear($('#payouts'));
    if (!S.payouts.length) {
      box.appendChild(el('p', { 'class': 'empty', text: 'Még nem volt kifizetésed. Kéthetente utalunk a jóváhagyott klipek után.' }));
      return;
    }
    var tbody = el('tbody');
    S.payouts.forEach(function (p) {
      tbody.appendChild(el('tr', {}, [
        el('td', { 'class': 'cell-main', text: KL.date(p.paid_at) }),
        el('td', { attrs: { 'data-label': 'Időszak' }, text: p.period_label || '–' }),
        el('td', { attrs: { 'data-label': 'Megjegyzés' }, text: p.note || '–' }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Összeg' }, text: KL.ft(p.amount) })
      ]));
    });
    box.appendChild(el('div', { 'class': 'tbl-wrap' }, [
      el('table', { 'class': 'tbl' }, [
        el('caption', { 'class': 'sr-only', text: 'Kifizetéseim' }),
        el('thead', {}, [el('tr', {}, [
          el('th', { attrs: { scope: 'col' }, text: 'Dátum' }),
          el('th', { attrs: { scope: 'col' }, text: 'Időszak' }),
          el('th', { attrs: { scope: 'col' }, text: 'Megjegyzés' }),
          el('th', { 'class': 'r', attrs: { scope: 'col' }, text: 'Összeg' })
        ])]),
        tbody
      ])
    ]));
  }

  /* ---------------- Szabályzat elfogadása ---------------- */
  $('#gate-btn').addEventListener('click', function (e) {
    var msg = $('#gate-msg');
    if (!$('#gate-check').checked) { KL.say(msg, 'Előbb pipáld be a nyilatkozatot.', 'err'); $('#gate-check').focus(); return; }
    var btn = e.currentTarget;
    KL.busy(btn, true, 'Mentés…');
    KL.q(sb.rpc('accept_rules')).then(function () {
      return KL.loadProfile(S.uid);
    }).then(function (p) {
      S.profile = p;
      KL.busy(btn, false);
      renderHeader();
      renderCampaigns();
      KL.toast('Köszönjük! Most már jelentkezhetsz kampányokra.');
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });

  /* ---------------- Klip beküldése ---------------- */
  $('#clip-platform').addEventListener('change', function () {
    var ph = { tiktok: 'https://www.tiktok.com/@fiokod/video/…', instagram: 'https://www.instagram.com/reel/…', youtube: 'https://www.youtube.com/shorts/…' };
    $('#clip-url').placeholder = ph[this.value] || '';
  });
  $('#clip-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#clip-msg');
    var campaignId = $('#clip-campaign').value;
    var platform = $('#clip-platform').value;
    var urlInput = $('#clip-url');
    var url = urlInput.value.trim();
    urlInput.removeAttribute('aria-invalid');
    if (!campaignId) { KL.say(msg, 'Válassz kampányt.', 'err'); return; }
    if (!/^https:\/\/\S+$/.test(url) || url.length > 500) {
      urlInput.setAttribute('aria-invalid', 'true');
      KL.say(msg, 'A link https:// kezdetű legyen, szóköz nélkül.', 'err');
      urlInput.focus();
      return;
    }
    if (!KL.PLATFORM_RE[platform].test(url)) {
      urlInput.setAttribute('aria-invalid', 'true');
      KL.say(msg, 'Ez a link nem ' + KL.PLATFORMS[platform] + ' link. Ellenőrizd a platformot vagy a linket.', 'err');
      urlInput.focus();
      return;
    }
    var btn = $('#clip-submit');
    KL.busy(btn, true, 'Beküldés…');
    KL.q(sb.from('clips').insert({ campaign_id: campaignId, clipper_id: S.uid, platform: platform, post_url: url })).then(function () {
      KL.busy(btn, false);
      urlInput.value = '';
      KL.say(msg, 'Beküldve! Ellenőrzés után itt látod az állapotát. Ne felejtsd el hetente feltölteni a statisztikát.', 'ok');
      return reload();
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });

  /* ---------------- Heti statisztika ---------------- */
  var dlg = $('#stat-dialog');
  function openStat(clip) {
    statClip = clip;
    $('#stat-form').reset();
    KL.say($('#stat-msg'), '', 'info');
    $('#stat-views').removeAttribute('aria-invalid');
    $('#stat-file').removeAttribute('aria-invalid');
    $('#stat-clip').textContent = (KL.PLATFORMS[clip.platform] || '') + ' · beküldve ' + KL.date(clip.created_at);
    if (typeof dlg.showModal === 'function') { dlg.showModal(); } else { dlg.setAttribute('open', ''); }
    $('#stat-views').focus();
  }
  function closeStat() {
    statClip = null;
    if (typeof dlg.close === 'function') { dlg.close(); } else { dlg.removeAttribute('open'); }
  }
  $('#stat-close').addEventListener('click', closeStat);
  $('#stat-cancel').addEventListener('click', closeStat);

  $('#stat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!statClip) { return; }
    var msg = $('#stat-msg');
    var viewsInput = $('#stat-views'), fileInput = $('#stat-file');
    var views = Number(viewsInput.value);
    viewsInput.removeAttribute('aria-invalid');
    fileInput.removeAttribute('aria-invalid');
    if (viewsInput.value === '' || !Number.isInteger(views) || views < 0 || views > 2000000000) {
      viewsInput.setAttribute('aria-invalid', 'true');
      KL.say(msg, 'Add meg a megtekintések számát egész számként.', 'err');
      viewsInput.focus();
      return;
    }
    var file = fileInput.files && fileInput.files[0];
    if (!file) { fileInput.setAttribute('aria-invalid', 'true'); KL.say(msg, 'Válaszd ki a képernyőképet.', 'err'); fileInput.focus(); return; }
    if (!EXT[file.type]) { fileInput.setAttribute('aria-invalid', 'true'); KL.say(msg, 'Csak PNG, JPG vagy WEBP képet tölthetsz fel.', 'err'); fileInput.focus(); return; }
    if (file.size > MAX_FILE) { fileInput.setAttribute('aria-invalid', 'true'); KL.say(msg, 'A kép túl nagy (legfeljebb 5 MB lehet).', 'err'); fileInput.focus(); return; }

    var clip = statClip;
    var path = S.uid + '/' + clip.id + '/' + Date.now() + '.' + EXT[file.type];
    var btn = $('#stat-submit');
    KL.busy(btn, true, 'Feltöltés…');
    KL.say(msg, 'Kép feltöltése…', 'info');
    sb.storage.from('screenshots').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' }).then(function (res) {
      if (res.error) { throw res.error; }
      return KL.q(sb.from('clip_stats').insert({ clip_id: clip.id, views: views, screenshot_path: path }));
    }).then(function () {
      KL.busy(btn, false);
      closeStat();
      KL.toast('Statisztika elküldve. Köszi!');
      return reload();
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });

  /* ---------------- Profil ---------------- */
  $('#profile-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#profile-msg');
    var fields = [['#pf-tiktok', 'TikTok'], ['#pf-instagram', 'Instagram'], ['#pf-youtube', 'YouTube']];
    var bad = null;
    fields.forEach(function (f) {
      var input = $(f[0]);
      var v = input.value.trim();
      input.removeAttribute('aria-invalid');
      if (v && (!/^https:\/\/\S+$/.test(v) || v.length > 300)) { input.setAttribute('aria-invalid', 'true'); if (!bad) { bad = f; } }
    });
    if (bad) { KL.say(msg, 'A(z) ' + bad[1] + ' link https:// kezdetű legyen.', 'err'); $(bad[0]).focus(); return; }
    var upd = {
      full_name: $('#pf-name').value.trim() || null,
      tiktok_url: $('#pf-tiktok').value.trim() || null,
      instagram_url: $('#pf-instagram').value.trim() || null,
      youtube_url: $('#pf-youtube').value.trim() || null,
      payout_name: $('#pf-payout').value.trim() || null
    };
    var btn = e.submitter || $('#profile-form button[type="submit"]');
    KL.busy(btn, true, 'Mentés…');
    KL.q(sb.from('profiles').update(upd).eq('id', S.uid)).then(function () {
      return KL.loadProfile(S.uid);
    }).then(function (p) {
      KL.busy(btn, false);
      if (p) { S.profile = p; renderHeader(); }
      KL.say(msg, 'Mentve.', 'ok');
    }).catch(function (err) {
      KL.busy(btn, false);
      KL.say(msg, KL.errorText(err), 'err');
    });
  });
})();
