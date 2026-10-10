// Only the ECharts pieces the stats page draws with, so the rest of the library is tree-shaken
// away. This module is imported from the stats chunk only.
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  VisualMapPiecewiseComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  CalendarComponent,
  VisualMapPiecewiseComponent,
  SVGRenderer,
]);

export { echarts };
