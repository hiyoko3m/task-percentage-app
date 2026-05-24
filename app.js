/* =========================================================
   タスク時間割合管理アプリ - app.js
   ========================================================= */

// ---- 定数 ----
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR   = 22;
const TOTAL_SLOTS         = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 4; // 60
const SLOT_HEIGHT_PX      = 15;
const DAY_NAMES           = ['月', '火', '水', '木', '金', '土', '日'];

// ---- localStorage キー ----
const LS_PRESETS = 'task-app-presets';
const LS_RECORDS = 'task-app-records';

// ---- 状態管理 ----
let state = {
  presets: [], // [{ id, name, enabled }]
  records: [], // [{ id, presetId, date, startTime, endTime }]
};
let currentWeekStart = null; // Date（週の月曜日 00:00:00）
let statsDate        = new Date();
let pieChartInstance = null;
let dragState = {
  active: false,
  columnDate: null,
  startSlot: -1,
  endSlot: -1,
  slotsContainer: null,
  previewEl: null,
};
let modalContext = {
  mode: 'create',        // 'create' | 'edit'
  editRecordId: null,
  targetDate: null,
};

// ---- ユーティリティ ----
function generateUUID() {
  return crypto.randomUUID();
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeToSlot(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h - CALENDAR_START_HOUR) * 4 + Math.floor(m / 15);
}

function slotToTime(slot) {
  const totalMinutes = CALENDAR_START_HOUR * 60 + slot * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * getBoundingClientRect は scroll を加味した viewport 相対値を返す。
 * clientY - rect.top = slotsContainer 内の Y 座標（スクロール不要）。
 */
function clientYToSlot(slotsContainer, clientY) {
  const rect  = slotsContainer.getBoundingClientRect();
  const relY  = clientY - rect.top;
  const slot  = Math.floor(relY / SLOT_HEIGHT_PX);
  return Math.max(0, Math.min(TOTAL_SLOTS - 1, slot));
}

function timeDiffMinutes(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function isQuarterTime(timeStr) {
  if (!timeStr) return false;
  const parts = timeStr.split(':');
  if (parts.length < 2) return false;
  const m = parseInt(parts[1], 10);
  return m % 15 === 0;
}

function hasOverlap(date, startTime, endTime, excludeId = null) {
  return state.records
    .filter(r => r.date === date && r.id !== excludeId)
    .some(r => startTime < r.endTime && r.startTime < endTime);
}

/**
 * UUID の文字コードからハッシュ値を導出し、一貫した HSL 色を返す。
 * 同じ presetId は常に同じ色になる。
 */
function generateColor(uuid) {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = (hash * 31 + uuid.charCodeAt(i)) & 0x7fffffff;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=日, 1=月, ...
  const diff = day === 0 ? -6 : 1 - day; // 月曜日に合わせる
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function el(id) {
  return document.getElementById(id);
}

function createDiv(className) {
  const d = document.createElement('div');
  if (className) d.className = className;
  return d;
}

// ---- localStorage 操作 ----
function loadData() {
  try {
    state.presets = JSON.parse(localStorage.getItem(LS_PRESETS) || '[]');
  } catch { state.presets = []; }
  try {
    state.records = JSON.parse(localStorage.getItem(LS_RECORDS) || '[]');
  } catch { state.records = []; }
}

function savePresets() {
  localStorage.setItem(LS_PRESETS, JSON.stringify(state.presets));
}

function saveRecords() {
  localStorage.setItem(LS_RECORDS, JSON.stringify(state.records));
}

function showApp() {
  currentWeekStart = getWeekStart(new Date());
  renderPresets();
  renderCalendar();
}

// ---- 画面1: プリセット管理 ----
function renderPresets() {
  const list    = el('preset-list');
  const emptyEl = el('preset-empty');
  list.innerHTML = '';

  if (state.presets.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  for (const preset of state.presets) {
    const li = document.createElement('li');
    li.className = 'preset-item' + (preset.enabled ? '' : ' disabled');

    // 名前
    const nameEl = createDiv('preset-name');
    nameEl.textContent = preset.name;
    if (!preset.enabled) {
      const badge = document.createElement('span');
      badge.className = 'badge-disabled';
      badge.textContent = '無効';
      nameEl.appendChild(badge);
    }

    // 操作ボタン
    const actions = createDiv('preset-actions');

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'リネーム';
    renameBtn.addEventListener('click', () => openRenameModal(preset.id, preset.name));

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = preset.enabled ? '無効化' : '有効化';
    toggleBtn.addEventListener('click', () => togglePreset(preset.id));

    actions.append(renameBtn, toggleBtn);
    li.append(nameEl, actions);
    list.appendChild(li);
  }
}

function openAddPresetModal() {
  el('modal-name-title').textContent = '案件を追加';
  el('modal-name-input').value = '';
  hideModalNameError();
  el('modal-name-btn-save').onclick = () => {
    const name = el('modal-name-input').value.trim();
    if (!name) { showModalNameError('案件名を入力してください。'); return; }
    addPreset(name);
    closeModal('modal-name');
  };
  showModal('modal-name');
  el('modal-name-input').focus();
}

function openRenameModal(id, currentName) {
  el('modal-name-title').textContent = '案件名を変更';
  el('modal-name-input').value = currentName;
  hideModalNameError();
  el('modal-name-btn-save').onclick = () => {
    const name = el('modal-name-input').value.trim();
    if (!name) { showModalNameError('案件名を入力してください。'); return; }
    renamePreset(id, name);
    closeModal('modal-name');
  };
  showModal('modal-name');
  el('modal-name-input').focus();
  el('modal-name-input').select();
}

function addPreset(name) {
  state.presets.push({ id: generateUUID(), name, enabled: true });
  savePresets();
  renderPresets();
}

function renamePreset(id, name) {
  const preset = state.presets.find(p => p.id === id);
  if (!preset) return;
  preset.name = name;
  savePresets();
  renderPresets();
}

function togglePreset(id) {
  const preset = state.presets.find(p => p.id === id);
  if (!preset) return;
  preset.enabled = !preset.enabled;
  savePresets();
  renderPresets();
}

// ---- 画面2: カレンダー描画 ----
function renderCalendar() {
  renderWeekLabel();
  renderTimeAxis();
  renderCalendarGrid();
}

function renderWeekLabel() {
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() + 6);
  el('week-label').textContent = `${formatDate(currentWeekStart)} 〜 ${formatDate(end)}`;
}

function renderTimeAxis() {
  const axis = el('time-axis');
  axis.innerHTML = '';

  const spacer = createDiv('time-axis-spacer');
  axis.appendChild(spacer);

  for (let h = CALENDAR_START_HOUR; h < CALENDAR_END_HOUR; h++) {
    const label = createDiv('time-label');
    label.textContent = `${String(h).padStart(2, '0')}:00`;
    axis.appendChild(label);
  }
}

function renderCalendarGrid() {
  const grid  = el('calendar-grid');
  const today = formatDate(new Date());
  grid.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const dateStr = formatDate(dayDate);

    const col = createDiv('calendar-day-column');
    col.dataset.date = dateStr;

    // ヘッダー
    const header = createDiv('day-header');
    header.textContent = `${DAY_NAMES[i]} ${dayDate.getDate()}`;
    if (dateStr === today) header.classList.add('today');
    col.appendChild(header);

    // タイムスロットコンテナ
    const slotsContainer = createDiv('slots-container');
    for (let s = 0; s < TOTAL_SLOTS; s++) {
      const slot = createDiv('time-slot');
      slot.dataset.slot = s;
      slotsContainer.appendChild(slot);
    }
    col.appendChild(slotsContainer);

    // 既存エントリ描画
    renderEntryBlocks(slotsContainer, dateStr);

    // ドラッグ
    attachDragHandlers(slotsContainer, dateStr);

    grid.appendChild(col);
  }
}

function renderEntryBlocks(slotsContainer, dateStr) {
  slotsContainer.querySelectorAll('.entry-block').forEach(e => e.remove());

  const dayRecords = state.records.filter(r => r.date === dateStr);
  for (const record of dayRecords) {
    const startSlot = timeToSlot(record.startTime);
    const endSlot   = timeToSlot(record.endTime);
    const top    = startSlot * SLOT_HEIGHT_PX;
    const height = (endSlot - startSlot) * SLOT_HEIGHT_PX;

    const block = createDiv('entry-block');
    block.style.top    = `${top}px`;
    block.style.height = `${height}px`;
    block.style.backgroundColor = generateColor(record.presetId);
    block.dataset.recordId = record.id;

    const preset = state.presets.find(p => p.id === record.presetId);

    const nameEl = createDiv('entry-name');
    nameEl.textContent = preset ? preset.name : '(不明)';

    // 短すぎるブロック（1スロット=15px）は時刻表示を省略
    if (height >= 30) {
      const timeEl = createDiv('entry-time');
      timeEl.textContent = `${record.startTime}〜${record.endTime}`;
      block.appendChild(timeEl);
    }
    block.insertBefore(nameEl, block.firstChild);

    block.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(record.id);
    });

    slotsContainer.appendChild(block);
  }
}

// ---- ドラッグ操作 ----
function attachDragHandlers(slotsContainer, dateStr) {
  slotsContainer.addEventListener('mousedown', e => {
    if (e.target.closest('.entry-block')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const startSlot = clientYToSlot(slotsContainer, e.clientY);

    const previewEl = createDiv('drag-preview');
    updatePreviewPosition(previewEl, startSlot, startSlot + 1);
    slotsContainer.appendChild(previewEl);

    dragState = {
      active: true,
      columnDate: dateStr,
      startSlot,
      endSlot: startSlot,
      slotsContainer,
      previewEl,
    };

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd, { once: true });
  });
}

function onDragMove(e) {
  if (!dragState.active) return;
  const currentSlot = clientYToSlot(dragState.slotsContainer, e.clientY);
  dragState.endSlot = currentSlot;
  const topSlot    = Math.min(dragState.startSlot, currentSlot);
  const bottomSlot = Math.max(dragState.startSlot, currentSlot) + 1;
  updatePreviewPosition(dragState.previewEl, topSlot, bottomSlot);
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  if (!dragState.active) return;

  const { startSlot, endSlot, columnDate, previewEl } = dragState;
  previewEl?.remove();
  dragState.active = false;

  const topSlot    = Math.min(startSlot, endSlot);
  const bottomSlot = Math.max(startSlot, endSlot) + 1;
  openCreateModal(columnDate, slotToTime(topSlot), slotToTime(bottomSlot));
}

function updatePreviewPosition(el, topSlot, bottomSlot) {
  el.style.top    = `${topSlot * SLOT_HEIGHT_PX}px`;
  el.style.height = `${(bottomSlot - topSlot) * SLOT_HEIGHT_PX}px`;
}

// ---- モーダル管理 ----
function showModal(id) {
  el(id).classList.remove('hidden');
}

function closeModal(id) {
  el(id).classList.add('hidden');
}

function showModalError(msg) {
  const e = el('modal-error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

function hideModalError() {
  const e = el('modal-error');
  e.textContent = '';
  e.classList.add('hidden');
}

function showModalNameError(msg) {
  const e = el('modal-name-error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

function hideModalNameError() {
  const e = el('modal-name-error');
  e.textContent = '';
  e.classList.add('hidden');
}

function populatePresetSelect(includeDisabled = false) {
  const sel = el('modal-preset-select');
  sel.innerHTML = '';
  const targets = includeDisabled
    ? state.presets
    : state.presets.filter(p => p.enabled);
  for (const p of targets) {
    const opt = document.createElement('option');
    opt.value       = p.id;
    opt.textContent = p.name + (p.enabled ? '' : ' (無効)');
    sel.appendChild(opt);
  }
}

function openCreateModal(dateStr, startTime, endTime) {
  if (state.presets.filter(p => p.enabled).length === 0) {
    alert('有効な案件がありません。\n「案件管理」タブから案件を追加してください。');
    return;
  }
  modalContext = { mode: 'create', editRecordId: null, targetDate: dateStr };
  populatePresetSelect(false);
  el('modal-title').textContent = '時間を記録';
  el('modal-start').value = startTime;
  el('modal-end').value   = endTime;
  el('modal-btn-delete').classList.add('hidden');
  hideModalError();
  showModal('modal-entry');
}

function openEditModal(recordId) {
  const record = state.records.find(r => r.id === recordId);
  if (!record) return;
  modalContext = { mode: 'edit', editRecordId: recordId, targetDate: record.date };
  populatePresetSelect(true); // 無効案件も含める（既存データ保護）
  el('modal-preset-select').value = record.presetId;
  el('modal-title').textContent = '記録を編集';
  el('modal-start').value = record.startTime;
  el('modal-end').value   = record.endTime;
  el('modal-btn-delete').classList.remove('hidden');
  hideModalError();
  showModal('modal-entry');
}

function validateEntryModal() {
  const startTime = el('modal-start').value;
  const endTime   = el('modal-end').value;
  const presetId  = el('modal-preset-select').value;

  if (!presetId)            return '案件を選択してください。';
  if (!startTime || !endTime) return '時刻を入力してください。';
  if (!isQuarterTime(startTime) || !isQuarterTime(endTime)) {
    return '時刻は15分単位で入力してください。';
  }
  if (startTime >= endTime) return '終了時刻は開始時刻より後にしてください。';

  const excludeId = modalContext.mode === 'edit' ? modalContext.editRecordId : null;
  if (hasOverlap(modalContext.targetDate, startTime, endTime, excludeId)) {
    return 'この時間帯は既存の記録と重複しています。';
  }
  return null; // OK
}

function saveEntry() {
  const error = validateEntryModal();
  if (error) { showModalError(error); return; }

  const startTime = el('modal-start').value;
  const endTime   = el('modal-end').value;
  const presetId  = el('modal-preset-select').value;

  if (modalContext.mode === 'create') {
    state.records.push({
      id: generateUUID(),
      presetId,
      date: modalContext.targetDate,
      startTime,
      endTime,
    });
  } else {
    const rec = state.records.find(r => r.id === modalContext.editRecordId);
    if (rec) {
      rec.presetId  = presetId;
      rec.startTime = startTime;
      rec.endTime   = endTime;
    }
  }

  saveRecords();
  closeModal('modal-entry');
  renderCalendar();
}

function deleteEntry() {
  if (!confirm('この記録を削除しますか？')) return;
  state.records = state.records.filter(r => r.id !== modalContext.editRecordId);
  saveRecords();
  closeModal('modal-entry');
  renderCalendar();
}

// ---- 画面3: 月別統計 ----
function renderStats() {
  const year  = statsDate.getFullYear();
  const month = statsDate.getMonth(); // 0-origin

  el('month-label').textContent = `${year}年 ${month + 1}月`;

  const monthPrefix  = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthRecords = state.records.filter(r => r.date.startsWith(monthPrefix));

  // 案件ごとに集計（無効案件の記録も含む）
  const totals = {};
  for (const r of monthRecords) {
    const mins = timeDiffMinutes(r.startTime, r.endTime);
    totals[r.presetId] = (totals[r.presetId] ?? 0) + mins;
  }

  const totalMinutes = Object.values(totals).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  // テーブル
  const tbody = el('stats-tbody');
  tbody.innerHTML = '';
  const labels = [], data = [], bgColors = [];

  for (const [presetId, minutes] of sorted) {
    const preset = state.presets.find(p => p.id === presetId);
    const name   = preset
      ? preset.name + (preset.enabled ? '' : ' (無効)')
      : '(不明)';
    const pct    = totalMinutes > 0
      ? ((minutes / totalMinutes) * 100).toFixed(1)
      : '0.0';
    const color  = generateColor(presetId);

    const tr = document.createElement('tr');
    const dot = `<span class="color-dot" style="background:${color}"></span>`;
    tr.innerHTML = `<td>${dot}${name}</td><td>${formatMinutes(minutes)}</td><td>${pct}%</td>`;
    tbody.appendChild(tr);

    labels.push(name);
    data.push(minutes);
    bgColors.push(color);
  }

  if (sorted.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" style="text-align:center;color:#999;padding:20px">この月の記録はありません</td>';
    tbody.appendChild(tr);
  }

  // 円グラフ（再生成前に必ず destroy）
  if (pieChartInstance) {
    pieChartInstance.destroy();
    pieChartInstance = null;
  }

  const canvas = el('pie-chart');
  if (data.length > 0) {
    pieChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderWidth: 1,
          borderColor: '#fff',
        }],
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const mins = ctx.raw;
                const pct  = totalMinutes > 0
                  ? ((mins / totalMinutes) * 100).toFixed(1)
                  : '0';
                return ` ${ctx.label}: ${formatMinutes(mins)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
    canvas.style.display = '';
  } else {
    canvas.style.display = 'none';
  }
}

// ---- タブ切り替え ----
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      el(`tab-${tabId}`).classList.remove('hidden');

      if (tabId === 'presets')  renderPresets();
      if (tabId === 'calendar') renderCalendar();
      if (tabId === 'stats')    renderStats();
    });
  });
}

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', () => {
  currentWeekStart = getWeekStart(new Date());
  statsDate        = new Date();

  // localStorage からデータを読み込んで即座に表示
  loadData();
  showApp();

  // カレンダー週移動
  el('btn-prev-week').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderCalendar();
  });
  el('btn-next-week').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderCalendar();
  });

  // 月別統計 月移動
  el('btn-prev-month').addEventListener('click', () => {
    statsDate.setMonth(statsDate.getMonth() - 1);
    renderStats();
  });
  el('btn-next-month').addEventListener('click', () => {
    statsDate.setMonth(statsDate.getMonth() + 1);
    renderStats();
  });

  // プリセット管理
  el('btn-add-preset').addEventListener('click', openAddPresetModal);

  // 時間記録モーダル
  el('modal-btn-save').addEventListener('click', saveEntry);
  el('modal-btn-delete').addEventListener('click', deleteEntry);
  el('modal-btn-cancel').addEventListener('click', () => closeModal('modal-entry'));

  // 案件名モーダル
  el('modal-name-btn-cancel').addEventListener('click', () => closeModal('modal-name'));
  el('modal-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') el('modal-name-btn-save').click();
    if (e.key === 'Escape') closeModal('modal-name');
  });

  // Escape でモーダルを閉じる
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal('modal-entry');
      closeModal('modal-name');
    }
  });

  // モーダルの背景クリックで閉じる
  el('modal-entry').addEventListener('click', e => {
    if (e.target === el('modal-entry')) closeModal('modal-entry');
  });
  el('modal-name').addEventListener('click', e => {
    if (e.target === el('modal-name')) closeModal('modal-name');
  });

  initTabs();
});
