// Мини-приложение Bileto для Telegram. Без сборки: один файл поверх общего API (/api).
(() => {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTg = !!(tg && tg.initData);
  const $app = document.getElementById('app');
  const $tabs = document.getElementById('tabs');
  const $toast = document.getElementById('toast');

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  const S = {
    lang: store.get('lang') || 'ru',
    token: null,
    user: null,
    cfg: { cities: [], feePercent: 7, commissionPercent: 10, support: 'bileto_manager' },
    stack: [{ name: 'feed' }], // экраны; последний — текущий
    feed: { q: '', city: '', page: 1, items: [], total: 0 },
    myTab: 'listings',
    draft: { title: '', city: '', price: '', qty: 1, delivery: 'PICKUP', description: '', photo: null, photoUrl: '' },
  };
  let t = window.I18N[S.lang] || window.I18N.ru;

  // ---------- Утилиты ----------

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => Number(n).toLocaleString('ru-RU').replace(/[\s,]/g, ' ') + ' ' + t.sum;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const haptic = (kind) => { try { tg.HapticFeedback.notificationOccurred(kind); } catch { /* вне Telegram */ } };
  // Телефон, @ник или ссылка в тексте объявления — как проверка в боте, только проще.
  const hasContacts = (s) => /(\d[\s()-]*){9,}|@[a-z0-9_]{4,}|https?:\/\/|www\.|t\.me\//i.test(s);

  let toastTimer;
  function toast(text) {
    $toast.textContent = text;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), 3200);
  }

  function confirmBox(text) {
    return new Promise((resolve) => {
      if (inTg && tg.showConfirm) tg.showConfirm(text, resolve);
      else resolve(window.confirm(text));
    });
  }

  async function api(method, path, body, retried) {
    const headers = {};
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    const isForm = body instanceof FormData;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch('/api' + path, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    } catch {
      throw new Error(t.loadError);
    }
    // Токен истёк — берём новый по подписи Telegram и повторяем один раз.
    if (res.status === 401 && S.token && !retried && path !== '/auth/telegram') {
      S.token = null;
      await auth();
      if (S.token) return api(method, path, body, true);
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = Array.isArray(json.message) ? json.message[0] : json.message;
      throw Object.assign(new Error(m || t.error), { status: res.status });
    }
    return json;
  }

  // ---------- Вход ----------

  async function auth() {
    if (!inTg) return;
    try {
      const r = await api('POST', '/auth/telegram', { initData: tg.initData });
      S.token = r.token;
      S.user = r.user;
      if (!store.get('lang') && window.I18N[r.lang]) setLang(r.lang, true);
    } catch { /* лента работает и без входа */ }
  }

  // Действиям с аккаунтом нужен номер: Telegram отправляет контакт боту, тот привязывает аккаунт.
  async function needUser() {
    if (S.user) return true;
    if (!inTg) { toast(t.openInTg); return false; }
    if (!tg.requestContact || !tg.isVersionAtLeast('6.9')) { toast(t.updateTg); return false; }
    const shared = await new Promise((r) => tg.requestContact((ok) => r(!!ok)));
    if (!shared) { toast(t.phoneNeeded); return false; }
    toast(t.phoneWait);
    for (let i = 0; i < 12 && !S.user; i++) {
      await sleep(i < 3 ? 700 : 1200);
      await auth();
    }
    if (!S.user) toast(t.phoneFail);
    return !!S.user;
  }

  function setLang(lang, silent) {
    S.lang = lang;
    t = window.I18N[lang];
    document.documentElement.lang = lang;
    if (silent) return;
    store.set('lang', lang);
    if (S.user) api('PATCH', '/me', { lang }).catch(() => undefined);
    render();
  }

  // ---------- Навигация ----------

  const view = () => S.stack[S.stack.length - 1];
  function go(name, params) { S.stack.push({ name, ...params }); render(); window.scrollTo(0, 0); }
  function tab(name) { S.stack = [{ name }]; render(); window.scrollTo(0, 0); }
  function back() { if (S.stack.length > 1) { S.stack.pop(); render(); } }

  const ICONS = {
    feed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M14 5v14" stroke-dasharray="2 3"/></svg>',
    sell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    my: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };

  function render() {
    const v = view();
    const root = S.stack.length === 1;
    $tabs.hidden = !root;
    $app.className = v.name === 'listing' ? 'with-cta' : '';
    if (root)
      $tabs.innerHTML = ['feed', 'sell', 'my']
        .map((n) => `<button data-tab="${n}" class="${v.name === n ? 'on' : ''}">${ICONS[n]}${esc(t['tab' + n[0].toUpperCase() + n.slice(1)])}</button>`)
        .join('');
    if (inTg) root ? tg.BackButton.hide() : tg.BackButton.show();
    ({ feed: renderFeed, listing: renderListing, sell: renderSell, my: renderMy, done: renderDone })[v.name](v);
  }

  const langSwitch = () =>
    `<div class="lang">${['ru', 'uz'].map((l) => `<button data-lang="${l}" class="${S.lang === l ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>`;
  const cover = (l, cls) =>
    l.coverUrl
      ? `<img class="${cls}" src="${esc(l.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;${cls} none&quot;>🎟</div>'">`
      : `<div class="${cls} none">🎟</div>`;
  const skeletons = (n) => '<div class="skeleton"></div>'.repeat(n);
  const errorBox = (msg) => `<div class="empty"><div class="big">📡</div><b>${esc(msg)}</b><button class="btn ghost small" data-act="reload" style="width:auto;margin:14px auto 0">${esc(t.retry)}</button></div>`;

  // ---------- Лента ----------

  function renderFeed() {
    const f = S.feed;
    $app.innerHTML = `
      <div class="top"><div class="logo">Bilet<i>o</i></div>${langSwitch()}</div>
      <div class="search">${ICONS.search}<input id="q" type="search" enterkeyhint="search" placeholder="${esc(t.search)}" value="${esc(f.q)}"></div>
      <div class="chips">
        <button class="chip ${f.city ? '' : 'on'}" data-city="">${esc(t.allCities)}</button>
        ${S.cfg.cities.map((c) => `<button class="chip ${f.city === c ? 'on' : ''}" data-city="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div id="list"></div>`;
    if (f.items.length) drawFeed();
    else loadFeed(1);
  }

  let feedSeq = 0;
  async function loadFeed(page) {
    const f = S.feed;
    const seq = ++feedSeq;
    const $list = document.getElementById('list');
    if (page === 1 && $list) $list.innerHTML = skeletons(4);
    try {
      const qs = new URLSearchParams({ page, limit: 20 });
      if (f.q) qs.set('q', f.q);
      if (f.city) qs.set('city', f.city);
      const r = await api('GET', '/listings?' + qs);
      if (seq !== feedSeq) return; // пришёл ответ на устаревший запрос
      f.items = page === 1 ? r.items : f.items.concat(r.items);
      f.total = r.total;
      f.page = page;
      drawFeed();
    } catch (e) {
      if (seq === feedSeq && document.getElementById('list')) document.getElementById('list').innerHTML = errorBox(e.message);
    }
  }

  function drawFeed() {
    const $list = document.getElementById('list');
    if (!$list) return;
    const f = S.feed;
    if (!f.items.length) {
      $list.innerHTML = `<div class="empty"><div class="big">🎫</div><b>${esc(t.emptyFeed)}</b>${esc(t.emptyFeedHint)}</div>`;
      return;
    }
    $list.innerHTML =
      f.items
        .map(
          (l) => `<button class="card" data-open="${esc(l.id)}">
            ${cover(l, 'thumb')}
            <div class="card-body">
              <div class="card-title">${esc(l.title)}</div>
              <div class="card-meta">📍 ${esc(l.city)} · ${esc(t.delivery[l.delivery])}</div>
              <div class="card-foot"><span class="price">${money(l.price)}</span><span class="left">${esc(t.left(l.qtyAvailable))}</span></div>
            </div>
          </button>`,
        )
        .join('') + (f.items.length < f.total ? `<button class="btn ghost" data-act="more">${esc(t.more)}</button>` : '');
  }

  // ---------- Объявление ----------

  async function renderListing(v) {
    if (!v.data) {
      $app.innerHTML = `<div class="skeleton" style="height:220px"></div>${skeletons(2)}`;
      try {
        v.data = await api('GET', '/listings/' + v.id);
        v.qty = 1;
      } catch (e) {
        if (view() === v) $app.innerHTML = errorBox(e.message);
        return;
      }
      if (view() !== v) return;
    }
    const l = v.data;
    const available = l.status === 'ACTIVE' && l.qtyAvailable > 0;
    const max = Math.min(10, l.qtyAvailable);
    const subtotal = l.price * v.qty;
    const fee = Math.round((subtotal * S.cfg.feePercent) / 100);
    $app.innerHTML = `
      ${cover(l, 'cover')}
      <h1 class="h1">${esc(l.title)}</h1>
      <div class="tags"><span class="tag">📍 ${esc(l.city)}</span><span class="tag">${esc(t.delivery[l.delivery])}</span>${available ? `<span class="tag">${esc(t.left(l.qtyAvailable))}</span>` : ''}</div>
      ${l.description ? `<div class="block"><h2>${esc(t.description)}</h2><div class="desc">${esc(l.description)}</div></div>` : ''}
      <div class="block"><h2>${esc(t.seller)}</h2>${esc(l.seller.name || 'Bileto')}${l.seller.verified ? ` <span class="badge ok">✓ ${esc(t.verified)}</span>` : ''}<div class="sub">${esc(l.seller.phoneMasked)}</div></div>
      ${
        available
          ? `<div class="block">
              <div class="stepper"><span>${esc(t.qty)}</span><div><button data-qty="-1" ${v.qty <= 1 ? 'disabled' : ''}>−</button><output>${v.qty}</output><button data-qty="1" ${v.qty >= max ? 'disabled' : ''}>+</button></div></div>
            </div>
            <div class="block">
              <div class="line"><span>${esc(t.tickets)}: ${v.qty} × ${money(l.price)}</span><b>${money(subtotal)}</b></div>
              <div class="line"><span>${esc(t.fee(S.cfg.feePercent))}</span><b>${money(fee)}</b></div>
              <div class="line total"><span>${esc(t.total)}</span><b>${money(subtotal + fee)}</b></div>
              <p class="note">${esc(t.buyNote)}</p>
            </div>
            <div class="cta"><button class="btn" data-act="buy">${esc(t.buy)}</button></div>`
          : `<div class="cta"><button class="btn ghost" disabled>${esc(t.soldOut)}</button></div>`
      }`;
  }

  async function buy(btn) {
    const v = view();
    if (!(await needUser())) return;
    btn.disabled = true;
    try {
      const name = S.user.name || (tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || 'Telegram';
      const r = await api('POST', '/requests', { listingId: v.id, qty: v.qty, name: name.slice(0, 60).padEnd(2, '.'), phone: S.user.phone });
      haptic('success');
      S.feed.items = []; // остаток изменится после сделки — лента перечитается
      S.stack = [{ name: 'feed' }];
      go('done', { icon: '✅', title: t.requestDone(r.number), text: t.requestDoneText, primary: [t.toRequests, 'my:requests'], secondary: [t.toFeed, 'feed'] });
    } catch (e) {
      haptic('error');
      toast(e.message);
      btn.disabled = false;
    }
  }

  // ---------- Продажа ----------

  function renderSell() {
    const d = S.draft;
    $app.innerHTML = `
      <h1 class="title">${esc(t.sellTitle)}</h1>
      <p class="sub" style="margin:-8px 0 16px">${esc(t.sellSub(S.cfg.commissionPercent))}</p>
      <label class="f"><span>${esc(t.fTitle)}</span><input class="in" data-f="title" maxlength="120" placeholder="${esc(t.fTitlePh)}" value="${esc(d.title)}"></label>
      <label class="f"><span>${esc(t.fCity)}</span><input class="in" data-f="city" maxlength="60" placeholder="${esc(t.fCityPh)}" value="${esc(d.city)}">
        <div class="mini-chips">${S.cfg.cities.slice(0, 4).map((c) => `<button type="button" data-setcity="${esc(c)}">${esc(c)}</button>`).join('')}</div></label>
      <label class="f"><span>${esc(t.fPrice)}</span><div class="suffix"><input class="in" data-f="price" inputmode="numeric" placeholder="500 000" value="${esc(d.price)}"><em>${esc(t.sum)}</em></div></label>
      <div class="f-label">${esc(t.fQty)}</div>
      <div class="block" style="padding:8px 14px"><div class="stepper"><span>${esc(t.pcs)}</span><div><button data-dqty="-1" ${d.qty <= 1 ? 'disabled' : ''}>−</button><output id="dqty">${d.qty}</output><button data-dqty="1" ${d.qty >= 10 ? 'disabled' : ''}>+</button></div></div></div>
      <div class="f-label">${esc(t.fDelivery)}</div>
      <div class="seg" style="margin-bottom:14px">${['PICKUP', 'DELIVERY'].map((k) => `<button data-delivery="${k}" class="${d.delivery === k ? 'on' : ''}">${esc(t.delivery[k])}</button>`).join('')}</div>
      <label class="f"><span>${esc(t.fDesc)}</span><textarea class="in" data-f="description" rows="3" maxlength="1000" placeholder="${esc(t.fDescPh)}">${esc(d.description)}</textarea></label>
      <div class="f-label">${esc(t.fPhoto)}</div>
      <label class="photo" id="photo" style="margin-bottom:14px">
        ${d.photoUrl ? `<img src="${esc(d.photoUrl)}" alt="">` : `<div><div style="font-size:30px">📷</div><b>${esc(t.addPhoto)}</b>${esc(t.photoHint)}</div>`}
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden>
      </label>
      <div class="err" id="err" hidden></div>
      <button class="btn" data-act="publish">${esc(t.publish)}</button>`;
  }

  function sellError(text, selector) {
    const $err = document.getElementById('err');
    $err.textContent = text;
    $err.hidden = false;
    const el = selector && $app.querySelector(selector);
    if (el) { el.classList.add('bad'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    haptic('error');
  }

  async function publish(btn) {
    const d = S.draft;
    $app.querySelectorAll('.bad').forEach((el) => el.classList.remove('bad'));
    const title = d.title.trim();
    const city = d.city.trim();
    const price = Number(d.price.replace(/\D/g, ''));
    const description = d.description.trim();
    if (title.length < 2) return sellError(t.eTitle, '[data-f=title]');
    if (hasContacts(title)) return sellError(t.eContacts, '[data-f=title]');
    if (city.length < 2) return sellError(t.eCity, '[data-f=city]');
    if (!(price >= 1000 && price <= 100000000)) return sellError(t.ePrice, '[data-f=price]');
    if (hasContacts(description)) return sellError(t.eContacts, '[data-f=description]');
    document.getElementById('err').hidden = true;
    if (!(await needUser())) return;

    btn.disabled = true;
    btn.textContent = t.publishing;
    try {
      // Кто выставляет билет — продавец (как в боте).
      if (S.user.role !== 'SELLER') S.user = await api('PATCH', '/me', { role: 'SELLER' });
      const form = new FormData();
      form.append('title', title);
      form.append('city', city);
      form.append('price', String(price));
      form.append('qty', String(d.qty));
      form.append('delivery', d.delivery);
      if (description) form.append('description', description);
      if (d.photo) form.append('proof', d.photo);
      await api('POST', '/listings', form);
      haptic('success');
      if (d.photoUrl) URL.revokeObjectURL(d.photoUrl);
      S.draft = { title: '', city: '', price: '', qty: 1, delivery: 'PICKUP', description: '', photo: null, photoUrl: '' };
      S.feed.items = [];
      loadConfig();
      S.stack = [{ name: 'sell' }];
      go('done', { icon: '🎉', title: t.listingDone, text: t.listingDoneText, primary: [t.toMyListings, 'my:listings'], secondary: [t.sellMore, 'sell'] });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t.publish;
      sellError(e.message);
    }
  }

  // ---------- Мои объявления и заявки ----------

  const L_BADGE = { ACTIVE: 'ok', SOLD: 'info', REJECTED: 'bad', ARCHIVED: '' };
  const R_BADGE = { NEW: 'warn', IN_PROGRESS: 'info', DONE: 'ok', CANCELLED: 'bad' };

  async function renderMy(v) {
    const head = `<div class="top"><h1 class="title" style="margin:0">${esc(t.myTitle)}</h1>${langSwitch()}</div>`;
    if (!S.user) {
      $app.innerHTML = `${head}<div class="empty"><div class="big">🔐</div>${esc(inTg ? t.needLogin : t.openInTg)}
        ${inTg ? `<button class="btn" data-act="login" style="margin-top:18px">${esc(t.sharePhone)}</button>` : ''}</div>${supportLink()}`;
      return;
    }
    const seg = `<div class="seg" style="margin-bottom:14px">${['listings', 'requests'].map((k) => `<button data-mytab="${k}" class="${S.myTab === k ? 'on' : ''}">${esc(k === 'listings' ? t.myListings : t.myRequests)}</button>`).join('')}</div>`;
    $app.innerHTML = `${head}${seg}<div id="mylist">${skeletons(3)}</div>${supportLink()}`;
    const tabNow = S.myTab;
    let html;
    try {
      const rows = await api('GET', '/me/' + tabNow);
      html = rows.length ? rows.map(tabNow === 'listings' ? myListing : myRequest).join('') : `<div class="empty"><div class="big">${tabNow === 'listings' ? '🎟' : '🧾'}</div>${esc(tabNow === 'listings' ? t.emptyListings : t.emptyRequests)}</div>`;
    } catch (e) {
      html = errorBox(e.message);
    }
    const $list = document.getElementById('mylist');
    if (view() === v && S.myTab === tabNow && $list) $list.innerHTML = html;
  }

  const supportLink = () =>
    `<button class="btn ghost small" data-act="support" style="margin-top:8px">💬 ${esc(t.support)}</button>`;

  const myListing = (l) => `<div class="item">
      <div class="item-head"><div class="item-title">${esc(l.title)}</div><span class="badge ${L_BADGE[l.status]}">${esc(t.lStatus[l.status])}</span></div>
      <div class="sub">📍 ${esc(l.city)} · ${money(l.price)} · ${esc(t.soldOf(l.qty - (l.status === 'SOLD' ? 0 : l.qtyAvailable), l.qty))} · ${esc(t.views(l.views))}</div>
      <div class="row">${l.status === 'ACTIVE' ? `<button class="btn ghost small" data-sold="${esc(l.id)}">✅ ${esc(t.markSold)}</button><button class="btn ghost small" data-archive="${esc(l.id)}">${esc(t.archive)}</button>` : ''}<button class="btn ghost small danger" data-remove="${esc(l.id)}">🗑 ${esc(t.remove)}</button></div>
    </div>`;

  const myRequest = (r) => `<div class="item">
      <div class="item-head"><div class="item-title">№${r.number} · ${esc(r.listing.title)}</div><span class="badge ${R_BADGE[r.status]}">${esc(t.rStatus[r.status])}</span></div>
      <div class="sub">${r.qty} ${esc(t.pcs)} · ${esc(t.total.toLowerCase())} ${money(r.total)}</div>
    </div>`;

  // how: 'sold' — продано, 'archive' — снять с продажи, 'remove' — удалить совсем
  async function closeListing(id, how) {
    const ask = { sold: t.confirmSold, archive: t.confirmArchive, remove: t.confirmRemove }[how];
    if (!(await confirmBox(ask))) return;
    try {
      await (how === 'archive' ? api('DELETE', '/listings/' + id) : api('POST', `/listings/${id}/${how === 'sold' ? 'sold' : 'delete'}`));
      S.feed.items = [];
      render();
    } catch (e) {
      toast(how === 'remove' && e.status === 409 ? t.activeRequests : e.message);
    }
  }

  // ---------- Экран «готово» ----------

  function renderDone(v) {
    $app.innerHTML = `<div class="done"><div class="big">${v.icon}</div><h1>${esc(v.title)}</h1><p>${esc(v.text)}</p>
      <button class="btn" data-goto="${v.primary[1]}">${esc(v.primary[0])}</button>
      <button class="btn ghost" data-goto="${v.secondary[1]}">${esc(v.secondary[0])}</button></div>`;
  }

  // ---------- События ----------

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    const v = view();
    if (d.tab) return tab(d.tab);
    if (d.lang) return setLang(d.lang);
    if (d.open) return go('listing', { id: d.open });
    if (d.city !== undefined) { S.feed.city = d.city; S.feed.items = []; return renderFeed(); }
    if (d.qty) { v.qty += Number(d.qty); return renderListing(v); }
    if (d.dqty) { S.draft.qty = Math.min(10, Math.max(1, S.draft.qty + Number(d.dqty))); return renderSell(); }
    if (d.delivery) { S.draft.delivery = d.delivery; return renderSell(); }
    if (d.setcity) { e.preventDefault(); S.draft.city = d.setcity; return renderSell(); }
    if (d.mytab) { S.myTab = d.mytab; return render(); }
    if (d.sold) return closeListing(d.sold, 'sold');
    if (d.archive) return closeListing(d.archive, 'archive');
    if (d.remove) return closeListing(d.remove, 'remove');
    if (d.goto) {
      const [name, sub] = d.goto.split(':');
      if (sub) S.myTab = sub;
      return tab(name);
    }
    switch (d.act) {
      case 'more': return loadFeed(S.feed.page + 1);
      case 'reload': delete v.data; return render();
      case 'buy': return buy(el);
      case 'publish': return publish(el);
      case 'login': return needUser().then((ok) => ok && render());
      case 'support': {
        const url = 'https://t.me/' + S.cfg.support;
        return inTg ? tg.openTelegramLink(url) : window.open(url, '_blank');
      }
    }
  });

  let searchTimer;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'q') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { S.feed.q = el.value.trim(); loadFeed(1); }, 350);
      return;
    }
    const f = el.dataset && el.dataset.f;
    if (!f) return;
    if (f === 'price') {
      const digits = el.value.replace(/\D/g, '').slice(0, 9);
      el.value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    S.draft[f] = el.value;
    el.classList.remove('bad');
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'file') return;
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return sellError(t.ePhotoBig, '#photo');
    if (S.draft.photoUrl) URL.revokeObjectURL(S.draft.photoUrl);
    S.draft.photo = file;
    S.draft.photoUrl = URL.createObjectURL(file);
    renderSell();
  });

  // ---------- Запуск ----------

  async function loadConfig() {
    try { S.cfg = await api('GET', '/miniapp/config'); } catch { /* останутся значения по умолчанию */ }
  }

  async function start() {
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.setHeaderColor('#0e0f13'); tg.setBackgroundColor('#0e0f13'); } catch { /* старый клиент */ }
      tg.BackButton.onClick(back);
    }
    // Стартовый экран: ?screen=sell в адресе или startapp=sell… в ссылке на мини-приложение.
    const param = new URLSearchParams(location.search).get('screen') || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    if (/^sell/.test(param)) S.stack = [{ name: 'sell' }];
    else if (param === 'my') S.stack = [{ name: 'my' }];
    await Promise.all([auth(), loadConfig()]);
    render();
  }
  start();
})();
