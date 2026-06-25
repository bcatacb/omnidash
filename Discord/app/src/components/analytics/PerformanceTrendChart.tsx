import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export interface PerformanceTrendPoint {
  date: string
  sent: number
  replied: number
  openRatePct: number
}

interface PerformanceTrendChartProps {
  title: string
  subtitle?: string
  points: PerformanceTrendPoint[]
  summary: {
    totalSent: number
    openRatePct: number
    totalReplied: number
  }
}

const LEGEND_COLORS = {
  sent: "#008FFB",
  openRatePct: "#BE83E4",
  replied: "#00E396",
}

const formatDateLabel = (isoDate: string) => {
  if (!isoDate) return ""
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" })
}

export function PerformanceTrendChart({ title, subtitle, points, summary }: PerformanceTrendChartProps) {
  return (
    <div className="border border-[#E9ECF2] rounded-xl p-6 bg-white">
      <div className="mb-4">
        <h3 className="text-[16px] font-semibold text-[#111827]">{title}</h3>
        {subtitle ? <p className="text-[12px] text-[#6B7280] mt-1">{subtitle}</p> : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="border border-[#E9ECF2] rounded-lg p-4 min-h-[100px] flex flex-col justify-between">
          <div className="flex items-center gap-2 text-[13px] text-[#6D727E]">
            <span className="inline-block w-3 h-1.5 rounded-full bg-[#F1A842]" />
            <span>Total sent</span>
          </div>
          <p className="text-2xl font-bold text-[#14171F]">{summary.totalSent.toLocaleString()}</p>
        </div>
        <div className="border border-[#E9ECF2] rounded-lg p-4 min-h-[100px] flex flex-col justify-between">
          <div className="flex items-center gap-2 text-[13px] text-[#6D727E]">
            <span className="inline-block w-3 h-1.5 rounded-full bg-[#BE83E4]" />
            <span>Open rate</span>
          </div>
          <p className="text-2xl font-bold text-[#14171F]">{summary.openRatePct}%</p>
        </div>
        <div className="border border-[#E9ECF2] rounded-lg p-4 min-h-[100px] flex flex-col justify-between">
          <div className="flex items-center gap-2 text-[13px] text-[#6D727E]">
            <span className="inline-block w-3 h-1.5 rounded-full bg-[#28D371]" />
            <span>Replied</span>
          </div>
          <p className="text-2xl font-bold text-[#14171F]">{summary.totalReplied.toLocaleString()}</p>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-sm text-[#9CA3AF]">
          No timeline data yet.
        </div>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 22, left: 8, bottom: 6 }}>
              <CartesianGrid stroke="#E5E7EB" strokeDasharray="0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                tick={{ fill: "#6B7280", fontSize: 11 }}
                axisLine={{ stroke: "#E5E7EB" }}
                tickLine={{ stroke: "#E5E7EB" }}
                minTickGap={24}
              />
              <YAxis
                yAxisId="count"
                tick={{ fill: "#6B7280", fontSize: 11 }}
                axisLine={{ stroke: "#E5E7EB" }}
                tickLine={{ stroke: "#E5E7EB" }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                tick={{ fill: "#6B7280", fontSize: 11 }}
                axisLine={{ stroke: "#E5E7EB" }}
                tickLine={{ stroke: "#E5E7EB" }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB" }}
                labelFormatter={(value) => {
                  if (typeof value !== "string") return String(value)
                  const date = new Date(`${value}T00:00:00.000Z`)
                  return Number.isNaN(date.getTime())
                    ? value
                    : date.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })
                }}
                formatter={(value, name) => {
                  if (name === "Open Rate") return [`${value}%`, name]
                  return [Number(value).toLocaleString(), name]
                }}
              />
              <Legend verticalAlign="top" height={34} />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="sent"
                name="Sent"
                stroke={LEGEND_COLORS.sent}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="openRatePct"
                name="Open Rate"
                stroke={LEGEND_COLORS.openRatePct}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="replied"
                name="Replied"
                stroke={LEGEND_COLORS.replied}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
