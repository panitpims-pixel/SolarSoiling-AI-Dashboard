// lib/solarEngine.js  (เวอร์ชันปรับปรุง — export ชื่อเดิมครบ ใช้แทนไฟล์เดิมได้เลย)

export const DEFAULT_SYSTEM_CAPACITY_KW = 50;
export const DERATE_FACTOR = 0.9;
export const THAI_GRID_CO2_FACTOR = 0.5; // kg CO2/kWh — ควรตรวจค่าล่าสุดจาก อบก. (TGO)

// ฝนช่วยล้างฝุ่นได้จริงก็ต่อเมื่อฝนมากพอ (ฝนปรอยๆ ไม่พอ)
export const RAIN_PROB_THRESHOLD = 60; // %
export const RAIN_MM_THRESHOLD = 5;    // mm ใน 24 ชม.
// คราบที่ฝนล้างไม่ออก
const STUBBORN_REGEX = /มูลนก|ขี้นก|ใบไม้|ยางไม้|bird|leaf|leaves/i;

const num = (v, fb) =>
  v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fb;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 1) => parseFloat(Number(v).toFixed(d));

/** Beer-Lambert: T = exp(-k·d), loss% = (1 - T)·100 */
export function calculateBeerLambertLoss(dustDensity = 1.5, extinctionCoeff = 0.05) {
  const d = Math.max(0, num(dustDensity, 1.5));
  const k = Math.max(0, num(extinctionCoeff, 0.05));
  return round((1 - Math.exp(-k * d)) * 100, 1);
}

export function calculateSoilingLoss(params = {}) {
  return calculateBeerLambertLoss(params.dustDensity ?? 1.5, params.extinctionCoeff ?? 0.05);
}

/** ย้อนสูตร: จาก loss% (ที่ AI ประเมิน) → ความหนาแน่นฝุ่นเชิงสัมพัทธ์ d = -ln(1-L)/k */
export function estimateDustDensity(lossPercent, extinctionCoeff = 0.05) {
  const L = clamp(num(lossPercent, 0), 0, 99.9) / 100;
  const k = Math.max(1e-6, num(extinctionCoeff, 0.05));
  return round(-Math.log(1 - L) / k, 2);
}

function rawPowerLoss(lossPercent, capacityKw) {
  return (clamp(num(lossPercent, 7.2), 0, 100) / 100) *
    Math.max(0, num(capacityKw, DEFAULT_SYSTEM_CAPACITY_KW)) * DERATE_FACTOR;
}

export function calculatePowerLoss(lossPercent = 7.2, capacityKw = DEFAULT_SYSTEM_CAPACITY_KW) {
  return round(rawPowerLoss(lossPercent, capacityKw), 1);
}

export function calculateFullSolarAnalysis({
  soilingLossPercent = 7.2,
  systemCapacityKw = DEFAULT_SYSTEM_CAPACITY_KW,
  electricityTariff = 4.2,
  rainProbability = 0,     // % สูงสุดใน 24 ชม. (null = ไม่ทราบ)
  rainMm24h = null,        // mm รวมใน 24 ชม. (null = ไม่ทราบ → ใช้ความน่าจะเป็นอย่างเดียว)
  soilingType = '',        // จาก AI เช่น "มูลนก", "ฝุ่นบาง"
  sunHoursPerDay = 4.2,    // ส่งค่าจริงจาก shortwave_radiation ได้ (kWh/m² ≈ peak sun hours)
  cleaningCostBaht = 1000,
  soilingThresholdPercent = 5.0
} = {}) {
  const lossPercent = clamp(num(soilingLossPercent, 7.2), 0, 100);
  const capacity = Math.max(0, num(systemCapacityKw, DEFAULT_SYSTEM_CAPACITY_KW));
  const tariff = Math.max(0, num(electricityTariff, 4.2));
  const sunHours = Math.max(0, num(sunHoursPerDay, 4.2));
  const rain = clamp(num(rainProbability, 0), 0, 100);
  const mm = rainMm24h === null || rainMm24h === undefined ? null : Math.max(0, num(rainMm24h, 0));
  const cleaningCost = Math.max(0, num(cleaningCostBaht, 1000));
  const threshold = Math.max(0, num(soilingThresholdPercent, 5.0));

  const powerLossKw = rawPowerLoss(lossPercent, capacity);
  const dailyLossKwh = powerLossKw * sunHours;
  const dailyLossBaht = dailyLossKwh * tariff;
  const monthlyLossBaht = dailyLossBaht * 30;
  const breakEvenDays = dailyLossBaht > 0 ? Math.ceil(cleaningCost / dailyLossBaht) : null;
  const monthlyCo2LossKg = dailyLossKwh * 30 * THAI_GRID_CO2_FACTOR;
  const netBenefit30dBaht = monthlyLossBaht - cleaningCost; // บวก = ล้างแล้วคุ้มภายใน 30 วัน

  const stubborn = STUBBORN_REGEX.test(String(soilingType));
  const rainWillWash =
    rain >= RAIN_PROB_THRESHOLD && (mm === null || mm >= RAIN_MM_THRESHOLD) && !stubborn;

  let recommendation, statusColor;
  if (lossPercent < threshold) {
    recommendation = 'ยังไม่ต้องทำความสะอาด (ประสิทธิภาพยังอยู่ในระดับดี)';
    statusColor = 'green';
  } else if (rainWillWash) {
    recommendation = `ชะลอการล้างแผง (ฝนโอกาส ${rain}%${mm !== null ? ` ปริมาณ ~${round(mm, 1)} mm` : ''} ใน 24 ชม. น่าจะช่วยชะล้างฟรี)`;
    statusColor = 'blue';
  } else if (netBenefit30dBaht >= 0) {
    recommendation =
      (stubborn ? 'คราบฝนล้างไม่ออก ' : '') +
      `ควรทำความสะอาดทันที (ระยะเวลาคืนทุน ${breakEvenDays ?? '-'} วัน, คุ้มกว่า ~${Math.round(netBenefit30dBaht).toLocaleString('th-TH')} บาท/30 วัน)`;
    statusColor = 'red';
  } else {
    recommendation = `เฝ้าระวังและวางแผนล้างตามรอบ (คืนทุนค่าล้างใน ~${breakEvenDays ?? '-'} วัน)`;
    statusColor = 'yellow';
  }

  return {
    soilingLossPercent: round(lossPercent, 1),
    systemCapacityKw: capacity,
    powerLossKw: round(powerLossKw, 1),
    dailyLossKwh: round(dailyLossKwh, 2),
    dailyLossBaht: round(dailyLossBaht, 2),
    monthlyLossBaht: round(monthlyLossBaht, 2),
    monthlyCo2LossKg: round(monthlyCo2LossKg, 1),
    breakEvenDays,
    netBenefit30dBaht: round(netBenefit30dBaht, 0),
    rainWillWash,
    recommendation,
    statusColor
  };
}