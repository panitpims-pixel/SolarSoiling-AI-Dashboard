// lib/storage.js
// ตั้งค่าระบบ + ประวัติการวัด เก็บไว้ในเบราว์เซอร์ของผู้ใช้ (localStorage) ไม่ส่งไปที่ไหน

export const SETTINGS_KEY = 'solar.settings.v1';
export const HISTORY_KEY = 'solar.history.v1';
export const MAX_HISTORY = 200;

export const DEFAULT_LOCATION = { name: 'กรุงเทพมหานคร', latitude: 13.7563, longitude: 100.5018 };

// ช่องกรอกค่าของระบบ (หน้าเว็บวาดฟอร์มจากรายการนี้ และใช้ min/max ตรวจค่า)
export const SETTING_FIELDS = [
  {
    key: 'systemCapacityKw', label: 'กำลังติดตั้งรวม', unit: 'kW', min: 0.1, max: 100000, defaultValue: 50,
    hint: 'จำนวนแผง × วัตต์ต่อแผง ÷ 1,000 (เช่น 100 แผง × 500 W = 50 kW)'
  },
  {
    key: 'electricityTariff', label: 'ค่าไฟต่อหน่วย', unit: 'บาท/kWh', min: 0, max: 100, defaultValue: 4.2,
    hint: 'ดูจากบิลค่าไฟ: ราคาต่อหน่วยที่คุณจ่ายจริง (ไม่รวมค่าบริการรายเดือน)'
  },
  {
    key: 'sunHoursPerDay', label: 'ชั่วโมงแสงแดดเฉลี่ยต่อวัน', unit: 'ชม./วัน', min: 0.5, max: 12, defaultValue: 4.2,
    hint: 'ชั่วโมงแสงแดดเต็มกำลังเทียบเท่า ไทยส่วนใหญ่ราว 4–5.5 (โดยประมาณ) ดูค่าวันนี้ได้จากแผงสภาพอากาศด้านบน'
  },
  {
    key: 'cleaningCostBaht', label: 'ค่าบริการล้างแผงต่อครั้ง', unit: 'บาท', min: 0, max: 10000000, defaultValue: 1000,
    hint: 'ราคาที่ผู้รับเหมาเสนอสำหรับล้างทั้งระบบ 1 รอบ'
  },
  {
    key: 'soilingThresholdPercent', label: 'เริ่มพิจารณาล้างเมื่อสูญเสียเกิน', unit: '%', min: 0, max: 50, defaultValue: 5,
    hint: 'ถ้าสูญเสียต่ำกว่านี้ ระบบจะบอกว่ายังไม่ต้องล้าง (เกณฑ์ของคุณเอง)'
  },
  {
    key: 'rainMmThreshold', label: 'ฝนที่ถือว่าช่วยล้างแผงได้ (ใน 24 ชม.)', unit: 'มม.', min: 0, max: 200, defaultValue: 5,
    hint: 'ค่าสมมติ: ฝนต้องตกอย่างน้อยเท่านี้ถึงช่วยล้างฝุ่นได้ ปรับตามหน้างานจริง'
  }
];

export const DEFAULT_SETTINGS = {
  ...Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.defaultValue])),
  location: DEFAULT_LOCATION
};

const SOURCES = ['vision-ai', 'manual'];
const STATUSES = ['green', 'yellow', 'red', 'blue'];

// แปลงเป็นตัวเลข: null / '' / boolean ถือว่าไม่ใช่ตัวเลข (ไม่ให้กลายเป็น 0)
const toNumber = (v) =>
  typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
const finiteOrNull = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
};

export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ใช้วิธีสำรองด้านล่าง */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ตรวจข้อความที่ผู้ใช้พิมพ์ในช่องกรอกตาม min/max ของช่องนั้น
export function parseField(field, text) {
  const n = toNumber(text);
  const valid = Number.isFinite(n) && n >= field.min && n <= field.max;
  return { valid, value: valid ? n : null };
}

export function sanitizeLocation(raw) {
  const lat = toNumber(raw?.latitude);
  const lon = toNumber(raw?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ...DEFAULT_LOCATION };
  }
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 120)
      : `พิกัด ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return { name, latitude: lat, longitude: lon };
}

// ค่าที่ผิดปกติหรือหายไปจะถูกแทนด้วยค่าเริ่มต้นเสมอ (กันข้อมูลใน localStorage เสีย)
export function sanitizeSettings(raw) {
  const out = {};
  for (const f of SETTING_FIELDS) {
    const n = toNumber(raw?.[f.key]);
    out[f.key] = Number.isFinite(n) && n >= f.min && n <= f.max ? n : f.defaultValue;
  }
  out.location = sanitizeLocation(raw?.location);
  return out;
}

function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const loss = toNumber(e.soilingLoss);
  const timestamp = typeof e.timestamp === 'string' ? e.timestamp : '';
  if (!Number.isFinite(loss) || loss < 0 || loss > 100 || Number.isNaN(Date.parse(timestamp))) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : makeId(),
    timestamp,
    source: SOURCES.includes(e.source) ? e.source : 'manual',
    soilingLoss: loss,
    location: typeof e.location === 'string' ? e.location.slice(0, 120) : '',
    latitude: finiteOrNull(e.latitude),
    longitude: finiteOrNull(e.longitude),
    rainProbability: finiteOrNull(e.rainProbability),
    rainMm: finiteOrNull(e.rainMm),
    powerLossKw: finiteOrNull(e.powerLossKw),
    dailyLossBaht: finiteOrNull(e.dailyLossBaht),
    monthlyLossBaht: finiteOrNull(e.monthlyLossBaht),
    statusColor: STATUSES.includes(e.statusColor) ? e.statusColor : 'green',
    soilingType: typeof e.soilingType === 'string' ? e.soilingType.slice(0, 200) : '',
    confidence: typeof e.confidence === 'string' ? e.confidence.slice(0, 40) : ''
  };
}

function readJson(key) {
  try {
    const text = window.localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // โหมดส่วนตัว / พื้นที่เต็ม / ถูกบล็อก
  }
}

export const loadSettings = () => sanitizeSettings(readJson(SETTINGS_KEY));
export const saveSettings = (settings) => writeJson(SETTINGS_KEY, settings);

export function loadHistory() {
  const raw = readJson(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeEntry)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) // ใหม่สุดก่อน
    .slice(0, MAX_HISTORY);
}
export const saveHistory = (history) => writeJson(HISTORY_KEY, history);