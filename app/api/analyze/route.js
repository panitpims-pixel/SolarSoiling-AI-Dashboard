// app/api/analyze/route.js
import { NextResponse } from 'next/server';
import { calculateBeerLambertLoss } from '@/lib/solarEngine';

export const runtime = 'nodejs';

// ถ้าได้ 404 ให้ตั้ง GEMINI_MODEL ใน .env.local เป็นรุ่นที่ key ของคุณใช้ได้ (ดูจาก ListModels)
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const MAX_BASE64_LENGTH = 7_000_000; // ≈ 5MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const CATEGORIES = ['clean', 'light_dust', 'heavy_dust', 'bird_droppings', 'leaves', 'mixed'];

const PROMPT = `คุณเป็นผู้เชี่ยวชาญตรวจสภาพแผงโซลาร์เซลล์ วิเคราะห์รูปภาพนี้แล้วคืนค่าเป็น JSON:
- "isSolarPanel": true ถ้ามีแผงโซลาร์ที่ประเมินได้ ไม่เช่นนั้น false
- "dustDensity": ดัชนีความหนาแน่นฝุ่น/สิ่งสกปรกบนผิวแผง ช่วง 0-10 (ทศนิยมได้)
  0-0.5 สะอาด | 0.5-1.5 ฝุ่นบาง | 1.5-4 ฝุ่นหนาหรือมีคราบ | มากกว่า 4 สกปรกมาก
- "soilingCategory": หนึ่งใน ${CATEGORIES.join(', ')}
- "soilingType": อธิบายประเภทคราบที่เห็นเป็นภาษาไทยสั้นๆ
- "confidence": ความมั่นใจ 0-1 (ลดลงถ้าภาพเบลอ มีแสงสะท้อน มุมเอียง หรือเห็นแผงไม่ชัด)
- "recommendation": คำแนะนำดูแลรักษา 1-2 ประโยคภาษาไทย
ค่าทั้งหมดเป็นการประมาณจากภาพเท่านั้น`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isSolarPanel: { type: 'BOOLEAN' },
    dustDensity: { type: 'NUMBER' },
    soilingCategory: { type: 'STRING', enum: CATEGORIES },
    soilingType: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    recommendation: { type: 'STRING' }
  },
  required: ['isSolarPanel', 'dustDensity', 'soilingCategory', 'soilingType', 'confidence', 'recommendation']
};

function fail(message, status) {
  return NextResponse.json({ error: message }, { status });
}

// Rate limit แบบง่ายในหน่วยความจำ (10 ครั้ง/นาที/IP) — ถ้า deploy แบบ serverless ควรใช้ Redis/Upstash แทน
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();
  return recent.length > 10;
}

function upstreamError(status, detail) {
  const raw = detail?.error?.message || '';
  if (status === 429) return fail('โควต้า Gemini API เต็มชั่วคราว กรุณารอสักครู่แล้วลองใหม่', 429);
  if (status === 400 && /API key/i.test(raw)) {
    return fail('API key ไม่ถูกต้อง ตรวจสอบ GEMINI_API_KEY ใน .env.local', 502);
  }
  if (status === 403) {
    return fail(`Google ปฏิเสธการเข้าถึงของ API key นี้ (${raw || '403'}) ให้สร้าง key ใหม่ที่ https://aistudio.google.com/apikey`, 502);
  }
  if (status === 404 || /no longer available|not found/i.test(raw)) {
    return fail(`ใช้โมเดล "${MODEL}" ไม่ได้ (${raw}) ให้ตั้ง GEMINI_MODEL เป็นรุ่นที่ใช้ได้`, 502);
  }
  return fail(raw || 'Gemini API ผิดพลาด', 502);
}

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail('ยังไม่ได้ตั้งค่า GEMINI_API_KEY บนเซิร์ฟเวอร์', 500);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) return fail('ส่งคำขอถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่', 429);

  const { mimeType, data } = await request.json().catch(() => ({}));
  if (typeof data !== 'string' || !ALLOWED_MIME.includes(mimeType)) {
    return fail('ข้อมูลรูปภาพไม่ถูกต้อง (รองรับ JPG, PNG, WebP)', 400);
  }
  if (data.length > MAX_BASE64_LENGTH) return fail('รูปภาพใหญ่เกินไป', 413);

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType, data } }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    );
  } catch (e) {
    console.error('Gemini request failed:', e);
    return fail('เชื่อมต่อ Gemini ไม่สำเร็จหรือใช้เวลานานเกินไป กรุณาลองใหม่', 504);
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    console.error('Gemini error:', res.status, detail);
    return upstreamError(res.status, detail);
  }

  try {
    const json = await res.json();

    const blockReason = json.promptFeedback?.blockReason;
    if (blockReason) return fail(`Gemini ปฏิเสธรูปนี้ (${blockReason})`, 422);

    // รุ่นที่มี thinking อาจส่ง part ที่เป็น thought มาด้วย จึงกรองออกก่อนรวมข้อความ
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    if (!text) throw new Error('Gemini ไม่ส่งผลลัพธ์กลับมา');

    const parsed = JSON.parse(text);

    if (parsed.isSolarPanel === false) {
      return fail('ภาพนี้ไม่พบแผงโซลาร์เซลล์ กรุณาถ่ายภาพแผงให้เห็นชัดเจน', 422);
    }

    const density = Number(parsed.dustDensity);
    if (!Number.isFinite(density)) throw new Error('dustDensity ไม่ใช่ตัวเลข');
    const dustDensity = Math.round(Math.min(10, Math.max(0, density)) * 100) / 100;

    const conf = Number(parsed.confidence);

    return NextResponse.json({
      dustDensity,
      // Beer-Lambert: loss = (1 - exp(-k·d)) × 100 — คำนวณฝั่งเซิร์ฟเวอร์จากดัชนีฝุ่นที่ AI ประเมิน
      soilingLoss: calculateBeerLambertLoss(dustDensity),
      soilingCategory: CATEGORIES.includes(parsed.soilingCategory) ? parsed.soilingCategory : 'mixed',
      soilingType: parsed.soilingType || 'ไม่ระบุ',
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null,
      recommendation: parsed.recommendation || ''
    });
  } catch (e) {
    console.error('Parse error:', e);
    return fail('อ่านผลวิเคราะห์จาก AI ไม่ได้ กรุณาลองใหม่', 502);
  }
}