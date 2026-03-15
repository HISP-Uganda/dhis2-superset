export type LegendItem = {
  label: string;
  color: string;
  valueMin?: number;
  valueMax?: number;
  count?: number;
  isNoData?: boolean;
};

export type LegendModel = {
  title?: string;
  type: 'continuous' | 'classed' | 'categorical';
  items: LegendItem[];
};
