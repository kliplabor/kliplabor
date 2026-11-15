/* Admin felület */
(function () {
  'use strict';
  var KL = window.KL, $ = KL.$, el = KL.el;
  var sb = KL.client();
  var TABS = ['attekintes', 'klipek', 'kampanyok', 'clipperek', 'kifizetesek', 'streamerek'];
  var D = { profiles: [], campaigns: [], clips: [], stats: [], earnings: {}, balances: [], usage: [], payouts: [], apps: [], settings: { viral_bonus: 5000, viral_threshold: 100000 } };
  var signedCache = {};

  function fail(err) {
    $('#page-loading').hidden = true;
    KL.say($('#page-msg'), typeof err === 'string' ? err : KL.errorText(err), 'err');
  }
  if (!sb) { fail(KL.NO_CLIENT); return; }

  KL.requireSession('admin.html').then(function (session) {
    if (!session) { return; }
    return KL.loadProfile(session.user.id).then(function (p) {
      $('#nav-user').textContent = (p && p.full_name) || '';
      if (!p || p.role !== 'admin') {
        // Nem admin: adatot nem kérünk le, csak egy udvarias üzenetet mutatunk.
        $('#page-loading').hidden = true;
        $('#no-access').hidden = false;
        return;
      }
      return loadAll().then(function () {
        $('#page-loading').hidden = true;
        $('#app').hidden = false;
        showTab((window.location.hash || '').slice(1));
      });
    });
  }).catch(fail);

  function byId(list, id) { for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } } return null; }
  function profileName(id) { var p = byId(D.profiles, id); return p ? (p.full_name || 'Név nélkül') : 'Ismeretlen'; }
  function campaignTitle(id) { var c = byId(D.campaigns, id); return c ? c.title : 'Ismeretlen kampány'; }

  function loadAll() {
    return Promise.all([
      KL.q(sb.from('profiles').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('campaigns').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('clips').select('*').order('created_at', { ascending: true })),
      KL.q(sb.from('clip_stats').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('clip_earnings').select('*')),
      KL.q(sb.from('clipper_balances').select('*')),
      KL.q(sb.from('campaign_usage').select('*')),
      KL.q(sb.from('payouts').select('*').order('paid_at', { ascending: false })),
      KL.q(sb.from('streamer_applications').select('*').order('created_at', { ascending: false })),
      KL.q(sb.from('app_settings').select('*').maybeSingle())
    ]).then(function (r) {
      D.profiles = r[0] || [];
      D.campaigns = r[1] || [];
      D.clips = r[2] || [];
      D.stats = r[3] || [];
      D.earnings = {};
      (r[4] || []).forEach(function (e) { D.earnings[e.clip_id] = e; });
      D.balances = r[5] || [];
      D.usage = r[6] || [];
      D.payouts = r[7] || [];
      D.apps = r[8] || [];
      if (r[9]) { D.settings = r[9]; }
      renderAll();
    });
  }
  function reload() { return loadAll().catch(function (err) { KL.toast(KL.errorText(err), 'err'); }); }

  /* ---------------- Fülek ---------------- */
  function showTab(name, focus) {
    if (TABS.indexOf(name) === -1) { name = 'attekintes'; }
    TABS.forEach(function (t) {
      var on = t === name;
      var tab = $('#tab-' + t);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('#panel-' + t).hidden = !on;
    });
    if (focus) { $('#tab-' + name).focus(); }
    if (name === 'klipek') { loadVisibleShots(); }
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

  function renderAll() {
    renderOverview();
    renderCampaignFilter();
    renderClips();
    renderCampaigns();
    renderClippers();
    renderPayouts();
    renderApps();
    var pending = D.clips.filter(function (c) { return c.status === 'bekuldve'; }).length;
    $('#count-pending').textContent = pending ? String(pending) : '';
    var newApps = D.apps.filter(function (a) { return a.status === 'uj'; }).length;
    $('#count-apps').textContent = newApps ? String(newApps) : '';
  }

  function stat(label, value, accent) {
    return el('div', { 'class': 'stat' + (accent ? ' stat-accent' : '') }, [
      el('p', { 'class': 'stat-label', text: label }),
      el('p', { 'class': 'stat-value num', text: value })
    ]);
  }

  /* ---------------- Áttekintés ---------------- */
  function renderOverview() {
    var owed = D.balances.reduce(function (s, b) { return s + Math.max(0, Number(b.owed) || 0); }, 0);
    var pending = D.clips.filter(function (c) { return c.status === 'bekuldve'; }).length;
    var active = D.campaigns.filter(function (c) { return c.status === 'aktiv'; }).length;
    var newApps = D.apps.filter(function (a) { return a.status === 'uj'; }).length;
    var box = KL.clear($('#ov-stats'));
    box.appendChild(stat('Clippereknek kifizetésre vár', KL.ft(owed), true));
    box.appendChild(stat('Ellenőrzésre váró klip', KL.fmt(pending)));
    box.appendChild(stat('Aktív kampány', KL.fmt(active)));
    box.appendChild(stat('Új streamer jelentkezés', KL.fmt(newApps)));
    box.querySelector('.stat').setAttribute('id', 'ov-owed');

    var list = KL.clear($('#ov-campaigns'));
    if (!D.usage.length) { list.appendChild(el('p', { 'class': 'empty', text: 'Még nincs kampány. A Kampányok fülön hozhatsz létre egyet.' })); return; }
    D.usage.forEach(function (u) { list.appendChild(usageCard(u)); });
  }

  function usageCard(u) {
    var pct = u.budget > 0 ? Math.round(u.used_budget / u.budget * 100) : 0;
    var barCls = 'bar' + (pct >= 100 ? ' bar-over' : pct >= 80 ? ' bar-warn' : '');
    var warn = null;
    if (pct >= 100 && u.status === 'aktiv') {
      warn = el('p', { 'class': 'msg msg-err', text: 'A keret elfogyott. Állítsd szünetelőre vagy zárd le a kampányt, és értesítsd a clippereket és a tartalomgyártót.' });
    } else if (pct >= 80 && u.status === 'aktiv') {
      warn = el('p', { 'class': 'msg msg-warn', text: 'A keret 80% fölött jár. Küldd ki az értesítéseket.' });
    }
    return el('article', { 'class': 'card card-tight stack', attrs: { 'data-usage': u.campaign_id } }, [
      el('div', { 'class': 'usage-head' }, [
        el('div', {}, [el('h3', { 'class': 'h-card', text: u.title }), el('p', { 'class': 'meta', text: u.creator_name })]),
        KL.badge(KL.CAMPAIGN_STATUS, u.status)
      ]),
      el('div', {}, [
        el('div', { 'class': barCls, attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(pct, 100)), 'aria-label': 'Keret felhasználás' } },
          [el('span', { attrs: { style: 'width:' + Math.min(pct, 100) + '%' } })]),
        el('p', { 'class': 'hint', attrs: { style: 'margin-top:6px' }, text: KL.ft(u.used_budget) + ' / ' + KL.ft(u.budget) + ' (' + pct + '%)' })
      ]),
      el('dl', { 'class': 'kv' }, [
        el('dt', { text: 'Hátralévő keret' }), el('dd', { 'class': 'num', attrs: { 'data-k': 'remaining' }, text: KL.ft(u.remaining_budget) }),
        el('dt', { text: 'Hitelesített megtekintés' }), el('dd', { 'class': 'num', text: KL.fmt(u.verified_views) }),
        el('dt', { text: 'Jóváhagyott / váró klip' }), el('dd', { 'class': 'num', text: KL.fmt(u.approved_clips) + ' / ' + KL.fmt(u.pending_clips) }),
        el('dt', { text: 'Számlázható (keretig)' }), el('dd', { 'class': 'num', text: KL.ft(u.billable_budget) }),
        el('dt', { text: 'Kezelési díj' }), el('dd', { 'class': 'num', text: KL.ft(u.management_fee) }),
        el('dt', { text: 'Clipper költség (bónusszal)' }), el('dd', { 'class': 'num', attrs: { 'data-k': 'cost' }, text: KL.ft(u.clipper_cost) }),
        el('dt', { text: 'Árrés (adók előtt)' }), el('dd', { 'class': 'num', attrs: { 'data-k': 'margin' }, text: KL.ft(u.margin) })
      ]),
      warn
    ]);
  }

  /* ---------------- Klipek ellenőrzése ---------------- */
  function renderCampaignFilter() {
    var sel = $('#f-campaign');
    var cur = sel.value;
    KL.clear(sel);
    sel.appendChild(el('option', { text: 'Minden kampány', attrs: { value: '' } }));
    D.campaigns.forEach(function (c) { sel.appendChild(el('option', { text: c.title, attrs: { value: c.id } })); });
    sel.value = cur && byId(D.campaigns, cur) ? cur : '';
  }
  $('#f-status').addEventListener('change', function () { renderClips(); loadVisibleShots(); });
  $('#f-campaign').addEventListener('change', function () { renderClips(); loadVisibleShots(); });

  function earningsPreview(clip, views) {
    var c = byId(D.campaigns, clip.campaign_id);
    var rate = c ? c.clipper_rate : 150;
    var base = Math.floor(views * rate / 1000);
    var bonus = views >= D.settings.viral_threshold ? D.settings.viral_bonus : 0;
    return 'Kereset: ' + KL.ft(base) + (bonus ? ' + ' + KL.ft(bonus) + ' bónusz = ' + KL.ft(base + bonus) : '');
  }

  function renderClips() {
    var status = $('#f-status').value;
    var camp = $('#f-campaign').value;
    var list = D.clips.filter(function (c) { return (!status || c.status === status) && (!camp || c.campaign_id === camp); });
    $('#clips-count').textContent = list.length + ' klip';
    var box = KL.clear($('#clips-list'));
    if (!list.length) { box.appendChild(el('p', { 'class': 'empty', text: 'Nincs ilyen klip.' })); return; }
    list.forEach(function (clip) { box.appendChild(clipCard(clip)); });
  }

  function clipCard(clip) {
    var stats = D.stats.filter(function (s) { return s.clip_id === clip.id; });
    var latest = stats[0] || null;
    var e = D.earnings[clip.id];
    var idp = 'c-' + clip.id;

    var shotBox = el('div', { 'class': 'shot-box' }, [
      latest ? el('div', { 'class': 'shot-empty', attrs: { 'data-shot': latest.screenshot_path }, text: 'Képernyőkép betöltése…' })
             : el('div', { 'class': 'shot-empty', text: 'Még nincs heti statisztika.' })
    ]);

    var hist = null;
    if (stats.length) {
      hist = el('ul', { 'class': 'hist', attrs: { 'aria-label': 'Statisztika előzmények' } });
      stats.forEach(function (s, i) {
        hist.appendChild(el('li', {}, [el('button', {
          attrs: { type: 'button', 'aria-pressed': i === 0 ? 'true' : 'false' },
          on: { click: function (ev) {
            KL.$$('button', hist).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
            ev.currentTarget.setAttribute('aria-pressed', 'true');
            showShot(shotBox, s.screenshot_path);
          } }
        }, [el('span', { text: KL.dateTime(s.created_at) }), el('span', { 'class': 'num', text: KL.views(s.views) })])]));
      });
    }

    var viewsInput = el('input', { 'class': 'input', attrs: { id: idp + '-views', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: String(clip.status === 'jovahagyva' ? clip.verified_views : (latest ? latest.views : 0)) } });
    var preview = el('p', { 'class': 'preview', attrs: { 'aria-live': 'polite' } });
    function upd() { var v = Math.max(0, Math.floor(Number(viewsInput.value) || 0)); preview.textContent = earningsPreview(clip, v); }
    viewsInput.addEventListener('input', upd);
    upd();
    var reasonInput = el('input', { 'class': 'input', attrs: { id: idp + '-reason', type: 'text', maxlength: '1000', value: clip.reject_reason || '', placeholder: 'pl. Nincs saját felirat' } });
    var msg = el('div', { 'class': 'msg', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });

    var approveBtn = el('button', { 'class': 'btn btn-accent btn-sm', text: clip.status === 'jovahagyva' ? 'Megtekintés frissítése' : 'Jóváhagyom', attrs: { type: 'button', 'data-approve': clip.id } });
    var rejectBtn = el('button', { 'class': 'btn btn-danger btn-sm', text: 'Elutasítom', attrs: { type: 'button', 'data-reject': clip.id } });

    approveBtn.addEventListener('click', function () {
      var raw = viewsInput.value.trim();
      var v = Number(raw);
      viewsInput.removeAttribute('aria-invalid');
      if (raw === '' || !Number.isInteger(v) || v < 0) {
        viewsInput.setAttribute('aria-invalid', 'true');
        KL.say(msg, 'Adj meg egy nem negatív egész számot.', 'err');
        viewsInput.focus();
        return;
      }
      if (latest && v > latest.views) {
        KL.say(msg, 'Figyelem: többet adtál meg, mint a legutóbbi képernyőképen (' + KL.fmt(latest.views) + '). Ha ez szándékos, rendben.', 'warn');
      }
      KL.busy(approveBtn, true, 'Mentés…');
      KL.q(sb.from('clips').update({ status: 'jovahagyva', verified_views: v, reject_reason: null, reviewed_at: new Date().toISOString() }).eq('id', clip.id)).then(function () {
        KL.toast('Jóváhagyva: ' + KL.views(v) + '. ' + earningsPreview(clip, v));
        return reload();
      }).then(loadVisibleShots).catch(function (err) { KL.busy(approveBtn, false); KL.say(msg, KL.errorText(err), 'err'); });
    });
    rejectBtn.addEventListener('click', function () {
      var reason = reasonInput.value.trim();
      reasonInput.removeAttribute('aria-invalid');
      if (reason.length < 3) {
        reasonInput.setAttribute('aria-invalid', 'true');
        KL.say(msg, 'Írd be az elutasítás okát (a clipper is látja).', 'err');
        reasonInput.focus();
        return;
      }
      KL.busy(rejectBtn, true, 'Mentés…');
      KL.q(sb.from('clips').update({ status: 'elutasitva', reject_reason: reason, reviewed_at: new Date().toISOString() }).eq('id', clip.id)).then(function () {
        KL.toast('Klip elutasítva.');
        return reload();
      }).then(loadVisibleShots).catch(function (err) { KL.busy(rejectBtn, false); KL.say(msg, KL.errorText(err), 'err'); });
    });

    var p = byId(D.profiles, clip.clipper_id);
    return el('article', { 'class': 'card card-tight', attrs: { 'data-clip': clip.id } }, [
      el('div', { 'class': 'clip-card' }, [
        el('div', { 'class': 'stack' }, [
          el('div', { 'class': 'usage-head' }, [
            el('div', {}, [
              el('h3', { 'class': 'h-card' }, [KL.extLink(clip.post_url, (KL.PLATFORMS[clip.platform] || clip.platform) + ' klip megnyitása')]),
              el('p', { 'class': 'meta' }, [
                el('span', { text: profileName(clip.clipper_id) }),
                el('span', { text: campaignTitle(clip.campaign_id) }),
                el('span', { text: 'Beküldve: ' + KL.dateTime(clip.created_at) })
              ])
            ]),
            KL.badge(KL.CLIP_STATUS, clip.status)
          ]),
          el('p', { 'class': 'hint pre', text: clip.post_url }),
          el('dl', { 'class': 'kv' }, [
            el('dt', { text: 'Clipper fiókjai' }), el('dd', {}, [
              p && p.tiktok_url ? KL.extLink(p.tiktok_url, 'TikTok') : null, p && p.tiktok_url ? ' ' : null,
              p && p.instagram_url ? KL.extLink(p.instagram_url, 'Instagram') : null, p && p.instagram_url ? ' ' : null,
              p && p.youtube_url ? KL.extLink(p.youtube_url, 'YouTube') : null,
              !(p && (p.tiktok_url || p.instagram_url || p.youtube_url)) ? '–' : null
            ]),
            el('dt', { text: 'Hitelesített megtekintés' }), el('dd', { 'class': 'num', text: KL.fmt(clip.verified_views) }),
            el('dt', { text: 'Kereset most' }), el('dd', { 'class': 'num', text: e ? KL.ft(e.total_amount) : KL.ft(0) }),
            el('dt', { text: 'Utolsó döntés' }), el('dd', { text: KL.dateTime(clip.reviewed_at) })
          ]),
          clip.status === 'elutasitva' && clip.reject_reason ? el('p', { 'class': 'msg msg-err', text: 'Elutasítás oka: ' + clip.reject_reason }) : null,
          hist ? el('div', { 'class': 'stack' }, [el('p', { 'class': 'fld-label', text: 'Statisztika előzmények' }), hist]) : null,
          el('div', { 'class': 'review' }, [
            el('div', { 'class': 'fld' }, [
              el('label', { text: 'Hitelesített megtekintés', attrs: { 'for': idp + '-views' } }),
              viewsInput, preview, approveBtn
            ]),
            el('div', { 'class': 'fld' }, [
              el('label', { text: 'Elutasítás oka', attrs: { 'for': idp + '-reason' } }),
              reasonInput, el('p', { 'class': 'preview', text: 'A clipper látja az okot.' }), rejectBtn
            ])
          ]),
          msg
        ]),
        shotBox
      ])
    ]);
  }

  function showShot(box, path) {
    KL.clear(box);
    var ph = el('div', { 'class': 'shot-empty', attrs: { 'data-shot': path }, text: 'Képernyőkép betöltése…' });
    box.appendChild(ph);
    loadShot(ph);
  }
  function loadShot(ph) {
    var path = ph.getAttribute('data-shot');
    ph.removeAttribute('data-shot');
    var cached = signedCache[path];
    var p = cached && cached.exp > Date.now() ? Promise.resolve(cached.url)
      : sb.storage.from('screenshots').createSignedUrl(path, 600).then(function (res) {
        if (res.error) { throw res.error; }
        var u = KL.safeUrl(res.data && res.data.signedUrl);
        if (!u) { throw new Error('Érvénytelen link'); }
        signedCache[path] = { url: u, exp: Date.now() + 540000 };
        return u;
      });
    p.then(function (url) {
      var img = el('img', { 'class': 'shot', attrs: { src: url, alt: 'A clipper által feltöltött statisztika képernyőkép', loading: 'lazy' } });
      var link = el('a', { text: 'Megnyitás teljes méretben', attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } });
      ph.replaceWith(el('div', { 'class': 'stack' }, [img, link]));
    }).catch(function (err) {
      ph.textContent = 'A képet nem sikerült betölteni. ' + KL.errorText(err);
    });
  }
  function loadVisibleShots() {
    if ($('#panel-klipek').hidden) { return; }
    KL.$$('#clips-list [data-shot]').forEach(loadShot);
  }

  /* ---------------- Kampányok ---------------- */
  function fillCampaignForm(c) {
    $('#cf-id').value = c ? c.id : '';
    $('#cf-title').value = c ? c.title : '';
    $('#cf-creator').value = c ? c.creator_name : '';
    $('#cf-platform').value = c ? (c.creator_platform || '') : '';
    $('#cf-desc').value = c ? (c.description || '') : '';
    $('#cf-rules').value = c ? (c.rules || '') : '';
    $('#cf-crate').value = c ? c.clipper_rate : 150;
    $('#cf-srate').value = c ? c.creator_rate : 300;
    $('#cf-fee').value = c ? (c.management_fee === null ? '' : c.management_fee) : 30000;
    $('#cf-budget').value = c ? c.budget : '';
    $('#cf-start').value = c ? (c.starts_on || '') : '';
    $('#cf-end').value = c ? (c.ends_on || '') : '';
    $('#cf-status').value = c ? c.status : 'aktiv';
    $('#camp-form-title').textContent = c ? 'Kampány szerkesztése' : 'Új kampány';
    $('#camp-save').textContent = c ? 'Változások mentése' : 'Kampány létrehozása';
    $('#camp-new').hidden = !c;
    KL.say($('#camp-msg'), '', 'info');
    KL.$$('#camp-form [aria-invalid]').forEach(function (i) { i.removeAttribute('aria-invalid'); });
  }
  $('#camp-new').addEventListener('click', function () { fillCampaignForm(null); $('#cf-title').focus(); });

  $('#camp-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#camp-msg');
    KL.$$('#camp-form [aria-invalid]').forEach(function (i) { i.removeAttribute('aria-invalid'); });
    function bad(sel, text) { $(sel).setAttribute('aria-invalid', 'true'); KL.say(msg, text, 'err'); $(sel).focus(); }
    function int(sel) { var v = $(sel).value.trim(); return v === '' ? null : Number(v); }
    var title = $('#cf-title').value.trim(), creator = $('#cf-creator').value.trim();
    if (title.length < 2) { return bad('#cf-title', 'Add meg a kampány nevét.'); }
    if (!creator) { return bad('#cf-creator', 'Add meg a tartalomgyártó nevét.'); }
    var crate = int('#cf-crate'), srate = int('#cf-srate'), fee = int('#cf-fee'), budget = int('#cf-budget');
    if (crate === null || !Number.isInteger(crate) || crate < 0) { return bad('#cf-crate', 'A clipper díj nem negatív egész szám legyen.'); }
    if (srate === null || !Number.isInteger(srate) || srate < 0) { return bad('#cf-srate', 'A streamer díj nem negatív egész szám legyen.'); }
    if (fee !== null && (!Number.isInteger(fee) || fee < 0)) { return bad('#cf-fee', 'A kezelési díj nem negatív egész szám legyen.'); }
    if (budget === null || !Number.isInteger(budget) || budget <= 0) { return bad('#cf-budget', 'A keret pozitív egész szám legyen (forintban).'); }
    var start = $('#cf-start').value || null, end = $('#cf-end').value || null;
    if (start && end && end < start) { return bad('#cf-end', 'A vége nem lehet korábban, mint a kezdete.'); }
    var row = {
      title: title, creator_name: creator, creator_platform: $('#cf-platform').value.trim() || null,
      description: $('#cf-desc').value.trim() || null, rules: $('#cf-rules').value.trim() || null,
      clipper_rate: crate, creator_rate: srate, management_fee: fee, budget: budget,
      starts_on: start, ends_on: end, status: $('#cf-status').value
    };
    var id = $('#cf-id').value;
    var btn = $('#camp-save');
    KL.busy(btn, true, 'Mentés…');
    var op = id ? sb.from('campaigns').update(row).eq('id', id) : sb.from('campaigns').insert(row);
    KL.q(op).then(function () {
      KL.busy(btn, false);
      KL.toast(id ? 'Kampány mentve.' : 'Kampány létrehozva.');
      fillCampaignForm(null);
      return reload();
    }).catch(function (err) { KL.busy(btn, false); KL.say(msg, KL.errorText(err), 'err'); });
  });

  function setCampaignStatus(c, status, btn) {
    if (status === 'lezart' && !window.confirm('Biztosan lezárod a(z) „' + c.title + '” kampányt? Lezárás után új klipet nem lehet beküldeni.')) { return; }
    KL.busy(btn, true, 'Mentés…');
    KL.q(sb.from('campaigns').update({ status: status }).eq('id', c.id)).then(function () {
      KL.toast('Kampány állapota: ' + KL.CAMPAIGN_STATUS[status].label + '.');
      return reload();
    }).catch(function (err) { KL.busy(btn, false); KL.toast(KL.errorText(err), 'err'); });
  }

  function renderCampaigns() {
    var box = KL.clear($('#camp-list'));
    if (!D.campaigns.length) { box.appendChild(el('p', { 'class': 'empty', text: 'Még nincs kampány.' })); return; }
    D.campaigns.forEach(function (c) {
      var members = D.clips.filter(function (x) { return x.campaign_id === c.id; }).length;
      var actions = [el('button', { 'class': 'btn btn-ghost btn-sm', text: 'Szerkesztés', attrs: { type: 'button' }, on: { click: function () { fillCampaignForm(c); $('#camp-form').scrollIntoView({ block: 'start' }); $('#cf-title').focus(); } } })];
      if (c.status === 'aktiv') { actions.push(el('button', { 'class': 'btn btn-ghost btn-sm', text: 'Szüneteltetés', attrs: { type: 'button' }, on: { click: function (e) { setCampaignStatus(c, 'szunetel', e.currentTarget); } } })); }
      if (c.status === 'szunetel') { actions.push(el('button', { 'class': 'btn btn-ghost btn-sm', text: 'Folytatás', attrs: { type: 'button' }, on: { click: function (e) { setCampaignStatus(c, 'aktiv', e.currentTarget); } } })); }
      if (c.status !== 'lezart') { actions.push(el('button', { 'class': 'btn btn-danger btn-sm', text: 'Lezárás', attrs: { type: 'button' }, on: { click: function (e) { setCampaignStatus(c, 'lezart', e.currentTarget); } } })); }
      box.appendChild(el('article', { 'class': 'card card-tight stack', attrs: { 'data-campaign': c.id } }, [
        el('div', { 'class': 'usage-head' }, [
          el('div', {}, [
            el('h3', { 'class': 'h-card', text: c.title }),
            el('p', { 'class': 'meta' }, [
              el('span', { text: c.creator_name + (c.creator_platform ? ' · ' + c.creator_platform : '') }),
              el('span', { text: (c.starts_on || c.ends_on) ? KL.date(c.starts_on) + ' – ' + KL.date(c.ends_on) : 'Nincs dátum' }),
              el('span', { text: members + ' klip' })
            ])
          ]),
          KL.badge(KL.CAMPAIGN_STATUS, c.status)
        ]),
        el('p', { 'class': 'meta', text: 'Clipper ' + KL.ft(c.clipper_rate) + ' · streamer ' + KL.ft(c.creator_rate) + ' / 1000 megtekintés · keret ' + KL.ft(c.budget) + ' · kezelési díj ' + KL.ft(c.management_fee || 0) }),
        el('div', { 'class': 'btn-row' }, actions)
      ]));
    });
  }

  /* ---------------- Clipperek ---------------- */
  function balanceOf(id) {
    for (var i = 0; i < D.balances.length; i++) { if (D.balances[i].clipper_id === id) { return D.balances[i]; } }
    return { approved_views: 0, earned: 0, paid: 0, owed: 0 };
  }
  function renderClippers() {
    var box = KL.clear($('#clippers-list'));
    var list = D.profiles;
    if (!list.length) { box.appendChild(el('p', { 'class': 'empty', text: 'Még nincs regisztrált clipper.' })); return; }
    var tbody = el('tbody');
    list.forEach(function (p) {
      var b = balanceOf(p.id);
      var socials = el('div', { 'class': 'stack-r' }, [
        p.tiktok_url ? KL.extLink(p.tiktok_url, 'TikTok') : null,
        p.instagram_url ? KL.extLink(p.instagram_url, 'Instagram') : null,
        p.youtube_url ? KL.extLink(p.youtube_url, 'YouTube') : null,
        !(p.tiktok_url || p.instagram_url || p.youtube_url) ? el('span', { 'class': 'muted', text: 'nincs megadva' }) : null
      ]);
      tbody.appendChild(el('tr', { attrs: { 'data-clipper': p.id } }, [
        el('td', { 'class': 'cell-main' }, [
          el('span', { text: p.full_name || 'Név nélkül' }),
          p.role === 'admin' ? el('span', { 'class': 'sub', text: 'admin' }) : null,
          el('span', { 'class': 'sub', text: 'Regisztrált: ' + KL.date(p.created_at) })
        ]),
        el('td', { attrs: { 'data-label': 'Fiókok' } }, [socials]),
        el('td', { attrs: { 'data-label': 'Számlatulajdonos' }, text: p.payout_name || '–' }),
        el('td', { attrs: { 'data-label': '18+ / szabályzat' }, text: (p.adult_confirmed ? 'igen' : 'nem') + ' / ' + (p.rules_accepted_at ? KL.date(p.rules_accepted_at) : 'nem fogadta el') }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Jóváhagyott megtekintés' }, text: KL.fmt(b.approved_views) }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Kereset' }, text: KL.ft(b.earned) }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Kifizetve' }, text: KL.ft(b.paid) }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Kifizetésre vár' }, text: KL.ft(b.owed) })
      ]));
    });
    box.appendChild(el('div', { 'class': 'tbl-wrap' }, [el('table', { 'class': 'tbl' }, [
      el('caption', { 'class': 'sr-only', text: 'Clipperek' }),
      el('thead', {}, [el('tr', {}, ['Név', 'Fiókok', 'Számlatulajdonos', '18+ / szabályzat', 'Jóváhagyott megtekintés', 'Kereset', 'Kifizetve', 'Kifizetésre vár'].map(function (h, i) {
        return el('th', { 'class': i >= 4 ? 'r' : null, attrs: { scope: 'col' }, text: h });
      }))]),
      tbody
    ])]));
  }

  /* ---------------- Kifizetések ---------------- */
  function renderPayouts() {
    var box = KL.clear($('#owed-list'));
    var owed = D.balances.filter(function (b) { return Number(b.owed) > 0; }).sort(function (a, b) { return b.owed - a.owed; });
    if (!owed.length) { box.appendChild(el('p', { 'class': 'empty', text: 'Most senkinek nem tartozol.' })); }
    owed.forEach(function (b) { box.appendChild(owedCard(b)); });

    var hist = KL.clear($('#payout-history'));
    if (!D.payouts.length) { hist.appendChild(el('p', { 'class': 'empty', text: 'Még nincs rögzített kifizetés.' })); return; }
    var tbody = el('tbody');
    D.payouts.forEach(function (p) {
      tbody.appendChild(el('tr', {}, [
        el('td', { 'class': 'cell-main' }, [el('span', { text: profileName(p.clipper_id) }), el('span', { 'class': 'sub', text: KL.date(p.paid_at) })]),
        el('td', { attrs: { 'data-label': 'Időszak' }, text: p.period_label || '–' }),
        el('td', { attrs: { 'data-label': 'Megjegyzés' }, text: p.note || '–' }),
        el('td', { 'class': 'r num', attrs: { 'data-label': 'Összeg' }, text: KL.ft(p.amount) })
      ]));
    });
    hist.appendChild(el('div', { 'class': 'tbl-wrap' }, [el('table', { 'class': 'tbl' }, [
      el('caption', { 'class': 'sr-only', text: 'Kifizetések története' }),
      el('thead', {}, [el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Clipper, dátum' }),
        el('th', { attrs: { scope: 'col' }, text: 'Időszak' }),
        el('th', { attrs: { scope: 'col' }, text: 'Megjegyzés' }),
        el('th', { 'class': 'r', attrs: { scope: 'col' }, text: 'Összeg' })
      ])]),
      tbody
    ])]));
  }

  function owedCard(b) {
    var p = byId(D.profiles, b.clipper_id) || {};
    var idp = 'p-' + b.clipper_id;
    var today = new Date();
    var form = el('form', { 'class': 'form pay-form', attrs: { hidden: true, novalidate: true } });
    var amount = el('input', { 'class': 'input', attrs: { id: idp + '-amount', type: 'number', min: '1', step: '1', value: String(b.owed), required: true } });
    var period = el('input', { 'class': 'input', attrs: { id: idp + '-period', type: 'text', maxlength: '120', value: KL.date(today) + '-i kör' } });
    var paidAt = el('input', { 'class': 'input', attrs: { id: idp + '-date', type: 'date', value: KL.isoDate(today) } });
    var note = el('input', { 'class': 'input', attrs: { id: idp + '-note', type: 'text', maxlength: '1000', placeholder: 'pl. utalás közleménye' } });
    var msg = el('div', { 'class': 'msg', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
    var save = el('button', { 'class': 'btn btn-accent btn-sm', text: 'Rögzítem a kifizetést', attrs: { type: 'submit' } });
    [
      el('div', { 'class': 'form-row' }, [
        el('div', { 'class': 'fld' }, [el('label', { text: 'Összeg (Ft)', attrs: { 'for': idp + '-amount' } }), amount]),
        el('div', { 'class': 'fld' }, [el('label', { text: 'Utalás napja', attrs: { 'for': idp + '-date' } }), paidAt]),
        el('div', { 'class': 'fld' }, [el('label', { text: 'Időszak', attrs: { 'for': idp + '-period' } }), period])
      ]),
      el('div', { 'class': 'fld' }, [el('label', { text: 'Megjegyzés', attrs: { 'for': idp + '-note' } }), note]),
      msg,
      el('div', { 'class': 'btn-row' }, [save])
    ].forEach(function (n) { form.appendChild(n); });

    var toggle = el('button', { 'class': 'btn btn-accent btn-sm', text: 'Kifizetve', attrs: { type: 'button', 'aria-expanded': 'false', 'data-pay': b.clipper_id } });
    toggle.addEventListener('click', function () {
      var open = form.hidden;
      form.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) { amount.focus(); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = Number(amount.value);
      amount.removeAttribute('aria-invalid');
      if (!Number.isInteger(v) || v <= 0) { amount.setAttribute('aria-invalid', 'true'); KL.say(msg, 'Az összeg pozitív egész szám legyen.', 'err'); amount.focus(); return; }
      if (v > b.owed) { amount.setAttribute('aria-invalid', 'true'); KL.say(msg, 'Az összeg nem lehet több, mint a tartozás (' + KL.ft(b.owed) + ').', 'err'); amount.focus(); return; }
      KL.busy(save, true, 'Mentés…');
      KL.q(sb.from('payouts').insert({
        clipper_id: b.clipper_id, amount: v, period_label: period.value.trim() || null,
        note: note.value.trim() || null, paid_at: paidAt.value || KL.isoDate()
      })).then(function () {
        KL.toast('Kifizetés rögzítve: ' + profileName(b.clipper_id) + ', ' + KL.ft(v) + '.');
        return reload();
      }).catch(function (err) { KL.busy(save, false); KL.say(msg, KL.errorText(err), 'err'); });
    });

    return el('article', { 'class': 'card card-tight', attrs: { 'data-owed': b.clipper_id } }, [
      el('div', { 'class': 'usage-head' }, [
        el('div', {}, [
          el('h3', { 'class': 'h-card', text: p.full_name || b.full_name || 'Név nélkül' }),
          el('p', { 'class': 'meta' }, [
            el('span', { text: 'Számlatulajdonos: ' + (p.payout_name || 'nincs megadva') }),
            el('span', { text: 'Jóváhagyott megtekintés: ' + KL.fmt(b.approved_views) })
          ])
        ]),
        el('p', { 'class': 'stat-value num', attrs: { 'data-k': 'owed' }, text: KL.ft(b.owed) })
      ]),
      !p.payout_name ? el('p', { 'class': 'msg msg-warn', attrs: { style: 'margin-top:10px' }, text: 'Nincs megadva a számlatulajdonos neve. Utalás előtt kérd el privát úton a kifizetési adatokat.' }) : null,
      el('div', { 'class': 'btn-row', attrs: { style: 'margin-top:12px' } }, [toggle]),
      form
    ]);
  }

  $('#csv-btn').addEventListener('click', function () {
    if (!D.payouts.length) { KL.toast('Nincs mit exportálni.', 'err'); return; }
    var head = ['Utalás napja', 'Clipper', 'Számlatulajdonos', 'Összeg (Ft)', 'Időszak', 'Megjegyzés', 'Rögzítve'];
    var lines = [head.map(KL.csvCell).join(';')];
    D.payouts.forEach(function (p) {
      var pr = byId(D.profiles, p.clipper_id) || {};
      lines.push([p.paid_at, pr.full_name || '', pr.payout_name || '', p.amount, p.period_label || '', p.note || '', KL.dateTime(p.created_at)].map(KL.csvCell).join(';'));
    });
    KL.download('kliplabor-kifizetesek-' + KL.isoDate() + '.csv', lines.join('\r\n'));
  });

  /* ---------------- Streamer jelentkezések ---------------- */
  function renderApps() {
    var box = KL.clear($('#apps-list'));
    if (!D.apps.length) { box.appendChild(el('p', { 'class': 'empty', text: 'Még nem jött streamer jelentkezés.' })); return; }
    D.apps.forEach(function (a) {
      var idp = 'a-' + a.id;
      var sel = el('select', { 'class': 'input select', attrs: { id: idp + '-status' } });
      Object.keys(KL.APP_STATUS).forEach(function (k) { sel.appendChild(el('option', { text: KL.APP_STATUS[k], attrs: { value: k } })); });
      sel.value = a.status;
      var note = el('textarea', { 'class': 'textarea', attrs: { id: idp + '-note', maxlength: '2000', rows: '3' } });
      note.value = a.admin_note || '';
      var msg = el('div', { 'class': 'msg', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
      var save = el('button', { 'class': 'btn btn-accent btn-sm', text: 'Mentés', attrs: { type: 'button' } });
      save.addEventListener('click', function () {
        KL.busy(save, true, 'Mentés…');
        KL.q(sb.from('streamer_applications').update({ status: sel.value, admin_note: note.value.trim() || null }).eq('id', a.id)).then(function () {
          KL.busy(save, false);
          a.status = sel.value; a.admin_note = note.value.trim() || null;
          KL.say(msg, 'Mentve.', 'ok');
          var n = D.apps.filter(function (x) { return x.status === 'uj'; }).length;
          $('#count-apps').textContent = n ? String(n) : '';
          renderOverview();
        }).catch(function (err) { KL.busy(save, false); KL.say(msg, KL.errorText(err), 'err'); });
      });
      var emailOk = /^[^@\s?&#]+@[^@\s?&#]+\.[^@\s?&#]+$/.test(a.email || '');
      box.appendChild(el('article', { 'class': 'card card-tight stack', attrs: { 'data-app': a.id } }, [
        el('div', { 'class': 'usage-head' }, [
          el('div', {}, [
            el('h3', { 'class': 'h-card', text: a.name }),
            el('p', { 'class': 'meta' }, [el('span', { text: KL.dateTime(a.created_at) }), el('span', { text: KL.BUDGET_BANDS[a.budget_band] || a.budget_band })])
          ]),
          el('span', { 'class': a.status === 'uj' ? 'badge badge-ok' : 'badge', text: KL.APP_STATUS[a.status] || a.status })
        ]),
        el('dl', { 'class': 'kv' }, [
          el('dt', { text: 'Csatorna' }), el('dd', {}, [KL.extLink(a.channel_url)]),
          el('dt', { text: 'E-mail' }), el('dd', {}, [emailOk ? el('a', { text: a.email, attrs: { href: 'mailto:' + a.email } }) : el('span', { text: a.email })])
        ]),
        a.message ? el('p', { 'class': 'pre soft', text: a.message }) : null,
        el('div', { 'class': 'form-row' }, [
          el('div', { 'class': 'fld' }, [el('label', { text: 'Állapot', attrs: { 'for': idp + '-status' } }), sel]),
          el('div', { 'class': 'fld' }, [el('label', { text: 'Saját jegyzet', attrs: { 'for': idp + '-note' } }), note])
        ]),
        msg,
        el('div', {}, [save])
      ]));
    });
  }
})();
