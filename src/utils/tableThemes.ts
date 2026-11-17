export type TableThemeId =
  | 'default'
  | 'striped'
  | 'ocean'
  | 'emerald'
  | 'amber'
  | 'minimal';

export interface TableThemeConfig {
  id: TableThemeId;
  label: string;
  wrapperClass: string;
  theadClass: string;
  thClass: string;
  thDividerClass: string;
  trClass: string;
  tdClass: string;
  tdDividerClass: string;
  cellDividersClass: string;
  preview: {
    headerBg: string;
    rowEvenBg: string;
    rowOddBg: string;
    border: string;
  };
  pdf: {
    wrapperBorder: string;
    headerBg: string;
    headerColor: string;
    headerBottomBorder: string;
    stripeBg: string;
    rowTopBorder: string;
    verticalBorder: string;
  };
  docx: {
    headerFill: string;
    headerTextColor: string;
    stripeFill?: string;
    outerBorderColor: string;
    insideHColor: string;
    insideVColor?: string;
  };
}

export const TABLE_THEMES: TableThemeConfig[] = [
  {
    id: 'default',
    label: 'Classic',
    wrapperClass:
      'rounded-xl border border-neutral-200 dark:border-white/[0.08]',
    theadClass:
      'bg-neutral-100/80 dark:bg-white/[0.03] border-b border-neutral-200 dark:border-white/[0.08]',
    thClass: 'text-neutral-700 dark:text-neutral-200',
    thDividerClass: 'border-l border-neutral-200/70 dark:border-white/[0.06]',
    trClass:
      'hover:bg-neutral-50/70 dark:hover:bg-white/[0.015] transition-colors',
    tdClass:
      'text-neutral-700 dark:text-neutral-300 border-t border-neutral-200/70 dark:border-white/[0.06]',
    tdDividerClass: 'border-l border-neutral-200/50 dark:border-white/[0.04]',
    cellDividersClass:
      '[&_th+th]:border-l [&_th+th]:border-neutral-200/70 dark:[&_th+th]:border-white/[0.06] [&_td+td]:border-l [&_td+td]:border-neutral-200/50 dark:[&_td+td]:border-white/[0.04]',
    preview: {
      headerBg: '#e4e4e7',
      rowEvenBg: '#ffffff',
      rowOddBg: '#ffffff',
      border: '#d4d4d8',
    },
    pdf: {
      wrapperBorder: '1px solid #e5e7eb',
      headerBg: '#f3f4f6',
      headerColor: '#111827',
      headerBottomBorder: '1px solid #e5e7eb',
      stripeBg: 'transparent',
      rowTopBorder: '1px solid #f3f4f6',
      verticalBorder: '1px solid #e5e7eb',
    },
    docx: {
      headerFill: 'F3F4F6',
      headerTextColor: '111827',
      outerBorderColor: 'D1D5DB',
      insideHColor: 'E5E7EB',
      insideVColor: 'E5E7EB',
    },
  },
  {
    id: 'striped',
    label: 'Striped',
    wrapperClass:
      'rounded-xl border border-neutral-200 dark:border-white/[0.09]',
    theadClass:
      'bg-neutral-200/70 dark:bg-white/[0.06] border-b border-neutral-300/80 dark:border-white/[0.1]',
    thClass: 'text-neutral-900 dark:text-white',
    thDividerClass: 'border-l border-neutral-300/60 dark:border-white/[0.08]',
    trClass:
      'even:bg-neutral-100/70 dark:even:bg-white/[0.025] hover:bg-neutral-100 dark:hover:bg-white/[0.04] transition-colors',
    tdClass:
      'text-neutral-700 dark:text-neutral-300 border-t border-neutral-200/70 dark:border-white/[0.06]',
    tdDividerClass: 'border-l border-neutral-200/50 dark:border-white/[0.05]',
    cellDividersClass:
      '[&_th+th]:border-l [&_th+th]:border-neutral-300/60 dark:[&_th+th]:border-white/[0.08] [&_td+td]:border-l [&_td+td]:border-neutral-200/50 dark:[&_td+td]:border-white/[0.05]',
    preview: {
      headerBg: '#d4d4d8',
      rowEvenBg: '#f4f4f5',
      rowOddBg: '#ffffff',
      border: '#a1a1aa',
    },
    pdf: {
      wrapperBorder: '1px solid #d1d5db',
      headerBg: '#e5e7eb',
      headerColor: '#111827',
      headerBottomBorder: '1px solid #d1d5db',
      stripeBg: '#f9fafb',
      rowTopBorder: '1px solid #e5e7eb',
      verticalBorder: '1px solid #e5e7eb',
    },
    docx: {
      headerFill: 'E5E7EB',
      headerTextColor: '111827',
      stripeFill: 'F9FAFB',
      outerBorderColor: 'D1D5DB',
      insideHColor: 'E5E7EB',
      insideVColor: 'E5E7EB',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    wrapperClass:
      'rounded-xl border border-blue-200 dark:border-blue-500/25',
    theadClass:
      'bg-blue-50 dark:bg-blue-500/[0.14] border-b border-blue-200 dark:border-blue-500/25',
    thClass: 'text-blue-950 dark:text-blue-100',
    thDividerClass: 'border-l border-blue-200/80 dark:border-blue-400/15',
    trClass:
      'even:bg-blue-50/40 dark:even:bg-blue-500/[0.03] hover:bg-blue-50/70 dark:hover:bg-blue-500/[0.06] transition-colors',
    tdClass:
      'text-neutral-800 dark:text-neutral-200 border-t border-blue-100 dark:border-blue-500/15',
    tdDividerClass: 'border-l border-blue-100/90 dark:border-blue-400/10',
    cellDividersClass:
      '[&_th+th]:border-l [&_th+th]:border-blue-200/80 dark:[&_th+th]:border-blue-400/15 [&_td+td]:border-l [&_td+td]:border-blue-100/90 dark:[&_td+td]:border-blue-400/10',
    preview: {
      headerBg: '#3b82f6',
      rowEvenBg: '#eff6ff',
      rowOddBg: '#ffffff',
      border: '#93c5fd',
    },
    pdf: {
      wrapperBorder: '1px solid #bfdbfe',
      headerBg: '#dbeafe',
      headerColor: '#1e3a8a',
      headerBottomBorder: '1px solid #93c5fd',
      stripeBg: '#f8fbff',
      rowTopBorder: '1px solid #dbeafe',
      verticalBorder: '1px solid #dbeafe',
    },
    docx: {
      headerFill: 'DBEAFE',
      headerTextColor: '1E3A8A',
      stripeFill: 'F0F7FF',
      outerBorderColor: '93C5FD',
      insideHColor: 'DBEAFE',
      insideVColor: 'DBEAFE',
    },
  },
  {
    id: 'emerald',
    label: 'Forest',
    wrapperClass:
      'rounded-xl border border-emerald-200 dark:border-emerald-500/25',
    theadClass:
      'bg-emerald-50 dark:bg-emerald-500/[0.13] border-b border-emerald-200 dark:border-emerald-500/25',
    thClass: 'text-emerald-950 dark:text-emerald-100',
    thDividerClass: 'border-l border-emerald-200/80 dark:border-emerald-400/15',
    trClass:
      'even:bg-emerald-50/40 dark:even:bg-emerald-500/[0.03] hover:bg-emerald-50/70 dark:hover:bg-emerald-500/[0.06] transition-colors',
    tdClass:
      'text-neutral-800 dark:text-neutral-200 border-t border-emerald-100 dark:border-emerald-500/15',
    tdDividerClass: 'border-l border-emerald-100/90 dark:border-emerald-400/10',
    cellDividersClass:
      '[&_th+th]:border-l [&_th+th]:border-emerald-200/80 dark:[&_th+th]:border-emerald-400/15 [&_td+td]:border-l [&_td+td]:border-emerald-100/90 dark:[&_td+td]:border-emerald-400/10',
    preview: {
      headerBg: '#10b981',
      rowEvenBg: '#ecfdf5',
      rowOddBg: '#ffffff',
      border: '#6ee7b7',
    },
    pdf: {
      wrapperBorder: '1px solid #a7f3d0',
      headerBg: '#d1fae5',
      headerColor: '#064e3b',
      headerBottomBorder: '1px solid #6ee7b7',
      stripeBg: '#f6fef9',
      rowTopBorder: '1px solid #d1fae5',
      verticalBorder: '1px solid #d1fae5',
    },
    docx: {
      headerFill: 'D1FAE5',
      headerTextColor: '064E3B',
      stripeFill: 'F0FDF4',
      outerBorderColor: '6EE7B7',
      insideHColor: 'D1FAE5',
      insideVColor: 'D1FAE5',
    },
  },
  {
    id: 'amber',
    label: 'Amber',
    wrapperClass:
      'rounded-xl border border-amber-200 dark:border-amber-500/25',
    theadClass:
      'bg-amber-50 dark:bg-amber-500/[0.14] border-b border-amber-200 dark:border-amber-500/25',
    thClass: 'text-amber-950 dark:text-amber-100',
    thDividerClass: 'border-l border-amber-200/80 dark:border-amber-400/15',
    trClass:
      'even:bg-amber-50/40 dark:even:bg-amber-500/[0.03] hover:bg-amber-50/70 dark:hover:bg-amber-500/[0.06] transition-colors',
    tdClass:
      'text-neutral-800 dark:text-neutral-200 border-t border-amber-100 dark:border-amber-500/15',
    tdDividerClass: 'border-l border-amber-100/90 dark:border-amber-400/10',
    cellDividersClass:
      '[&_th+th]:border-l [&_th+th]:border-amber-200/80 dark:[&_th+th]:border-amber-400/15 [&_td+td]:border-l [&_td+td]:border-amber-100/90 dark:[&_td+td]:border-amber-400/10',
    preview: {
      headerBg: '#f59e0b',
      rowEvenBg: '#fffbeb',
      rowOddBg: '#ffffff',
      border: '#fcd34d',
    },
    pdf: {
      wrapperBorder: '1px solid #fde68a',
      headerBg: '#fef3c7',
      headerColor: '#78350f',
      headerBottomBorder: '1px solid #fcd34d',
      stripeBg: '#fffdf5',
      rowTopBorder: '1px solid #fef3c7',
      verticalBorder: '1px solid #fef3c7',
    },
    docx: {
      headerFill: 'FEF3C7',
      headerTextColor: '78350F',
      stripeFill: 'FFFBEB',
      outerBorderColor: 'FCD34D',
      insideHColor: 'FEF3C7',
      insideVColor: 'FEF3C7',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    wrapperClass: 'rounded-none border-0',
    theadClass:
      'bg-transparent border-b-2 border-neutral-300 dark:border-white/20',
    thClass: 'text-neutral-900 dark:text-white',
    thDividerClass: '',
    trClass:
      'hover:bg-neutral-50/60 dark:hover:bg-white/[0.02] transition-colors',
    tdClass:
      'text-neutral-700 dark:text-neutral-300 border-t border-neutral-200/70 dark:border-white/[0.07]',
    tdDividerClass: '',
    cellDividersClass: '',
    preview: {
      headerBg: '#f4f4f5',
      rowEvenBg: '#ffffff',
      rowOddBg: '#ffffff',
      border: '#71717a',
    },
    pdf: {
      wrapperBorder: '0',
      headerBg: 'transparent',
      headerColor: '#111827',
      headerBottomBorder: '1.5px solid #9ca3af',
      stripeBg: 'transparent',
      rowTopBorder: '1px solid #e5e7eb',
      verticalBorder: '0',
    },
    docx: {
      headerFill: 'FFFFFF',
      headerTextColor: '111827',
      outerBorderColor: 'FFFFFF',
      insideHColor: 'D1D5DB',
    },
  },
];

const THEME_MAP = new Map<TableThemeId, TableThemeConfig>(
  TABLE_THEMES.map((t) => [t.id, t])
);

export function normalizeTableTheme(value: unknown): TableThemeId {
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase() as TableThemeId;
    if (THEME_MAP.has(clean)) return clean;
  }
  return 'default';
}

export function getTableTheme(themeId?: TableThemeId | string): TableThemeConfig {
  const id = normalizeTableTheme(themeId);
  return THEME_MAP.get(id) ?? TABLE_THEMES[0];
}
