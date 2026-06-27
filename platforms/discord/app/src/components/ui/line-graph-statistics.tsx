import { useState, useEffect } from 'react';

interface ChartPoint {
  date: string;
  sent: number;
  opened: number;
  replied: number;
}

interface LineGraphStatisticsProps {
  title: string;
  subtitle?: string;
  data: ChartPoint[];
}

const LineGraphStatistics = ({ title, subtitle, data: inputData }: LineGraphStatisticsProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [animationPhase, setAnimationPhase] = useState(0);
  const [chartVisible, setChartVisible] = useState(false);

  // Fallback if no data
  const chartData = inputData.length > 0 ? inputData : [
    { date: 'N/A', sent: 0, opened: 0, replied: 0 }
  ];

  const dates = chartData.map(d => d.date);
  const sentValues = chartData.map(d => d.sent);
  const openedValues = chartData.map(d => d.opened);
  const repliedValues = chartData.map(d => d.replied);

  const maxValue = Math.max(...sentValues, ...openedValues, ...repliedValues, 1) * 1.2;

  // Generate path for smooth curves
  const generateSmoothPath = (values: number[], height = 300, isArea = false) => {
    const width = 800;
    const padding = 60;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const denom = Math.max(1, values.length - 1);
    const points = values.map((value, index) => ({
      x: padding + (index / denom) * chartWidth,
      y: padding + (1 - value / maxValue) * chartHeight
    }));

    if (points.length < 2) return '';

    let path = `M ${points[0].x},${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      
      const cp1x = prev.x + (curr.x - prev.x) * 0.5;
      const cp1y = prev.y;
      const cp2x = curr.x - (next ? (next.x - curr.x) * 0.3 : 0);
      const cp2y = curr.y;
      
      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${curr.x},${curr.y}`;
    }
    
    if (isArea) {
      path += ` L ${points[points.length - 1].x},${height - padding} L ${padding},${height - padding} Z`;
    }
    
    return path;
  };

  useEffect(() => {
    setChartVisible(false);
    setAnimationPhase(0);
    
    const timers = [
      setTimeout(() => setAnimationPhase(1), 100),
      setTimeout(() => setAnimationPhase(2), 400),
      setTimeout(() => setAnimationPhase(3), 800),
      setTimeout(() => setChartVisible(true), 1200)
    ];
    
    return () => timers.forEach(clearTimeout);
  }, [inputData]);

  const totalSent = sentValues.reduce((a, b) => a + b, 0);
  const totalOpened = openedValues.reduce((a, b) => a + b, 0);
  const totalReplied = repliedValues.reduce((a, b) => a + b, 0);
  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  const metrics = [
    { label: 'Total Sent', value: totalSent, color: 'border-blue-500' },
    { label: 'Open Rate', value: `${openRate}%`, color: 'border-purple-500' },
    { label: 'Reply Rate', value: `${replyRate}%`, color: 'border-emerald-500' }
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden font-light">
      <div className="p-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h3 
              className={`text-2xl font-semibold text-gray-900 transition-all duration-1000 ${
                animationPhase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              {title}
            </h3>
            {subtitle && (
              <p 
                className={`text-sm text-gray-500 mt-1 transition-all duration-1000 delay-200 ${
                  animationPhase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
              >
                {subtitle}
              </p>
            )}
          </div>
          
          {/* Legend */}
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
              <span className="text-xs font-medium text-gray-600">Sent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-500"></div>
              <span className="text-xs font-medium text-gray-600">Opened</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
              <span className="text-xs font-medium text-gray-600">Replied</span>
            </div>
          </div>
        </div>

        {/* Main Chart Container */}
        <div className="relative">
          {/* Chart Area */}
          <div className="h-80 relative">
            <svg className="w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="80" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 80 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1"/>
                </pattern>
              </defs>
              <rect width="800" height="400" fill="url(#grid)"/>

              {/* Area Fills */}
              <path
                d={generateSmoothPath(sentValues, 340, true)}
                fill="rgba(59, 130, 246, 0.05)"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />
              <path
                d={generateSmoothPath(openedValues, 340, true)}
                fill="rgba(168, 85, 247, 0.05)"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />
              <path
                d={generateSmoothPath(repliedValues, 340, true)}
                fill="rgba(16, 185, 129, 0.05)"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />

              {/* Lines */}
              <path
                d={generateSmoothPath(sentValues, 340)}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />
              <path
                d={generateSmoothPath(openedValues, 340)}
                fill="none"
                stroke="#a855f7"
                strokeWidth="2.5"
                strokeLinecap="round"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />
              <path
                d={generateSmoothPath(repliedValues, 340)}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                className={`transition-all duration-2000 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
              />

              {/* Interaction Points */}
              {dates.map((_date, index) => {
                const padding = 60;
                const chartWidth = 800 - padding * 2;
                const denom = Math.max(1, dates.length - 1);
                const x = padding + (index / denom) * chartWidth;
                
                return (
                  <g key={index}>
                    <rect
                      x={x - 20}
                      y={0}
                      width="40"
                      height="340"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredPoint(index)}
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                    {hoveredPoint === index && (
                      <line x1={x} y1={padding} x2={x} y2={340 - padding} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4" />
                    )}
                  </g>
                );
              })}

              {/* X-axis Labels */}
              {dates.map((_date, index) => {
                const padding = 60;
                const chartWidth = 800 - padding * 2;
                const denom = Math.max(1, dates.length - 1);
                const x = padding + (index / denom) * chartWidth;
                
                // Only show some labels to avoid crowding
                if (dates.length > 10 && index % Math.ceil(dates.length / 10) !== 0 && index !== dates.length - 1) return null;

                return (
                  <text
                    key={index}
                    x={x}
                    y={365}
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize="11"
                    className={`transition-all duration-500 ${chartVisible ? 'opacity-100' : 'opacity-0'}`}
                  >
                    {_date}
                  </text>
                );
              })}

              {/* Tooltip */}
              {hoveredPoint !== null && (() => {
                const tooltipX = 60 + (hoveredPoint / Math.max(1, dates.length - 1)) * 680;
                return (
                <g>
                  <rect
                    x={tooltipX - 60}
                    y={10}
                    width="120"
                    height="85"
                    fill="white"
                    stroke="#e5e7eb"
                    strokeWidth="1"
                    rx="8"
                    className="drop-shadow-lg"
                  />
                  <text x={tooltipX} y={30} textAnchor="middle" fill="#1f2937" fontSize="12" fontWeight="600">
                    {dates[hoveredPoint]}
                  </text>
                  <text x={tooltipX} y={50} textAnchor="middle" fill="#3b82f6" fontSize="11" fontWeight="500">
                    Sent: {sentValues[hoveredPoint]}
                  </text>
                  <text x={tooltipX} y={65} textAnchor="middle" fill="#a855f7" fontSize="11" fontWeight="500">
                    Opened: {openedValues[hoveredPoint]}
                  </text>
                  <text x={tooltipX} y={80} textAnchor="middle" fill="#10b981" fontSize="11" fontWeight="500">
                    Replied: {repliedValues[hoveredPoint]}
                  </text>
                </g>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Bottom Metrics */}
        <div className="mt-8 flex gap-4">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={`
                flex-1 bg-gray-50 rounded-xl border-2 ${metric.color} p-4
                transition-all duration-800 hover:bg-white hover:shadow-md
                ${animationPhase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}
              `}
              style={{ transitionDelay: `${1800 + index * 200}ms` }}
            >
              <div className="text-2xl font-bold text-gray-900 mb-1">{metric.value}</div>
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LineGraphStatistics;
