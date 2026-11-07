import { AppSelect } from '../../components/AppSelect';
import { isSelectProperty } from '../propertySchema';
import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useWorkspace } from '../../store';
import { PageIcon } from '../../ui';
import { aggregateRows, groupRows } from '../model';
import type { ViewProps } from './types';
import type { Aggregate } from '../../types';
import { WindowedCards } from './WindowedCards';

const colors = ['#8f77b5', '#5b9cc2', '#86a58a', '#d9aa62', '#c78280', '#8c9eaa', '#b889a7'];
export function ChartView({ page, view, rows, updateView, openRow }: ViewProps) {
  const { workspace } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const db = page.database!;
  const numericColumns = db.columns.filter((column) =>
    column.type === 'number' || column.type === 'rollup' || column.type === 'formula');
  const field = view.chartGroup || db.columns.find((c) => isSelectProperty(c))?.id || 'title';
  const metric = view.chartValue || 'title';
  const aggregation = view.chartAggregation || 'count';
  const groups = useMemo(() => groupRows(rows, field, db, workspace!.pages, { ...view, hideEmptyGroups: true }),
    [rows, field, db, workspace!.pages, view]);
  const values = useMemo(() => groups.map(group => aggregateRows(group.rows, metric, aggregation, db, workspace!.pages)),
    [groups, metric, aggregation, db, workspace!.pages]);
  const selectedGroup = groups.find(group => group.key === selected);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const range = Math.max(1, high - low);
  const y = (value: number) => 255 - ((value - low) / range) * 220;
  const zero = y(0);
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  const kind = view.chartType || 'bar';
  const width = Math.max(600, groups.length * 90 + 70);
  const height = 310;
  const step = (width - 80) / Math.max(1, groups.length);
  let angle = 0;
  const gradient = values
    .map((value, i) => {
      const start = angle;
      angle += total ? (Math.max(0, value) / total) * 360 : 0;
      return `${colors[i % colors.length]} ${start}deg ${angle}deg`;
    })
    .join(',');
  return (
    <div className="chart-view">
      <div className="chart-controls">
        <AppSelect
          aria-label="图表类型"
          value={kind}
          onChange={(e) => updateView({ chartType: e.target.value as typeof kind })}
        >
          <option value="bar">柱状图</option>
          <option value="horizontal">横条图</option>
          <option value="line">折线图</option>
          <option value="donut">圆环图</option>
        </AppSelect>
        <span>按</span>
        <AppSelect
          aria-label="图表分组"
          value={field}
          onChange={(e) => {
            updateView({ chartGroup: e.target.value });
            setSelected(null);
          }}
        >
          <option value="title">名称</option>
          {db.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </AppSelect>
        <span>统计</span>
        <AppSelect
          aria-label="图表计算"
          value={aggregation}
          onChange={(e) => {
            const chartAggregation = e.target.value as Aggregate;
            updateView({
              chartAggregation,
              ...(chartAggregation !== 'count' && !numericColumns.some(column => column.id === view.chartValue)
                && numericColumns[0] ? { chartValue: numericColumns[0].id } : {}),
            });
          }}
        >
          <option value="count">记录数量</option>
          <option value="sum">求和</option>
          <option value="average">平均值</option>
          <option value="median">中位数</option>
          <option value="min">最小值</option>
          <option value="max">最大值</option>
          <option value="range">极差</option>
        </AppSelect>
        {aggregation !== 'count' && (
          <AppSelect
            aria-label="图表数值属性"
            value={metric}
            onChange={(e) => updateView({ chartValue: e.target.value })}
          >
            <option value="title">选择属性</option>
            {numericColumns.map((column) => (
              <option value={column.id} key={column.id}>
                {column.name}
              </option>
            ))}
          </AppSelect>
        )}
      </div>
      {aggregation !== 'count' && !numericColumns.length && (
        <p className="chart-notice">请先添加数值、汇总或公式属性，再进行图表计算。</p>
      )}
      {kind === 'donut' && low < 0 && (
        <p className="chart-notice">圆环图展示正值的占比；负值保留在图例中，可切换到柱状图查看。</p>
      )}
      {!groups.length ? (
        <div className="empty-state">
          <BarChart3 size={32} />
          <h3>没有可显示的数据</h3>
          <p>添加记录，或调整当前视图的筛选条件。</p>
        </div>
      ) : kind === 'donut' ? (
        <div className="donut-layout">
          <div className="donut-chart" style={{ background: `conic-gradient(${gradient})` }}>
            <div>
              <strong>{total.toLocaleString()}</strong>
              <span>{aggregation === 'count' ? '条记录' : low < 0 ? '正值合计' : '总计'}</span>
            </div>
          </div>
          <div className="chart-legend">
            {groups.map((group, i) => (
              <button
                key={group.key}
                onClick={() => setSelected(selected === group.key ? null : group.key)}
                className={selected === group.key ? 'selected' : ''}
              >
                <i style={{ background: colors[i % colors.length] }} />
                <span>{group.label}</span>
                <strong>{values[i]}</strong>
                <small>{values[i] < 0 ? '—' : `${total ? Math.round((values[i] / total) * 100) : 0}%`}</small>
              </button>
            ))}
          </div>
        </div>
      ) : kind === 'horizontal' ? (
        <div className="horizontal-chart">
          {groups.map((group, i) => (
            <button key={group.key} onClick={() => setSelected(selected === group.key ? null : group.key)}>
              <span>{group.label}</span>
              <div style={{ position: 'relative' }}>
                <i
                  style={{
                    position: 'absolute',
                    left: `${((Math.min(0, values[i]) - low) / range) * 100}%`,
                    width: `${(Math.abs(values[i]) / range) * 100}%`,
                    background: colors[i % colors.length],
                  }}
                />
                <b className="chart-zero-line" style={{ left: `${(-low / range) * 100}%` }} />
              </div>
              <strong>{values[i]}</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="svg-chart-scroll">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${kind === 'line' ? '折线图' : '柱状图'}：${db.columns.find((c) => c.id === field)?.name || '名称'}`}
          >
            {[0, 1, 2, 3, 4].map((tick) => (
              <g key={tick}>
                <line
                  x1="48"
                  x2={width - 15}
                  y1={255 - tick * 55}
                  y2={255 - tick * 55}
                  className="chart-gridline"
                />
                <text x="37" y={260 - tick * 55} textAnchor="end" className="chart-axis-label">
                  {Math.round((low + (range * tick) / 4) * 10) / 10}
                </text>
              </g>
            ))}
            {kind === 'line' && (
              <polyline
                points={values.map((value, i) => `${55 + step * (i + 0.5)},${y(value)}`).join(' ')}
                fill="none"
                stroke={colors[0]}
                strokeWidth="2.5"
              />
            )}
            {groups.map((group, i) => {
              const x = 55 + step * (i + 0.5);
              const valueY = y(values[i]);
              const barHeight = Math.abs(valueY - zero);
              return (
                <g
                  key={group.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`${group.label} ${values[i]}`}
                  onClick={() => setSelected(selected === group.key ? null : group.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(current => current === group.key ? null : group.key);
                    }
                  }}
                  className="chart-mark"
                >
                  <title>
                    {group.label}: {values[i]}
                  </title>
                  <polygon points={`${x - step * 0.45},20 ${x + step * 0.45},20 ${x + step * 0.45},255 ${x - step * 0.45},255`}
                    fill="transparent" pointerEvents="all" />
                  {kind === 'bar' ? (
                    <rect
                      x={x - step * 0.28}
                      y={Math.min(zero, valueY)}
                      width={step * 0.56}
                      height={Math.max(1, barHeight)}
                      rx="3"
                      fill={colors[i % colors.length]}
                      opacity={selected && selected !== group.key ? 0.4 : 1}
                    />
                  ) : (
                    <circle
                      cx={x}
                      cy={valueY}
                      r={selected === group.key ? 6 : 4}
                      fill={colors[0]}
                    />
                  )}
                  <text
                    x={x}
                    y={values[i] < 0 ? Math.min(275, valueY + 15) : Math.max(22, valueY - 9)}
                    textAnchor="middle"
                    className="chart-value-label"
                  >
                    {values[i]}
                  </text>
                  <text x={x} y="282" textAnchor="middle" className="chart-axis-label">
                    {group.label.slice(0, 12)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {selectedGroup && (
        <div className="chart-drilldown">
          <h4>{selectedGroup.label} · 记录</h4>
          {selectedGroup.rows.length > 100 ? (
            <WindowedCards rows={selectedGroup.rows} enabled className="chart-drilldown-rows"
              layoutKey={view.id} estimatedHeight={36} footer={null}>
              {row => <button key={row.id} className="chart-drilldown-row" data-record-id={row.id}
                onClick={() => openRow(row.id)}>
                <PageIcon icon={row.icon} />
                {row.title || '无标题'}
              </button>}
            </WindowedCards>
          ) : selectedGroup.rows.map(row => (
            <button key={row.id} data-record-id={row.id} onClick={() => openRow(row.id)}>
              <PageIcon icon={row.icon} />
              {row.title || '无标题'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
