'use client';

import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export default function SolarRainChart({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="day" stroke="#94a3b8" />
        <YAxis yAxisId="left" domain={[0, 100]} stroke="#94a3b8" unit="%" />
        <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" unit=" mm" />
        <Tooltip
          contentStyle={{
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderRadius: '8px',
            color: '#f8fafc'
          }}
        />
        <Legend />
        <Bar
          yAxisId="right"
          dataKey="mm"
          name="ปริมาณฝน (mm)"
          fill="#38bdf8"
          fillOpacity={0.6}
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="prob"
          name="โอกาสฝนตกสูงสุด (%)"
          stroke="#fbbf24"
          strokeWidth={2}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}