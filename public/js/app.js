/* Kira 考研备考助手 - 前端逻辑 */
const API = '';
let SETTINGS = {};
let EVENTS = [];
let currentTaskId = null;
let charts = {};

// ============ 工具函数 ============
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 获取 / 保存 / 清除登录 token
function getToken() { return localStorage.getItem('ky_token') || ''; }
function setToken(t) { localStorage.setItem('ky_token', t); }
function clearToken() { localStorage.removeItem('ky_token'); }

async function api(url, opts = {}) {
  opts.headers = opts.headers || {};
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + url, opts);
  // 401 未登录 → 跳登录页（auth 接口除外，由调用方自行处理）
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    clearToken();
    showLogin();
    throw new Error('未登录');
  }
  return res.json();
}

// ============ 导航 ============
function go(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const tab = document.querySelector(`.tab[data-page="${page}"]`);
  if (tab) tab.classList.add('active');
  if (page === 'home') loadHome();
  if (page === 'checkin') { document.getElementById('checkinDate').value = todayStr(); loadCheckinTasks(); }
  if (page === 'schedule') loadSchedule();
  if (page === 'stats') loadStats();
  if (page === 'plan') { document.getElementById('planDate').value = tomorrowStr(); }
  window.scrollTo(0, 0);
}

// ============ 顶部日期 ============
function renderTopDate() {
  const d = new Date();
  const week = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  document.getElementById('topDate').textContent = `${d.getMonth()+1}月${d.getDate()}日 ${week}`;
}

// ============ 倒计时 ============
function renderCountdown() {
  const exam = new Date(SETTINGS.examDate + 'T00:00:00');
  const now = new Date();
  const diff = Math.ceil((exam - now) / (1000 * 60 * 60 * 24));
  document.getElementById('cdDays').textContent = diff > 0 ? diff : 0;

  // 备考第几天：假设备考从 2027-01-01 开始
  const start = new Date('2027-01-01T00:00:00');
  const dayNum = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
  const cheers = [
    '今天也要稳稳前进呀 ✨',
    '按计划完成，就是在变厉害 🎯',
    '慢慢来，比较快 🌱',
    '你认真的样子超棒 💪',
    '每一步都算数 ⭐'
  ];
  const cheer = cheers[new Date().getDate() % cheers.length];
  document.getElementById('cdSub').textContent = `第 ${dayNum > 0 ? dayNum : 1} 天 · ${cheer}`;
}

// ============ 首页 ============
async function loadHome() {
  renderTopDate();
  renderCountdown();
  loadSchool();
  loadMockExams();
  loadQuote();
  const tasks = await api('/api/tasks?date=' + todayStr());
  const done = tasks.filter(t => t.completed).length;
  const minutes = tasks.filter(t => t.completed).reduce((s, t) => s + (Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0), 0);
  document.getElementById('statTotal').textContent = tasks.length;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statMin').textContent = minutes;

  const stats = await api('/api/stats?days=30');
  document.getElementById('statStreak').textContent = stats.streak;

  const list = document.getElementById('todayTaskList');
  if (tasks.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:16px">今天还没有任务，去"计划"页安排一下吧~</div>';
  } else {
    list.innerHTML = tasks.map(t => `
      <div class="task-item ${t.completed ? 'done' : ''}">
        <div class="task-check">${t.completed ? '<i class="fa fa-check"></i>' : ''}</div>
        <div class="task-info">
          <div class="task-name">${t.name}</div>
          <div class="task-time">${t.startTime || ''}${t.endTime ? ' - ' + t.endTime : ''} · ${t.subject || ''}</div>
        </div>
      </div>
    `).join('');
  }

  // 今日评价
  const evalItem = (stats.evaluations || []).find(e => e.date === todayStr());
  if (evalItem) {
    document.getElementById('evalText').textContent = evalItem.text;
  } else if (done > 0) {
    generateDailyEvaluation(tasks, stats.streak);
  }
}

// ============ 目标学校 ============
async function loadSchool() {
  const s = SETTINGS.targetSchool || {};
  const img = document.getElementById('schoolPhoto');
  const ph = document.getElementById('schoolImgPlaceholder');
  if (s.photo) { img.src = s.photo; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }
  document.getElementById('schoolName').textContent = s.name || '点击设置目标院校';
  document.getElementById('schoolTargetScore').textContent = s.targetScore || '--';
  updateSchoolGap();
}

async function uploadSchoolPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('photo', file);
  const res = await api('/api/settings/school-photo', { method: 'POST', body: form });
  SETTINGS.targetSchool = { ...(SETTINGS.targetSchool || {}), photo: res.photo };
  loadSchool();
}

async function editSchoolName() {
  const name = prompt('请输入目标院校名称：', SETTINGS.targetSchool?.name || '');
  if (name === null) return;
  const ts = { ...(SETTINGS.targetSchool || {}), name };
  await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetSchool: ts }) });
  SETTINGS.targetSchool = ts;
  loadSchool();
}

async function editSchoolScore() {
  const score = prompt('请输入目标分数：', SETTINGS.targetSchool?.targetScore || '');
  if (score === null) return;
  const ts = { ...(SETTINGS.targetSchool || {}), targetScore: Number(score) || 0 };
  await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetSchool: ts }) });
  SETTINGS.targetSchool = ts;
  loadSchool();
}

function updateSchoolGap() {
  const ts = SETTINGS.targetSchool || {};
  const gapEl = document.getElementById('schoolGap');
  if (!ts.targetScore) { gapEl.textContent = '设置目标分数后查看差距'; return; }
  const exams = MOCK_EXAMS || [];
  if (exams.length === 0) { gapEl.textContent = `目标 ${ts.targetScore} 分，记录模考分数后查看差距`; return; }
  const latest = exams[exams.length - 1];
  const avg = Math.round(exams.reduce((s, e) => s + Number(e.score), 0) / exams.length);
  const diff = ts.targetScore - latest.score;
  const trend = exams.length >= 2 ? (exams[exams.length - 1].score - exams[0].score) : 0;
  let gapText = `最近模考 ${latest.score} 分，距目标还差 ${Math.max(0, diff)} 分`;
  if (trend > 0) gapText += ` · 较首次进步 ${trend} 分 📈`;
  else if (trend < 0) gapText += ` · 较首次退步 ${-trend} 分`;
  gapText += ` · 平均 ${avg} 分`;
  gapEl.textContent = gapText;
}

// ============ 模考分数 ============
let MOCK_EXAMS = [];
let mockChart = null;

async function loadMockExams() {
  MOCK_EXAMS = await api('/api/mock-exams');
  document.getElementById('mockDate').value = todayStr();
  renderMockExams();
}

function renderMockExams() {
  const list = document.getElementById('mockList');
  if (MOCK_EXAMS.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);font-size:13px">还没有模考记录~</div>';
  } else {
    list.innerHTML = MOCK_EXAMS.map(e => `
      <div class="mock-item">
        <span>${e.date}${e.name ? ' · ' + e.name : ''}</span>
        <span><span class="mock-score">${e.score}</span> 分 <button class="del-btn" onclick="delMockExam('${e.id}')"><i class="fa fa-trash-o"></i></button></span>
      </div>
    `).join('');
  }
  // 折线图
  const labels = MOCK_EXAMS.map(e => e.date.slice(5));
  const scores = MOCK_EXAMS.map(e => Number(e.score));
  const target = Number(SETTINGS.targetSchool?.targetScore) || 0;
  if (mockChart) mockChart.destroy();
  mockChart = new Chart(document.getElementById('chartMock'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '模考分数', data: scores,
          borderColor: '#E74C3C', backgroundColor: 'rgba(231,76,60,0.1)',
          fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: '#E74C3C'
        },
        ...(target ? [{
          label: '目标分数', data: labels.map(() => target),
          borderColor: '#A9CCE3', borderDash: [5, 5], pointRadius: 0, fill: false
        }] : [])
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: false, grid: { color: 'rgba(169,204,227,0.15)' } }, x: { grid: { display: false } } }
    }
  });
  updateSchoolGap();
}

async function addMockExam() {
  const date = document.getElementById('mockDate').value;
  const score = document.getElementById('mockScore').value;
  const name = document.getElementById('mockName').value;
  if (!date || !score) { alert('请填写日期和分数'); return; }
  await api('/api/mock-exams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, score: Number(score), name }) });
  document.getElementById('mockScore').value = '';
  document.getElementById('mockName').value = '';
  document.getElementById('mockExamForm').style.display = 'none';
  loadMockExams();
}

async function delMockExam(id) {
  if (!confirm('删除这条模考记录？')) return;
  await api('/api/mock-exams/' + id, { method: 'DELETE' });
  loadMockExams();
}

// ============ 每日激励语 ============
let QUOTES = [];
async function loadQuote() {
  QUOTES = await api('/api/quotes');
  const today = todayStr();
  const todayQuote = QUOTES.find(q => q.date === today);
  const el = document.getElementById('quoteText');
  if (todayQuote) {
    el.textContent = todayQuote.text;
    el.style.fontStyle = 'normal';
  } else {
    el.textContent = '点击写下今天想对自己说的话...';
    el.style.fontStyle = 'italic';
  }
}

function editQuote() {
  const today = todayStr();
  const todayQuote = QUOTES.find(q => q.date === today);
  document.getElementById('quoteInput').value = todayQuote ? todayQuote.text : '';
  document.getElementById('quoteEdit').style.display = 'flex';
  document.getElementById('quoteText').style.display = 'none';
}

async function saveQuote() {
  const text = document.getElementById('quoteInput').value.trim();
  if (!text) { document.getElementById('quoteEdit').style.display = 'none'; document.getElementById('quoteText').style.display = 'block'; return; }
  const today = todayStr();
  const existing = QUOTES.find(q => q.date === today);
  if (existing) {
    await api('/api/quotes/' + existing.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } else {
    await api('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today, text }) });
  }
  document.getElementById('quoteEdit').style.display = 'none';
  document.getElementById('quoteText').style.display = 'block';
  loadQuote();
}

// ============ 计划生成 ============
// 科目关键词映射
const SUBJECT_MAP = [
  { keys: ['计网', '计算机网络', '网络', '408'], subject: '408计算机网络', icon: '🌐' },
  { keys: ['数据结构', 'ds', 'DS'], subject: '数据结构', icon: '🗂️' },
  { keys: ['操作系统', 'os', 'OS'], subject: '操作系统', icon: '⚙️' },
  { keys: ['组成原理', '计组', '组成'], subject: '计算机组成原理', icon: '🔧' },
  { keys: ['数学', '高数', '线代', '概率', '张宇', '汤家凤', '武忠祥', '李永乐'], subject: '数学', icon: '📐' },
  { keys: ['英语', '单词', '阅读', '田静', '唐迟', '作文'], subject: '英语', icon: '📖' },
  { keys: ['政治', '肖秀荣', '徐涛'], subject: '政治', icon: '🗳️' },
  { keys: ['错题', '复盘'], subject: '错题整理', icon: '📝' }
];

const SUGGESTIONS = {
  '数学': { focus: '先做基础题，再做错题', method: '限时训练，不会的题标记，当天复盘', note: '不要一边看答案一边做题' },
  '英语': { focus: '单词 + 阅读真题', method: '每天固定量，阅读要精读长难句', note: '单词要反复滚动记忆' },
  '数据结构': { focus: '听课 + 记笔记 + 课后复盘', method: '边听边写伪代码，记录不懂的地方', note: '不要只听课不动笔' },
  '408计算机网络': { focus: '理解协议层次、常见题型', method: '边看边画框架图，用自己的话复述', note: '不要只背概念，要结合题目理解' },
  '操作系统': { focus: '进程、内存、文件系统', method: '结合真题理解概念，画图辅助', note: '重点掌握 PV 操作和内存管理' },
  '计算机组成原理': { focus: '数据表示、CPU、存储器', method: '理解硬件工作原理，多做计算题', note: '注意流水线和 Cache 的计算' },
  '政治': { focus: '选择题 + 大题框架', method: '刷选择题，整理大题答题模板', note: '后期集中背诵，前期理解为主' },
  '错题整理': { focus: '错题归类 + 重做', method: '按知识点分类，标注错误原因', note: '定期回顾，避免重复犯错' }
};

function matchSubject(text) {
  for (const s of SUBJECT_MAP) {
    if (s.keys.some(k => text.includes(k))) return s;
  }
  return { subject: '通用学习', icon: '📚' };
}

function parsePlanText(text) {
  // 按逗号、顿号、句号、分号拆分
  const parts = text.split(/[，。、；,;\n]+/).map(s => s.trim()).filter(Boolean);
  return parts;
}

async function generatePlan() {
  const text = document.getElementById('planInput').value.trim();
  const date = document.getElementById('planDate').value || tomorrowStr();
  if (!text) { alert('请输入明天的学习内容~'); return; }

  const parts = parsePlanText(text);
  if (parts.length === 0) { alert('没有识别到学习内容'); return; }

  // 生成任务列表
  let tasks = parts.map((p, i) => {
    const subj = matchSubject(p);
    const sug = SUGGESTIONS[subj.subject] || { focus: '认真完成学习内容', method: '专注投入，做好笔记', note: '保持学习节奏' };
    // 预估时长：默认 40 分钟
    return {
      name: p,
      subject: subj.subject,
      icon: subj.icon,
      estimatedMinutes: 40,
      priority: i === 0 ? 'high' : (i <= 1 ? 'medium' : 'low'),
      focus: sug.focus,
      method: sug.method,
      note: sug.note
    };
  });

  // 智能排程
  const scheduled = await scheduleTasks(tasks, date);

  // 渲染
  const result = document.getElementById('planResult');
  result.innerHTML = scheduled.map((t, i) => `
    <div class="plan-task">
      <div class="plan-task-head">
        <span class="plan-task-name">${i + 1}. ${t.icon} ${t.name}</span>
        <span class="plan-priority ${t.priority}">${t.priority === 'high' ? '重要' : t.priority === 'medium' ? '一般' : '轻松'}</span>
      </div>
      <div class="plan-time"><i class="fa fa-clock-o"></i> ${t.startTime} - ${t.endTime}（约 ${t.estimatedMinutes} 分钟）</div>
      <div class="plan-suggest">
        <div><b>学习重点：</b>${t.focus}</div>
        <div><b>学习方法：</b>${t.method}</div>
        <div><b>注意事项：</b>${t.note}</div>
      </div>
    </div>
  `).join('');

  // 保存到后端
  await api('/api/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, tasks: scheduled })
  });
  result.innerHTML += '<div style="text-align:center;color:var(--success-text);padding:10px">✅ 计划已保存！</div>';
}

// 智能排程：避开课表事件，使用可用时段
async function scheduleTasks(tasks, date) {
  const events = await api('/api/events');
  const settings = await api('/api/settings');
  const slots = settings.availableSlots || [];

  // 获取目标日期是星期几
  const d = new Date(date + 'T00:00:00');
  const dayOfWeek = d.getDay();

  // 当天的固定事件
  const dayEvents = events
    .filter(e => Number(e.dayOfWeek) === dayOfWeek)
    .map(e => ({ start: e.startTime, end: e.endTime }))
    .sort((a, b) => a.start.localeCompare(b.start));

  // 生成可用时间块
  let freeBlocks = [];
  for (const slot of slots) {
    let cur = toMin(slot.start);
    const end = toMin(slot.end);
    // 扣除事件
    const evs = dayEvents.filter(e => toMin(e.start) < end && toMin(e.end) > cur)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const ev of evs) {
      const es = toMin(ev.start), ee = toMin(ev.end);
      if (es > cur) freeBlocks.push({ start: cur, end: Math.min(es, end) });
      cur = Math.max(cur, ee);
      if (cur >= end) break;
    }
    if (cur < end) freeBlocks.push({ start: cur, end });
  }

  freeBlocks = freeBlocks.filter(b => b.end - b.start >= 20).sort((a, b) => a.start - b.start);

  // 优先级排序：重要的先排
  const pri = { high: 0, medium: 1, low: 2 };
  const sorted = [...tasks].sort((a, b) => pri[a.priority] - pri[b.priority]);

  const rest = 10; // 任务间休息 10 分钟
  let blockIdx = 0;
  let curPos = freeBlocks.length ? freeBlocks[0].start : 0;

  for (const task of sorted) {
    let placed = false;
    while (blockIdx < freeBlocks.length) {
      const block = freeBlocks[blockIdx];
      const need = task.estimatedMinutes;
      if (curPos + need <= block.end) {
        task.startTime = toTime(curPos);
        task.endTime = toTime(curPos + need);
        curPos += need + rest;
        placed = true;
        break;
      } else {
        blockIdx++;
        if (blockIdx < freeBlocks.length) curPos = freeBlocks[blockIdx].start;
      }
    }
    if (!placed) {
      // 时间不够，给默认时间
      task.startTime = '待定';
      task.endTime = '待定';
    }
  }

  // 按开始时间排序返回
  return tasks.map(t => {
    const s = sorted.find(x => x.name === t.name);
    return s || t;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function toTime(min) {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

// ============ 查看可学时段 ============
async function showFreeSlots() {
  const date = document.getElementById('planDate').value || tomorrowStr();
  const events = await api('/api/events');
  const settings = await api('/api/settings');
  const slots = settings.availableSlots || [];
  const d = new Date(date + 'T00:00:00');
  const dayOfWeek = d.getDay();

  // 当天事件
  const dayEvents = events
    .filter(e => Number(e.dayOfWeek) === dayOfWeek)
    .map(e => ({ start: toMin(e.startTime), end: toMin(e.endTime), name: e.name }))
    .sort((a, b) => a.start - b.start);

  // 计算空闲块
  let freeBlocks = [];
  for (const slot of slots) {
    let cur = toMin(slot.start);
    const end = toMin(slot.end);
    for (const ev of dayEvents) {
      if (ev.start > cur && cur < end) freeBlocks.push({ start: cur, end: Math.min(ev.start, end) });
      cur = Math.max(cur, ev.end);
      if (cur >= end) break;
    }
    if (cur < end) freeBlocks.push({ start: cur, end });
  }
  freeBlocks = freeBlocks.filter(b => b.end - b.start >= 20).sort((a, b) => a.start - b.start);

  // 推荐科目：根据输入框里的内容
  const input = document.getElementById('planInput').value.trim();
  let subjects = [];
  if (input) {
    subjects = parsePlanText(input).map(p => matchSubject(p).subject);
  }

  const card = document.getElementById('freeSlotsCard');
  const list = document.getElementById('freeSlotsList');
  card.style.display = 'block';

  if (freeBlocks.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:12px">当天没有可用学习时段，请检查课表设置~</div>';
    return;
  }

  let subjIdx = 0;
  list.innerHTML = `
    <div style="font-size:13px;color:var(--text-light);margin-bottom:10px">
      根据你的课表，${date} 共有 ${freeBlocks.length} 个可学时段：
    </div>
    ${freeBlocks.map(b => {
      const dur = b.end - b.start;
      const rec = subjects[subjIdx % subjects.length] || '自由安排';
      subjIdx++;
      return `
        <div class="free-slot-item">
          <div>
            <div class="free-slot-time">${toTime(b.start)} - ${toTime(b.end)}</div>
            <div class="free-slot-dur">可学 ${dur} 分钟</div>
          </div>
          <div style="text-align:right">
            <div class="rec-subject">建议：${rec}</div>
          </div>
        </div>
      `;
    }).join('')}
    ${dayEvents.length ? `<div style="font-size:12px;color:var(--text-light);margin-top:10px">📌 当天事件：${dayEvents.map(e=>e.name).join('、')}</div>` : ''}
  `;
}

// ============ 打卡 ============
let timerInterval = null;
let timerStartTime = null;
let currentTimerTaskId = null;

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}

function updateTimerDisplay() {
  if (!timerStartTime) return;
  const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = fmtTime(elapsed);
}

async function startStudyTimer(id) {
  if (currentTimerTaskId && currentTimerTaskId !== id) {
    alert('已有任务正在计时中，请先完成当前任务~');
    return;
  }
  await api('/api/tasks/' + id + '/start-timer', { method: 'POST' });
  currentTimerTaskId = id;
  timerStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 1000);
  loadCheckinTasks();
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerStartTime = null;
  currentTimerTaskId = null;
}

async function loadCheckinTasks() {
  const date = document.getElementById('checkinDate').value || todayStr();
  const tasks = await api('/api/tasks?date=' + date);
  const list = document.getElementById('checkinList');
  if (tasks.length === 0) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-light)">这一天还没有任务~</div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    const isStudying = t.timerRunning && currentTimerTaskId === t.id;
    return `
    <div class="checkin-task ${t.completed ? 'done' : ''}">
      <div class="ct-head">
        <span class="ct-name">${t.icon || ''} ${t.name} ${isStudying ? '<span class="studying-badge">学习中</span>' : ''}</span>
        <span class="ct-time">${t.startTime || ''}${t.endTime ? ' - ' + t.endTime : ''}</span>
      </div>
      ${t.subject ? `<div style="font-size:12px;color:var(--text-light)">${t.subject}</div>` : ''}
      ${t.focus ? `<div class="ct-suggest">💡 ${t.focus}</div>` : ''}
      ${t.completed ? `
        <div class="ct-meta">✅ 已打卡 · 实际学习 ${t.actualMinutes || t.estimatedMinutes || 0} 分钟${t.teacher ? ' · ' + t.teacher : ''}${t.completionNote ? ' · ' + t.completionNote : ''}</div>
        ${t.photo ? `<img src="${t.photo}" class="ct-photo" />` : ''}
        ${t.video ? `<video src="${t.video}" class="ct-photo" controls style="max-height:160px"></video>` : ''}
      ` : `
        <div style="display:flex;gap:8px;margin-top:8px">
          ${isStudying
            ? `<button class="btn-ghost" onclick="openCheckin('${t.id}')"><i class="fa fa-camera"></i> 拍照完成</button>`
            : `<button class="btn-ghost" onclick="startStudyTimer('${t.id}')"><i class="fa fa-play-circle"></i> 开始学习</button>`
          }
          <button class="btn-primary" onclick="openCheckin('${t.id}')"><i class="fa fa-camera"></i> 上传笔记打卡</button>
        </div>
      `}
    </div>
  `}).join('');
}

function openCheckin(id) {
  currentTaskId = id;
  document.getElementById('modalPhoto').value = '';
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('modalVideo').value = '';
  document.getElementById('videoPreview').style.display = 'none';
  document.getElementById('videoHint').textContent = '点击录制或选择视频';
  document.getElementById('modalTeacher').value = '';
  document.getElementById('modalNote').value = '';
  document.getElementById('modalTaskName').textContent = '';
  // 显示计时器（如果正在计时）
  const timerBox = document.getElementById('timerBox');
  if (currentTimerTaskId === id && timerStartTime) {
    timerBox.style.display = 'flex';
    updateTimerDisplay();
  } else {
    timerBox.style.display = 'none';
  }
  api('/api/tasks?date=' + (document.getElementById('checkinDate').value || todayStr()))
    .then(tasks => {
      const t = tasks.find(x => x.id === id);
      if (t) document.getElementById('modalTaskName').textContent = (t.icon || '') + ' ' + t.name;
    });
  document.getElementById('checkinModal').classList.add('show');
}

function closeModal() {
  document.getElementById('checkinModal').classList.remove('show');
}

function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('photoPreview');
    img.src = e.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function previewVideo(input) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const v = document.getElementById('videoPreview');
  v.src = url;
  v.style.display = 'block';
  document.getElementById('videoHint').textContent = file.name.length > 20 ? file.name.slice(0, 20) + '...' : file.name;
}

async function submitCheckin() {
  const file = document.getElementById('modalPhoto').files[0];
  if (!file) { alert('必须上传笔记照片才能打卡哦~'); return; }

  // 计算实际学习时长（如果计时器在跑）
  let actualMinutes = 0;
  if (currentTimerTaskId === currentTaskId && timerStartTime) {
    actualMinutes = Math.max(1, Math.round((Date.now() - timerStartTime) / 60000));
  }

  const videoFile = document.getElementById('modalVideo').files[0];
  const form = new FormData();
  form.append('photo', file);
  if (videoFile) form.append('video', videoFile);
  form.append('teacher', document.getElementById('modalTeacher').value);
  form.append('completionNote', document.getElementById('modalNote').value);
  form.append('actualMinutes', actualMinutes);

  const res = await api('/api/tasks/' + currentTaskId + '/checkin', {
    method: 'POST',
    body: form
  });

  if (res.id) {
    stopTimer();
    closeModal();
    loadCheckinTasks();
    // 生成今日评价
    const tasks = await api('/api/tasks?date=' + (document.getElementById('checkinDate').value || todayStr()));
    const stats = await api('/api/stats?days=30');
    generateDailyEvaluation(tasks, stats.streak);
  } else {
    alert('打卡失败，请重试');
  }
}

// ============ 每日评价 ============
function generateDailyEvaluation(tasks, streak) {
  const today = todayStr();
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const rate = total ? done / total : 0;
  const minutes = tasks.filter(t => t.completed).reduce((s, t) => s + (Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0), 0);
  const subjects = [...new Set(tasks.filter(t => t.completed).map(t => t.subject).filter(Boolean))];
  const withPhoto = tasks.filter(t => t.completed && t.photo).length;

  let texts = [];
  if (rate >= 0.9) texts.push('今天完成率很高，计划执行得很稳，继续保持 🌟');
  else if (rate >= 0.6) texts.push('今天完成了大半任务，已经很棒了，明天再加把劲 ✨');
  else if (rate > 0) texts.push('今天任务完成得不多，别灰心，明天重新出发 💪');

  if (minutes >= 180) texts.push('学习时长很充足，知识积累正在发生 📚');
  else if (minutes > 0 && minutes < 60) texts.push('今天学习时间偏少，明天要多投入一些哦 ⏰');

  if (subjects.length >= 3) texts.push('科目覆盖很全面，均衡发展很赞 🎯');
  if (withPhoto === done && done > 0) texts.push('笔记上传很认真，这是巩固知识的好方法 📝');
  if (streak >= 3) texts.push(`连续打卡 ${streak} 天啦，学习习惯正在形成 🔥`);
  if (total > 6 && rate < 0.7) texts.push('今天任务安排有点满，建议明天减少数量，提高质量 🌱');

  const text = texts.length ? texts.join(' ') : '今天也要加油呀，哪怕只学一点点也是进步~';

  api('/api/evaluations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today, text, rate: Math.round(rate * 100), minutes, subjects })
  });
  document.getElementById('evalText').textContent = text;
  return text;
}

// ============ 课表 ============
async function loadSchedule() {
  const events = await api('/api/events');
  EVENTS = events;
  const settings = await api('/api/settings');
  SETTINGS = settings;
  document.getElementById('examDate').value = settings.examDate;
  document.getElementById('deepseekKey').value = settings.deepseekKey || '';

  const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const list = document.getElementById('eventList');
  if (events.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:12px">还没有添加事件~</div>';
  } else {
    list.innerHTML = events.map(e => `
      <div class="event-item">
        <div class="event-info">
          <div class="event-name">${e.name}</div>
          <div class="event-meta">${dayNames[e.dayOfWeek]} ${e.startTime}-${e.endTime}</div>
          ${e.photo ? `<img src="${e.photo}" class="ct-photo" style="max-width:100px;max-height:70px;margin-top:6px;border-radius:8px" />` : ''}
        </div>
        <span class="event-type">${e.type}</span>
        <button class="del-btn" onclick="delEvent('${e.id}')"><i class="fa fa-trash-o"></i></button>
      </div>
    `).join('');
  }

  // 可用时段
  const slotsList = document.getElementById('slotsList');
  slotsList.innerHTML = (settings.availableSlots || []).map((s, i) => `
    <div class="slot-item">
      <input type="time" class="input-sm" value="${s.start}" onchange="updateSlot(${i}, 'start', this.value)" />
      <span>—</span>
      <input type="time" class="input-sm" value="${s.end}" onchange="updateSlot(${i}, 'end', this.value)" />
      <button class="del-btn" onclick="removeSlot(${i})"><i class="fa fa-times"></i></button>
    </div>
  `).join('');
}

async function addEvent() {
  const name = document.getElementById('evName').value.trim();
  if (!name) { alert('请输入事件名称'); return; }
  const form = new FormData();
  form.append('dayOfWeek', document.getElementById('evDay').value);
  form.append('startTime', document.getElementById('evStart').value);
  form.append('endTime', document.getElementById('evEnd').value);
  form.append('name', name);
  form.append('type', document.getElementById('evType').value);
  const photoFile = document.getElementById('evPhoto').files[0];
  if (photoFile) form.append('photo', photoFile);

  await api('/api/events', { method: 'POST', body: form });
  document.getElementById('evName').value = '';
  document.getElementById('evPhoto').value = '';
  document.getElementById('evPhotoPreview').style.display = 'none';
  document.getElementById('evPhotoHint').textContent = '点击拍照或选择图片';
  loadSchedule();
}

function previewEventPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('evPhotoPreview');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('evPhotoHint').textContent = '已选择图片';
  };
  reader.readAsDataURL(file);
}

async function delEvent(id) {
  if (!confirm('删除这个事件？')) return;
  await api('/api/events/' + id, { method: 'DELETE' });
  loadSchedule();
}

async function addSlot() {
  const start = document.getElementById('slotStart').value;
  const end = document.getElementById('slotEnd').value;
  const slots = SETTINGS.availableSlots || [];
  slots.push({ start, end });
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableSlots: slots })
  });
  loadSchedule();
}

async function updateSlot(i, key, val) {
  const slots = SETTINGS.availableSlots || [];
  slots[i][key] = val;
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableSlots: slots })
  });
}

async function removeSlot(i) {
  const slots = SETTINGS.availableSlots || [];
  slots.splice(i, 1);
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableSlots: slots })
  });
  loadSchedule();
}

async function saveExamDate() {
  const d = document.getElementById('examDate').value;
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ examDate: d })
  });
  SETTINGS.examDate = d;
  alert('考研日期已保存 ✅');
}

async function saveDeepseekKey() {
  const key = document.getElementById('deepseekKey').value.trim();
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deepseekKey: key })
  });
  SETTINGS.deepseekKey = key;
  alert('DeepSeek API Key 已保存 ✅');
}

// ============ 统计 ============
let currentPeriod = 'week';
const PIE_COLORS = ['#A9CCE3', '#7FB3D5', '#5DADE2', '#85C1E9', '#AED6F1', '#D6EAF8', '#5499C7', '#2E86C1'];

function switchPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.period-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.period === period);
  });
  loadStats();
}

async function loadStats() {
  const period = currentPeriod;
  const [summary, pie, raw] = await Promise.all([
    api('/api/stats/summary?period=' + period),
    api('/api/stats/pie?period=' + period),
    api('/api/stats?days=14')
  ]);

  // 概览卡片
  document.getElementById('sumRate').textContent = summary.completionRate + '%';
  document.getElementById('sumDone').textContent = summary.completed + '/' + summary.total;
  document.getElementById('sumMin').textContent = summary.minutes + '分';
  document.getElementById('sumStreak').textContent = summary.streak + '天';

  const periodName = period === 'week' ? '本周' : period === 'month' ? '本月' : '本年';
  document.getElementById('periodLabel').textContent = periodName;
  document.getElementById('periodLabel2').textContent = periodName;

  // 趋势折线图（用 buckets）
  const labels = Object.keys(summary.buckets || {});
  const rates = labels.map(k => {
    const b = summary.buckets[k];
    return b.total ? Math.round((b.completed / b.total) * 100) : 0;
  });
  const mins = labels.map(k => summary.buckets[k].minutes);

  // 完成率折线图
  if (charts.rate) charts.rate.destroy();
  charts.rate = new Chart(document.getElementById('chartRate'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '完成率 (%)',
        data: rates,
        borderColor: '#A9CCE3',
        backgroundColor: 'rgba(169,204,227,0.2)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: '#A9CCE3',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: 'rgba(169,204,227,0.15)' } },
        x: { grid: { display: false } }
      }
    }
  });

  // 学习时长折线图
  if (charts.min) charts.min.destroy();
  charts.min = new Chart(document.getElementById('chartMin'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '学习时长 (分钟)',
        data: mins,
        borderColor: '#7FB3D5',
        backgroundColor: 'rgba(127,179,213,0.2)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: '#7FB3D5',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(169,204,227,0.15)' } },
        x: { grid: { display: false } }
      }
    }
  });

  // 科目时间分布饼图（按实际学习时长占比）
  const subjLabels = Object.keys(pie.subjectTimePie || {});
  const subjData = Object.values(pie.subjectTimePie || {});
  const totalMin = pie.totalStudyMin || 0;
  if (charts.subjPie) charts.subjPie.destroy();
  charts.subjPie = new Chart(document.getElementById('chartSubjectPie'), {
    type: 'doughnut',
    data: {
      labels: subjLabels.length ? subjLabels : ['暂无数据'],
      datasets: [{
        data: subjData.length ? subjData : [1],
        backgroundColor: subjLabels.length ? subjLabels.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) : ['#D6EAF8'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 8, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed;
              const pct = totalMin ? Math.round(val / totalMin * 100) : 0;
              return `${ctx.label}: ${val}分钟 (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // 完成状态饼图
  const statusLabels = Object.keys(pie.statusPie || {});
  const statusData = Object.values(pie.statusPie || {});
  if (charts.statusPie) charts.statusPie.destroy();
  charts.statusPie = new Chart(document.getElementById('chartStatusPie'), {
    type: 'pie',
    data: {
      labels: statusLabels,
      datasets: [{
        data: statusData,
        backgroundColor: ['#A9CCE3', '#FADBD8'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } }
      }
    }
  });

  // 完成率分布饼图
  const distLabels = Object.keys(pie.rateDist || {});
  const distData = Object.values(pie.rateDist || {});
  if (charts.rateDistPie) charts.rateDistPie.destroy();
  charts.rateDistPie = new Chart(document.getElementById('chartRateDistPie'), {
    type: 'doughnut',
    data: {
      labels: distLabels,
      datasets: [{
        data: distData,
        backgroundColor: ['#D5F5E3', '#FCF3CF', '#FADBD8', '#EBF5FB'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } }
      }
    }
  });

  // 评价历史
  const eh = document.getElementById('evalHistory');
  const evals = [...(raw.evaluations || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  if (evals.length === 0) {
    eh.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:12px">还没有评价记录~</div>';
  } else {
    eh.innerHTML = evals.map(e => `
      <div class="eval-history-item">
        <div class="eval-history-date">${e.date} · 完成率 ${e.rate || 0}%</div>
        <div class="eval-history-text">${e.text}</div>
      </div>
    `).join('');
  }
}

// ============ AI 评价 ============
async function runAiEvaluate() {
  const btn = document.getElementById('aiEvalBtn');
  const result = document.getElementById('aiResult');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> AI 分析中...';
  result.classList.add('show');
  result.innerHTML = '<span class="ai-loading">正在连接 DeepSeek 分析你的备考数据，请稍候...</span>';

  try {
    const res = await api('/api/ai/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: currentPeriod })
    });
    if (res.error) {
      result.innerHTML = '⚠️ ' + res.error;
    } else {
      result.innerHTML = `
        <div style="font-weight:700;margin-bottom:8px;color:var(--primary)">🤖 ${res.label} AI 备考分析</div>
        <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">完成率 ${res.rate}% · 学习 ${res.minutes} 分钟 · 完成 ${res.completed}/${res.total} 个任务</div>
        ${res.text}
      `;
    }
  } catch (e) {
    result.innerHTML = '⚠️ 请求失败：' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-magic"></i> 重新生成 AI 评价';
  }
}

// ============ 星海动画 ============
const starState = {
  canvas: null, ctx: null, w: 0, h: 0,
  stars: [],            // 已完成任务生成的星星
  bgStars: [],          // 背景远星
  rotation: 0,          // 当前旋转角度
  dragRotation: 0,      // 拖拽产生的旋转偏移
  autoSpeed: 0.0008,    // 自动旋转速度
  dragging: false,
  lastX: 0, lastY: 0,
  animId: null,
  centerX: 0, centerY: 0
};

// 星色：丰富多样（白、蓝、黄、橙、红、粉、青、绿）— 饱和度更高更鲜明
const STAR_COLORS = [
  '#ffffff', '#f8fafc', '#e2e8f0',           // 白/银
  '#93c5fd', '#60a5fa', '#3b82f6',           // 蓝
  '#fde047', '#facc15', '#eab308',           // 黄
  '#fb923c', '#f97316', '#ea580c',           // 橙
  '#f87171', '#ef4444', '#dc2626',           // 红
  '#f9a8d4', '#ec4899', '#db2777',           // 粉
  '#67e8f9', '#22d3ee', '#06b6d4',           // 青
  '#86efac', '#4ade80', '#22c55e'            // 绿
];
function pickStarColor() {
  return STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
}
// 背景远星也用彩色
const BG_STAR_COLORS = ['#ffffff', '#bfdbfe', '#fde68a', '#fca5a5', '#a5f3fc', '#fbcfe8', '#bbf7d0'];

async function loadStarSea() {
  const allTasks = await api('/api/tasks');
  const completed = allTasks.filter(t => t.completed);
  document.getElementById('starCount').textContent = `已点亮 ${completed.length} 颗星 ✨`;

  const total = completed.length;
  const minDim = Math.min(starState.w, starState.h);
  const maxR = minDim * 0.44;

  // 数量越多，单颗星越小（避免拥挤），并分布到更多同心环
  // sizeScale: 1 颗时 ~1.0，50 颗时 ~0.7，200 颗时 ~0.45
  const sizeScale = Math.max(0.4, 1.0 - total * 0.0028);
  // 同心环数量：每 ~12 颗增加一环
  const ringCount = Math.max(1, Math.ceil(total / 12));

  starState.stars = completed.map((t, i) => {
    // 分配到某个同心环
    const ring = i % ringCount;
    const ringProgress = ringCount > 1 ? ring / (ringCount - 1) : 0;
    const ringBaseR = 30 + ringProgress * (maxR - 30);
    // 环内半径抖动
    const radius = ringBaseR + (Math.random() - 0.5) * (maxR / ringCount) * 0.9;
    // 环内角度均匀分布 + 抖动
    const inRingIdx = Math.floor(i / ringCount);
    const perRing = Math.ceil(total / ringCount);
    const angle = (inRingIdx / Math.max(perRing, 1)) * Math.PI * 2
                + (ring % 2) * (Math.PI / perRing)
                + (Math.random() - 0.5) * 0.35;
    const depth = 0.35 + Math.random() * 0.65;
    return {
      task: t,
      baseAngle: angle,
      radius: Math.max(20, Math.min(maxR, radius)),
      depth,
      baseSize: (0.8 + Math.random() * 2.0) * sizeScale,
      color: pickStarColor(),
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.02 + Math.random() * 0.05,
      hasPhoto: !!t.photo
    };
  });

  // 生成背景远星
  if (starState.bgStars.length === 0) {
    for (let i = 0; i < 200; i++) {
      starState.bgStars.push({
        x: Math.random() * starState.w,
        y: Math.random() * starState.h,
        size: Math.random() * 1.2 + 0.3,
        twinkle: Math.random() * Math.PI * 2,
        speed: 0.01 + Math.random() * 0.03,
        color: BG_STAR_COLORS[Math.floor(Math.random() * BG_STAR_COLORS.length)]
      });
    }
  }
}

function initStarCanvas() {
  const canvas = document.getElementById('starCanvas');
  if (!canvas) return;
  starState.canvas = canvas;
  starState.ctx = canvas.getContext('2d');
  resizeStarCanvas();
  window.addEventListener('resize', resizeStarCanvas);

  // 拖拽旋转
  const onDown = e => {
    starState.dragging = true;
    const p = getStarPos(e);
    starState.lastX = p.x; starState.lastY = p.y;
  };
  const onMove = e => {
    if (!starState.dragging) return;
    const p = getStarPos(e);
    const dx = p.x - starState.lastX;
    starState.dragRotation += dx * 0.005;
    starState.lastX = p.x; starState.lastY = p.y;
  };
  const onUp = () => { starState.dragging = false; };

  // 点击检测
  const onClick = e => {
    const p = getStarPos(e);
    const cx = starState.centerX, cy = starState.centerY;
    const rot = starState.rotation + starState.dragRotation;
    let nearest = null, minDist = 22;
    for (const s of starState.stars) {
      const ang = s.baseAngle + rot;
      const sx = cx + Math.cos(ang) * s.radius;
      const sy = cy + Math.sin(ang) * s.radius;
      const d = Math.hypot(p.x - sx, p.y - sy);
      const hitR = 10 + s.depth * 14;
      if (d < hitR && d < minDist) { minDist = d; nearest = s; }
    }
    if (nearest) showStarDetail(nearest.task);
  };

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('touchstart', e => { onDown(e.touches[0]); e.preventDefault(); });
  window.addEventListener('touchmove', e => { if (starState.dragging) { onMove(e.touches[0]); e.preventDefault(); } });
  window.addEventListener('touchend', onUp);

  if (starState.animId) cancelAnimationFrame(starState.animId);
  drawStarScene();
}

function resizeStarCanvas() {
  const canvas = starState.canvas;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  starState.w = rect.width;
  starState.h = rect.height;
  starState.centerX = rect.width / 2;
  starState.centerY = rect.height / 2;
  starState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 重新生成背景远星
  starState.bgStars = [];
  for (let i = 0; i < 200; i++) {
    starState.bgStars.push({
      x: Math.random() * rect.width,
      y: Math.random() * rect.height,
      size: Math.random() * 1.2 + 0.3,
      twinkle: Math.random() * Math.PI * 2,
      speed: 0.01 + Math.random() * 0.03,
      color: BG_STAR_COLORS[Math.floor(Math.random() * BG_STAR_COLORS.length)]
    });
  }
}

function getStarPos(e) {
  const rect = starState.canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// hex 转 rgba
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawStarScene() {
  const ctx = starState.ctx;
  const w = starState.w, h = starState.h;
  const cx = starState.centerX, cy = starState.centerY;
  const rot = starState.rotation + starState.dragRotation;

  // 1. 纯黑背景
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  // 2. 背景远星（微弱闪烁）
  for (const bs of starState.bgStars) {
    bs.twinkle += bs.speed;
    const alpha = 0.15 + Math.abs(Math.sin(bs.twinkle)) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = bs.color;
    ctx.beginPath();
    ctx.arc(bs.x, bs.y, bs.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 3. 任务星星（环形分布的亮星）
  const sorted = [...starState.stars].sort((a, b) => a.depth - b.depth);
  for (const s of sorted) {
    const ang = s.baseAngle + rot;
    const sx = cx + Math.cos(ang) * s.radius;
    const sy = cy + Math.sin(ang) * s.radius;
    s.twinkle += s.twinkleSpeed;
    const tw = 0.5 + Math.abs(Math.sin(s.twinkle)) * 0.5;
    const size = s.baseSize * (0.4 + s.depth * 1.8);
    const brightness = s.depth * (0.5 + tw * 0.5);

    // 光晕
    const haloR = size * 5;
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR);
    halo.addColorStop(0, hexToRgba(s.color, brightness * 0.6));
    halo.addColorStop(0.4, hexToRgba(s.color, brightness * 0.15));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // 星芒十字（亮星）
    if (s.depth > 0.6) {
      ctx.globalAlpha = brightness * 0.4;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 0.5;
      const ray = size * 4;
      ctx.beginPath();
      ctx.moveTo(sx - ray, sy); ctx.lineTo(sx + ray, sy);
      ctx.moveTo(sx, sy - ray); ctx.lineTo(sx, sy + ray);
      ctx.stroke();
    }

    // 星星本体
    ctx.globalAlpha = brightness;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fill();
    // 高光（减弱，保留原色）
    ctx.globalAlpha = brightness * 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx - size * 0.25, sy - size * 0.25, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 自动旋转
  if (!starState.dragging) {
    starState.rotation += starState.autoSpeed;
    starState.dragRotation *= 0.998;
  }

  starState.animId = requestAnimationFrame(drawStarScene);
}

function showStarDetail(t) {
  document.getElementById('sdTitle').textContent = t.icon ? t.icon + ' ' + t.name : t.name;
  document.getElementById('sdSubject').textContent = t.subject || '学习';
  const dateStr = t.date;
  const timeStr = t.completedAt ? new Date(t.completedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  document.getElementById('sdDate').textContent = `📅 ${dateStr}${timeStr ? '  ' + timeStr : ''}`;
  document.getElementById('sdNote').textContent = t.completionNote ? '📝 ' + t.completionNote : '';
  const min = t.actualMinutes || t.estimatedMinutes || 0;
  document.getElementById('sdMinutes').textContent = min ? `⏱️ 学习 ${min} 分钟` : '';
  const img = document.getElementById('sdPhoto');
  if (t.photo) { img.src = t.photo; img.style.display = 'block'; }
  else { img.style.display = 'none'; }
  const vid = document.getElementById('sdVideo');
  if (t.video) { vid.src = t.video; vid.style.display = 'block'; }
  else { vid.style.display = 'none'; }
  document.getElementById('starDetail').style.display = 'flex';
}

function closeStarDetail() {
  document.getElementById('starDetail').style.display = 'none';
}

// ============ AI 悬浮聊天助手 ============
let aiChatHistory = [];
let aiLoading = false;

function toggleAiChat() {
  const chat = document.getElementById('aiChat');
  chat.classList.toggle('open');
  if (chat.classList.contains('open')) {
    setTimeout(() => document.getElementById('aiChatInput').focus(), 100);
  }
}

function appendAiMsg(role, text) {
  const box = document.getElementById('aiChatMessages');
  const msg = document.createElement('div');
  msg.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-bot');
  const avatar = role === 'user'
    ? '<div class="ai-msg-avatar"><i class="fa fa-user"></i></div>'
    : '<div class="ai-msg-avatar"><i class="fa fa-robot"></i></div>';
  const lines = String(text).split('\n').filter(l => l.trim());
  const bubble = lines.map(l => `<div class="ai-msg-text">${escapeHtml(l)}</div>`).join('');
  msg.innerHTML = avatar + '<div class="ai-msg-bubble">' + bubble + '</div>';
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
  return msg;
}

function showAiTyping() {
  const box = document.getElementById('aiChatMessages');
  const msg = document.createElement('div');
  msg.className = 'ai-msg ai-msg-bot';
  msg.id = 'aiTyping';
  msg.innerHTML = '<div class="ai-msg-avatar"><i class="fa fa-robot"></i></div>' +
    '<div class="ai-msg-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>';
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}
function removeAiTyping() {
  const t = document.getElementById('aiTyping');
  if (t) t.remove();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function askAi(question) {
  document.getElementById('aiChatInput').value = question;
  sendAiMsg();
}

async function sendAiMsg() {
  if (aiLoading) return;
  const input = document.getElementById('aiChatInput');
  const text = input.value.trim();
  if (!text) return;

  // 隐藏推荐问题
  const sugg = document.getElementById('aiChatSuggest');
  if (sugg) sugg.style.display = 'none';

  appendAiMsg('user', text);
  input.value = '';
  aiLoading = true;
  const sendBtn = document.querySelector('.ai-chat-send');
  sendBtn.disabled = true;

  showAiTyping();

  try {
    const r = await api('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: aiChatHistory })
    });
    removeAiTyping();
    if (r.error) {
      appendAiMsg('bot', '⚠ ' + r.error);
    } else {
      appendAiMsg('bot', r.text);
      aiChatHistory.push({ role: 'user', content: text });
      aiChatHistory.push({ role: 'assistant', content: r.text });
      // 只保留最近 10 轮
      if (aiChatHistory.length > 20) aiChatHistory = aiChatHistory.slice(-20);
    }
  } catch (e) {
    removeAiTyping();
    appendAiMsg('bot', '网络出错了，请稍后再试 😢');
  } finally {
    aiLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============ 院校文件智能分析 ============
async function analyzeSchoolFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    alert('文件不能超过 20MB');
    return;
  }
  document.getElementById('schoolFileName').textContent = '📎 ' + file.name;
  document.getElementById('schoolAnalyzeLoading').style.display = 'block';
  document.getElementById('schoolResult').style.display = 'none';

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(API + '/api/school/analyze', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: fd
    });
    const data = await res.json();
    document.getElementById('schoolAnalyzeLoading').style.display = 'none';

    if (data.error) {
      document.getElementById('schoolResult').style.display = 'block';
      document.getElementById('schoolResultContent').innerHTML =
        `<div class="sr-error">⚠ ${escapeHtml(data.error)}</div>`;
      return;
    }
    renderSchoolResult(data);
  } catch (e) {
    document.getElementById('schoolAnalyzeLoading').style.display = 'none';
    document.getElementById('schoolResult').style.display = 'block';
    document.getElementById('schoolResultContent').innerHTML =
      `<div class="sr-error">⚠ 网络错误：${escapeHtml(e.message)}</div>`;
  } finally {
    input.value = '';
  }
}

function renderSchoolResult(d) {
  const c = document.getElementById('schoolResultContent');
  const subjects = Array.isArray(d.subjects) ? d.subjects : [];
  const subjHtml = subjects.map(s =>
    `<span class="sr-subject-tag">${escapeHtml(String(s))}</span>`
  ).join('');
  const init = d.initial_score || {};
  const bd = init.breakdown || {};
  const bdHtml = Object.entries(bd).map(([k, v]) =>
    `<div><b>${escapeHtml(k)}</b>：${escapeHtml(String(v))}</div>`
  ).join('');
  const ret = d.retest_score || {};
  const ratio = d.admission_ratio || {};

  c.innerHTML = `
    <div class="sr-section">
      <div class="sr-major">🎯 ${escapeHtml(d.major || '未识别专业')}</div>
    </div>
    <div class="sr-section">
      <div class="sr-section-title">📚 初试科目</div>
      <div class="sr-subjects">${subjHtml || '<span style="color:var(--text-light)">未提及</span>'}</div>
      ${d.subjects_note ? `<div class="sr-note">${escapeHtml(d.subjects_note)}</div>` : ''}
    </div>
    <div class="sr-section">
      <div class="sr-section-title">📊 初试分数建议</div>
      <div class="sr-score-grid">
        <div class="sr-score-box">
          <div class="sr-score-label">建议总分</div>
          <div class="sr-score-num">${escapeHtml(String(init.total || '未提及'))}</div>
        </div>
        <div class="sr-score-box">
          <div class="sr-score-label">稳妥上岸分</div>
          <div class="sr-score-num safe">${escapeHtml(String(init.safe_score || '未提及'))}</div>
        </div>
        <div class="sr-score-box">
          <div class="sr-score-label">最低进复试</div>
          <div class="sr-score-num">${escapeHtml(String(init.min_score || '未提及'))}</div>
        </div>
      </div>
      ${bdHtml ? `<div class="sr-breakdown">${bdHtml}</div>` : ''}
    </div>
    <div class="sr-section">
      <div class="sr-section-title">🎓 复试情况</div>
      ${ret.total ? `<div class="sr-text"><b>复试总分：</b>${escapeHtml(String(ret.total))}</div>` : ''}
      ${ret.pass_score ? `<div class="sr-text"><b>及格线：</b>${escapeHtml(String(ret.pass_score))}</div>` : ''}
      ${ret.weight ? `<div class="sr-text"><b>占比：</b>${escapeHtml(String(ret.weight))}</div>` : ''}
      ${ret.content ? `<div class="sr-text" style="margin-top:6px;">${escapeHtml(ret.content)}</div>` : ''}
    </div>
    <div class="sr-section">
      <div class="sr-section-title">📈 报录比分析</div>
      ${ratio.ratio ? `<div class="sr-ratio">${escapeHtml(String(ratio.ratio))}</div>` : ''}
      ${ratio.explanation ? `<div class="sr-text">${escapeHtml(ratio.explanation)}</div>` : ''}
      ${ratio.competition ? `<div class="sr-text" style="margin-top:4px;"><b>竞争程度：</b>${escapeHtml(ratio.competition)}</div>` : ''}
    </div>
    ${d.summary ? `<div class="sr-section"><div class="sr-section-title">💡 备考建议</div><div class="sr-summary">${escapeHtml(d.summary)}</div></div>` : ''}
  `;
  document.getElementById('schoolResult').style.display = 'block';
  document.getElementById('schoolResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 导航到星海页时初始化
const origGo = go;
go = function(page) {
  origGo(page);
  if (page === 'star') {
    document.getElementById('starDetail').style.display = 'none';
    loadStarSea();
    setTimeout(initStarCanvas, 50);
  } else if (starState.animId) {
    cancelAnimationFrame(starState.animId);
    starState.animId = null;
  }
};

// ============ 初始化 ============
// ============ 登录 / 注册 ============
function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('app').style.display = 'none';
}
function showRegister() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('app').style.display = 'none';
}
function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  if (!u || !p) { errEl.textContent = '请输入用户名和密码'; return; }
  errEl.textContent = '';
  const r = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  if (r.error) {
    if (r.error === 'no_account') { showRegister(); return; }
    errEl.textContent = r.error;
    return;
  }
  setToken(r.token);
  document.getElementById('userLabel').textContent = r.username;
  showApp();
  afterLoginInit();
}

async function doRegister() {
  const u = document.getElementById('regUser').value.trim();
  const p = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  const errEl = document.getElementById('regErr');
  if (!u || !p) { errEl.textContent = '请输入用户名和密码'; return; }
  if (p.length < 4) { errEl.textContent = '密码至少 4 位'; return; }
  if (p !== p2) { errEl.textContent = '两次密码不一致'; return; }
  errEl.textContent = '';
  const r = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  if (r.error) { errEl.textContent = r.error; return; }
  setToken(r.token);
  document.getElementById('userLabel').textContent = r.username;
  showApp();
  afterLoginInit();
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  clearToken();
  showLogin();
}

async function afterLoginInit() {
  SETTINGS = await api('/api/settings');
  renderTopDate();
  renderCountdown();
  loadHome();
}

async function init() {
  // 先检查登录态
  try {
    const r = await api('/api/auth/status');
    if (r.valid) {
      document.getElementById('userLabel').textContent = r.username;
      showApp();
      afterLoginInit();
    } else if (r.hasAccount) {
      showLogin();
    } else {
      showRegister();
    }
  } catch (e) {
    showLogin();
  }
}

init();

// ============ 注册 Service Worker（PWA 可安装） ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
