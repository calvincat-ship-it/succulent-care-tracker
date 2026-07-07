const PLANTS_KEY = 'sct_plants_v1';
const CATEGORY_NOTES_KEY = 'sct_category_notes_v1';
const SETTINGS_KEY = 'sct_settings_v1';
const PHOTO_DB_NAME = 'sct_photos_db';
const PHOTO_STORE = 'photos';

const SPECIES_LIST = ['succulent', 'cactus', 'haworthia'];
const SPECIES_LABELS = { succulent: '景天科', cactus: '仙人球', haworthia: '玉露' };

/** @typedef {{id:string,species:string,photoId:string|null,purchaseDate:string,purchasePrice:number,note:string,lastWatered:string|null,lastFertilized:string|null,createdAt:string,deleted:boolean,deletedAt:string|null}} Plant */

// ---- IndexedDB photo storage ----

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PHOTO_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhoto(id, blob) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhoto(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deletePhoto(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function resizePhoto(file, maxDim = 1000, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('resize failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// ---- Storage ----

function loadPlants() {
  try {
    return JSON.parse(localStorage.getItem(PLANTS_KEY)) || [];
  } catch {
    return [];
  }
}

function savePlants(list) {
  localStorage.setItem(PLANTS_KEY, JSON.stringify(list));
}

function loadCategoryNotes() {
  const defaults = { succulent: '', cactus: '', haworthia: '' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(CATEGORY_NOTES_KEY)) };
  } catch {
    return defaults;
  }
}

function saveCategoryNotes(notes) {
  localStorage.setItem(CATEGORY_NOTES_KEY, JSON.stringify(notes));
}

function loadSettings() {
  const defaults = {
    succulent: { waterMin: 5, waterMax: 14, fertilizeMax: 60 },
    cactus: { waterMin: 7, waterMax: 21, fertilizeMax: 60 },
    haworthia: { waterMin: 5, waterMax: 14, fertilizeMax: 60 },
  };
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {}
  const merged = {};
  SPECIES_LIST.forEach((sp) => { merged[sp] = { ...defaults[sp], ...(stored[sp] || {}) }; });
  return merged;
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ---- Helpers ----

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - d) / 86400000);
}

function maxDate(dates) {
  const valid = dates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (b > a ? b : a));
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function classifyWatering(dateStr, cfg) {
  const days = daysBetween(dateStr);
  if (days === null) return { cls: 'overdue', label: '尚無澆水紀錄', days: null };
  if (days > cfg.waterMax) return { cls: 'overdue', label: '太久沒澆水了，檢查是否有缺水的情況', days };
  if (days < cfg.waterMin) return { cls: 'soon', label: '才剛澆水沒多久，確定要澆水嗎?', days };
  return { cls: 'ok', label: '狀況良好', days };
}

function classifyFertilizing(dateStr, cfg) {
  const days = daysBetween(dateStr);
  if (days === null) return { cls: 'overdue', label: '尚無施肥紀錄', days: null };
  if (days > cfg.fertilizeMax) return { cls: 'overdue', label: '太久沒施肥了', days };
  return { cls: 'ok', label: '狀況良好', days };
}

// ---- State ----

let plants = loadPlants();
let categoryNotes = loadCategoryNotes();
let settings = loadSettings();
let pendingPhotoBlob = null;
let pendingPhotoRemoved = false;
let currentPhotoId = null;
let plantListCollapsed = localStorage.getItem('sct_plantlist_collapsed') === '1';
let plantPhotoUrls = [];

const plantForm = document.getElementById('plantForm');
const editPlantIdInput = document.getElementById('editPlantId');
const plantSubmitBtn = document.getElementById('plantSubmitBtn');
const plantFormTitle = document.getElementById('plantFormTitle');
const cancelPlantEditBtn = document.getElementById('cancelPlantEditBtn');
const categoryCardsEl = document.getElementById('categoryCards');
const plantListEl = document.getElementById('plantList');
const plantEmptyState = document.getElementById('plantEmptyState');
const plantListFilter = document.getElementById('plantListFilter');
const toast = document.getElementById('toast');
const trendSelect = document.getElementById('trendSelect');

function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
}

// ---- Photo preview (add/edit form) ----

function showPhotoPreview(blob) {
  const url = URL.createObjectURL(blob);
  const img = document.getElementById('photoPreview');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = url;
  document.getElementById('photoPreviewWrap').hidden = false;
}

function hidePhotoPreview() {
  const img = document.getElementById('photoPreview');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = '';
  document.getElementById('photoPreviewWrap').hidden = true;
}

document.getElementById('photoCaptureBtn').addEventListener('click', () => {
  document.getElementById('fieldPhotoInput').click();
});

document.getElementById('fieldPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const blob = await resizePhoto(file);
    pendingPhotoBlob = blob;
    pendingPhotoRemoved = false;
    showPhotoPreview(blob);
  } catch {
    showToast('照片處理失敗');
  }
});

document.getElementById('removePhotoBtn').addEventListener('click', () => {
  pendingPhotoBlob = null;
  pendingPhotoRemoved = true;
  hidePhotoPreview();
});

// ---- Plant form ----

function resetPlantForm() {
  plantForm.reset();
  editPlantIdInput.value = '';
  plantSubmitBtn.textContent = '新增植物';
  plantFormTitle.textContent = '新增植物';
  cancelPlantEditBtn.hidden = true;
  pendingPhotoBlob = null;
  pendingPhotoRemoved = false;
  currentPhotoId = null;
  hidePhotoPreview();
  document.getElementById('fieldPurchaseDate').value = todayStr();
}

async function startEditPlant(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return;
  editPlantIdInput.value = p.id;
  document.getElementById('fieldSpecies').value = p.species;
  document.getElementById('fieldPurchaseDate').value = p.purchaseDate;
  document.getElementById('fieldPurchasePrice').value = p.purchasePrice || '';
  document.getElementById('fieldPlantNote').value = p.note || '';
  plantSubmitBtn.textContent = '儲存變更';
  plantFormTitle.textContent = '編輯植物';
  cancelPlantEditBtn.hidden = false;
  pendingPhotoBlob = null;
  pendingPhotoRemoved = false;
  currentPhotoId = p.photoId || null;
  if (p.photoId) {
    const blob = await getPhoto(p.photoId);
    if (blob) showPhotoPreview(blob); else hidePhotoPreview();
  } else {
    hidePhotoPreview();
  }
  window.scrollTo({ top: plantForm.offsetTop - 20, behavior: 'smooth' });
}

cancelPlantEditBtn.addEventListener('click', resetPlantForm);

async function deletePlant(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return;
  if (!confirm('確定要刪除這盆植物嗎？')) return;
  if (p.photoId) await deletePhoto(p.photoId).catch(() => {});
  plants = plants.map((x) => x.id === id
    ? { ...x, deleted: true, deletedAt: todayStr(), photoId: null }
    : x);
  savePlants(plants);
  showToast('已刪除');
  renderAll();
}

plantForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const species = document.getElementById('fieldSpecies').value;
  const purchaseDate = document.getElementById('fieldPurchaseDate').value;
  const purchasePrice = Number(document.getElementById('fieldPurchasePrice').value) || 0;
  const note = document.getElementById('fieldPlantNote').value.trim();

  let photoId = currentPhotoId;
  if (pendingPhotoRemoved && currentPhotoId) {
    await deletePhoto(currentPhotoId);
    photoId = null;
  }
  if (pendingPhotoBlob) {
    if (currentPhotoId && !pendingPhotoRemoved) {
      await deletePhoto(currentPhotoId);
    }
    photoId = crypto.randomUUID();
    await savePhoto(photoId, pendingPhotoBlob);
  }

  const editId = editPlantIdInput.value;
  if (editId) {
    plants = plants.map((p) => p.id === editId
      ? { ...p, species, purchaseDate, purchasePrice, note, photoId }
      : p);
    showToast('已更新植物資料');
  } else {
    plants.push({
      id: crypto.randomUUID(),
      species,
      photoId,
      purchaseDate,
      purchasePrice,
      note,
      lastWatered: purchaseDate,
      lastFertilized: purchaseDate,
      createdAt: new Date().toISOString(),
      deleted: false,
      deletedAt: null,
    });
    showToast('已新增植物');
  }
  savePlants(plants);
  resetPlantForm();
  renderAll();
});

// ---- Category cards ----

function renderCategoryCards() {
  categoryCardsEl.innerHTML = SPECIES_LIST.map(renderCategoryCard).join('');
}

function renderCategoryCard(species) {
  const label = SPECIES_LABELS[species];
  const inCategory = plants.filter((p) => !p.deleted && p.species === species);
  const count = inCategory.length;
  const cfg = settings[species];
  const lastWatered = maxDate(inCategory.map((p) => p.lastWatered));
  const lastFertilized = maxDate(inCategory.map((p) => p.lastFertilized));
  const waterInfo = count > 0 ? classifyWatering(lastWatered, cfg) : { cls: 'overdue', label: '尚無植物', days: null };
  const fertInfo = count > 0 ? classifyFertilizing(lastFertilized, cfg) : { cls: 'overdue', label: '尚無植物', days: null };
  const note = categoryNotes[species] || '';

  return `
    <div class="card category-card" data-species="${species}">
      <div class="category-card-header">
        <h2>${label}</h2>
        <span class="category-count">${count} 盆</span>
      </div>
      <textarea class="category-note" data-species="${species}" placeholder="照護注意事項（日照、澆水、施肥）">${escapeHtml(note)}</textarea>
      <div class="care-row">
        <div class="care-info">
          <span class="care-label">澆水・上次 ${fmtDate(lastWatered)}${waterInfo.days != null ? `（距今 ${waterInfo.days} 天）` : ''}</span>
          <span class="care-warning care-${waterInfo.cls}">${waterInfo.label}</span>
        </div>
        <button type="button" class="care-confirm-btn" data-action="water-all" data-species="${species}" ${count === 0 ? 'disabled' : ''}>全部已澆水</button>
      </div>
      <div class="care-row">
        <div class="care-info">
          <span class="care-label">施肥・上次 ${fmtDate(lastFertilized)}${fertInfo.days != null ? `（距今 ${fertInfo.days} 天）` : ''}</span>
          <span class="care-warning care-${fertInfo.cls}">${fertInfo.label}</span>
        </div>
        <button type="button" class="care-confirm-btn" data-action="fertilize-all" data-species="${species}" ${count === 0 ? 'disabled' : ''}>全部已施肥</button>
      </div>
    </div>
  `;
}

categoryCardsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const species = btn.dataset.species;
  const today = todayStr();
  if (btn.dataset.action === 'water-all') {
    plants = plants.map((p) => (!p.deleted && p.species === species) ? { ...p, lastWatered: today } : p);
    savePlants(plants);
    showToast(`已將全部${SPECIES_LABELS[species]}標記為已澆水`);
    renderAll();
  } else if (btn.dataset.action === 'fertilize-all') {
    plants = plants.map((p) => (!p.deleted && p.species === species) ? { ...p, lastFertilized: today } : p);
    savePlants(plants);
    showToast(`已將全部${SPECIES_LABELS[species]}標記為已施肥`);
    renderAll();
  }
});

categoryCardsEl.addEventListener('focusout', (e) => {
  if (!e.target.matches('.category-note')) return;
  const species = e.target.dataset.species;
  categoryNotes[species] = e.target.value;
  saveCategoryNotes(categoryNotes);
});

// ---- Plant list ----

function revokePlantPhotoUrls() {
  plantPhotoUrls.forEach((u) => URL.revokeObjectURL(u));
  plantPhotoUrls = [];
}

function renderPlantList() {
  const filter = plantListFilter.value;
  const list = plants
    .filter((p) => !p.deleted && (filter === 'all' || p.species === filter))
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt));

  plantEmptyState.hidden = list.length > 0;
  plantEmptyState.textContent = filter === 'all' ? '尚無植物，新增第一盆多肉吧！' : `尚無${SPECIES_LABELS[filter]}植物`;

  plantListEl.innerHTML = list.map((p) => {
    const cfg = settings[p.species];
    const waterInfo = classifyWatering(p.lastWatered, cfg);
    const fertInfo = classifyFertilizing(p.lastFertilized, cfg);
    return `
      <div class="plant-card" data-id="${p.id}">
        <div class="plant-photo-slot" data-photo-id="${p.photoId || ''}">
          <div class="plant-photo-placeholder">🌵</div>
        </div>
        <div class="plant-body">
          <div class="plant-header-row">
            <span class="plant-species-tag">${SPECIES_LABELS[p.species]}</span>
            <div class="plant-actions">
              <button data-action="edit" aria-label="編輯" title="編輯">✎</button>
              <button data-action="delete" aria-label="刪除" title="刪除">🗑</button>
            </div>
          </div>
          <span class="plant-meta">購入 ${fmtDate(p.purchaseDate)}${p.purchasePrice ? ` · ${p.purchasePrice} 元` : ''}</span>
          ${p.note ? `<span class="plant-note">${escapeHtml(p.note)}</span>` : ''}
          <div class="plant-care-rows">
            <div class="plant-care-line">
              澆水 ${fmtDate(p.lastWatered)}${waterInfo.days != null ? `（${waterInfo.days}天）` : ''}
              <span class="care-warning care-${waterInfo.cls}">${waterInfo.label}</span>
              <button type="button" data-action="water">已澆水</button>
            </div>
            <div class="plant-care-line">
              施肥 ${fmtDate(p.lastFertilized)}${fertInfo.days != null ? `（${fertInfo.days}天）` : ''}
              <span class="care-warning care-${fertInfo.cls}">${fertInfo.label}</span>
              <button type="button" data-action="fertilize">已施肥</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function hydratePlantPhotos() {
  revokePlantPhotoUrls();
  const slots = plantListEl.querySelectorAll('.plant-photo-slot');
  for (const slot of slots) {
    const photoId = slot.dataset.photoId;
    if (!photoId) continue;
    const blob = await getPhoto(photoId);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    plantPhotoUrls.push(url);
    slot.innerHTML = `<img class="plant-photo" src="${url}" alt="植物照片">`;
  }
}

plantListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const card = btn.closest('.plant-card');
  const id = card.dataset.id;
  const action = btn.dataset.action;
  if (action === 'edit') startEditPlant(id);
  if (action === 'delete') deletePlant(id);
  if (action === 'water') {
    plants = plants.map((p) => p.id === id ? { ...p, lastWatered: todayStr() } : p);
    savePlants(plants);
    renderAll();
  }
  if (action === 'fertilize') {
    plants = plants.map((p) => p.id === id ? { ...p, lastFertilized: todayStr() } : p);
    savePlants(plants);
    renderAll();
  }
});

plantListFilter.addEventListener('change', () => {
  renderPlantList();
  hydratePlantPhotos();
});

function applyPlantListCollapsed() {
  document.getElementById('plantListBody').hidden = plantListCollapsed;
  document.getElementById('plantListToggleIcon').textContent = plantListCollapsed ? '▸' : '▾';
  document.getElementById('plantListToggleBtn').setAttribute('aria-expanded', String(!plantListCollapsed));
}

document.getElementById('plantListToggleBtn').addEventListener('click', () => {
  plantListCollapsed = !plantListCollapsed;
  localStorage.setItem('sct_plantlist_collapsed', plantListCollapsed ? '1' : '0');
  applyPlantListCollapsed();
});

// ---- Summary & trend chart ----

function renderSummary() {
  const active = plants.filter((p) => !p.deleted);
  document.getElementById('totalCountValue').textContent = active.length;
  const totalPrice = active.reduce((s, p) => s + (Number(p.purchasePrice) || 0), 0);
  document.getElementById('totalPriceValue').textContent = `${totalPrice} 元`;

  document.getElementById('speciesCountBreakdown').innerHTML = SPECIES_LIST.map((sp) => {
    const c = active.filter((p) => p.species === sp).length;
    return `<div class="species-breakdown-row"><span>${SPECIES_LABELS[sp]}數量</span><span>${c}</span></div>`;
  }).join('');

  document.getElementById('speciesPriceBreakdown').innerHTML = SPECIES_LIST.map((sp) => {
    const sum = active.filter((p) => p.species === sp).reduce((s, p) => s + (Number(p.purchasePrice) || 0), 0);
    return `<div class="species-breakdown-row"><span>${SPECIES_LABELS[sp]}金額</span><span>${sum} 元</span></div>`;
  }).join('');
}

function buildCountSeries(filterFn) {
  const events = [];
  plants.forEach((p) => {
    if (!filterFn(p)) return;
    events.push({ date: p.purchaseDate, delta: 1 });
    if (p.deleted) events.push({ date: p.deletedAt || p.purchaseDate, delta: -1 });
  });
  return collapseEvents(events);
}

function buildPriceSeries(filterFn) {
  const events = [];
  plants.forEach((p) => {
    if (!filterFn(p)) return;
    events.push({ date: p.purchaseDate, delta: Number(p.purchasePrice) || 0 });
  });
  return collapseEvents(events);
}

function collapseEvents(events) {
  if (events.length === 0) return [];
  events.sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map();
  let running = 0;
  events.forEach((ev) => {
    running += ev.delta;
    byDate.set(ev.date, running);
  });
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

function renderChart() {
  const canvas = document.getElementById('trendChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssHeight = 180;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const kind = trendSelect.value;
  let data, color;
  if (kind === 'totalCount') { data = buildCountSeries(() => true); color = '#3f7d5c'; }
  else if (kind === 'succulentCount') { data = buildCountSeries((p) => p.species === 'succulent'); color = '#3f7d5c'; }
  else if (kind === 'cactusCount') { data = buildCountSeries((p) => p.species === 'cactus'); color = '#c98a3e'; }
  else if (kind === 'haworthiaCount') { data = buildCountSeries((p) => p.species === 'haworthia'); color = '#3a8de0'; }
  else { data = buildPriceSeries(() => true); color = '#8a6dc9'; }

  if (data.length === 0) {
    ctx.fillStyle = '#9aa8a0';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('尚無資料', cssWidth / 2, cssHeight / 2);
    return;
  }

  const padding = { top: 14, right: 10, bottom: 20, left: 34 };
  const plotW = cssWidth - padding.left - padding.right;
  const plotH = cssHeight - padding.top - padding.bottom;

  const values = data.map((d) => d.value);
  const maxV = Math.max(...values, 1);
  const minV = Math.min(...values, 0);

  function x(i) { return padding.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW); }
  function y(v) { return padding.top + plotH - ((v - minV) / (maxV - minV || 1)) * plotH; }

  ctx.strokeStyle = '#e1eae4';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#9aa8a0';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minV + ((maxV - minV) * i) / steps;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(padding.left, yy);
    ctx.lineTo(cssWidth - padding.right, yy);
    ctx.stroke();
    ctx.fillText(Math.round(v).toString(), padding.left - 4, yy + 3);
  }

  const pts = data.map((d, i) => ({ x: x(i), y: y(d.value) }));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.fillStyle = color;
  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#9aa8a0';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(fmtDate(data[0].date), padding.left, cssHeight - 4);
  if (data.length > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(fmtDate(data[data.length - 1].date), cssWidth - padding.right, cssHeight - 4);
  }
}

trendSelect.addEventListener('change', renderChart);
window.addEventListener('resize', () => renderChart());

// ---- Settings ----

const settingsModal = document.getElementById('settingsModal');

function openSettings() {
  SPECIES_LIST.forEach((sp) => {
    document.getElementById(`waterMin_${sp}`).value = settings[sp].waterMin;
    document.getElementById(`waterMax_${sp}`).value = settings[sp].waterMax;
    document.getElementById(`fertilizeMax_${sp}`).value = settings[sp].fertilizeMax;
  });
  settingsModal.hidden = false;
}

function closeSettings() {
  settingsModal.hidden = true;
}

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

document.getElementById('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  SPECIES_LIST.forEach((sp) => {
    settings[sp] = {
      waterMin: Number(document.getElementById(`waterMin_${sp}`).value) || 0,
      waterMax: Number(document.getElementById(`waterMax_${sp}`).value) || 1,
      fertilizeMax: Number(document.getElementById(`fertilizeMax_${sp}`).value) || 1,
    };
  });
  saveSettings(settings);
  closeSettings();
  showToast('設定已儲存');
  renderAll();
});

// ---- Photo viewer (unused directly but kept for future per-plant photo view) ----

function closePhotoViewer() {
  const viewer = document.getElementById('photoViewer');
  if (viewer.dataset.objectUrl) {
    URL.revokeObjectURL(viewer.dataset.objectUrl);
    delete viewer.dataset.objectUrl;
  }
  viewer.hidden = true;
}

document.getElementById('closePhotoViewerBtn').addEventListener('click', closePhotoViewer);
document.getElementById('photoViewer').addEventListener('click', (e) => {
  if (e.target.id === 'photoViewer') closePhotoViewer();
});

// ---- Render all & init ----

function renderAll() {
  renderCategoryCards();
  renderPlantList();
  hydratePlantPhotos();
  renderSummary();
  renderChart();
}

resetPlantForm();
applyPlantListCollapsed();
renderAll();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
