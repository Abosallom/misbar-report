// theme.js — brand palette + deck geometry (from dissection of تقرير مسبار 09072026.pptx).
export const GEOM = {
  slideW: 13.333, slideH: 7.5,   // inches (16:9, PptxGenJS LAYOUT_WIDE)
  pxPerIn: 96,                    // HTML preview: 1280 x 720
};

export const COLORS = {
  navy: '#1E3A8A',        // brand: titles, table headers, top bar, title-slide bg
  navyDark: '#172554',    // totals column fill
  navyChart: '#1F4E78',   // line-chart actual series, overall-average card
  navyBar: '#1F3864',     // late-by-test bars
  taskNavy: '#2F5597',    // status مستمر fill
  blue: '#2563EB',
  purple: '#6B21A8',      // title-slide side bar
  orange: '#F97316',      // title-slide side bar
  orangeSeries: '#ED7D31',// line-chart expected series
  amber: '#F59E0B',
  amberStatus: '#FFC000', // status قيد التنفيذ fill
  green: '#16A34A',
  greenBright: '#00B050',
  greenSoft: '#92D050',
  deltaGreen: '#2E7D32',  // "+N" indicators
  red: '#DC2626',
  redDark: '#C00000',     // status متأخر fill
  redPure: '#FF0000',
  redSoft: '#F87171',
  slate900: '#1E293B',
  slate600: '#475569',
  slate500: '#64748B',
  bgLight: '#F8FAFC',
  bgLighter: '#F1F5F9',
  bgRed: '#FEF2F2',
  border: '#E2E8F0',
  borderDark: '#CBD5E1',
  iceBlue: '#C7D2FE',
  peach: '#F8CBAD',
  white: '#FFFFFF',
  black: '#000000',
};

export const FONT = { family: 'Cairo' };
