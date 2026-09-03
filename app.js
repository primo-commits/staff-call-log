(function () {
  'use strict';

  var STORAGE_KEY = 'staffCallLog.contacts.v1';
  var STORAGE_META_KEY = 'staffCallLog.meta.v1';
  var INSTALL_DISMISS_KEY = 'staffCallLog.installDismissed.v1';

  var STATUSES = [
    { key: 'reached', label: 'Reached' },
    { key: 'voicemail', label: 'Voicemail' },
    { key: 'no-answer', label: 'No Answer' },
    { key: 'wrong-number', label: 'Wrong Number' },
    { key: 'callback', label: 'Call Back Later' }
  ];
  var STATUS_KEYS = STATUSES.map(function (s) { return s.key; });
  var STATUS_LABEL = {};
  STATUSES.forEach(function (s) { STATUS_LABEL[s.key] = s.label; });

  var contacts = [];
  var notesSaveTimers = {};

  // ---------- Elements ----------
  var els = {
    importBtn: document.getElementById('importBtn'),
    emptyImportBtn: document.getElementById('emptyImportBtn'),
    exportBtn: document.getElementById('exportBtn'),
    fileInput: document.getElementById('csvFileInput'),
    emptyState: document.getElementById('emptyState'),
    listContainer: document.getElementById('listContainer'),
    contactList: document.getElementById('contactList'),
    searchInput: document.getElementById('searchInput'),
    statusFilter: document.getElementById('statusFilter'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    noResults: document.getElementById('noResults'),
    clearListBtn: document.getElementById('clearListBtn'),
    toast: document.getElementById('toast'),
    installBanner: document.getElementById('installBanner'),
    installBannerText: document.getElementById('installBannerText'),
    installBannerBtn: document.getElementById('installBannerBtn'),
    installBannerClose: document.getElementById('installBannerClose')
  };

  // ---------- Storage ----------
  function loadContacts() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      contacts = raw ? JSON.parse(raw) : [];
    } catch (e) {
      contacts = [];
    }
  }

  function saveContacts() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    } catch (e) {
      showToast('Could not save — storage may be full.');
    }
  }

  function saveMeta(meta) {
    try {
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
    } catch (e) { /* ignore */ }
  }

  // ---------- CSV parsing ----------
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\r') {
        // skip, \n handles the line break
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });
  }

  function csvField(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function normalizeStatus(value) {
    if (!value) return '';
    var v = String(value).trim().toLowerCase();
    if (!v) return '';
    var found = STATUSES.find(function (s) {
      return s.key === v || s.label.toLowerCase() === v || v.indexOf(s.key) !== -1;
    });
    return found ? found.key : '';
  }

  function findColumnIndex(header, patterns) {
    for (var i = 0; i < header.length; i++) {
      for (var p = 0; p < patterns.length; p++) {
        if (header[i].indexOf(patterns[p]) !== -1) return i;
      }
    }
    return -1;
  }

  function buildContactsFromRows(rows) {
    if (!rows.length) return [];
    var startIdx = 0;
    var nameIdx = 0, phoneIdx = 1, statusIdx = -1, notesIdx = -1;

    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var looksLikeHeader = header.some(function (h) {
      return h.indexOf('name') !== -1 || h.indexOf('phone') !== -1 || h.indexOf('number') !== -1 || h.indexOf('tel') !== -1;
    });

    if (looksLikeHeader) {
      startIdx = 1;
      var ni = findColumnIndex(header, ['name']);
      var pi = findColumnIndex(header, ['phone', 'mobile', 'cell', 'number', 'tel']);
      statusIdx = findColumnIndex(header, ['status', 'outcome', 'result']);
      notesIdx = findColumnIndex(header, ['note']);
      if (ni !== -1) nameIdx = ni;
      if (pi !== -1) phoneIdx = pi;
    }

    var out = [];
    for (var i = startIdx; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var name = (r[nameIdx] || '').trim();
      var phone = (r[phoneIdx] || '').trim();
      if (!name && !phone) continue;
      var status = statusIdx !== -1 ? normalizeStatus(r[statusIdx]) : '';
      var notes = notesIdx !== -1 ? (r[notesIdx] || '').trim() : '';
      out.push({
        id: makeId(),
        name: name || '(no name)',
        phone: phone,
        status: status,
        notes: notes,
        calledAt: status ? new Date().toISOString() : null
      });
    }
    return out;
  }

  function makeId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function telHref(phone) {
    var cleaned = (phone || '').replace(/[^\d+]/g, '');
    return 'tel:' + cleaned;
  }

  // ---------- Rendering ----------
  function render() {
    var hasContacts = contacts.length > 0;
    els.emptyState.hidden = hasContacts;
    els.listContainer.hidden = !hasContacts;
    els.exportBtn.disabled = !hasContacts;
    if (!hasContacts) return;

    var query = els.searchInput.value.trim().toLowerCase();
    var filter = els.statusFilter.value;

    var visible = contacts.filter(function (c) {
      if (filter === 'pending' && c.status) return false;
      if (filter !== 'all' && filter !== 'pending' && c.status !== filter) return false;
      if (query) {
        var hay = (c.name + ' ' + c.phone).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    els.contactList.innerHTML = '';
    els.noResults.hidden = visible.length !== 0;

    var frag = document.createDocumentFragment();
    visible.forEach(function (c) {
      frag.appendChild(renderContact(c));
    });
    els.contactList.appendChild(frag);

    var calledCount = contacts.filter(function (c) { return c.status; }).length;
    var pct = contacts.length ? Math.round((calledCount / contacts.length) * 100) : 0;
    els.progressFill.style.width = pct + '%';
    els.progressText.textContent = calledCount + ' of ' + contacts.length + ' called';
  }

  function renderContact(c) {
    var li = document.createElement('li');
    li.className = 'contact';
    li.dataset.id = c.id;
    if (c.status) li.dataset.status = c.status;

    var main = document.createElement('div');
    main.className = 'contact-main';

    var name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = c.name;
    main.appendChild(name);

    if (c.phone) {
      var phoneLink = document.createElement('a');
      phoneLink.className = 'contact-phone';
      phoneLink.href = telHref(c.phone);
      phoneLink.textContent = c.phone;
      main.appendChild(phoneLink);
    }
    li.appendChild(main);

    var chips = document.createElement('div');
    chips.className = 'status-chips';
    STATUSES.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-chip' + (c.status === s.key ? ' active' : '');
      btn.dataset.status = s.key;
      btn.textContent = s.label;
      btn.addEventListener('click', function () { setStatus(c.id, s.key); });
      chips.appendChild(btn);
    });
    li.appendChild(chips);

    var footer = document.createElement('div');
    footer.className = 'contact-footer';

    var notesToggle = document.createElement('button');
    notesToggle.type = 'button';
    notesToggle.className = 'notes-toggle';
    notesToggle.textContent = c.notes ? 'Edit note' : '+ Add note';
    footer.appendChild(notesToggle);

    if (c.calledAt) {
      var when = document.createElement('span');
      when.className = 'called-at';
      when.textContent = formatTime(c.calledAt);
      footer.appendChild(when);
    }
    li.appendChild(footer);

    var notesInput = document.createElement('textarea');
    notesInput.className = 'notes-input';
    notesInput.placeholder = 'Notes (optional)';
    notesInput.value = c.notes || '';
    notesInput.hidden = !c.notes;
    notesInput.addEventListener('input', function () {
      scheduleNotesSave(c.id, notesInput.value);
    });
    li.appendChild(notesInput);

    notesToggle.addEventListener('click', function () {
      notesInput.hidden = !notesInput.hidden;
      if (!notesInput.hidden) notesInput.focus();
    });

    return li;
  }

  function formatTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  // ---------- Mutations ----------
  function setStatus(id, statusKey) {
    var c = contacts.find(function (x) { return x.id === id; });
    if (!c) return;
    c.status = c.status === statusKey ? '' : statusKey;
    c.calledAt = c.status ? new Date().toISOString() : null;
    saveContacts();
    render();
  }

  function scheduleNotesSave(id, value) {
    clearTimeout(notesSaveTimers[id]);
    notesSaveTimers[id] = setTimeout(function () {
      var c = contacts.find(function (x) { return x.id === id; });
      if (!c) return;
      c.notes = value;
      saveContacts();
    }, 300);
  }

  // ---------- Import ----------
  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var rows = parseCSV(text);
      var imported = buildContactsFromRows(rows);
      if (!imported.length) {
        showToast('No contacts found in that file.');
        return;
      }
      if (contacts.length) {
        var ok = window.confirm('Importing will replace your current list of ' + contacts.length + ' contact(s). Continue?');
        if (!ok) return;
      }
      contacts = imported;
      saveContacts();
      saveMeta({ importedAt: new Date().toISOString(), fileName: file.name, count: imported.length });
      els.searchInput.value = '';
      els.statusFilter.value = 'all';
      render();
      showToast('Imported ' + imported.length + ' contact' + (imported.length === 1 ? '' : 's') + '.');
    };
    reader.onerror = function () {
      showToast('Could not read that file.');
    };
    reader.readAsText(file);
  }

  // ---------- Export ----------
  function exportCSV() {
    if (!contacts.length) return;
    var header = ['Name', 'Phone', 'Status', 'Notes', 'Called At'];
    var lines = [header.map(csvField).join(',')];
    contacts.forEach(function (c) {
      lines.push([
        csvField(c.name),
        csvField(c.phone),
        csvField(STATUS_LABEL[c.status] || ''),
        csvField(c.notes || ''),
        csvField(c.calledAt || '')
      ].join(','));
    });
    var csv = lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'call-log-' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Exported ' + contacts.length + ' contact' + (contacts.length === 1 ? '' : 's') + '.');
  }

  // ---------- Toast ----------
  var toastTimer;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  // ---------- Install prompt ----------
  var deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function setupInstallBanner() {
    if (isStandalone()) return;
    if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      els.installBannerText.textContent = 'Install this app for quick one-tap access.';
      els.installBanner.hidden = false;
    });

    if (isIOS()) {
      els.installBannerText.textContent = 'Add to your Home Screen: tap Share, then "Add to Home Screen".';
      els.installBannerBtn.hidden = true;
      els.installBanner.hidden = false;
    }
  }

  els.installBannerBtn.addEventListener('click', function () {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(function () {
      deferredInstallPrompt = null;
      els.installBanner.hidden = true;
    });
  });

  els.installBannerClose.addEventListener('click', function () {
    els.installBanner.hidden = true;
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
  });

  // ---------- Events ----------
  els.importBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.emptyImportBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    handleFile(file);
    els.fileInput.value = '';
  });
  els.exportBtn.addEventListener('click', exportCSV);
  els.searchInput.addEventListener('input', render);
  els.statusFilter.addEventListener('change', render);
  els.clearListBtn.addEventListener('click', function () {
    var ok = window.confirm('Clear the entire list from this device? This cannot be undone (export first if you need a copy).');
    if (!ok) return;
    contacts = [];
    saveContacts();
    saveMeta(null);
    render();
    showToast('List cleared.');
  });

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () { /* ignore */ });
    });
  }

  // ---------- Init ----------
  loadContacts();
  render();
  setupInstallBanner();
})();
