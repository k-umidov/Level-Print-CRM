// LevelPrint CRM — интерфейс (без фреймворков)
(() => {
  const app = document.getElementById('app');
  const state = { user: null, settings: { margin: 3, vat: 12 }, lang: localStorage.getItem('lp_lang') || 'ru' };

  // ---------- Помощники ----------
  const t = (key, vars = {}) => {
    const s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.ru[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const money = (n) => `${fmt(n)} ${t('currency')}`;
  const parseNum = (v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  const isAdmin = () => state.user && state.user.role === 'admin';

  // Единицы измерения: значение хранится коротко, в списке показывается с расшифровкой
  const UNITS = [
    ['м²', 'unit_m2'], ['м', 'unit_m'], ['п.м.', 'unit_pm'], ['шт', 'unit_pcs'], ['лист', 'unit_sheet'], ['рулон', 'unit_roll'],
    ['пачка', 'unit_pack'], ['комплект', 'unit_set'], ['кг', 'unit_kg'], ['л', 'unit_l'], ['час', 'unit_hour'], ['мешок', 'unit_bag'], ['бухта', 'unit_coil'],
  ];
  const unitOptions = (current) => {
    const list = UNITS.map(([value, key]) => ({ value, label: t(key) }));
    if (current && !list.some((o) => o.value === current)) list.push({ value: current, label: current });
    return list;
  };
  const unitSelect = (attrs, current, short = false) => `<select ${attrs}>${unitOptions(current).map((o) => `<option value="${esc(o.value)}" ${o.value === current ? 'selected' : ''}>${esc(short ? o.value : o.label)}</option>`).join('')}</select>`;

  // Должности сотрудников
  const POSITIONS = ['director', 'cfo', 'supply', 'printer', 'sales', 'worker'];
  const positionOptions = () => POSITIONS.map((p) => ({ value: p, label: t('pos_' + p) }));

  // Тема оформления
  const getTheme = () => localStorage.getItem('lp_theme') === 'dark' ? 'dark' : 'light';
  const applyTheme = () => { document.documentElement.dataset.theme = getTheme(); };
  const themeButton = () => `<button class="theme-btn" data-theme-toggle title="${t(getTheme() === 'dark' ? 'themeLight' : 'themeDark')}" aria-label="${t(getTheme() === 'dark' ? 'themeLight' : 'themeDark')}">
    ${getTheme() === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'}
  </button>`;
  function bindTheme(root) {
    root.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
      localStorage.setItem('lp_theme', getTheme() === 'dark' ? 'light' : 'dark');
      applyTheme();
      const tmp = document.createElement('div');
      tmp.innerHTML = themeButton();
      const fresh = tmp.firstElementChild;
      b.replaceWith(fresh);
      bindTheme(fresh.parentElement);
    }));
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/login') { state.user = null; renderLogin(); throw new Error('unauthorized'); }
    if (!res.ok) { const e = new Error(data.error || 'unknown'); e.code = data.error; throw e; }
    return data;
  }
  const errText = (e) => (I18N.ru['err_' + e.code] ? t('err_' + e.code) : t('err_unknown'));

  let toastTimer;
  function toast(msg, bad = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }
  const fail = (e) => { if (e.message !== 'unauthorized') toast(errText(e), true); };

  // Диалог с полями: возвращает введённые значения или null
  function ask({ title, fields, okText = t('save'), danger = false }) {
    const dlg = document.getElementById('dialog');
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        ${fields.map((f) => `
          <div class="field">
            <label for="dlg-${f.name}">${esc(f.label)}</label>
            ${f.options
              ? `<select id="dlg-${f.name}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
              : `<input id="dlg-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.list ? `list="${f.list}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} autocomplete="off">`}
          </div>`).join('')}
        <div class="buttons">
          <button value="cancel" formnovalidate>${t('cancel')}</button>
          <button value="ok" class="primary" ${danger ? 'style="background:var(--red)"' : ''}>${esc(okText)}</button>
        </div>
      </form>`;
    dlg.showModal();
    const first = dlg.querySelector('input, select');
    if (first) first.focus();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => {
        if (dlg.returnValue !== 'ok') return resolve(null);
        resolve(Object.fromEntries(new FormData(dlg.querySelector('form'))));
      }, { once: true });
    });
  }
  async function confirmBox(text) {
    const r = await ask({ title: text, fields: [], okText: t('delete'), danger: true });
    return r !== null;
  }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    folder: '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    settings: '<path d="M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.5 1.8 3 0 3.5a1.7 1.7 0 0 0-1 2.5c.9 1.6-.9 3.4-2.4 2.4a1.7 1.7 0 0 0-2.6 1.1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1.1c-1.5.9-3.3-.8-2.4-2.4a1.7 1.7 0 0 0-1-2.5c-1.8-.5-1.8-3 0-3.5a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.4 2.4-2.4a1.7 1.7 0 0 0 2.6-1.1"/><circle cx="12" cy="12" r="3"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const langSwitch = () => `<div class="langs" role="group" aria-label="Язык / Til">
    ${['ru', 'uz'].map((l) => `<button data-lang="${l}" class="${state.lang === l ? 'on' : ''}">${I18N[l].langName}</button>`).join('')}</div>`;
  function bindLang(root, rerender) {
    root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      localStorage.setItem('lp_lang', state.lang);
      document.documentElement.lang = state.lang;
      rerender();
    }));
  }

  // ---------- Вход и первый запуск ----------
  function renderAuth({ setup }) {
    app.innerHTML = `
      <div class="auth">
        <img src="/logo.png" alt="LevelPrint">
        <form class="card" id="auth-form" novalidate>
          <h2>${setup ? t('setupTitle') : t('loginTitle')}</h2>
          ${setup ? `<p class="muted small" style="margin:-6px 0 14px">${t('setupText')}</p>
          <div class="field"><label for="f-name">${t('fullName')}</label><input id="f-name" name="name" autocomplete="name"></div>` : ''}
          <div class="field"><label for="f-login">${t('login')}</label><input id="f-login" name="login" autocomplete="username" autocapitalize="off"></div>
          <div class="field"><label for="f-pass">${t('password')}</label><input id="f-pass" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}"></div>
          <button class="primary" type="submit">${setup ? t('setupBtn') : t('signIn')}</button>
          <div class="error" id="auth-error"></div>
        </form>
        <div class="prefs">${langSwitch()}${themeButton()}</div>
      </div>`;
    bindLang(app, () => renderAuth({ setup }));
    bindTheme(app);
    const form = document.getElementById('auth-form');
    form.querySelector('input').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      try {
        await api('POST', setup ? '/api/setup' : '/api/login', body);
        await boot();
      } catch (e) {
        document.getElementById('auth-error').textContent = errText(e);
      }
    });
  }
  const renderLogin = () => renderAuth({ setup: false });

  // ---------- Каркас с меню ----------
  function shell(active, content) {
    const link = (href, key, ic, name) => `<a href="#/${href}" class="${active === key ? 'active' : ''}">${icon(ic)}<span>${t(name)}</span></a>`;
    app.innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <a class="logo" href="#/projects"><img src="/logo.png" alt="LevelPrint"></a>
          <nav class="nav">
            ${link('new', 'new', 'plus', 'navNew')}
            ${link('projects', 'projects', 'folder', 'navProjects')}
            ${link('materials', 'materials', 'box', 'navMaterials')}
            ${link('pricelist', 'pricelist', 'tag', 'navPrice')}
            ${isAdmin() ? link('admin', 'admin', 'settings', 'navAdmin') : ''}
          </nav>
          <div class="bottom">
            <div class="user">${esc(state.user.name)}<div class="muted">${t('pos_' + (state.user.position || 'worker'))}</div></div>
            <div class="prefs">${langSwitch()}${themeButton()}</div>
            <div><button class="link" id="logout">${t('logout')}</button></div>
          </div>
        </aside>
        <main class="main" id="main">${content}</main>
      </div>`;
    bindLang(app, route);
    bindTheme(app);
    document.getElementById('logout').addEventListener('click', async () => {
      await api('POST', '/api/logout').catch(() => {});
      state.user = null;
      renderLogin();
    });
    return document.getElementById('main');
  }

  // ---------- Создать проект ----------
  async function viewNew() {
    const { number } = await api('GET', '/api/projects/next-number');
    const main = shell('new', `
      <div class="page-head"><h1>${t('newProjectTitle')}</h1></div>
      <form class="card" id="new-form" novalidate>
        <div class="row row-new">
          <div><label for="p-num">${t('projectNumber')}</label><input id="p-num" name="number" value="${esc(number)}"></div>
          <div><label for="p-name">${t('projectName')}</label><input id="p-name" name="name" placeholder="${esc(t('projectNamePh'))}"></div>
          <button class="primary" type="submit">${t('create')}</button>
        </div>
        <div class="error" id="new-error"></div>
      </form>`);
    const form = main.querySelector('#new-form');
    form.querySelector('#p-name').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const { id } = await api('POST', '/api/projects', Object.fromEntries(new FormData(form)));
        location.hash = `#/project/${id}`;
      } catch (e) { form.querySelector('#new-error').textContent = errText(e); }
    });
  }

  // ---------- Список проектов ----------
  async function viewProjects() {
    const projects = await api('GET', '/api/projects');
    const main = shell('projects', `
      <div class="page-head">
        <h1>${t('projectsTitle')}</h1>
        <div class="actions"><button class="primary" onclick="location.hash='#/new'">+ ${t('navNew')}</button></div>
      </div>
      <div class="card">
        ${projects.length ? `<input id="search" placeholder="${t('search')}" style="max-width:320px;margin-bottom:12px">` : ''}
        <div class="table-wrap"><table class="table">
          <thead><tr><th style="width:90px">${t('colNumber')}</th><th>${t('colName')}</th><th>${t('client')}</th><th>${t('colAuthor')}</th><th class="num">${t('colItems')}</th><th class="num">${t('colTotal')}</th>${isAdmin() ? '<th style="width:44px"></th>' : ''}</tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>`);
    const rows = main.querySelector('#rows');
    const draw = (q = '') => {
      const list = searchList(projects, q, (p) => `${p.number} ${p.name} ${p.client_name || ''} ${p.author || ''}`);
      rows.innerHTML = list.length
        ? list.map((p) => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.number)}</b></td><td>${esc(p.name)}</td><td>${esc(p.client_name || '—')}</td><td class="muted">${esc(p.author || '—')}</td><td class="num">${p.items}</td><td class="num"><b>${money(p.total)}</b></td>${isAdmin() ? `<td class="num"><button class="icon" data-del title="${t('deleteProject')}" aria-label="${t('deleteProject')}">✕</button></td>` : ''}</tr>`).join('')
        : `<tr><td colspan="7" class="empty">${projects.length ? t('noResults') : t('noProjects')}</td></tr>`;
    };
    draw();
    main.querySelector('#search')?.addEventListener('input', (e) => draw(e.target.value));
    rows.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const p = projects.find((x) => x.id === Number(tr.dataset.id));
      if (e.target.closest('[data-del]')) { deleteProject(p); return; }
      location.hash = `#/project/${tr.dataset.id}`;
    });
  }

  // ---------- Поиск: понимает кириллицу и латиницу и прощает опечатки в гласных ----------
  // «аракал» найдёт «Orakal», «фомекс» — «Fomiks», «алюкабонд» — «Alyukabond».
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
  const lat = (s) => String(s).toLowerCase().replace(/[а-яёўқғҳ]/g, (c) => TR[c] ?? c);
  const skel = (s) => lat(s).replace(/[^a-z0-9]/g, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
  function makeMatcher(query) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const prepared = words.map((w) => ({ w, l: lat(w), s: skel(w) }));
    return (text) => {
      const low = String(text).toLowerCase(), l = lat(text), s = skel(text);
      let score = 0;
      for (const p of prepared) {
        if (low.includes(p.w) || l.includes(p.l)) score += 2;
        else if (p.s.length >= 3 && s.includes(p.s)) score += 1;
        else return 0;
      }
      return score;
    };
  }
  const searchList = (list, query, textOf) => {
    const match = makeMatcher(query);
    if (!match) return list;
    return list.map((x, i) => ({ x, i, sc: match(textOf(x)) })).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i).map((r) => r.x);
  };
  const categoriesOf = (list) => {
    const counts = new Map();
    list.forEach((x) => counts.set(x.category || '', (counts.get(x.category || '') || 0) + 1));
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  };
  const NO_CAT = '__none__';
  const catLabel = (c) => c || t('noCategory');
  const catSelect = (cls, list, value = '') => `<select class="${cls}" aria-label="${esc(t('category'))}"><option value="">${t('allCategories')} (${list.length})</option>${categoriesOf(list).map(([c, n]) => `<option value="${esc(c || NO_CAT)}" ${(c || NO_CAT) === value ? 'selected' : ''}>${esc(catLabel(c))} (${n})</option>`).join('')}</select>`;
  const priceText = (x) => (x.price > 0 ? `${fmt(x.price)} ${t('currency')}` : (x.note || t('onRequest')));
  const titleWithSize = (x) => (x.size ? `${x.name} (${x.size})` : x.name);

  // Выбор позиции с поиском: категория + строка поиска + список результатов
  function mountPicker(root, { items, textOf, metaOf, placeholder, onChoose }) {
    const LIMIT = 100;
    root.innerHTML = `
      <div class="picker">
        <div class="picker-bar">${catSelect('pk-cat', items)}<input class="pk-q" type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"></div>
        <div class="pk-list" role="listbox" tabindex="-1"></div>
        <div class="pk-foot muted small"></div>
      </div>`;
    const cat = root.querySelector('.pk-cat'), q = root.querySelector('.pk-q'), listEl = root.querySelector('.pk-list'), foot = root.querySelector('.pk-foot');
    let shown = [], selected = null;
    const select = (id) => {
      selected = shown.find((x) => x.id === id) || null;
      listEl.querySelectorAll('.pk-item').forEach((b) => { const on = Number(b.dataset.id) === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      const el = listEl.querySelector('.pk-item.on');
      if (el) el.scrollIntoView({ block: 'nearest' });
      onChoose(selected, false);
    };
    const draw = () => {
      const pool = cat.value ? items.filter((x) => (x.category || NO_CAT) === cat.value) : items;
      const hits = searchList(pool, q.value, textOf);
      shown = hits.slice(0, LIMIT);
      listEl.innerHTML = shown.length ? shown.map((x) => `
        <button type="button" class="pk-item" role="option" aria-selected="false" data-id="${x.id}">
          <span class="pk-name">${esc(titleWithSize(x))}<small>${esc(catLabel(x.category))}</small></span>
          <span class="pk-meta">${esc(metaOf(x))}</span>
        </button>`).join('') : `<div class="empty">${t('noResults')}</div>`;
      foot.textContent = hits.length > LIMIT ? t('shownFirst', { n: LIMIT, total: hits.length }) : t('found', { n: hits.length });
      select(shown.length && (q.value.trim() || cat.value) ? shown[0].id : null);
    };
    cat.addEventListener('change', draw);
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => {
      const i = shown.indexOf(selected);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (shown[i + 1]) select(shown[i + 1].id); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) select(shown[i - 1].id); }
      else if (e.key === 'Enter') { e.preventDefault(); if (selected) onChoose(selected, true); }
    });
    listEl.addEventListener('click', (e) => { const b = e.target.closest('.pk-item'); if (b) select(Number(b.dataset.id)); });
    listEl.addEventListener('dblclick', (e) => { const b = e.target.closest('.pk-item'); if (b) { select(Number(b.dataset.id)); onChoose(selected, true); } });
    draw();
    return { focus: () => q.focus() };
  }

  // ---------- Проект: вкладки ----------
  const PROJECT_TABS = [['calc', 'tabCalc'], ['client', 'tabClient'], ['info', 'tabInfo'], ['offer', 'tabOffer']];
  async function viewProject(id, tab = 'calc') {
    if (!PROJECT_TABS.some(([k]) => k === tab)) tab = 'calc';
    const project = await api('GET', `/api/projects/${id}`);
    const main = shell('projects', `
      <div class="print-head"><img src="/logo.png" alt="LevelPrint"></div>
      <div class="page-head">
        <div>
          <div class="muted">${t('project')} №${esc(project.number)}${project.client_name ? ` · ${esc(project.client_name)}` : ''}</div>
          <h1>${esc(project.name)}</h1>
        </div>
        <div class="actions">
          <button id="edit-project">${t('edit')}</button>
          ${tab === 'calc' ? `<button id="print">${t('print')}</button>` : ''}
          ${isAdmin() ? `<button id="del-project" class="danger">${t('deleteProject')}</button>` : ''}
        </div>
      </div>
      <nav class="tabs no-print" role="tablist">
        ${PROJECT_TABS.map(([k, label]) => `<a role="tab" href="#/project/${id}/${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${t(label)}${k === 'info' && project.photos.length ? ` <span class="count">${project.photos.length}</span>` : ''}</a>`).join('')}
      </nav>
      <div id="tab-body"></div>`);

    main.querySelector('#edit-project').addEventListener('click', async () => {
      const r = await ask({ title: t('edit'), fields: [
        { name: 'number', label: t('projectNumber'), value: project.number },
        { name: 'name', label: t('projectName'), value: project.name },
      ] });
      if (!r) return;
      try { await api('PUT', `/api/projects/${id}`, r); route(); } catch (err) { fail(err); }
    });
    main.querySelector('#del-project')?.addEventListener('click', () => deleteProject(project));
    main.querySelector('#print')?.addEventListener('click', () => window.print());

    const body = main.querySelector('#tab-body');
    if (tab === 'calc') await tabCalc(project, body);
    else if (tab === 'client') tabClient(project, body);
    else if (tab === 'info') tabInfo(project, body);
    else body.innerHTML = `<div class="card empty-state"><h2>${t('tabOffer')}</h2><p class="muted">${t('offerSoon')}</p></div>`;
  }

  async function deleteProject(project) {
    if (!(await confirmBox(t('confirmDeleteProjectNamed', { number: project.number, name: project.name })))) return false;
    try {
      await api('DELETE', `/api/projects/${project.id}`);
      toast(t('projectDeleted'));
      if (location.hash === '#/projects') route(); else location.hash = '#/projects';
      return true;
    } catch (err) { fail(err); return false; }
  }

  // ---------- Вкладка «Калькуляция» ----------
  async function tabCalc(project, body) {
    const id = project.id;
    const [materials, prices] = await Promise.all([api('GET', '/api/materials'), api('GET', '/api/pricelist')]);
    const vatRate = state.settings.vat;
    let m = Number(project.margin) || state.settings.margin;
    let vatOn = project.vat_on !== 0;
    let mode = materials.length ? 'base' : prices.length ? 'price' : 'manual';
    let chosen = null;
    // Позиции из прайс-листа — уже цена для клиента, маржа к ним не применяется
    const marginOf = (it) => (it.source === 'price' ? it.qty * it.price : it.qty * it.price * m);

    body.innerHTML = `
      ${project.client_name || project.client_phone ? `<div class="print-only print-client">${t('client')}: ${esc([project.client_name, project.client_phone].filter(Boolean).join(', '))}</div>` : ''}
      <div class="card calc-settings no-print">
        <div class="calc-setting">
          <label for="c-margin">${t('marginLabel')}</label>
          <div class="margin-box"><span>×</span><input id="c-margin" inputmode="decimal" value="${fmt(m)}" aria-describedby="margin-hint"></div>
          <div class="muted small" id="margin-hint">${t('marginHint', { d: fmt(state.settings.margin) })}</div>
        </div>
        <div class="calc-setting">
          <span class="label">${t('vatLabelShort', { v: fmt(vatRate) })}</span>
          <button type="button" class="switch ${vatOn ? 'on' : ''}" id="c-vat" role="switch" aria-checked="${vatOn}">
            <span class="knob"></span><span class="switch-text">${t(vatOn ? 'vatOn' : 'vatOff')}</span>
          </button>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="table" id="items">
          <thead><tr>
            <th>#</th><th>${t('colPosition')}</th><th>${t('colUnit')}</th>
            <th class="num">${t('colQty')}</th><th class="num">${t('colPrice')}</th>
            <th class="num">${t('colSum')}</th><th class="num" id="margin-head">${t('colMargin', { m: fmt(m) })}</th><th class="no-print"></th>
          </tr></thead>
          <tbody></tbody>
        </table></div>
      </div>
      <div class="card no-print">
        <h2>${t('addPosition')}</h2>
        <div class="segment">
          <button data-mode="base">${t('fromBase')}</button>
          <button data-mode="price">${t('fromPrice')}</button>
          <button data-mode="manual">${t('manual')}</button>
        </div>
        <div id="add-area"></div>
        <div class="error" id="add-error"></div>
      </div>
      <div class="card"><div class="totals" id="totals"></div></div>`;

    const tbody = body.querySelector('#items tbody');
    const drawTotals = () => {
      const cost = project.items.filter((i) => i.source !== 'price').reduce((s, i) => s + i.qty * i.price, 0);
      const retail = project.items.filter((i) => i.source === 'price').reduce((s, i) => s + i.qty * i.price, 0);
      const noVat = cost * m + retail, vat = vatOn ? noVat * vatRate / 100 : 0;
      body.querySelector('#totals').innerHTML = `
        <div><span>${t('totalCost')}</span><span>${money(cost)}</span></div>
        <div><span>${t('totalMargin', { m: fmt(m) })}</span><span>${money(cost * m)}</span></div>
        ${retail ? `<div><span>${t('totalPriceItems')}</span><span>${money(retail)}</span></div>
        <div><span>${t('totalNoVat')}</span><span>${money(noVat)}</span></div>` : ''}
        ${vatOn ? `<div><span>${t('totalVat', { v: fmt(vatRate) })}</span><span>${money(vat)}</span></div>` : `<div class="muted"><span>${t('vatNotApplied')}</span><span>—</span></div>`}
        <div class="grand"><span>${t(vatOn ? 'totalAll' : 'totalAllNoVat')}</span><span>${money(noVat + vat)}</span></div>`;
    };
    const sourceTag = (it) => (it.source === 'price' ? `<span class="tag red">${t('priceMark')}</span>` : it.source === 'manual' ? `<span class="tag">${t('manualMark')}</span>` : '');
    const drawItems = () => {
      body.querySelector('#margin-head').textContent = t('colMargin', { m: fmt(m) });
      tbody.innerHTML = project.items.length ? project.items.map((it, n) => `
        <tr data-id="${it.id}">
          <td class="muted">${n + 1}</td>
          <td><input data-f="name" value="${esc(it.name)}" aria-label="${esc(t('colPosition'))}">${sourceTag(it)}</td>
          <td>${unitSelect(`data-f="unit" aria-label="${esc(t('colUnit'))}"`, it.unit, true)}</td>
          <td><input data-f="qty" class="num" inputmode="decimal" value="${fmt(it.qty)}" aria-label="${esc(t('colQty'))}"></td>
          <td><input data-f="price" class="num" inputmode="decimal" value="${fmt(it.price)}" aria-label="${esc(t('colPrice'))}"></td>
          <td class="num" data-sum>${fmt(it.qty * it.price)}</td>
          <td class="num" data-margin><b>${fmt(marginOf(it))}</b>${it.source === 'price' ? `<div class="muted small">${t('noMarginHint')}</div>` : ''}</td>
          <td class="no-print"><button class="icon" data-del title="${t('delete')}" aria-label="${t('delete')}">✕</button></td>
        </tr>`).join('') : `<tr><td colspan="8" class="empty">${t('noItems')}</td></tr>`;
      drawTotals();
    };

    // Маржа проекта и НДС: сохраняем сразу
    const marginEl = body.querySelector('#c-margin');
    const saveMargin = async () => {
      const val = parseNum(marginEl.value);
      if (!Number.isFinite(val) || val <= 0 || val > 100) { toast(t('err_bad_number'), true); marginEl.value = fmt(m); return; }
      if (val === m) { marginEl.value = fmt(m); return; }
      try {
        await api('PUT', `/api/projects/${id}`, { margin: val });
        m = val; marginEl.value = fmt(m); drawItems(); toast(t('saved'));
      } catch (err) { fail(err); marginEl.value = fmt(m); }
    };
    marginEl.addEventListener('change', saveMargin);
    marginEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') marginEl.blur(); });
    const vatBtn = body.querySelector('#c-vat');
    vatBtn.addEventListener('click', async () => {
      const next = !vatOn;
      try {
        await api('PUT', `/api/projects/${id}`, { vat_on: next });
        vatOn = next;
        vatBtn.classList.toggle('on', vatOn);
        vatBtn.setAttribute('aria-checked', vatOn);
        vatBtn.querySelector('.switch-text').textContent = t(vatOn ? 'vatOn' : 'vatOff');
        drawTotals();
      } catch (err) { fail(err); }
    });

    // Изменение строки — сохраняем сразу
    tbody.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const item = project.items.find((i) => i.id === Number(tr.dataset.id));
      const get = (f) => tr.querySelector(`[data-f="${f}"]`).value;
      const next = { name: get('name').trim(), unit: get('unit').trim(), qty: parseNum(get('qty')), price: parseNum(get('price')) };
      if (!next.name || !Number.isFinite(next.qty) || !Number.isFinite(next.price) || next.qty < 0 || next.price < 0) {
        toast(t(next.name ? 'err_bad_number' : 'err_required'), true);
        return drawItems();
      }
      try {
        await api('PUT', `/api/items/${item.id}`, next);
        Object.assign(item, next);
        tr.querySelector('[data-sum]').textContent = fmt(item.qty * item.price);
        tr.querySelector('[data-margin] b').textContent = fmt(marginOf(item));
        tr.querySelector('[data-f="qty"]').value = fmt(item.qty);
        tr.querySelector('[data-f="price"]').value = fmt(item.price);
        drawTotals();
        toast(t('saved'));
      } catch (err) { fail(err); drawItems(); }
    });
    tbody.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      const itemId = Number(btn.closest('tr').dataset.id);
      if (!(await confirmBox(t('confirmDeleteItem')))) return;
      try {
        await api('DELETE', `/api/items/${itemId}`);
        project.items = project.items.filter((i) => i.id !== itemId);
        drawItems();
      } catch (err) { fail(err); }
    });

    // Добавление позиции: из базы, из прайс-листа или вручную
    const area = body.querySelector('#add-area');
    const errEl = body.querySelector('#add-error');
    let picker = null;
    const addItem = async (payload) => {
      errEl.textContent = '';
      try {
        await api('POST', `/api/projects/${id}/items`, payload);
        project.items = (await api('GET', `/api/projects/${id}`)).items;
        drawItems();
        toast(t('added'));
        return true;
      } catch (err) { errEl.textContent = errText(err); return false; }
    };
    const drawAdd = () => {
      body.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      errEl.textContent = '';
      chosen = null;
      if (mode === 'manual') {
        area.innerHTML = `
          <form id="manual-form" class="row" novalidate>
            <div><label for="a-name">${t('materialName')}</label><input id="a-name" name="name" placeholder="${esc(t('materialNamePh'))}"></div>
            <div><label for="a-unit">${t('unit')}</label>${unitSelect('id="a-unit" name="unit"', 'шт')}</div>
            <div><label for="a-price">${t('price')}</label><input id="a-price" name="price" inputmode="decimal"></div>
            <div><label for="a-qty">${t('colQty')}</label><input id="a-qty" name="qty" value="1" inputmode="decimal"></div>
            <button class="primary" type="submit">${t('add')}</button>
          </form>`;
        const f = area.querySelector('#manual-form');
        f.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (await addItem(Object.fromEntries(new FormData(f)))) { f.reset(); f.querySelector('#a-name').focus(); }
        });
        return;
      }
      const isBase = mode === 'base';
      area.innerHTML = `
        <div id="pk"></div>
        <form id="pick-form" class="row pick-row" novalidate>
          <div class="pick-chosen"><span class="muted small">${t('selected')}</span><div id="chosen-name" class="muted">${t('nothingSelected')}</div></div>
          <div class="pick-qty"><label for="a-qty">${t('colQty')}</label><input id="a-qty" name="qty" value="1" inputmode="decimal"></div>
          <button class="primary" type="submit">${t('add')}</button>
        </form>`;
      const chosenEl = area.querySelector('#chosen-name'), qtyEl = area.querySelector('#a-qty');
      const submit = async () => {
        if (!chosen) { errEl.textContent = t('nothingSelected'); return; }
        const payload = isBase ? { material_id: chosen.id, qty: qtyEl.value } : { price_id: chosen.id, qty: qtyEl.value };
        if (await addItem(payload)) { qtyEl.value = '1'; picker.focus(); }
      };
      picker = mountPicker(area.querySelector('#pk'), {
        items: isBase ? materials : prices,
        textOf: (x) => `${x.name} ${x.size || ''} ${x.category || ''}`,
        metaOf: (x) => `${priceText(x)} / ${x.unit}`,
        placeholder: t(isBase ? 'searchMaterial' : 'searchPrice'),
        onChoose: (x, go) => {
          chosen = x;
          chosenEl.className = x ? '' : 'muted';
          chosenEl.textContent = x ? `${titleWithSize(x)} — ${priceText(x)} / ${x.unit}` : t('nothingSelected');
          if (go) submit();
        },
      });
      area.querySelector('#pick-form').addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    };
    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; drawAdd(); picker?.focus(); }));

    drawItems();
    drawAdd();
  }

  // ---------- Вкладка «О клиенте» ----------
  function tabClient(project, body) {
    const tgUser = (v) => String(v || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
    const phoneHref = (v) => String(v || '').replace(/[^\d+]/g, '');
    body.innerHTML = `
      <form class="card" id="client-form" novalidate>
        <h2>${t('tabClient')}</h2>
        <div class="form-grid">
          <div><label for="cl-name">${t('clientName')}</label><input id="cl-name" name="client_name" value="${esc(project.client_name)}" autocomplete="off"></div>
          <div><label for="cl-phone">${t('clientPhone')}</label><input id="cl-phone" name="client_phone" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(project.client_phone)}" autocomplete="off"></div>
          <div><label for="cl-tg">${t('clientTelegram')}</label><input id="cl-tg" name="client_telegram" placeholder="@username" value="${esc(project.client_telegram)}" autocomplete="off"></div>
        </div>
        <div class="form-actions">
          <button class="primary" type="submit">${t('save')}</button>
          <span id="client-links" class="client-links"></span>
        </div>
        <div class="error" id="client-error"></div>
      </form>`;
    const form = body.querySelector('#client-form');
    const drawLinks = () => {
      const ph = phoneHref(form.client_phone.value), tg = tgUser(form.client_telegram.value);
      body.querySelector('#client-links').innerHTML = [
        ph ? `<a class="btn-link" href="tel:${esc(ph)}">${t('callClient')}</a>` : '',
        /^[A-Za-z0-9_]{3,64}$/.test(tg) ? `<a class="btn-link" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">${t('openTelegram')}</a>` : '',
      ].join('');
    };
    drawLinks();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      try {
        await api('PUT', `/api/projects/${project.id}`, data);
        Object.assign(project, data);
        body.querySelector('#client-error').textContent = '';
        drawLinks();
        toast(t('saved'));
      } catch (err) { body.querySelector('#client-error').textContent = errText(err); }
    });
  }

  // ---------- Вкладка «О проекте»: локация, описание, фото ----------
  function tabInfo(project, body) {
    const mapUrl = () => (project.lat != null && project.lng != null
      ? `https://yandex.uz/maps/?pt=${project.lng},${project.lat}&z=17&l=map`
      : project.location ? `https://yandex.uz/maps/?text=${encodeURIComponent(project.location)}` : '');
    body.innerHTML = `
      <form class="card" id="info-form" novalidate>
        <h2>${t('locationTitle')}</h2>
        <div class="form-grid">
          <div class="wide"><label for="in-loc">${t('locationAddress')}</label><input id="in-loc" name="location" value="${esc(project.location)}" placeholder="${esc(t('locationPh'))}"></div>
          <div class="wide"><label for="in-notes">${t('projectNotes')}</label><textarea id="in-notes" name="notes" rows="3">${esc(project.notes)}</textarea></div>
        </div>
        <div class="muted small" id="coords"></div>
        <div class="form-actions">
          <button class="primary" type="submit">${t('save')}</button>
          <button type="button" id="geo">${t('myLocation')}</button>
          <span id="map-link"></span>
        </div>
        <div class="error" id="info-error"></div>
      </form>
      <div class="card">
        <div class="photos-head">
          <h2>${t('photosTitle')}</h2>
          <label class="upload-btn"><input type="file" id="ph-input" accept="image/*" multiple hidden>${t('uploadPhotos')}</label>
        </div>
        <div class="muted small" id="ph-status"></div>
        <div class="gallery" id="gallery"></div>
      </div>`;
    const form = body.querySelector('#info-form'), errEl = body.querySelector('#info-error');
    const drawMap = () => {
      const url = mapUrl();
      body.querySelector('#map-link').innerHTML = url ? `<a class="btn-link" href="${esc(url)}" target="_blank" rel="noopener">${t('openMap')}</a>` : '';
      body.querySelector('#coords').textContent = project.lat != null ? `${t('coords')}: ${project.lat.toFixed(6)}, ${project.lng.toFixed(6)}` : '';
    };
    drawMap();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      try { await api('PUT', `/api/projects/${project.id}`, data); Object.assign(project, data); errEl.textContent = ''; drawMap(); toast(t('saved')); }
      catch (err) { errEl.textContent = errText(err); }
    });
    body.querySelector('#geo').addEventListener('click', () => {
      if (!navigator.geolocation) { errEl.textContent = t('geoUnavailable'); return; }
      errEl.textContent = '';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = Math.round(pos.coords.latitude * 1e6) / 1e6, lng = Math.round(pos.coords.longitude * 1e6) / 1e6;
        try { await api('PUT', `/api/projects/${project.id}`, { lat, lng }); project.lat = lat; project.lng = lng; drawMap(); toast(t('saved')); }
        catch (err) { errEl.textContent = errText(err); }
      }, () => { errEl.textContent = t('geoDenied'); }, { enableHighAccuracy: true, timeout: 15000 });
    });

    // Фото
    const gallery = body.querySelector('#gallery'), status = body.querySelector('#ph-status');
    const drawGallery = () => {
      gallery.innerHTML = project.photos.length ? project.photos.map((p) => `
        <figure data-id="${p.id}">
          <a href="/api/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}" alt="${esc(p.original_name || t('photo'))}" loading="lazy"></a>
          <button class="icon ph-del" data-del title="${t('delete')}" aria-label="${t('delete')}">✕</button>
        </figure>`).join('') : `<div class="empty">${t('noPhotos')}</div>`;
    };
    drawGallery();
    // Большие фото с телефона уменьшаем до 2000 px — так быстрее и меньше места на диске
    const shrink = async (file) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
        return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
      } catch { return file; }
    };
    body.querySelector('#ph-input').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      let done = 0, failed = 0;
      for (const f of files) {
        status.textContent = t('uploading', { n: done + 1, total: files.length });
        try {
          const file = await shrink(f);
          const res = await fetch(`/api/projects/${project.id}/photos`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: file });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'unknown');
          done++;
        } catch { failed++; }
      }
      project.photos = (await api('GET', `/api/projects/${project.id}`)).photos;
      drawGallery();
      const countEl = document.querySelector('.tabs a[href$="/info"]');
      if (countEl) countEl.innerHTML = `${t('tabInfo')}${project.photos.length ? ` <span class="count">${project.photos.length}</span>` : ''}`;
      status.textContent = failed ? t('uploadFailed', { n: failed }) : '';
      if (done) toast(t('photosUploaded', { n: done }));
    });
    gallery.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      const pid = Number(btn.closest('figure').dataset.id);
      if (!(await confirmBox(t('confirmDeletePhoto')))) return;
      try { await api('DELETE', `/api/photos/${pid}`); project.photos = project.photos.filter((p) => p.id !== pid); drawGallery(); } catch (err) { fail(err); }
    });
  }

  // ---------- Материалы ----------
  const matView = { q: '', cat: '', sort: 'category' };
  async function viewMaterials() {
    const materials = await api('GET', '/api/materials');
    const kindLabel = (k) => t(k === 'service' ? 'kindService' : 'kindMaterial');
    const kindOptions = [{ value: 'material', label: t('kindMaterial') }, { value: 'service', label: t('kindService') }];
    const cats = categoriesOf(materials).map(([c]) => c).filter(Boolean);
    const sortOptions = [['category', 'sortCategory'], ['name', 'sortName'], ['priceAsc', 'sortPriceAsc'], ['priceDesc', 'sortPriceDesc']];
    const main = shell('materials', `
      <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <div class="page-head"><h1>${t('materialsTitle')}</h1></div>
      ${isAdmin() ? `
      <form class="card" id="mat-form" novalidate>
        <h2>${t('addMaterial')}</h2>
        <div class="row">
          <div><label for="m-cat">${t('category')}</label><input id="m-cat" name="category" list="cat-list" placeholder="${esc(t('categoryPh'))}" value="${esc(matView.cat === NO_CAT ? '' : matView.cat)}"></div>
          <div><label for="m-kind">${t('kind')}</label><select id="m-kind" name="kind">${kindOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></div>
          <div><label for="m-name">${t('materialName')}</label><input id="m-name" name="name" placeholder="${esc(t('materialNamePh'))}"></div>
          <div><label for="m-unit">${t('unit')}</label>${unitSelect('id="m-unit" name="unit"', 'м²')}</div>
          <div><label for="m-price">${t('price')}</label><input id="m-price" name="price" inputmode="decimal"></div>
          <button class="primary" type="submit">${t('add')}</button>
        </div>
        <div class="error" id="mat-error"></div>
      </form>` : `<p class="muted">${t('materialsReadonly')}</p>`}
      <div class="card">
        <div class="toolbar">
          <input id="search" type="search" placeholder="${esc(t('searchMaterial'))}" value="${esc(matView.q)}" aria-label="${esc(t('search'))}">
          ${catSelect('f-cat', materials, matView.cat)}
          <select id="f-sort" aria-label="${t('sortLabel')}">${sortOptions.map(([val, k]) => `<option value="${val}" ${matView.sort === val ? 'selected' : ''}>${t(k)}</option>`).join('')}</select>
        </div>
        <div class="muted small" id="count" style="margin-bottom:6px"></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('materialName')}</th><th>${t('category')}</th><th>${t('kind')}</th><th>${t('unit')}</th><th class="num">${t('price')}</th>${isAdmin() ? '<th style="width:80px"></th>' : ''}</tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>`);
    const rows = main.querySelector('#rows');
    const cols = isAdmin() ? 6 : 5;
    const rowHtml = (x) => `
        <tr data-id="${x.id}">
          <td>${esc(x.name)}</td>
          <td class="muted small">${esc(catLabel(x.category))}</td>
          <td><span class="tag ${x.kind === 'service' ? 'red' : ''}">${kindLabel(x.kind)}</span></td>
          <td>${esc(x.unit)}</td>
          <td class="num"><b>${fmt(x.price)}</b></td>
          ${isAdmin() ? `<td class="num"><button class="icon" data-edit title="${t('edit')}" aria-label="${t('edit')}">✎</button><button class="icon" data-del title="${t('delete')}" aria-label="${t('delete')}">✕</button></td>` : ''}
        </tr>`;
    const draw = () => {
      let list = matView.cat ? materials.filter((x) => (x.category || NO_CAT) === matView.cat) : materials;
      list = searchList(list, matView.q, (x) => `${x.name} ${x.category}`);
      const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
      const byCat = (a, b) => catLabel(a.category).localeCompare(catLabel(b.category), 'ru');
      // При поиске внутри категории сохраняем порядок по точности совпадения
      list = [...list].sort(matView.sort === 'priceAsc' ? (a, b) => a.price - b.price
        : matView.sort === 'priceDesc' ? (a, b) => b.price - a.price
        : matView.sort === 'name' ? byName
        : matView.q ? byCat : (a, b) => byCat(a, b) || byName(a, b));
      main.querySelector('#count').textContent = t('found', { n: list.length });
      if (!list.length) { rows.innerHTML = `<tr><td colspan="${cols}" class="empty">${materials.length ? t('noResults') : t('noMaterials')}</td></tr>`; return; }
      if (matView.sort === 'category') {
        let html = '', last = null;
        for (const x of list) {
          if (x.category !== last) { last = x.category; html += `<tr class="group"><td colspan="${cols}">${esc(catLabel(x.category))}</td></tr>`; }
          html += rowHtml(x);
        }
        rows.innerHTML = html;
      } else rows.innerHTML = list.map(rowHtml).join('');
    };
    draw();
    main.querySelector('#search').addEventListener('input', (e) => { matView.q = e.target.value; draw(); });
    main.querySelector('.f-cat').addEventListener('change', (e) => { matView.cat = e.target.value; draw(); });
    main.querySelector('#f-sort').addEventListener('change', (e) => { matView.sort = e.target.value; draw(); });

    const form = main.querySelector('#mat-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const keep = { cat: form.category.value, kind: form.kind.value, unit: form.unit.value };
      try {
        await api('POST', '/api/materials', Object.fromEntries(new FormData(form)));
        toast(t('saved'));
        await viewMaterials();
        document.getElementById('m-cat').value = keep.cat;
        document.getElementById('m-kind').value = keep.kind;
        document.getElementById('m-unit').value = keep.unit;
        document.getElementById('m-name').focus();
      } catch (err) { main.querySelector('#mat-error').textContent = errText(err); }
    });
    rows.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const mat = materials.find((x) => x.id === Number(tr.dataset.id));
      if (e.target.closest('[data-edit]')) {
        const r = await ask({ title: t('editMaterial'), fields: [
          { name: 'category', label: t('category'), value: mat.category, list: 'cat-list' },
          { name: 'kind', label: t('kind'), value: mat.kind, options: kindOptions },
          { name: 'name', label: t('materialName'), value: mat.name },
          { name: 'unit', label: t('unit'), value: mat.unit, options: unitOptions(mat.unit) },
          { name: 'price', label: t('price'), value: mat.price, inputmode: 'decimal' },
        ] });
        if (!r) return;
        try { await api('PUT', `/api/materials/${mat.id}`, r); toast(t('saved')); viewMaterials(); } catch (err) { fail(err); }
      } else if (e.target.closest('[data-del]')) {
        if (!(await confirmBox(t('confirmDeleteMaterial', { name: mat.name })))) return;
        try { await api('DELETE', `/api/materials/${mat.id}`); viewMaterials(); } catch (err) { fail(err); }
      }
    });
  }

  // ---------- Прайс-лист ----------
  const priceView = { q: '', cat: '' };
  async function viewPriceList() {
    const prices = await api('GET', '/api/pricelist');
    const cats = [...new Set(prices.map((x) => x.category).filter(Boolean))];
    const unitList = [...new Set([...UNITS.map(([u]) => u), ...prices.map((x) => x.unit)])];
    const main = shell('pricelist', `
      <datalist id="pcat-list">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <datalist id="punit-list">${unitList.map((u) => `<option value="${esc(u)}"></option>`).join('')}</datalist>
      <div class="page-head"><h1>${t('priceListTitle')}</h1></div>
      <p class="muted" style="margin-top:-10px">${t('priceListHint')}</p>
      ${isAdmin() ? `
      <form class="card" id="price-form" novalidate>
        <h2>${t('addPriceItem')}</h2>
        <div class="row">
          <div><label for="p-cat">${t('category')}</label><input id="p-cat" name="category" list="pcat-list" value="${esc(priceView.cat === NO_CAT ? '' : priceView.cat)}"></div>
          <div><label for="p-name">${t('materialName')}</label><input id="p-name" name="name"></div>
          <div><label for="p-size">${t('size')}</label><input id="p-size" name="size" placeholder="200*80 см"></div>
          <div><label for="p-unit">${t('unit')}</label><input id="p-unit" name="unit" list="punit-list" value="м²"></div>
          <div><label for="p-price">${t('price')}</label><input id="p-price" name="price" inputmode="decimal"></div>
          <button class="primary" type="submit">${t('add')}</button>
        </div>
        <div class="error" id="price-error"></div>
      </form>` : `<p class="muted">${t('priceReadonly')}</p>`}
      <div class="card">
        <div class="toolbar">
          <input id="search" type="search" placeholder="${esc(t('searchPrice'))}" value="${esc(priceView.q)}" aria-label="${esc(t('search'))}">
          ${catSelect('f-cat', prices, priceView.cat)}
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('materialName')}</th><th>${t('size')}</th><th>${t('unit')}</th><th class="num">${t('price')}</th>${isAdmin() ? '<th style="width:80px"></th>' : ''}</tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>`);
    const rows = main.querySelector('#rows');
    const cols = isAdmin() ? 5 : 4;
    const draw = () => {
      let list = priceView.cat ? prices.filter((x) => (x.category || NO_CAT) === priceView.cat) : prices;
      list = searchList(list, priceView.q, (x) => `${x.name} ${x.size} ${x.category}`);
      if (!list.length) { rows.innerHTML = `<tr><td colspan="${cols}" class="empty">${prices.length ? t('noResults') : t('noPrice')}</td></tr>`; return; }
      const order = [...new Set(list.map((x) => x.category))];
      rows.innerHTML = order.map((c) => `<tr class="group"><td colspan="${cols}">${esc(catLabel(c))}</td></tr>` + list.filter((x) => x.category === c).map((x) => `
        <tr data-id="${x.id}">
          <td>${esc(x.name)}</td>
          <td class="muted">${esc(x.size || '—')}</td>
          <td>${esc(x.unit)}</td>
          <td class="num">${x.price > 0 ? `<b>${fmt(x.price)}</b>` : `<span class="muted">${esc(x.note || t('onRequest'))}</span>`}</td>
          ${isAdmin() ? `<td class="num"><button class="icon" data-edit title="${t('edit')}" aria-label="${t('edit')}">✎</button><button class="icon" data-del title="${t('delete')}" aria-label="${t('delete')}">✕</button></td>` : ''}
        </tr>`).join('')).join('');
    };
    draw();
    main.querySelector('#search').addEventListener('input', (e) => { priceView.q = e.target.value; draw(); });
    main.querySelector('.f-cat').addEventListener('change', (e) => { priceView.cat = e.target.value; draw(); });

    const form = main.querySelector('#price-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const keep = { cat: form.category.value, unit: form.unit.value };
      try {
        await api('POST', '/api/pricelist', Object.fromEntries(new FormData(form)));
        toast(t('saved'));
        await viewPriceList();
        document.getElementById('p-cat').value = keep.cat;
        document.getElementById('p-unit').value = keep.unit;
        document.getElementById('p-name').focus();
      } catch (err) { main.querySelector('#price-error').textContent = errText(err); }
    });
    rows.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const x = prices.find((p) => p.id === Number(tr.dataset.id));
      if (e.target.closest('[data-edit]')) {
        const r = await ask({ title: t('editPriceItem'), fields: [
          { name: 'category', label: t('category'), value: x.category, list: 'pcat-list' },
          { name: 'name', label: t('materialName'), value: x.name },
          { name: 'size', label: t('size'), value: x.size },
          { name: 'unit', label: t('unit'), value: x.unit, list: 'punit-list' },
          { name: 'price', label: t('price'), value: x.price, inputmode: 'decimal' },
          { name: 'note', label: t('note'), value: x.note },
        ] });
        if (!r) return;
        try { await api('PUT', `/api/pricelist/${x.id}`, r); toast(t('saved')); viewPriceList(); } catch (err) { fail(err); }
      } else if (e.target.closest('[data-del]')) {
        if (!(await confirmBox(t('confirmDeletePrice', { name: x.name })))) return;
        try { await api('DELETE', `/api/pricelist/${x.id}`); viewPriceList(); } catch (err) { fail(err); }
      }
    });
  }

  // ---------- Админ-панель ----------
  async function viewAdmin() {
    if (!isAdmin()) { location.hash = '#/projects'; return; }
    const [stats, users] = await Promise.all([api('GET', '/api/stats'), api('GET', '/api/users')]);
    const roleOptions = [{ value: 'employee', label: t('roleEmployee') }, { value: 'admin', label: t('roleAdmin') }];
    const main = shell('admin', `
      <div class="page-head"><h1>${t('adminTitle')}</h1></div>
      <div class="stats">
        <div class="stat"><span class="muted">${t('statProjects')}</span><b>${stats.projects}</b></div>
        <div class="stat"><span class="muted">${t('statMaterials')}</span><b>${stats.materials}</b></div>
        <div class="stat"><span class="muted">${t('statUsers')}</span><b>${stats.users}</b></div>
      </div>
      <form class="card" id="settings-form" novalidate>
        <h2>${t('settingsTitle')}</h2>
        <div class="row row-settings">
          <div><label for="s-margin">${t('marginDefaultLabel')}</label><input id="s-margin" name="margin" value="${fmt(state.settings.margin)}" inputmode="decimal"></div>
          <div><label for="s-vat">${t('vatLabel')}</label><input id="s-vat" name="vat" value="${fmt(state.settings.vat)}" inputmode="decimal"></div>
          <button class="primary" type="submit">${t('save')}</button>
        </div>
        <div class="error" id="settings-error"></div>
      </form>
      <div class="card">
        <h2>${t('usersTitle')}</h2>
        <form id="user-form" novalidate>
          <div class="row row-user">
            <div><label for="u-name">${t('fullName')}</label><input id="u-name" name="name" autocomplete="off"></div>
            <div><label for="u-login">${t('login')}</label><input id="u-login" name="login" autocomplete="off" autocapitalize="off"></div>
            <div><label for="u-pass">${t('password')}</label><input id="u-pass" name="password" type="password" autocomplete="new-password"></div>
            <div><label for="u-pos">${t('position')}</label><select id="u-pos" name="position">${positionOptions().map((o) => `<option value="${o.value}" ${o.value === 'worker' ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>
            <div><label for="u-role">${t('access')}</label><select id="u-role" name="role">${roleOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></div>
            <button class="primary" type="submit">${t('addUser')}</button>
          </div>
          <div class="error" id="user-error"></div>
        </form>
        <div class="table-wrap"><table class="table" style="margin-top:8px">
          <thead><tr><th>${t('fullName')}</th><th>${t('login')}</th><th>${t('position')}</th><th>${t('access')}</th><th>${t('status')}</th><th style="width:250px"></th></tr></thead>
          <tbody id="users">${users.map((u) => {
            const me = u.id === state.user.id;
            return `<tr data-id="${u.id}">
              <td>${esc(u.name)} ${me ? `<span class="muted small">(${t('you')})</span>` : ''}</td>
              <td>${esc(u.login)}</td>
              <td>${t('pos_' + (u.position || 'worker'))}</td>
              <td>${t(u.role === 'admin' ? 'roleAdmin' : 'roleEmployee')}</td>
              <td><span class="tag ${u.active ? 'ok' : 'red'}">${t(u.active ? 'active' : 'blocked')}</span></td>
              <td class="num">
                <button data-act="edit">${t('edit')}</button>
                ${me ? '' : `<button data-act="toggle">${t(u.active ? 'block' : 'unblock')}</button>
                <button class="icon" data-act="delete" title="${t('delete')}" aria-label="${t('delete')}">✕</button>`}
              </td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`);

    const sForm = main.querySelector('#settings-form');
    sForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        state.settings = await api('PUT', '/api/settings', Object.fromEntries(new FormData(sForm)));
        main.querySelector('#settings-error').textContent = '';
        toast(t('saved'));
      } catch (err) { main.querySelector('#settings-error').textContent = errText(err); }
    });
    const uForm = main.querySelector('#user-form');
    // Директору и финансовому директору по умолчанию предлагаем доступ администратора
    uForm.querySelector('#u-pos').addEventListener('change', (e) => {
      uForm.querySelector('#u-role').value = ['director', 'cfo'].includes(e.target.value) ? 'admin' : 'employee';
    });
    uForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/api/users', Object.fromEntries(new FormData(uForm)));
        toast(t('saved'));
        viewAdmin();
      } catch (err) { main.querySelector('#user-error').textContent = errText(err); }
    });
    main.querySelector('#users').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const u = users.find((x) => x.id === Number(btn.closest('tr').dataset.id));
      try {
        if (btn.dataset.act === 'edit') {
          const fields = [{ name: 'name', label: t('fullName'), value: u.name }];
          fields.push({ name: 'position', label: t('position'), value: u.position || 'worker', options: positionOptions() });
          if (u.id !== state.user.id) fields.push({ name: 'role', label: t('access'), value: u.role, options: roleOptions });
          fields.push({ name: 'password', label: `${t('newPassword')}`, type: 'password' });
          const r = await ask({ title: t('editUser'), fields });
          if (!r) return;
          if (!r.password) delete r.password;
          await api('PUT', `/api/users/${u.id}`, r);
          if (u.id === state.user.id) { state.user.name = r.name || state.user.name; state.user.position = r.position || state.user.position; }
        } else if (btn.dataset.act === 'toggle') {
          await api('PUT', `/api/users/${u.id}`, { active: !u.active });
        } else if (btn.dataset.act === 'delete') {
          if (!(await confirmBox(t('confirmDeleteUser', { name: u.name })))) return;
          await api('DELETE', `/api/users/${u.id}`);
        }
        toast(t('saved'));
        viewAdmin();
      } catch (err) { fail(err); }
    });
  }

  // ---------- Маршрутизация ----------
  async function route() {
    if (!state.user) return;
    const h = location.hash.replace(/^#\/?/, '');
    const pm = h.match(/^project\/(\d+)(?:\/(\w+))?$/);
    try {
      if (pm) await viewProject(Number(pm[1]), pm[2]);
      else if (h === 'new') await viewNew();
      else if (h === 'materials') await viewMaterials();
      else if (h === 'pricelist') await viewPriceList();
      else if (h === 'admin') await viewAdmin();
      else await viewProjects();
    } catch (err) {
      if (err.code === 'not_found') { toast(t('err_not_found'), true); location.hash = '#/projects'; }
      else fail(err);
    }
  }

  async function boot() {
    document.documentElement.lang = state.lang;
    try {
      const { needed } = await api('GET', '/api/setup');
      if (needed) return renderAuth({ setup: true });
      const me = await api('GET', '/api/me');
      state.user = me.user;
      state.settings = me.settings;
      if (!location.hash || location.hash === '#/') location.hash = '#/projects';
      else route();
    } catch (err) {
      if (err.message !== 'unauthorized') renderLogin();
    }
  }

  window.addEventListener('hashchange', route);
  boot();
})();
