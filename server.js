// 下一站，上岸！ - 后端服务
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { loadDB, saveDB, genId, UPLOAD_DIR } = require('./db');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ============ 鉴权 ============
const crypto = require('crypto');
function hashPass(pwd) {
  const salt = 'kaoyan-salt-2026';
  return crypto.createHash('sha256').update(salt + pwd).digest('hex');
}
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 注册（首次设置账号）
app.post('/api/auth/register', (req, res) => {
  const db = loadDB();
  if (db.settings.authUser) {
    return res.status(400).json({ error: '已存在账号，请直接登录' });
  }
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: '用户名和密码必填，密码至少4位' });
  }
  db.settings.authUser = username;
  db.settings.authPassHash = hashPass(password);
  const token = genToken();
  db.settings.authToken = token;
  saveDB(db);
  res.json({ ok: true, token, username });
});

// 登录
app.post('/api/auth/login', (req, res) => {
  const db = loadDB();
  const { username, password } = req.body || {};
  if (!db.settings.authUser) {
    return res.status(400).json({ error: 'no_account' });
  }
  if (username !== db.settings.authUser || hashPass(password) !== db.settings.authPassHash) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = genToken();
  db.settings.authToken = token;
  saveDB(db);
  res.json({ ok: true, token, username });
});

// 状态：是否有账号 + token 是否有效
app.get('/api/auth/status', (req, res) => {
  const db = loadDB();
  const hasAccount = !!db.settings.authUser;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const valid = hasAccount && token && token === db.settings.authToken;
  res.json({ hasAccount, valid, username: valid ? db.settings.authUser : null });
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  const db = loadDB();
  db.settings.authToken = '';
  saveDB(db);
  res.json({ ok: true });
});

// API 鉴权中间件（保护除 /api/auth/* 外的所有接口）
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  const db = loadDB();
  // 未设置账号时放行（首次使用）
  if (!db.settings.authUser) return next();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token || token !== db.settings.authToken) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  next();
});

// 照片上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ============ 设置 ============
app.get('/api/settings', (req, res) => {
  const db = loadDB();
  res.json(db.settings);
});

app.put('/api/settings', (req, res) => {
  const db = loadDB();
  db.settings = { ...db.settings, ...req.body };
  saveDB(db);
  res.json(db.settings);
});

// ============ 课表 / 固定事件 ============
app.get('/api/events', (req, res) => {
  const db = loadDB();
  res.json(db.events);
});

app.post('/api/events', upload.single('photo'), (req, res) => {
  const db = loadDB();
  let photoPath = null;
  if (req.file) photoPath = '/uploads/' + req.file.filename;
  const ev = { id: genId(), photo: photoPath, ...req.body };
  db.events.push(ev);
  saveDB(db);
  res.json(ev);
});

app.delete('/api/events/:id', (req, res) => {
  const db = loadDB();
  db.events = db.events.filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============ 计划任务（含打卡） ============
app.get('/api/tasks', (req, res) => {
  const db = loadDB();
  const { date } = req.query;
  let tasks = db.tasks;
  if (date) tasks = tasks.filter(t => t.date === date);
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const db = loadDB();
  const task = { id: genId(), completed: false, ...req.body };
  db.tasks.push(task);
  saveDB(db);
  res.json(task);
});

app.post('/api/tasks/batch', (req, res) => {
  const db = loadDB();
  const { date, tasks } = req.body;
  // 先删除该日期的未打卡任务
  db.tasks = db.tasks.filter(t => t.date !== date || t.completed);
  const created = tasks.map(t => ({ id: genId(), date, completed: false, ...t }));
  db.tasks.push(...created);
  saveDB(db);
  res.json(created);
});

app.put('/api/tasks/:id', (req, res) => {
  const db = loadDB();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.tasks[idx] = { ...db.tasks[idx], ...req.body };
  saveDB(db);
  res.json(db.tasks[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const db = loadDB();
  db.tasks = db.tasks.filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============ 开始学习计时 ============
app.post('/api/tasks/:id/start-timer', (req, res) => {
  const db = loadDB();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.tasks[idx].startedAt = new Date().toISOString();
  db.tasks[idx].timerRunning = true;
  saveDB(db);
  res.json(db.tasks[idx]);
});

// ============ 打卡（上传照片 + 视频 + 结束计时） ============
app.post('/api/tasks/:id/checkin', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }]), (req, res) => {
  const db = loadDB();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  let photoPath = null;
  let videoPath = null;
  if (req.files && req.files.photo) photoPath = '/uploads/' + req.files.photo[0].filename;
  if (req.files && req.files.video) videoPath = '/uploads/' + req.files.video[0].filename;
  const task = db.tasks[idx];
  // 计算实际学习时长（从开始计时到打卡完成）
  let actualMinutes = Number(req.body.actualMinutes) || task.actualMinutes || 0;
  if (task.startedAt && !actualMinutes) {
    const started = new Date(task.startedAt).getTime();
    const now = Date.now();
    actualMinutes = Math.max(1, Math.round((now - started) / 60000));
  }
  db.tasks[idx] = {
    ...task,
    completed: true,
    completedAt: new Date().toISOString(),
    teacher: req.body.teacher || task.teacher || '',
    completionNote: req.body.completionNote || '',
    photo: photoPath || task.photo || null,
    video: videoPath || task.video || null,
    actualMinutes,
    timerRunning: false
  };
  saveDB(db);
  res.json(db.tasks[idx]);
});

// ============ 听课记录 ============
app.get('/api/lectures', (req, res) => {
  const db = loadDB();
  res.json(db.lectures);
});

app.post('/api/lectures', upload.single('photo'), (req, res) => {
  const db = loadDB();
  let photoPath = null;
  if (req.file) photoPath = '/uploads/' + req.file.filename;
  const lec = {
    id: genId(),
    subject: req.body.subject || '',
    teacher: req.body.teacher || '',
    content: req.body.content || '',
    date: req.body.date || new Date().toISOString().slice(0, 10),
    duration: Number(req.body.duration) || 0,
    photo: photoPath
  };
  db.lectures.push(lec);
  saveDB(db);
  res.json(lec);
});

app.delete('/api/lectures/:id', (req, res) => {
  const db = loadDB();
  db.lectures = db.lectures.filter(l => l.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============ 每日评价 ============
app.get('/api/evaluations', (req, res) => {
  const db = loadDB();
  res.json(db.evaluations);
});

app.post('/api/evaluations', (req, res) => {
  const db = loadDB();
  const { date } = req.body;
  const idx = db.evaluations.findIndex(e => e.date === date);
  const item = { date, ...req.body };
  if (idx === -1) db.evaluations.push(item);
  else db.evaluations[idx] = item;
  saveDB(db);
  res.json(item);
});

// ============ 统计数据 ============
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const days = Number(req.query.days) || 30;
  const today = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayTasks = db.tasks.filter(t => t.date === dateStr);
    const total = dayTasks.length;
    const completed = dayTasks.filter(t => t.completed).length;
    const minutes = dayTasks.filter(t => t.completed).reduce((s, t) => s + (Number(t.estimatedMinutes) || 0), 0);
    const subjects = [...new Set(dayTasks.filter(t => t.completed).map(t => t.subject).filter(Boolean))];
    result.push({
      date: dateStr,
      total, completed,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      minutes,
      subjects
    });
  }
  // 连续打卡天数
  let streak = 0;
  for (let i = 0; i < result.length; i++) {
    const r = result[result.length - 1 - i];
    if (r.completed > 0) streak++;
    else if (r.total > 0) break;
  }
  // 各科目学习次数
  const subjectCount = {};
  db.tasks.filter(t => t.completed).forEach(t => {
    if (t.subject) subjectCount[t.subject] = (subjectCount[t.subject] || 0) + 1;
  });
  res.json({ daily: result, streak, subjectCount, evaluations: db.evaluations });
});

// ============ 周期聚合统计（周/月/年） ============
function getWeekRange(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday, label: `${monday.getMonth()+1}/${monday.getDate()}-${sunday.getMonth()+1}/${sunday.getDate()}` };
}

function getDateRange(period) {
  const now = new Date();
  if (period === 'week') return getWeekRange(now);
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end, label: `${now.getFullYear()}年${now.getMonth()+1}月` };
  }
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end, label: `${now.getFullYear()}年` };
  }
  // 默认最近14天
  const start = new Date(now);
  start.setDate(start.getDate() - 13);
  start.setHours(0, 0, 0, 0);
  return { start, end: now, label: '近14天' };
}

app.get('/api/stats/summary', (req, res) => {
  const db = loadDB();
  const period = req.query.period || 'week';
  const { start, end, label } = getDateRange(period);

  const inRange = t => {
    const d = new Date(t.date + 'T00:00:00');
    return d >= start && d <= end;
  };

  const tasks = db.tasks.filter(inRange);
  const completed = tasks.filter(t => t.completed);
  const total = tasks.length;
  const doneCount = completed.length;
  const minutes = completed.reduce((s, t) => s + (Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0), 0);

  // 科目分布
  const subjectCount = {};
  completed.forEach(t => {
    if (t.subject) subjectCount[t.subject] = (subjectCount[t.subject] || 0) + 1;
  });

  // 按时段（周/月/年）分组的趋势
  const buckets = {};
  if (period === 'week') {
    // 按天分组
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { total: 0, completed: 0, minutes: 0 };
    }
  } else if (period === 'month') {
    // 按周分组
    const weeks = Math.ceil((end.getDate() - start.getDate() + 1) / 7);
    for (let i = 0; i < weeks; i++) {
      const ws = new Date(start);
      ws.setDate(start.getDate() + i * 7);
      buckets[`第${i+1}周`] = { total: 0, completed: 0, minutes: 0 };
    }
  } else if (period === 'year') {
    // 按月分组
    for (let m = 0; m < 12; m++) {
      buckets[`${m+1}月`] = { total: 0, completed: 0, minutes: 0 };
    }
  }

  tasks.forEach(t => {
    const d = new Date(t.date + 'T00:00:00');
    let key;
    if (period === 'week') key = t.date;
    else if (period === 'month') {
      const weekIdx = Math.floor((d.getDate() - 1) / 7);
      key = `第${weekIdx+1}周`;
    } else if (period === 'year') {
      key = `${d.getMonth()+1}月`;
    }
    if (buckets[key]) {
      buckets[key].total++;
      if (t.completed) {
        buckets[key].completed++;
        buckets[key].minutes += Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0;
      }
    }
  });

  // 连续打卡
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dayTasks = db.tasks.filter(t => t.date === ds);
    if (dayTasks.some(t => t.completed)) streak++;
    else if (dayTasks.length > 0) break;
  }

  res.json({
    period, label,
    total, completed: doneCount,
    completionRate: total ? Math.round((doneCount / total) * 100) : 0,
    minutes, streak,
    subjectCount,
    buckets
  });
});

// ============ 饼图数据 ============
app.get('/api/stats/pie', (req, res) => {
  const db = loadDB();
  const period = req.query.period || 'week';
  const { start, end } = getDateRange(period);

  const inRange = t => {
    const d = new Date(t.date + 'T00:00:00');
    return d >= start && d <= end;
  };

  const tasks = db.tasks.filter(inRange);
  const completed = tasks.filter(t => t.completed);

  // 科目时间分布（按实际学习时长占比）
  const subjectTimePie = {};
  let totalStudyMin = 0;
  completed.forEach(t => {
    const s = t.subject || '未分类';
    const m = Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0;
    subjectTimePie[s] = (subjectTimePie[s] || 0) + m;
    totalStudyMin += m;
  });

  // 完成状态分布
  const statusPie = {
    '已完成': completed.length,
    '未完成': tasks.length - completed.length
  };

  // 每日完成率分布（>=80 / 50-80 / <50 / 无任务）
  const rateDist = { '优秀(≥80%)': 0, '良好(50-80%)': 0, '待加强(<50%)': 0, '无任务': 0 };
  const dateMap = {};
  tasks.forEach(t => {
    if (!dateMap[t.date]) dateMap[t.date] = { total: 0, done: 0 };
    dateMap[t.date].total++;
    if (t.completed) dateMap[t.date].done++;
  });
  Object.values(dateMap).forEach(({ total, done }) => {
    if (total === 0) rateDist['无任务']++;
    else {
      const r = done / total;
      if (r >= 0.8) rateDist['优秀(≥80%)']++;
      else if (r >= 0.5) rateDist['良好(50-80%)']++;
      else rateDist['待加强(<50%)']++;
    }
  });

  res.json({ subjectTimePie, totalStudyMin, statusPie, rateDist });
});

// ============ AI 评价（DeepSeek） ============
app.post('/api/ai/evaluate', async (req, res) => {
  const db = loadDB();
  const period = req.body.period || 'week';
  const apiKey = db.settings.deepseekKey || '';
  if (!apiKey) {
    return res.status(400).json({ error: '请先在课表设置页填写 DeepSeek API Key' });
  }

  // 获取该周期数据
  const { start, end, label } = getDateRange(period);
  const inRange = t => {
    const d = new Date(t.date + 'T00:00:00');
    return d >= start && d <= end;
  };
  const tasks = db.tasks.filter(inRange);
  const completed = tasks.filter(t => t.completed);
  const total = tasks.length;
  const doneCount = completed.length;
  const minutes = completed.reduce((s, t) => s + (Number(t.actualMinutes) || Number(t.estimatedMinutes) || 0), 0);
  const rate = total ? Math.round((doneCount / total) * 100) : 0;

  const subjectCount = {};
  completed.forEach(t => { if (t.subject) subjectCount[t.subject] = (subjectCount[t.subject] || 0) + 1; });

  const notes = completed.map(t => `${t.subject || '学习'}: ${t.name}${t.completionNote ? '（' + t.completionNote + '）' : ''}`).join('\n');

  const prompt = `你是一位温柔又专业的考研备考教练。请根据以下数据对我本${period === 'week' ? '周' : period === 'month' ? '月' : '年'}的备考情况给出评价和建议。

【周期】${label}
【任务总数】${total}
【已完成】${doneCount}
【完成率】${rate}%
【学习总时长】${minutes} 分钟
【各科目完成次数】${JSON.stringify(subjectCount)}
【已完成任务记录】
${notes || '（暂无记录）'}

请用中文输出，语气像朋友一样温暖鼓励，包含以下三点：
1. 总体评价（完成率、时长、科目均衡度）
2. 做得好的地方
3. 需要改进的地方和下周/下个月的具体建议

控制在 200 字以内，不要用 Markdown，直接分段即可。`;

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(400).json({ error: data.error?.message || 'AI 调用失败' });
    }
    const text = data.choices?.[0]?.message?.content || 'AI 没有返回内容';
    res.json({ text, period, label, rate, minutes, completed: doneCount, total });
  } catch (e) {
    res.status(500).json({ error: '网络错误: ' + e.message });
  }
});

// ============ AI 对话助手 ============
const AI_SYSTEM_PROMPT = `你是"小岸"，一位温柔又专业的考研备考助手。
你的职责：
1. 解答考研相关问题（科目、方法、时间规划、心态调整等）
2. 鼓励和陪伴备考的同学，语气像朋友一样温暖
3. 给出具体、可执行的建议
回答要求：
- 用中文，口语化，不要太正式
- 适当使用 emoji 增加亲切感
- 回答简洁，重点突出，不要长篇大论
- 如果问题与考研无关，可以友好地引导回备考话题`;

app.post('/api/ai/chat', async (req, res) => {
  const db = loadDB();
  const apiKey = db.settings.deepseekKey || '';
  if (!apiKey) {
    return res.status(400).json({ error: '请先在课表设置页填写 DeepSeek API Key' });
  }
  const message = (req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: '请输入问题' });
  }
  const history = Array.isArray(req.body.history) ? req.body.history : [];

  const messages = [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history, { role: 'user', content: message }];

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 800
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(400).json({ error: data.error?.message || 'AI 调用失败' });
    }
    const text = data.choices?.[0]?.message?.content || 'AI 没有返回内容';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: '网络错误: ' + e.message });
  }
});

// ============ 目标学校图片上传 ============
app.post('/api/settings/school-photo', upload.single('photo'), (req, res) => {
  const db = loadDB();
  let photoPath = null;
  if (req.file) photoPath = '/uploads/' + req.file.filename;
  db.settings.targetSchool = { ...(db.settings.targetSchool || {}), photo: photoPath };
  saveDB(db);
  res.json({ photo: photoPath });
});

// ============ 院校录取文件智能分析 ============
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

async function extractDocText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') {
    const data = await pdfParse(file.buffer);
    return data.text || '';
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || '';
  }
  if (ext === '.doc') {
    return '[旧版 .doc 文件暂不支持，请转换为 .docx 或 PDF 后上传]';
  }
  return '';
}

const SCHOOL_ANALYZE_PROMPT = `你是一位资深考研规划专家。请根据用户上传的院校招生简章/专业目录/复试方案等文件内容，进行结构化分析。

请严格按以下 JSON 格式输出（不要输出 JSON 以外的任何内容）：
{
  "major": "专业名称",
  "subjects": ["初试科目1", "初试科目2", "初试科目3", "初试科目4"],
  "subjects_note": "各科目简要说明或参考书目建议",
  "initial_score": {
    "total": "建议初试总分（数字）",
    "breakdown": {"科目1": "建议分数", "科目2": "建议分数"},
    "safe_score": "稳妥上岸分数",
    "min_score": "最低进复试分数"
  },
  "retest_score": {
    "total": "复试总分",
    "pass_score": "复试及格线",
    "weight": "复试占总成绩比例（如 40%）",
    "content": "复试内容简述（笔试/面试/英语等）"
  },
  "admission_ratio": {
    "ratio": "报录比（如 1:5 或 5:1）",
    "explanation": "报录比含义解读",
    "competition": "竞争激烈程度评估"
  },
  "summary": "总体备考建议（200字以内）"
}

注意：
1. 如果文件中没有某项信息，对应字段填"未提及"或合理估算
2. 分数建议要结合国家线、院校线综合判断
3. 报录比要从文件中提取真实数据，没有则填"未公布"
4. subjects 数组列出初试所有科目`;

app.post('/api/school/analyze', docUpload.single('file'), async (req, res) => {
  try {
    const db = loadDB();
    const apiKey = db.settings.deepseekKey || '';
    if (!apiKey) {
      return res.status(400).json({ error: '请先在课表设置页填写 DeepSeek API Key' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const imgExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const textExts = ['.pdf', '.docx', '.txt', '.doc'];
    let textContent = '';
    let isImage = false;

    if (imgExts.includes(ext)) {
      isImage = true;
    } else if (textExts.includes(ext)) {
      if (ext === '.txt') {
        textContent = req.file.buffer.toString('utf-8');
      } else {
        textContent = await extractDocText(req.file);
      }
    } else {
      return res.status(400).json({ error: '不支持的文件格式，请上传 PDF、Word、TXT 或图片' });
    }

    if (!isImage && !textContent.trim()) {
      return res.status(400).json({ error: '未能从文件中提取到文字内容，请确认文件格式正确' });
    }

    // 限制文本长度
    const trimmed = textContent.slice(0, 8000);

    let messages;
    if (isImage) {
      const base64 = req.file.buffer.toString('base64');
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/' + ext.slice(1);
      messages = [
        { role: 'system', content: SCHOOL_ANALYZE_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: '请分析这张院校录取相关图片' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
        ]}
      ];
    } else {
      messages = [
        { role: 'system', content: SCHOOL_ANALYZE_PROMPT },
        { role: 'user', content: `文件内容：\n${trimmed}` }
      ];
    }

    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(400).json({ error: data.error?.message || 'AI 分析失败' });
    }
    const rawText = data.choices?.[0]?.message?.content || '';
    // 解析 JSON
    let result;
    try {
      result = JSON.parse(rawText);
    } catch (e) {
      // 尝试提取 JSON
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        return res.status(500).json({ error: 'AI 返回格式解析失败', raw: rawText });
      }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '分析出错: ' + e.message });
  }
});

// ============ 模考分数 ============
app.get('/api/mock-exams', (req, res) => {
  const db = loadDB();
  res.json((db.mockExams || []).sort((a, b) => a.date.localeCompare(b.date)));
});

app.post('/api/mock-exams', (req, res) => {
  const db = loadDB();
  const exam = { id: genId(), ...req.body };
  db.mockExams = db.mockExams || [];
  db.mockExams.push(exam);
  saveDB(db);
  res.json(exam);
});

app.delete('/api/mock-exams/:id', (req, res) => {
  const db = loadDB();
  db.mockExams = (db.mockExams || []).filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============ 每日激励语 ============
app.get('/api/quotes', (req, res) => {
  const db = loadDB();
  res.json(db.quotes || []);
});

app.post('/api/quotes', (req, res) => {
  const db = loadDB();
  const quote = { id: genId(), ...req.body };
  db.quotes = db.quotes || [];
  db.quotes.push(quote);
  saveDB(db);
  res.json(quote);
});

app.put('/api/quotes/:id', (req, res) => {
  const db = loadDB();
  const idx = (db.quotes || []).findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.quotes[idx] = { ...db.quotes[idx], ...req.body };
  saveDB(db);
  res.json(db.quotes[idx]);
});

app.delete('/api/quotes/:id', (req, res) => {
  const db = loadDB();
  db.quotes = (db.quotes || []).filter(q => q.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`下一站，上岸！已启动: http://localhost:${PORT}`);
});
