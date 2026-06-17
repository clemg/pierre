// Thin client over the bench server's SSE feed: renders the version × diff
// matrix, the queue/current state, the live screencast + console log, a
// per-cell means summary, and the full sortable run history.

const matrixHead = document.querySelector('#matrix thead');
const matrixBody = document.querySelector('#matrix tbody');
const statusLine = document.getElementById('status');
const screencast = document.getElementById('screencast');
const liveLabel = document.getElementById('live-label');
const logPane = document.getElementById('log');
const resultsBody = document.querySelector('#results tbody');

let results = [];
const logLines = [];
// Runs completed since this page connected, newest last
const doneThisSession = [];
let lastState = null;

function cellCheckbox(version, diff) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.version = version;
  input.dataset.diff = diff;
  return input;
}

function renderMatrix(state) {
  if (matrixHead.children.length > 0) {
    return;
  }
  const headRow = document.createElement('tr');
  headRow.append(document.createElement('th'));
  for (const version of state.versions) {
    const th = document.createElement('th');
    const columnToggle = document.createElement('input');
    columnToggle.type = 'checkbox';
    columnToggle.title = `check the whole ${version.key} column`;
    columnToggle.addEventListener('change', () => {
      for (const box of matrixBody.querySelectorAll(
        `input[data-version="${version.key}"]`
      )) {
        box.checked = columnToggle.checked;
      }
    });
    th.append(columnToggle, ` ${version.label}`);
    th.title = version.description;
    const sha = document.createElement('div');
    sha.append(
      version.builtSha != null ? `built @ ${version.builtSha}` : 'not built yet'
    );
    th.append(sha);
    headRow.append(th);
  }
  matrixHead.append(headRow);

  const addRow = (label, diffKey, labelNode) => {
    const row = document.createElement('tr');
    const th = document.createElement('th');
    const rowToggle = document.createElement('input');
    rowToggle.type = 'checkbox';
    rowToggle.title = `check the whole "${label}" row`;
    rowToggle.addEventListener('change', () => {
      for (const box of matrixBody.querySelectorAll(
        `input[data-diff="${diffKey}"]`
      )) {
        box.checked = rowToggle.checked;
      }
    });
    th.append(rowToggle, ' ', labelNode ?? label);
    row.append(th);
    for (const version of state.versions) {
      const cell = document.createElement('td');
      cell.append(cellCheckbox(version.key, diffKey));
      row.append(cell);
    }
    matrixBody.append(row);
  };

  for (const diff of state.diffs) {
    addRow(diff.label, diff.label);
  }
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.id = 'custom-path';
  customInput.placeholder = '/owner/repo/pull/123';
  customInput.size = 28;
  addRow('custom path', 'custom', customInput);
}

function renderSchedule(state) {
  const schedule = document.getElementById('schedule');
  schedule.textContent = '';
  for (const done of doneThisSession) {
    const item = document.createElement('li');
    item.className = done.ok === true ? 'run-done-ok' : 'run-done-fail';
    item.textContent =
      done.ok === true
        ? `✓ done: ${done.version} × ${done.diff} (pass ${done.passIndex}) — ${Math.round(done.durationMs / 1000)}s`
        : `✗ failed: ${done.version} × ${done.diff} (pass ${done.passIndex}) — ${done.error}`;
    schedule.append(item);
  }
  if (state.current != null) {
    const item = document.createElement('li');
    item.textContent = `▶ running: ${state.current.version} × ${state.current.diff} (pass ${state.current.passIndex}) — ${state.current.phase}`;
    schedule.append(item);
  }
  for (const queued of state.queue) {
    const item = document.createElement('li');
    item.className = 'run-queued';
    item.textContent = `· waiting: ${queued.version} × ${queued.diff} (pass ${queued.passIndex})`;
    schedule.append(item);
  }
  if (schedule.children.length === 0) {
    const item = document.createElement('li');
    item.className = 'run-queued';
    item.textContent = 'nothing scheduled';
    schedule.append(item);
  }
}

function renderStatus(state) {
  lastState = state;
  renderSchedule(state);
  const queued = state.queue.length;
  if (state.current != null) {
    const run = state.current;
    liveLabel.textContent = `run #${run.id}: ${run.version} × ${run.diff} (pass ${run.passIndex}) — ${run.phase}`;
    statusLine.textContent = `running: ${run.version} × ${run.diff} — ${run.phase} · ${queued} queued`;
  } else {
    liveLabel.textContent = 'no run in progress';
    statusLine.textContent =
      queued > 0
        ? `${queued} queued`
        : 'idle — check some cells in the matrix and hit run';
  }
}

function appendLog(line) {
  logLines.push(line);
  if (logLines.length > 300) {
    logLines.shift();
  }
  logPane.textContent = logLines.join('\n');
  logPane.scrollTop = logPane.scrollHeight;
}

function showFrame(jpegBase64) {
  screencast.src = `data:image/jpeg;base64,${jpegBase64}`;
  screencast.hidden = false;
}

function mean(values) {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMB(value) {
  return value == null ? '—' : Math.round(value).toLocaleString('en-US');
}

function formatParse(ms) {
  if (ms == null) {
    return '—';
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

// Mean of one metric across a group's ok passes; null samples are skipped.
function okMean(group, select) {
  return mean(
    group.passes
      .filter((pass) => pass.ok)
      .map(select)
      .filter((value) => value != null)
  );
}

const SUMMARY_COLUMNS = [
  { key: 'version', label: 'version', value: (g) => g.version },
  { key: 'diff', label: 'diff', value: (g) => g.diff },
  { key: 'runs', label: 'runs', value: (g) => g.passes.length },
  {
    key: 'cpu',
    label: 'parse CPU',
    value: (g) => okMean(g, (pass) => pass.mainThreadMs),
  },
  {
    key: 'wall',
    label: 'parse wall',
    value: (g) => okMean(g, (pass) => pass.parseMs),
  },
  {
    key: 'peak',
    label: 'peak MB',
    value: (g) => okMean(g, (pass) => pass.settled?.peakMB),
  },
  {
    key: 'settled',
    label: 'settled MB',
    value: (g) =>
      okMean(g, (pass) =>
        pass.settled == null ? null : pass.settled.rssMB + pass.settled.swapMB
      ),
  },
  {
    key: 'aftergc',
    label: 'after-GC MB',
    value: (g) =>
      okMean(g, (pass) =>
        pass.afterGC == null ? null : pass.afterGC.rssMB + pass.afterGC.swapMB
      ),
  },
  {
    key: 'jsheap',
    label: 'JS heap MB',
    value: (g) => okMean(g, (pass) => pass.afterGC?.jsHeapMB),
  },
  {
    key: 'failures',
    label: 'failures',
    value: (g) => g.passes.filter((pass) => pass.ok === false).length,
  },
];

// Group by diff first so the versions of one diff sit next to each other
const summarySort = { key: 'diff', descending: false };

function formatSummaryCell(column, group) {
  const value = column.value(group);
  if (value == null) {
    return '—';
  }
  if (
    column.key === 'version' ||
    column.key === 'diff' ||
    column.key === 'runs' ||
    column.key === 'failures'
  ) {
    return String(value);
  }
  if (column.key === 'cpu' || column.key === 'wall') {
    return formatParse(value);
  }
  return formatMB(value);
}

// One row per version × diff, each metric the mean over that cell's ok
// passes, sortable by any column (same click-to-sort as the history table)
function renderResults() {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.version} | ${result.diff}`;
    let group = groups.get(key);
    if (group == null) {
      groups.set(
        key,
        (group = { version: result.version, diff: result.diff, passes: [] })
      );
    }
    group.passes.push(result);
  }

  const headRow = document.querySelector('#results thead tr');
  if (headRow.children.length === 0) {
    for (const column of SUMMARY_COLUMNS) {
      const th = document.createElement('th');
      th.addEventListener('click', () => {
        if (summarySort.key === column.key) {
          summarySort.descending = !summarySort.descending;
        } else {
          summarySort.key = column.key;
          summarySort.descending = true;
        }
        renderResults();
      });
      headRow.append(th);
    }
  }
  for (let i = 0; i < SUMMARY_COLUMNS.length; i++) {
    const column = SUMMARY_COLUMNS[i];
    headRow.children[i].textContent =
      column.key === summarySort.key
        ? `${column.label} ${summarySort.descending ? '▼' : '▲'}`
        : column.label;
  }

  const sortColumn = SUMMARY_COLUMNS.find((c) => c.key === summarySort.key);
  const sorted = [...groups.values()].sort((a, b) => {
    const left = sortColumn.value(a);
    const right = sortColumn.value(b);
    if (left == null && right == null) {
      return 0;
    }
    if (left == null) {
      return 1;
    }
    if (right == null) {
      return -1;
    }
    const order = left < right ? -1 : left > right ? 1 : 0;
    return summarySort.descending ? -order : order;
  });

  resultsBody.textContent = '';
  for (const group of sorted) {
    const row = document.createElement('tr');
    if (group.passes.every((pass) => pass.ok === false)) {
      row.className = 'run-done-fail';
    }
    for (const column of SUMMARY_COLUMNS) {
      const cell = document.createElement('td');
      cell.textContent = formatSummaryCell(column, group);
      row.append(cell);
    }
    resultsBody.append(row);
  }
}

// ---- history table (every run, sortable, persisted server-side) ----

const HISTORY_COLUMNS = [
  { key: 'date', label: 'date', value: (r) => r.startedAt },
  { key: 'version', label: 'version', value: (r) => r.version },
  { key: 'diff', label: 'diff', value: (r) => r.diff },
  { key: 'pass', label: 'pass', value: (r) => r.passIndex },
  {
    key: 'status',
    label: 'status',
    value: (r) => (r.ok === true ? 'ok' : (r.error ?? 'failed')),
  },
  { key: 'cpu', label: 'parse CPU', value: (r) => r.mainThreadMs },
  { key: 'wall', label: 'parse wall', value: (r) => r.parseMs },
  { key: 'peak', label: 'peak MB', value: (r) => r.settled?.peakMB },
  {
    key: 'settled',
    label: 'settled MB',
    value: (r) =>
      r.settled == null ? null : r.settled.rssMB + r.settled.swapMB,
  },
  {
    key: 'aftergc',
    label: 'after-GC MB',
    value: (r) =>
      r.afterGC == null ? null : r.afterGC.rssMB + r.afterGC.swapMB,
  },
  { key: 'jsheap', label: 'JS heap MB', value: (r) => r.afterGC?.jsHeapMB },
];

const historySort = { key: 'date', descending: true };

function formatHistoryCell(column, result) {
  const value = column.value(result);
  if (value == null) {
    return '—';
  }
  if (column.key === 'date') {
    return String(value).replace('T', ' ').slice(0, 19);
  }
  if (column.key === 'cpu' || column.key === 'wall') {
    return formatParse(value);
  }
  if (typeof value === 'number' && column.key !== 'pass') {
    return formatMB(value);
  }
  return String(value);
}

function renderHistory() {
  const headRow = document.querySelector('#history thead tr');
  if (headRow.children.length === 0) {
    for (const column of HISTORY_COLUMNS) {
      const th = document.createElement('th');
      th.addEventListener('click', () => {
        if (historySort.key === column.key) {
          historySort.descending = !historySort.descending;
        } else {
          historySort.key = column.key;
          historySort.descending = true;
        }
        renderHistory();
      });
      headRow.append(th);
    }
  }
  for (let i = 0; i < HISTORY_COLUMNS.length; i++) {
    const column = HISTORY_COLUMNS[i];
    headRow.children[i].textContent =
      column.key === historySort.key
        ? `${column.label} ${historySort.descending ? '▼' : '▲'}`
        : column.label;
  }

  const column = HISTORY_COLUMNS.find((c) => c.key === historySort.key);
  const sorted = [...results].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (left == null && right == null) {
      return 0;
    }
    if (left == null) {
      return 1;
    }
    if (right == null) {
      return -1;
    }
    const order = left < right ? -1 : left > right ? 1 : 0;
    return historySort.descending ? -order : order;
  });

  const body = document.querySelector('#history tbody');
  body.textContent = '';
  for (const result of sorted) {
    const row = document.createElement('tr');
    if (result.ok !== true) {
      row.className = 'run-done-fail';
    }
    for (const col of HISTORY_COLUMNS) {
      const cell = document.createElement('td');
      cell.textContent = formatHistoryCell(col, result);
      row.append(cell);
    }
    body.append(row);
  }
}

document.getElementById('run').addEventListener('click', () => {
  void (async () => {
    const selections = [
      ...matrixBody.querySelectorAll('input[type=checkbox]:checked'),
    ]
      .filter((box) => box.dataset.version != null)
      .map((box) => ({ version: box.dataset.version, diff: box.dataset.diff }));
    const body = {
      selections,
      passes: Number(document.getElementById('passes').value),
    };
    const customInput = document.getElementById('custom-path');
    if (customInput != null && customInput.value.trim() !== '') {
      body.customPath = customInput.value.trim();
    }
    const response = await fetch('/api/bench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    statusLine.textContent = response.ok
      ? `queued ${payload.queued} runs`
      : `✗ ${payload.error}`;
  })();
});

document.getElementById('cancel').addEventListener('click', () => {
  void fetch('/api/cancel', { method: 'POST' });
});

function connect() {
  const source = new EventSource('/api/events');
  source.addEventListener('hello', (event) => {
    const state = JSON.parse(event.data);
    renderMatrix(state);
    renderStatus(state);
    results = state.results ?? [];
    renderResults();
    renderHistory();
    if (state.lastFrame != null) {
      showFrame(state.lastFrame);
    }
  });
  source.addEventListener('state', (event) => {
    renderStatus(JSON.parse(event.data));
  });
  source.addEventListener('log', (event) => {
    appendLog(JSON.parse(event.data).line);
  });
  source.addEventListener('frame', (event) => {
    showFrame(JSON.parse(event.data).jpeg);
  });
  source.addEventListener('result', (event) => {
    const result = JSON.parse(event.data);
    results.push(result);
    doneThisSession.push(result);
    renderResults();
    renderHistory();
    if (lastState != null) {
      renderSchedule(lastState);
    }
  });
  source.onerror = () => {
    statusLine.textContent = 'disconnected — retrying…';
    source.close();
    setTimeout(connect, 2000);
  };
}

connect();
