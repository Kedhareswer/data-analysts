export type ChartSpec = {
  id: string;
  title?: string;
  type: "bar" | "line";
  xField: string;
  yField: string;
};

export type ChartDataPoint = Record<string, unknown>;

export type ChartPayload = {
  charts: Array<{
    spec: ChartSpec;
    data: ChartDataPoint[];
  }>;
};
