'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Sun, CheckCircle2, RefreshCw, CloudRain, TrendingDown, Wrench, Activity,
  Upload, Loader2, AlertTriangle, MapPin, Settings, Leaf
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

import { analyzePanelImage, fetchWeatherData, getUserLocation, DEFAULT_LOCATION } from '@/lib/apiService';
import { calculateFullSolarAnalysis, DEFAULT_SYSTEM_CAPACITY_KW } from '@/lib/solarEngine';

const SETTINGS_KEY = 'solar-dashboard-settings-v1';
const DEFAULT_SETTINGS = {
  capacityKw: String(DEFAULT_SYSTEM_CAPACITY_KW),
  tariff: '4.2',
  cleaningCost: '1000'
};

// ชื่อคลาส Tailwind ต้องเขียนให้ครบ ห้ามต่อสตริงแบบ dynamic
const STATUS_STYLES = {
  green: {
    box: 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
    title: 'ยังไม่ต้องล้างแผง'
  },
  yellow: {
    box: 'bg-amber-950/40 border-amber-500/50 text-amber-200',
    icon: <Wrench className="h-5 w-5 text-amber-400" />,
    title: 'เฝ้าระวัง / วางแผนล้าง'
  },
  red: {
    box: 'bg-rose-950/40 border-rose-500/50 text-rose-200',
    icon: <Wrench className="h-5 w-5 text-rose-400" />,
    title: 'ควรล้างแผงทันที'
  },
  blue: {
    box: 'bg-sky-950/40 border-sky-500/50 text-sky-200',
    icon: <CloudRain className="h-5 w-5 text-sky-400" />,
    title: 'ชะลอการล้าง (รอฝน)'
  }
};

const card = 'bg-slate-800/80 border border-slate-700/60 p-5 rounded-xl shadow-lg';
const inputCls =
  'w-full bg-slate-900 border border-slate-700 focus:border-amber-400 outline-none rounded-lg px-3 py-2 text-sm text-slate-100';

const thaiNum = (n, d = 0) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

const toPositive = (s, fallback) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default function SolarSoilingDashboard() {
  // ---- ตั้งค่าระบบ + ตำแหน่ง ----
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [locError, setLocError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const hydrated = useRef(false);

  // ---- อากาศ ----
  const [weather, setWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // ---- ผลวิเคราะห์ ----
  const [soilingLoss, setSoilingLoss] = useState(null); // null = ยังไม่มีข้อมูล
  const [source, setSource] = useState(null);           // 'ai' | 'manual'
  const [selectedImage, setSelectedImage] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef(null);

  // โหลดค่าที่บันทึกไว้ (เฉพาะฝั่ง client)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved?.settings) setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
      if (saved?.location && Number.isFinite(saved.location.lat) && Number.isFinite(saved.location.lon)) {
        setLocation(saved.location);
      }
    } catch {
      /* ใช้ค่าเริ่มต้น */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings, location }));
    } catch {
      /* ข้าม */
    }
  }, [settings, location]);

  const loadWeather = useCallback(async (force = false) => {
    setIsLoading(true);
    try {
      setWeather(await fetchWeatherData(location.lat, location.lon, { force }));
    } finally {
      setIsLoading(false);
    }
  }, [location.lat, location.lon]);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const useGps = async () => {
    setIsLocating(true);
    setLocError('');
    try {
      setLocation(await getUserLocation());
    } catch (err) {
      setLocError(err.message);
    } finally {
      setIsLocating(false);
    }
  };

  // ---- คำนวณทั้งหมดจาก solarEngine ----
  const capacityKw = toPositive(settings.capacityKw, DEFAULT_SYSTEM_CAPACITY_KW);
  const analysis = useMemo(() => {
    if (soilingLoss === null) return null;
    return calculateFullSolarAnalysis({
      soilingLossPercent: soilingLoss,
      systemCapacityKw: capacityKw,
      electricityTariff: toPositive(settings.tariff, 4.2),
      cleaningCostBaht: toPositive(settings.cleaningCost, 1000),
      rainProbability: weather?.rainProbability ?? null,
      rainMm24h: weather?.rainMm24h ?? null,
      // ถ้ามีรังสีจริงใช้ค่าจริง ไม่งั้นให้ engine ใช้ค่าเฉลี่ย
      sunHoursPerDay: weather?.sunHours24h > 0 ? weather.sunHours24h : undefined,
      soilingType: aiResult ? `${aiResult.soilingCategory} ${aiResult.soilingType}` : ''
    });
  }, [soilingLoss, capacityKw, settings.tariff, settings.cleaningCost, weather, aiResult]);

  const status = analysis ? STATUS_STYLES[analysis.statusColor] ?? STATUS_STYLES.green : null;

  const chartData = useMemo(
    () =>
      (weather?.dailyForecast ?? []).map((d) => ({
        day: new Date(`${d.date}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' }),
        prob: d.maxRainProb,
        mm: d.rainMm
      })),
    [weather]
  );

  // ---- อัปโหลดรูป ----
  const openFilePicker = () => {
    if (!isAnalyzing) fileInputRef.current?.click();
  };

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;

    setSelectedImage(url);
    setIsAnalyzing(true);
    setAiResult(null);
    setErrorMessage('');

    try {
      const result = await analyzePanelImage(file);
      setAiResult(result);
      if (Number.isFinite(result?.soilingLoss)) {
        setSoilingLoss(result.soilingLoss); // 0 = สะอาด เป็นค่าที่ถูกต้อง
        setSource('ai');
      }
    } catch (err) {
      console.warn('Vision AI analysis failed:', err);
      setErrorMessage(err.message || 'วิเคราะห์รูปภาพไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const setField = (key) => (e) => setSettings((s) => ({ ...s, [key]: e.target.value }));
  const lowConfidence = Number.isFinite(aiResult?.confidence) && aiResult.confidence < 0.5;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-amber-400">
            <Sun className="h-8 w-8" />
            SolarSoiling AI Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            ต้องล้างแผงโซลาร์หรือยัง และล้างตอนนี้คุ้มไหม — Vision AI + Beer-Lambert Law + พยากรณ์อากาศ
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="bg-slate-800 text-emerald-400 border border-emerald-500/30 text-xs px-3 py-1.5 rounded-full flex items-center gap-2 font-medium">
            <Activity className="h-3.5 w-3.5" />
            {source === 'ai' ? 'ประเมินจากภาพ (Gemini)' : source === 'manual' ? 'ปรับค่าเอง' : 'รอรูปภาพ'}
          </span>
          <button
            onClick={() => loadWeather(true)}
            disabled={isLoading}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            อัปเดตพยากรณ์
          </button>
        </div>
      </div>

      {/* ตั้งค่าระบบ */}
      <div className={`${card} mb-8`}>
        <h2 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-400" />
          ข้อมูลระบบของคุณ
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <label className="text-xs text-slate-400 space-y-1">
            <span>กำลังติดตั้งรวม (kW)</span>
            <input type="number" min="0" step="0.1" inputMode="decimal" value={settings.capacityKw} onChange={setField('capacityKw')} className={inputCls} />
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            <span>ค่าไฟ (บาท/kWh)</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={settings.tariff} onChange={setField('tariff')} className={inputCls} />
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            <span>ค่าล้างแผงต่อครั้ง (บาท)</span>
            <input type="number" min="0" step="50" inputMode="decimal" value={settings.cleaningCost} onChange={setField('cleaningCost')} className={inputCls} />
          </label>
          <div className="space-y-1">
            <button
              onClick={useGps}
              disabled={isLocating}
              className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-slate-100 text-sm font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-2 transition"
            >
              {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 text-sky-400" />}
              ใช้ตำแหน่งปัจจุบัน (GPS)
            </button>
            <p className="text-[11px] text-slate-500 truncate">
              {location.label} · {location.lat}, {location.lon}
            </p>
          </div>
        </div>
        {locError && <p className="text-xs text-rose-300 mt-3">{locError}</p>}
      </div>

      {/* การ์ดสรุป */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className={card}>
          <div className="flex justify-between items-center text-slate-400 mb-2">
            <span className="text-sm font-medium">อัตราสูญเสียจากคราบฝุ่น</span>
            <TrendingDown className="h-5 w-5 text-rose-400" />
          </div>
          <div className="text-3xl font-extrabold text-rose-400">
            {analysis ? `${analysis.soilingLossPercent}%` : '--'}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {analysis
              ? source === 'ai'
                ? 'ประเมินจากภาพผ่าน Beer-Lambert (ค่าประมาณ)'
                : 'ค่าที่คุณปรับเอง'
              : 'อัปโหลดรูปแผงเพื่อเริ่มวิเคราะห์'}
          </p>
          {analysis && (
            <input
              type="range"
              min="0"
              max="40"
              step="0.5"
              value={soilingLoss}
              onChange={(e) => {
                setSoilingLoss(Number(e.target.value));
                setSource('manual');
              }}
              aria-label="ปรับอัตราสูญเสียเอง"
              className="w-full mt-3 accent-rose-400"
            />
          )}
        </div>

        <div className={card}>
          <div className="flex justify-between items-center text-slate-400 mb-2">
            <span className="text-sm font-medium">กำลังผลิตที่สูญเสีย</span>
            <Sun className="h-5 w-5 text-amber-400" />
          </div>
          {analysis ? (
            <>
              <div className="text-3xl font-extrabold text-amber-400">
                {analysis.powerLossKw} <span className="text-lg font-normal text-slate-300">kW</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                จาก {analysis.systemCapacityKw} kW ≈ {thaiNum(analysis.dailyLossBaht, 0)} บาท/วัน (
                {thaiNum(analysis.monthlyLossBaht, 0)} บาท/เดือน)
              </p>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
                <Leaf className="h-3 w-3 text-emerald-400" />
                {analysis.dailyLossKwh} kWh/วัน · CO₂ ที่เสียโอกาส ≈ {thaiNum(analysis.monthlyCo2LossKg, 1)} kg/เดือน
              </p>
            </>
          ) : (
            <div className="text-3xl font-extrabold text-slate-600">--</div>
          )}
        </div>

        <div className={card}>
          <div className="flex justify-between items-center text-slate-400 mb-2">
            <span className="text-sm font-medium">โอกาสฝนตก 24 ชม.</span>
            <CloudRain className="h-5 w-5 text-sky-400" />
          </div>
          <div className="text-3xl font-extrabold text-sky-400">
            {weather?.rainProbability == null ? '--' : `${weather.rainProbability}%`}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {weather?.rainProbability == null
              ? isLoading
                ? 'กำลังดึงข้อมูลพยากรณ์...'
                : 'ดึงข้อมูลพยากรณ์ไม่สำเร็จ (คำนวณโดยถือว่าไม่มีฝน)'
              : `ฝนรวม ~${weather.rainMm24h} mm · แดด ~${weather.sunHours24h} ชม.เต็มกำลัง`}
          </p>
          {weather && !weather.isFallback && (
            <p className="text-xs text-slate-500 mt-1">
              ตอนนี้: ฝน {weather.current.precipitation} mm · รังสี {Math.round(weather.current.shortwaveRadiation)} W/m²
            </p>
          )}
        </div>

        <div className={`border p-5 rounded-xl shadow-lg ${status ? status.box : 'bg-slate-800/80 border-slate-700/60 text-slate-300'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">ข้อเสนอแนะการล้างแผง</span>
            {status ? status.icon : <Wrench className="h-5 w-5 text-slate-500" />}
          </div>
          <div className="text-xl font-bold mt-1">{status ? status.title : 'ยังไม่มีข้อมูล'}</div>
          <p className="text-xs opacity-80 mt-2">
            {analysis ? analysis.recommendation : 'อัปโหลดรูปแผงโซลาร์เพื่อให้ระบบตัดสินใจว่าควรล้างหรือไม่'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* กราฟพยากรณ์ฝนจริง */}
        <div className={`lg:col-span-2 ${card} p-6`}>
          <h2 className="text-lg font-bold text-slate-200 mb-1 flex items-center gap-2">
            <CloudRain className="h-5 w-5 text-sky-400" />
            พยากรณ์ฝน 7 วัน (Open-Meteo)
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            ใช้ดูว่าฝนจะมาเมื่อไร — ฝนที่ล้างฝุ่นได้จริงควรมีปริมาณตั้งแต่ ~5 mm ขึ้นไป
          </p>
          <div className="h-72 w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                {isLoading ? 'กำลังโหลดพยากรณ์...' : 'ไม่มีข้อมูลพยากรณ์'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="day" stroke="#94a3b8" />
                  <YAxis yAxisId="left" domain={[0, 100]} stroke="#94a3b8" unit="%" />
                  <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" unit=" mm" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Legend />
                  <Bar yAxisId="right" dataKey="mm" name="ปริมาณฝน (mm)" fill="#38bdf8" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="left" type="monotone" dataKey="prob" name="โอกาสฝนตกสูงสุด (%)" stroke="#fbbf24" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* อัปโหลดรูป */}
        <div className={`${card} p-6 flex flex-col justify-between`}>
          <div>
            <h2 className="text-lg font-bold text-slate-200 mb-2 flex items-center gap-2">
              <Upload className="h-5 w-5 text-indigo-400" />
              Vision AI Inspection
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              ถ่ายรูปแผงในมุมตั้งฉาก แสงสม่ำเสมอ ไม่มีเงาหรือแสงสะท้อนจ้า เพื่อความแม่นยำสูงสุด
            </p>

            <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" className="hidden" />

            <div
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
              className="border-2 border-dashed border-slate-600 hover:border-indigo-400 focus:border-indigo-400 outline-none transition-colors rounded-xl p-4 text-center cursor-pointer bg-slate-900/50 overflow-hidden relative min-h-[160px] flex flex-col items-center justify-center"
            >
              {selectedImage ? (
                <div className="relative w-full h-36">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selectedImage} alt="ภาพแผงโซลาร์ที่อัปโหลด" className="w-full h-full object-cover rounded-lg" />
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center text-indigo-300 text-xs gap-2 rounded-lg">
                      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                      กำลังวิเคราะห์ภาพ...
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                  <p className="text-sm text-slate-300 font-medium">คลิกเพื่อเลือกรูปแผงโซลาร์</p>
                  <p className="text-xs text-slate-500 mt-1">รองรับ JPG, PNG, WebP ไม่เกิน 10MB</p>
                </>
              )}
            </div>

            {errorMessage && (
              <div role="alert" className="mt-4 p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-200 flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                <span className="break-words min-w-0">{errorMessage}</span>
              </div>
            )}

            {aiResult && (
              <div className="mt-4 p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-lg text-xs space-y-1 text-indigo-200">
                <div className="font-semibold text-indigo-300">ผลการประเมินจาก Gemini AI</div>
                <div>ประเภทคราบ: <span className="text-slate-100">{aiResult.soilingType}</span></div>
                <div>ดัชนีฝุ่น: <span className="text-slate-100">{aiResult.dustDensity}</span> / 10</div>
                <div>
                  ความมั่นใจ:{' '}
                  <span className={lowConfidence ? 'text-amber-400' : 'text-emerald-400'}>
                    {Number.isFinite(aiResult.confidence) ? `${Math.round(aiResult.confidence * 100)}%` : 'ไม่ระบุ'}
                  </span>
                </div>
                {lowConfidence && (
                  <div className="text-amber-300">ความมั่นใจต่ำ — แนะนำถ่ายภาพใหม่ให้ชัดขึ้น หรือปรับค่าด้วยตัวเลื่อน</div>
                )}
                <div>คำแนะนำ: <span className="text-slate-300">{aiResult.recommendation}</span></div>
                <div className="text-slate-500 pt-1">* เป็นค่าประมาณจากภาพ ไม่ใช่ค่าที่วัดจริง</div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-700 text-xs text-slate-400 space-y-1">
            <div className="flex justify-between">
              <span>แบบจำลอง:</span>
              <span className="text-slate-200">Beer-Lambert (T = e<sup>−k·d</sup>)</span>
            </div>
            <p className="text-[11px] text-slate-500">
              ค่าสัมประสิทธิ์การดูดกลืน k ตั้งไว้ 0.05 เป็นค่าสมมติ ควรสอบเทียบกับข้อมูลผลิตไฟจริงของระบบคุณ
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}