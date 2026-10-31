'use strict';

const DB_NAME = 'paperleaf-db';
const DB_VERSION = 1;
const COLORS = ['none', 'sage', 'sand', 'rose', 'lilac', 'blue'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();

const state = {
  notes: [], folders: [], view: 'all', folderId: null, tag: null,
  activeId: null, query: '', sort: 'updated', grid: false, theme: 'light',
  mobileEditorOpen: false, preview: false, dirty: false, saveTimer: null, toastTimer: null,
  db: null, lastSaved: null,
};

const els = {
  sidebar: $('#sidebar'), sidebarScrim: $('#sidebarScrim'), notesPanel: $('#notesPanel'), editorPanel: $('#editorPanel'),
  notesList: $('#notesList'), emptyList: $('#emptyList'), editorEmpty: $('#editorEmpty'), editorWrap: $('#editorWrap'),
  listTitle: $('#listTitle'), listSubtitle: $('#listSubtitle'), listEyebrow: $('#listEyebrow'), noteTotal: $('#noteTotal'), allCount: $('#allCount'),
  search: $('#searchInput'), clearSearch: $('#clearSearch'), noteTitle: $('#noteTitle'), noteContent: $('#noteContent'), notePreview: $('#notePreview'),
  tagInput: $('#tagInput'), tagChips: $('#tagChips'), noteContext: $('#noteContext'), noteUpdated: $('#noteUpdated'),
  saveIndicator: $('#saveIndicator'), wordCount: $('#wordCount'), noteMenu: $('#noteMenu'), modalBackdrop: $('#modalBackdrop'),
  modalTitle: $('#modalTitle'), modalEyebrow: $('#modalEyebrow'), modalBody: $('#modalBody'), modalFooter: $('#modalFooter'), toast: $('#toast'),
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available in this browser.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
  });
}

function storeRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    try { request = action(store); } catch (error) { reject(error); return; }
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Storage operation failed.'));
    } else {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Storage operation failed.'));
    }
  });
}

const db = {
  getAll: (name) => storeRequest(name, 'readonly', store => store.getAll()),
  put: (name, value) => storeRequest(name, 'readwrite', store => store.put(value)),
  delete: (name, key) => storeRequest(name, 'readwrite', store => store.delete(key)),
  clear: (name) => storeRequest(name, 'readwrite', store => store.clear()),
};

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function sanitizeHTML(html = '') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const allowed = new Set(['DIV','P','BR','B','STRONG','I','EM','U','S','STRIKE','H2','H3','UL','OL','LI','BLOCKQUOTE','PRE','CODE','A']);
  const cleanNode = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          cleanNode(node);
          return;
        }
        [...child.attributes].forEach(attr => {
          if (child.tagName === 'A' && attr.name === 'href') {
            try {
              const url = new URL(attr.value, location.href);
              if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) child.removeAttribute('href');
              else child.setAttribute('href', url.href);
            } catch { child.removeAttribute('href'); }
          } else if (attr.name !== 'href') child.removeAttribute(attr.name);
        });
        cleanNode(child);
      } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
    });
  };
  const root = doc.body.firstElementChild;
  cleanNode(root);
  return root.innerHTML;
}

function plainText(html = '') {
  const doc = new DOMParser().parseFromString(sanitizeHTML(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function formatDate(value, compact = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return compact ? 'Today' : `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

function getActiveNote() { return state.notes.find(note => note.id === state.activeId) || null; }
function getFolder(id) { return state.folders.find(folder => folder.id === id) || null; }
function isVisible(note) {
  if (state.view === 'trash') return note.trashed;
  if (note.trashed) return false;
  if (state.view === 'archive') return note.archived;
  if (note.archived) return false;
  if (state.view === 'favorites' && !note.favorite) return false;
  if (state.view === 'folder' && note.folderId !== state.folderId) return false;
  if (state.view === 'tag' && !(note.tags || []).includes(state.tag)) return false;
  return true;
}
function filteredNotes() {
  const query = state.query.trim().toLowerCase();
  const items = state.notes.filter(note => {
    if (!isVisible(note)) return false;
    if (!query) return true;
    const folder = getFolder(note.folderId);
    return [note.title, plainText(note.content), ...(note.tags || []), folder?.name || ''].join(' ').toLowerCase().includes(query);
  });
  const sort = state.sort;
  items.sort((a, b) => {
    if (state.view !== 'trash' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'title') return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
    if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  return items;
}

function setView(view, extra = {}) {
  flushPendingEditor();
  state.view = view; state.folderId = extra.folderId ?? null; state.tag = extra.tag ?? null;
  state.activeId = null; state.mobileEditorOpen = false;
  closeSidebar(); render();
}

function updateListHeading() {
  const labels = {
    all: ['YOUR SPACE', 'All notes', 'A clear place for everything on your mind.'],
    favorites: ['YOUR PICKS', 'Favorites', 'The notes you want close at hand.'],
    archive: ['OUT OF SIGHT', 'Archive', 'Notes you want to keep, just not in the way.'],
    trash: ['RECENTLY REMOVED', 'Trash', 'Restore a note or remove it permanently.'],
    folder: ['FOLDER', getFolder(state.folderId)?.name || 'Folder', 'Everything collected in one place.'],
    tag: ['TAG', `#${state.tag || ''}`, 'Notes connected by the same idea.'],
  };
  const [eyebrow, title, subtitle] = labels[state.view] || labels.all;
  els.listEyebrow.textContent = eyebrow;
  els.listTitle.textContent = title;
  els.listSubtitle.textContent = state.query ? `Search results for “${state.query}”` : subtitle;
  const count = filteredNotes().length;
  els.noteTotal.textContent = `${count} ${count === 1 ? 'note' : 'notes'}`;
  els.allCount.textContent = state.notes.filter(note => !note.trashed && !note.archived).length;
}

function render() {
  updateListHeading();
  renderNavigation();
  renderNotes();
  renderEditor();
  $('#layoutButton').innerHTML = state.grid ? '<svg><use href="#i-notes"/></svg>' : '<svg><use href="#i-grid"/></svg>';
  document.body.classList.toggle('dark', state.theme === 'dark');
  $('#themeButton').innerHTML = state.theme === 'dark' ? '<svg><use href="#i-sun"/></svg>' : '<svg><use href="#i-moon"/></svg>';
  els.clearSearch.classList.toggle('visible', Boolean(state.query));
}

function renderNavigation() {
  $$('.nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view && state.view !== 'folder' && state.view !== 'tag'));
  const folderNav = $('#folderNav');
  folderNav.innerHTML = '';
  if (!state.folders.length) folderNav.innerHTML = '<div class="sidebar-hint">Your folders will appear here.</div>';
  state.folders.sort((a,b) => a.name.localeCompare(b.name)).forEach(folder => {
    const row = document.createElement('div'); row.className = 'folder-row';
    const button = document.createElement('button');
    button.className = `nav-item ${state.view === 'folder' && state.folderId === folder.id ? 'active' : ''}`;
    button.innerHTML = '<span class="folder-dot"></span><span class="folder-name"></span><span class="nav-count"></span>';
    $('.folder-name', button).textContent = folder.name;
    $('.nav-count', button).textContent = state.notes.filter(note => !note.trashed && !note.archived && note.folderId === folder.id).length || '';
    button.addEventListener('click', () => setView('folder', { folderId: folder.id }));
    button.addEventListener('contextmenu', event => { event.preventDefault(); showFolderMenu(folder); });
    const more = document.createElement('button'); more.className = 'folder-more'; more.type = 'button'; more.setAttribute('aria-label', `Options for ${folder.name}`); more.title = 'Folder options'; more.textContent = '···';
    more.addEventListener('click', event => { event.stopPropagation(); showFolderMenu(folder); });
    row.append(button, more); folderNav.append(row);
  });
  const tags = [...new Set(state.notes.filter(note => !note.trashed && !note.archived).flatMap(note => note.tags || []))].sort((a,b) => a.localeCompare(b));
  const tagNav = $('#tagNav'); tagNav.innerHTML = '';
  if (!tags.length) tagNav.innerHTML = '<div class="sidebar-hint">Tags make notes easier to find.</div>';
  tags.slice(0, 12).forEach(tag => {
    const button = document.createElement('button'); button.className = `nav-item ${state.view === 'tag' && state.tag === tag ? 'active' : ''}`;
    button.innerHTML = '<span style="color:#9eb6a4;font-size:13px">#</span><span></span>';
    $('span:nth-child(2)', button).textContent = tag;
    button.addEventListener('click', () => setView('tag', { tag })); tagNav.append(button);
  });
}

function renderNotes() {
  const items = filteredNotes();
  els.notesList.classList.toggle('grid-view', state.grid);
  els.notesList.innerHTML = '';
  els.emptyList.hidden = items.length > 0;
  if (!items.length) {
    const hasSearch = Boolean(state.query);
    $('#emptyTitle').textContent = hasSearch ? 'Nothing found.' : state.view === 'trash' ? 'Trash is clear.' : state.view === 'archive' ? 'Nothing archived.' : 'A fresh page.';
    $('#emptyText').textContent = hasSearch ? 'Try another word or check your spelling.' : state.view === 'trash' ? 'Deleted notes will stay here until you remove them permanently.' : state.view === 'archive' ? 'Archived notes will be tucked away here.' : 'Create a note and get that thought out of your head.';
    $('#emptyNewNote').style.display = ['trash','archive'].includes(state.view) || hasSearch ? 'none' : 'inline-flex';
  }
  items.forEach(note => {
    const card = document.createElement('article');
    card.className = `note-card ${note.id === state.activeId ? 'selected' : ''} ${note.color && note.color !== 'none' ? `color-${note.color}` : ''}`;
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Open note ${note.title || 'Untitled'}`);
    const title = document.createElement('h3'); title.textContent = note.title.trim() || 'Untitled note';
    const body = document.createElement('p'); body.textContent = plainText(note.content) || 'No additional text';
    const top = document.createElement('div'); top.className = 'card-topline';
    const time = document.createElement('span'); time.className = 'card-time'; time.textContent = formatDate(note.updatedAt, true);
    const flags = document.createElement('span'); flags.className = 'card-flags';
    if (note.pinned) flags.insertAdjacentHTML('beforeend', '<svg title="Pinned"><use href="#i-pin"/></svg>');
    if (note.favorite) flags.insertAdjacentHTML('beforeend', '<svg title="Favorite"><use href="#i-star"/></svg>');
    top.append(time, flags);
    const bottom = document.createElement('div'); bottom.className = 'card-bottom';
    const tags = document.createElement('div'); tags.className = 'card-tags';
    (note.tags || []).slice(0,2).forEach(tag => { const chip = document.createElement('span'); chip.className = 'card-tag'; chip.textContent = `#${tag}`; tags.append(chip); });
    const folder = document.createElement('span'); folder.className = 'card-folder'; folder.textContent = getFolder(note.folderId)?.name || '';
    bottom.append(tags, folder);
    card.append(top, title, body, bottom);
    const open = () => openNote(note.id);
    card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    els.notesList.append(card);
  });
}

function renderEditor() {
  const note = getActiveNote();
  const visible = Boolean(note);
  els.editorEmpty.hidden = visible; els.editorWrap.hidden = !visible;
  els.editorPanel.classList.toggle('mobile-open', state.mobileEditorOpen && visible);
  if (!visible) return;
  els.noteContext.textContent = note.trashed ? 'IN TRASH' : note.archived ? 'ARCHIVED NOTE' : (getFolder(note.folderId)?.name || 'PERSONAL NOTE').toUpperCase();
  els.noteUpdated.textContent = `Edited ${formatDate(note.updatedAt)}`;
  els.noteTitle.value = note.title || '';
  els.noteContent.innerHTML = sanitizeHTML(note.content || '');
  els.noteContent.hidden = state.preview;
  els.notePreview.hidden = !state.preview;
  els.notePreview.innerHTML = sanitizeHTML(note.content || '');
  $('#previewButton').classList.toggle('active', state.preview);
  $('#previewButton span').textContent = state.preview ? 'Edit' : 'Preview';
  $('#previewButton').title = state.preview ? 'Edit note' : 'Preview note';
  $('#favoriteButton').classList.toggle('is-active', Boolean(note.favorite));
  $('#favoriteButton').setAttribute('aria-label', note.favorite ? 'Remove from favorites' : 'Add to favorites');
  $('#pinButton').classList.toggle('is-active', Boolean(note.pinned));
  $('#pinButton').setAttribute('aria-label', note.pinned ? 'Unpin note' : 'Pin note');
  els.noteMenu.innerHTML = note.trashed
    ? '<button data-action="restore"><svg><use href="#i-restore"/></svg> Restore note</button><div class="dropdown-divider"></div><button class="danger-action" data-action="permanent-delete"><svg><use href="#i-trash"/></svg> Delete forever</button>'
    : `<button data-action="color"><svg><use href="#i-palette"/></svg> Change color</button><button data-action="folder"><svg><use href="#i-folder"/></svg> Move to folder</button><button data-action="markdown"><svg><use href="#i-download"/></svg> Export as Markdown</button><button data-action="archive"><svg><use href="#i-archive"/></svg> ${note.archived ? 'Move to all notes' : 'Archive note'}</button><div class="dropdown-divider"></div><button class="danger-action" data-action="delete"><svg><use href="#i-trash"/></svg> Move to trash</button>`;
  $('#moreButton').setAttribute('aria-label', note.trashed ? 'Restore or delete note' : 'More note actions');
  renderTags(); updateWordCount();
  const trash = note.trashed;
  $('#favoriteButton').disabled = trash; $('#pinButton').disabled = trash;
  if (trash) {
    $('#noteTitle').readOnly = true; els.noteContent.contentEditable = 'false'; $('#tagInput').disabled = true;
  } else {
    $('#noteTitle').readOnly = false; els.noteContent.contentEditable = 'true'; $('#tagInput').disabled = false;
  }
}

function renderTags() {
  const note = getActiveNote(); if (!note) return;
  els.tagChips.innerHTML = '';
  (note.tags || []).forEach(tag => {
    const chip = document.createElement('span'); chip.className = 'tag-chip';
    const label = document.createElement('span'); label.textContent = `#${tag}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove tag ${tag}`); remove.innerHTML = '<svg><use href="#i-x"/></svg>';
    remove.addEventListener('click', () => { flushPendingEditor(); note.tags = note.tags.filter(item => item !== tag); saveNote(note); renderTags(); renderNotes(); renderNavigation(); });
    chip.append(label, remove); els.tagChips.append(chip);
  });
}

function updateWordCount() {
  const text = plainText(els.noteContent.innerHTML);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  els.wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
}

function openNote(id) {
  if (state.activeId !== id) flushPendingEditor();
  const note = state.notes.find(item => item.id === id); if (!note) return;
  state.activeId = id; state.preview = false; state.mobileEditorOpen = true;
  render();
}

async function createNote() {
  closeSidebar();
  await flushPendingEditor();
  const note = { id: uid(), title: '', content: '', createdAt: now(), updatedAt: now(), folderId: state.view === 'folder' ? state.folderId : null, tags: [], pinned: false, favorite: false, archived: false, trashed: false, color: 'none' };
  state.notes.unshift(note); await saveNote(note, false);
  state.view = 'all'; state.folderId = null; state.tag = null;
  openNote(note.id); render();
  setTimeout(() => $('#noteTitle').focus(), 30);
}

async function saveNote(note, updateTimestamp = true) {
  if (!note) return;
  if (updateTimestamp) note.updatedAt = now();
  try {
    await db.put('notes', note);
    state.lastSaved = note.updatedAt;
    setSaveState('saved');
    renderNotes(); renderNavigation();
  } catch (error) {
    console.error(error); setSaveState('error'); showToast('Could not save. Export a backup before closing.');
  }
}

function flushPendingEditor() {
  clearTimeout(state.saveTimer);
  const note = getActiveNote();
  if (!note || note.trashed || !state.dirty) return Promise.resolve();
  note.title = els.noteTitle.value.trimStart();
  note.content = sanitizeHTML(els.noteContent.innerHTML);
  state.dirty = false;
  return saveNote(note);
}

function queueSave() {
  const note = getActiveNote(); if (!note || note.trashed) return;
  state.dirty = true;
  setSaveState('saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    const current = getActiveNote(); if (!current || current.id !== note.id) return;
    current.title = els.noteTitle.value.trimStart();
    current.content = sanitizeHTML(els.noteContent.innerHTML);
    state.dirty = false;
    await saveNote(current);
    els.noteUpdated.textContent = `Edited ${formatDate(current.updatedAt)}`;
    updateWordCount();
  }, 450);
}

function setSaveState(status) {
  els.saveIndicator.classList.toggle('saving', status === 'saving');
  els.saveIndicator.classList.toggle('error', status === 'error');
  const text = status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved on this device';
  els.saveIndicator.lastElementChild.textContent = text;
}

function showToast(message) {
  els.toast.textContent = message; els.toast.classList.add('show');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function closeSidebar() { els.sidebar.classList.remove('open'); els.sidebarScrim.classList.remove('visible'); }
function openSidebar() { els.sidebar.classList.add('open'); els.sidebarScrim.classList.add('visible'); }

function showModal({ eyebrow = 'PAPERLEAF', title, body, buttons = [] }) {
  els.modalEyebrow.textContent = eyebrow; els.modalTitle.textContent = title;
  els.modalBody.innerHTML = ''; els.modalFooter.innerHTML = '';
  if (typeof body === 'string') els.modalBody.innerHTML = body; else els.modalBody.append(body);
  buttons.forEach(config => {
    const button = document.createElement('button'); button.className = config.className || 'secondary-button'; button.textContent = config.label;
    button.addEventListener('click', async () => { try { const result = config.action ? await config.action() : undefined; if (result !== false && config.close !== false) closeModal(); } catch (error) { console.error(error); } });
    els.modalFooter.append(button);
  });
  els.modalBackdrop.hidden = false;
  const firstInput = $('input', els.modalBody); if (firstInput) setTimeout(() => firstInput.focus(), 30);
}
function closeModal() { els.modalBackdrop.hidden = true; }

function addFolder() {
  const wrap = document.createElement('div'); wrap.innerHTML = '<div class="modal-field"><label for="folderNameInput">FOLDER NAME</label><input id="folderNameInput" maxlength="40" placeholder="e.g. Ideas, Study, Personal"></div>';
  showModal({ title: 'Create a folder', body: wrap, buttons: [{ label: 'Cancel' }, { label: 'Create folder', className: 'modal-primary', action: async () => {
    const name = $('#folderNameInput').value.trim(); if (!name) { showToast('Give your folder a name first.'); return false; }
    if (state.folders.some(folder => folder.name.toLowerCase() === name.toLowerCase())) { showToast('That folder already exists.'); return false; }
    const folder = { id: uid(), name, createdAt: now() }; state.folders.push(folder); await db.put('folders', folder); render(); showToast('Folder created.');
  }}] });
}

function showFolderMenu(folder) {
  const wrap = document.createElement('div');
  const p = document.createElement('p'); p.className = 'modal-copy'; p.textContent = `Manage “${folder.name}”. Notes inside it will be kept if you delete the folder.`; wrap.append(p);
  const inputWrap = document.createElement('div'); inputWrap.className = 'modal-field'; inputWrap.innerHTML = '<label for="renameFolderInput">FOLDER NAME</label><input id="renameFolderInput" maxlength="40">';
  $('#renameFolderInput', inputWrap).value = folder.name; wrap.append(inputWrap);
  showModal({ title: 'Folder settings', body: wrap, buttons: [
    { label: 'Delete folder', className: 'danger-button', action: async () => { state.notes.filter(note => note.folderId === folder.id).forEach(note => note.folderId = null); for (const note of state.notes) await db.put('notes', note); state.folders = state.folders.filter(item => item.id !== folder.id); await db.delete('folders', folder.id); if (state.folderId === folder.id) setView('all'); else render(); showToast('Folder deleted. Notes were kept.'); } },
    { label: 'Save name', className: 'modal-primary', action: async () => { const name = $('#renameFolderInput').value.trim(); if (!name) { showToast('Folder name cannot be empty.'); return false; } if (state.folders.some(item => item.id !== folder.id && item.name.toLowerCase() === name.toLowerCase())) { showToast('That folder name is already in use.'); return false; } folder.name = name.slice(0,40); await db.put('folders', folder); render(); showToast('Folder updated.'); } },
  ] });
}

function chooseColor() {
  flushPendingEditor();
  const note = getActiveNote(); if (!note) return;
  const wrap = document.createElement('div'); wrap.className = 'color-options';
  COLORS.forEach(color => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `color-option ${note.color === color ? 'selected' : ''}`; button.dataset.color = color; button.title = color === 'none' ? 'Default' : color; button.setAttribute('aria-label', button.title);
    button.addEventListener('click', async () => { note.color = color; await saveNote(note); closeModal(); render(); }); wrap.append(button);
  });
  showModal({ title: 'Choose a note color', body: wrap, buttons: [{ label: 'Done', className: 'modal-primary' }] });
}

function chooseFolder() {
  flushPendingEditor();
  const note = getActiveNote(); if (!note) return;
  const wrap = document.createElement('div');
  const choices = [{ id: null, name: 'No folder' }, ...state.folders];
  choices.forEach(folder => {
    const button = document.createElement('button'); button.className = `folder-choice ${note.folderId === folder.id ? 'selected' : ''}`;
    button.innerHTML = '<span class="folder-dot"></span><span></span>';
    $('span:nth-child(2)', button).textContent = folder.name;
    button.addEventListener('click', async () => { note.folderId = folder.id; await saveNote(note); closeModal(); render(); }); wrap.append(button);
  });
  showModal({ title: 'Move to folder', body: wrap, buttons: [{ label: 'Cancel' }] });
}

async function archiveNote() {
  await flushPendingEditor();
  const note = getActiveNote(); if (!note) return;
  note.archived = !note.archived; await saveNote(note); state.activeId = null; state.mobileEditorOpen = false; render(); showToast(note.archived ? 'Note archived.' : 'Note restored to all notes.');
}

async function moveToTrash() {
  await flushPendingEditor();
  const note = getActiveNote(); if (!note) return;
  note.trashed = true; note.archived = false; await saveNote(note); state.activeId = null; state.mobileEditorOpen = false; render(); showToast('Moved to trash.');
}

async function restoreFromTrash() {
  const note = getActiveNote(); if (!note) return;
  note.trashed = false; note.archived = false;
  await saveNote(note); state.activeId = null; state.mobileEditorOpen = false; render(); showToast('Note restored.');
}

function confirmPermanentDelete(note) {
  const text = document.createElement('p'); text.className = 'modal-copy'; text.textContent = 'This note will be permanently removed from this device. This cannot be undone.';
  showModal({ title: 'Delete forever?', body: text, buttons: [
    { label: 'Keep note' },
    { label: 'Delete forever', className: 'danger-button', action: async () => { await db.delete('notes', note.id); state.notes = state.notes.filter(item => item.id !== note.id); state.activeId = null; state.mobileEditorOpen = false; render(); showToast('Note permanently deleted.'); } },
  ] });
}

async function toggleFavorite() { await flushPendingEditor(); const note = getActiveNote(); if (!note) return; note.favorite = !note.favorite; await saveNote(note); renderEditor(); showToast(note.favorite ? 'Added to favorites.' : 'Removed from favorites.'); }
async function togglePin() { await flushPendingEditor(); const note = getActiveNote(); if (!note) return; note.pinned = !note.pinned; await saveNote(note); renderEditor(); showToast(note.pinned ? 'Note pinned.' : 'Note unpinned.'); }

function addTag(value) {
  flushPendingEditor();
  const note = getActiveNote(); if (!note || note.trashed) return;
  const tag = value.trim().replace(/^#/, '').replace(/,/g, '').slice(0, 24);
  if (!tag) return;
  if ((note.tags || []).some(item => item.toLowerCase() === tag.toLowerCase())) { els.tagInput.value = ''; return; }
  note.tags = [...(note.tags || []), tag]; els.tagInput.value = ''; saveNote(note); renderTags(); renderNotes(); renderNavigation();
}

function applyCommand(command, value = null) {
  els.noteContent.focus();
  if (command === 'checklist') {
    document.execCommand('insertHTML', false, '<ul><li>☐ </li></ul>');
  } else if (command === 'formatBlock') {
    document.execCommand('formatBlock', false, value || 'h2');
  } else {
    document.execCommand(command, false, value);
  }
  queueSave();
}

function exportJSON() {
  const payload = { app: 'Paperleaf', schemaVersion: 1, exportedAt: now(), notes: state.notes, folders: state.folders };
  downloadFile(`paperleaf-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('Backup downloaded.');
}
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(sanitizeHTML(html), 'text/html');
  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const inner = [...node.childNodes].map(convert).join('');
    switch (node.tagName) {
      case 'H2': return `## ${inner}\n\n`; case 'H3': return `### ${inner}\n\n`;
      case 'STRONG': case 'B': return `**${inner}**`; case 'EM': case 'I': return `*${inner}*`;
      case 'U': return `<u>${inner}</u>`; case 'A': return `[${inner}](${node.getAttribute('href') || ''})`;
      case 'LI': return `- ${inner}\n`; case 'UL': case 'OL': return `${inner}\n`;
      case 'BLOCKQUOTE': return `${inner.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n')}\n\n`;
      case 'P': case 'DIV': return `${inner}\n\n`; case 'BR': return '\n'; default: return inner;
    }
  }
  return [...doc.body.childNodes].map(convert).join('').replace(/\n{3,}/g, '\n\n').trim();
}
function exportCurrentMarkdown() {
  const note = getActiveNote(); if (!note) return;
  const title = note.title.trim() || 'Untitled note';
  const markdown = `# ${title}\n\n${htmlToMarkdown(note.content)}\n`;
  downloadFile(`${title.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'note'}.md`, markdown, 'text/markdown;charset=utf-8');
  showToast('Markdown note downloaded.');
}

function openSettings() {
  const wrap = document.createElement('div');
  const backup = document.createElement('div'); backup.className = 'backup-row';
  backup.innerHTML = '<div class="backup-icon"><svg><use href="#i-download"/></svg></div><div><strong>Export a full backup</strong><small>Download all notes and folders as a JSON file.</small></div>';
  const exportBtn = document.createElement('button'); exportBtn.className = 'secondary-button'; exportBtn.textContent = 'Export'; exportBtn.addEventListener('click', exportJSON); backup.append(exportBtn);
  const importRow = document.createElement('div'); importRow.className = 'backup-row';
  importRow.innerHTML = '<div class="backup-icon"><svg><use href="#i-restore"/></svg></div><div><strong>Restore from backup</strong><small>Import a Paperleaf JSON backup from this or another device.</small></div>';
  const importBtn = document.createElement('button'); importBtn.className = 'secondary-button'; importBtn.textContent = 'Choose file'; importBtn.addEventListener('click', () => $('#importFile').click()); importRow.append(importBtn);
  const file = document.createElement('input'); file.type = 'file'; file.id = 'importFile'; file.accept = 'application/json,.json'; file.hidden = true;
  file.addEventListener('change', async () => { if (file.files?.[0]) await importJSON(file.files[0]); });
  const info = document.createElement('p'); info.className = 'modal-copy'; info.style.marginTop = '15px'; info.textContent = 'Paperleaf stores notes in this browser on this device. There are no accounts, trackers, or cloud sync in this version. Clearing browser data can remove notes, so keep a backup.';
  wrap.append(backup, importRow, file, info);
  showModal({ title: 'Backup & settings', body: wrap, buttons: [{ label: 'Done', className: 'modal-primary' }] });
}

async function importJSON(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.notes) || !Array.isArray(parsed.folders)) throw new Error('This does not look like a Paperleaf backup.');
    const existingIds = new Set(state.notes.map(note => note.id));
    let added = 0;
    for (const raw of parsed.folders) {
      if (!raw || typeof raw.name !== 'string') continue;
      const name = raw.name.trim().slice(0,40); if (!name) continue;
      const folder = { id: String(raw.id || uid()), name, createdAt: raw.createdAt || now() };
      if (!state.folders.some(item => item.id === folder.id)) { state.folders.push(folder); await db.put('folders', folder); }
    }
    for (const raw of parsed.notes) {
      if (!raw || typeof raw !== 'object') continue;
      let id = String(raw.id || uid()); if (existingIds.has(id)) id = uid();
      const note = {
        id, title: String(raw.title || '').slice(0,180), content: sanitizeHTML(String(raw.content || '')),
        createdAt: raw.createdAt || now(), updatedAt: raw.updatedAt || now(),
        folderId: state.folders.some(folder => folder.id === raw.folderId) ? raw.folderId : null,
        tags: Array.isArray(raw.tags) ? raw.tags.map(tag => String(tag).slice(0,24)).filter(Boolean).slice(0,30) : [],
        pinned: Boolean(raw.pinned), favorite: Boolean(raw.favorite), archived: Boolean(raw.archived), trashed: Boolean(raw.trashed),
        color: COLORS.includes(raw.color) ? raw.color : 'none',
      };
      state.notes.push(note); await db.put('notes', note); added++;
    }
    closeModal(); render(); showToast(`Imported ${added} ${added === 1 ? 'note' : 'notes'}.`);
  } catch (error) { console.error(error); showToast(error.message || 'Could not import this backup.'); }
}

function wireEvents() {
  $('#newNoteButton').addEventListener('click', createNote); $('#emptyNewNote').addEventListener('click', createNote); $('#editorNewNote').addEventListener('click', createNote);
  $('#menuButton').addEventListener('click', openSidebar); $('#sidebarClose').addEventListener('click', closeSidebar); els.sidebarScrim.addEventListener('click', closeSidebar);
  $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#addFolderButton').addEventListener('click', addFolder); $('#settingsButton').addEventListener('click', openSettings);
  els.search.addEventListener('input', () => { state.query = els.search.value; renderNotes(); updateListHeading(); els.clearSearch.classList.toggle('visible', Boolean(state.query)); });
  els.clearSearch.addEventListener('click', () => { els.search.value = ''; state.query = ''; render(); els.search.focus(); });
  $('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; renderNotes(); });
  $('#layoutButton').addEventListener('click', () => { state.grid = !state.grid; renderNotes(); $('#layoutButton').innerHTML = state.grid ? '<svg><use href="#i-notes"/></svg>' : '<svg><use href="#i-grid"/></svg>'; });
  $('#themeButton').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('paperleaf-theme', state.theme); } catch {} render(); });
  $('#exportButton').addEventListener('click', exportJSON);
  $('#noteTitle').addEventListener('input', queueSave);
  els.noteContent.addEventListener('input', queueSave);
  els.noteContent.addEventListener('keyup', updateWordCount);
  els.noteContent.addEventListener('paste', event => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    if (html) document.execCommand('insertHTML', false, sanitizeHTML(html));
    else document.execCommand('insertText', false, text);
    queueSave();
  });
  els.tagInput.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(els.tagInput.value); } });
  $$('.format-toolbar button[data-command]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => applyCommand(button.dataset.command, button.dataset.value));
  });
  $('#previewButton').addEventListener('click', () => { const note = getActiveNote(); if (!note) return; if (!state.preview) { note.content = sanitizeHTML(els.noteContent.innerHTML); queueSave(); } state.preview = !state.preview; els.noteContent.hidden = state.preview; els.notePreview.hidden = !state.preview; els.notePreview.innerHTML = sanitizeHTML(note.content); $('#previewButton span').textContent = state.preview ? 'Edit' : 'Preview'; $('#previewButton').classList.toggle('active', state.preview); });
  $('#favoriteButton').addEventListener('click', toggleFavorite); $('#pinButton').addEventListener('click', togglePin);
  $('#moreButton').addEventListener('click', () => { els.noteMenu.hidden = !els.noteMenu.hidden; });
  els.noteMenu.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    els.noteMenu.hidden = true; const action = button.dataset.action;
    if (action === 'color') chooseColor();
    if (action === 'folder') chooseFolder();
    if (action === 'markdown') { await flushPendingEditor(); exportCurrentMarkdown(); }
    if (action === 'archive') await archiveNote();
    if (action === 'delete') await moveToTrash();
    if (action === 'restore') await restoreFromTrash();
    if (action === 'permanent-delete') { const note = getActiveNote(); if (note) confirmPermanentDelete(note); }
  });
  $('#backToNotes').addEventListener('click', () => { flushPendingEditor(); state.mobileEditorOpen = false; render(); });
  $('#modalClose').addEventListener('click', closeModal); els.modalBackdrop.addEventListener('click', event => { if (event.target === els.modalBackdrop) closeModal(); });
  document.addEventListener('click', event => { if (!event.target.closest('.menu-anchor')) els.noteMenu.hidden = true; });
  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); createNote(); }
    if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); els.search.focus(); }
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); clearTimeout(state.saveTimer); queueSave(); showToast('Saving your note…'); }
    if (event.key === 'Escape') { if (!els.modalBackdrop.hidden) closeModal(); else if (els.sidebar.classList.contains('open')) closeSidebar(); else if (state.mobileEditorOpen) { flushPendingEditor(); state.mobileEditorOpen = false; render(); } }
  });
  window.addEventListener('beforeunload', event => { if (state.saveTimer) { clearTimeout(state.saveTimer); const note = getActiveNote(); if (note && !note.trashed && state.dirty) { note.title = els.noteTitle.value.trimStart(); note.content = sanitizeHTML(els.noteContent.innerHTML); db.put('notes', note).catch(() => {}); state.dirty = false; } } });
}

async function init() {
  try {
    state.db = await openDatabase();
    [state.notes, state.folders] = await Promise.all([db.getAll('notes'), db.getAll('folders')]);
  } catch (error) {
    console.error(error);
    showToast('Local storage is unavailable. Try a current browser or enable site storage.');
  }
  try { state.theme = localStorage.getItem('paperleaf-theme') === 'dark' ? 'dark' : 'light'; } catch {}
  wireEvents(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.info('Offline worker not registered:', error));
  }
}

init();
