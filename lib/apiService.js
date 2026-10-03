// lib/apiService.js

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1280;
const WEATHER_TTL_MS = 30 * 60 * 1000; // แคชพยากรณ์ 30 นาที

export const DEFAULT_LOCATION = { lat: 13.7563, lon: 100.5018, label: 'กรุงเทพฯ (ค่าเริ่มต้น)' };

// ย่อรูปด้วย canvas แล้วแปลงเป็น JPEG base64
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('เปิดไฟล์รูปไม่ได้ (รองรับ JPG, PNG, WebP)'));
      el.src = url;
    });

    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 1. วิเคราะห์รูปผ่าน /api/analyze
export async function analyzePanelImage(imageFile) {
  if (!imageFile?.type?.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  if (imageFile.size > MAX_IMAGE_BYTES) throw new Error('ไฟล์รูปใหญ่เกิน 10MB');

  const { mimeType, data } = await prepareImage(imageFile);

  let res;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType, data })
    });
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `วิเคราะห์รูปภาพไม่สำเร็จ (HTTP ${res.status})`);
  }
  return res.json();
}

// 2. ขอพิกัด GPS จากเบราว์เซอร์
export function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('เบราว์เซอร์นี้ไม่รองรับ GPS'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: Math.round(pos.coords.latitude * 10000) / 10000,
          lon: Math.round(pos.coords.longitude * 10000) / 10000,
          label: 'ตำแหน่งปัจจุบัน (GPS)'
        }),
      (err) =>
        reject(
          new Error(
            err.code === 1 ? 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง' : 'ระบุตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง'
          )
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < WEATHER_TTL_MS ? v : null;
  } catch {
    return null;
  }
}
function writeCache(key, v) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* ไม่มีที่เก็บก็ข้าม */
  }
}

// 3. พยากรณ์อากาศ Real-time + 7 วัน (Open-Meteo)
export async function fetchWeatherData(lat = DEFAULT_LOCATION.lat, lon = DEFAULT_LOCATION.lon, { force = false } = {}) {
  const cacheKey = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=precipitation_probability,precipitation,shortwave_radiation` +
      `&daily=precipitation_probability_max,precipitation_sum` +
      `&forecast_days=7&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();

    const times = data.hourly?.time ?? [];
    const probs = data.hourly?.precipitation_probability ?? [];
    const precips = data.hourly?.precipitation ?? [];
    const rads = data.hourly?.shortwave_radiation ?? [];

    // เวลาท้องถิ่นตาม utc_offset_seconds ของพิกัดนั้น
    const nowLocal = new Date(Date.now() + (data.utc_offset_seconds ?? 0) * 1000)
      .toISOString()
      .slice(0, 13);
    let i = times.findIndex((t) => t.startsWith(nowLocal));
    if (i === -1) i = 0;

    const next24 = (arr) => arr.slice(i, i + 24).filter(Number.isFinite);
    const p24 = next24(probs);

    const result = {
      rainProbability: p24.length ? Math.max(...p24) : 0,                              // % สูงสุดใน 24 ชม.
      rainMm24h: Math.round(next24(precips).reduce((a, b) => a + b, 0) * 10) / 10,     // mm รวมใน 24 ชม.
      sunHours24h: Math.round((next24(rads).reduce((a, b) => a + b, 0) / 1000) * 10) / 10, // kWh/m² ≈ peak sun hours
      current: {
        rainProbability: probs[i] ?? 0,
        precipitation: precips[i] ?? 0,
        shortwaveRadiation: rads[i] ?? 0,
        time: times[i] ?? ''
      },
      dailyForecast: (data.daily?.time ?? []).map((date, k) => ({
        date,
        maxRainProb: data.daily.precipitation_probability_max?.[k] ?? 0,
        rainMm: data.daily.precipitation_sum?.[k] ?? 0
      })),
      isFallback: false
    };
    writeCache(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('Weather fetch error:', error);
    return {
      rainProbability: null,
      rainMm24h: null,
      sunHours24h: null,
      current: { rainProbability: 0, precipitation: 0, shortwaveRadiation: 0, time: '' },
      dailyForecast: [],
      isFallback: true
    };
  }
}