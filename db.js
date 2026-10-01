// 轻量级 JSON 文件数据库
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function loadDB() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      settings: {
        examDate: '2028-12-23',
        availableSlots: [
          { start: '08:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
          { start: '19:00', end: '22:00' }
        ],
        targetSchool: { name: '', photo: '', targetScore: 0 }
      },
      events: [],     // 课表/固定事件
      tasks: [],      // 计划任务（含打卡信息）
      lectures: [],   // 听课记录
      evaluations: [],// 每日评价
      mockExams: [],  // 模考分数记录
      quotes: []      // 每日激励语
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return { settings: { examDate: '2028-12-23', availableSlots: [] }, events: [], tasks: [], lectures: [], evaluations: [] };
  }
}

function saveDB(db) {
  ensureDirs();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { loadDB, saveDB, genId, UPLOAD_DIR, DATA_DIR };
