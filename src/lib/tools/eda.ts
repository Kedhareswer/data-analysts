import { tool } from "ai";
import { z } from "zod";
import { getDataset } from "@/lib/datasets";
import type { ChartPayload } from "@/lib/charts";

export const DescribeDataset = tool({
  description:
    "Describe the currently selected dataset: schema, row count, and basic column types.",
  inputSchema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe("The id of the dataset to describe, as provided in context."),
  }),
  execute: async ({ datasetId }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server. Make sure the user has uploaded a dataset first.`,
      };
    }

    return {
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.rowCount,
      columns: dataset.columns,
    };
  },
});

export const SummarizeColumns = tool({
  description:
    "Compute basic summary statistics for each column in the dataset (counts, distincts, basic numeric stats).",
  inputSchema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe("The id of the dataset to summarize, as provided in context."),
  }),
  execute: async ({ datasetId }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server. Make sure the user has uploaded a dataset first.`,
      };
    }

    const rows = dataset.rows;
    const totalRows = rows.length;

    const summaries: Record<
      string,
      {
        type: string;
        nonNullCount: number;
        nullCount: number;
        distinctCount: number;
        sampleValues: unknown[];
        cardinalityBucket: "low" | "medium" | "high" | "very_high";
        numericStats?: {
          min: number;
          max: number;
          mean: number;
          median: number;
          q1: number;
          q3: number;
          iqr: number;
          variance: number;
          stdDev: number;
          skewness: number;
          kurtosis: number;
          outlierCountIqr: number;
          outlierFractionIqr: number;
        };
      }
    > = {};

    const charts: ChartPayload["charts"] = [];

    const quantile = (sorted: number[], p: number): number => {
      if (sorted.length === 0) return NaN;
      const idx = (sorted.length - 1) * p;
      const lower = Math.floor(idx);
      const upper = Math.ceil(idx);
      if (lower === upper) return sorted[lower];
      const weight = idx - lower;
      return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    for (const column of dataset.columns) {
      const name = column.name;
      const values = rows.map((r) => r[name]);
      const nonNullValues = values.filter((v) => v !== null && v !== undefined);
      const distinct = new Set(
        nonNullValues.map((v) =>
          typeof v === "number" || typeof v === "boolean" ? v : String(v)
        )
      );

      let cardinalityBucket: "low" | "medium" | "high" | "very_high";
      if (distinct.size <= 10) cardinalityBucket = "low";
      else if (distinct.size <= 100) cardinalityBucket = "medium";
      else if (distinct.size <= 1000) cardinalityBucket = "high";
      else cardinalityBucket = "very_high";

      const summary: (typeof summaries)[string] = {
        type: column.type,
        nonNullCount: nonNullValues.length,
        nullCount: totalRows - nonNullValues.length,
        distinctCount: distinct.size,
        sampleValues: nonNullValues.slice(0, 5),
        cardinalityBucket,
      };

      if (column.type === "number") {
        const nums = nonNullValues.filter((v) => typeof v === "number") as number[];
        if (nums.length > 0) {
          const sorted = [...nums].sort((a, b) => a - b);
          const min = sorted[0];
          const max = sorted[sorted.length - 1];
          const mean = nums.reduce((acc, n) => acc + n, 0) / nums.length;
          const median = quantile(sorted, 0.5);
          const q1 = quantile(sorted, 0.25);
          const q3 = quantile(sorted, 0.75);
          const iqr = q3 - q1;

          // variance, std dev, skewness, kurtosis
          let m2 = 0;
          let m3 = 0;
          let m4 = 0;
          for (const x of nums) {
            const d = x - mean;
            const d2 = d * d;
            m2 += d2;
            m3 += d2 * d;
            m4 += d2 * d2;
          }
          const n = nums.length;
          const variance = n > 1 ? m2 / (n - 1) : 0;
          const stdDev = Math.sqrt(variance);
          const skewness =
            n > 2 && stdDev > 0 ? (n * m3) / ((n - 1) * (n - 2) * stdDev * stdDev * stdDev) : 0;
          const kurtosis =
            n > 3 && variance > 0
              ?
                ((n * (n + 1) * m4) /
                  ((n - 1) * (n - 2) * (n - 3) * variance * variance)) -
                (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))
              : 0;

          // IQR-based outliers
          const lowerFence = q1 - 1.5 * iqr;
          const upperFence = q3 + 1.5 * iqr;
          let outlierCountIqr = 0;
          for (const x of nums) {
            if (x < lowerFence || x > upperFence) outlierCountIqr += 1;
          }
          const outlierFractionIqr = nums.length
            ? outlierCountIqr / nums.length
            : 0;

          summary.numericStats = {
            min,
            max,
            mean,
            median,
            q1,
            q3,
            iqr,
            variance,
            stdDev,
            skewness,
            kurtosis,
            outlierCountIqr,
            outlierFractionIqr,
          };

          // simple histogram for numeric distributions (up to 20 bins)
          const binCount = Math.min(20, Math.max(5, Math.round(Math.sqrt(nums.length))));
          const range = max - min || 1;
          const binSize = range / binCount;
          const bins = new Array(binCount).fill(0);
          for (const x of nums) {
            let idx = Math.floor((x - min) / binSize);
            if (idx < 0) idx = 0;
            if (idx >= binCount) idx = binCount - 1;
            bins[idx] += 1;
          }
          const histData = bins.map((count, i) => ({
            binStart: min + i * binSize,
            binEnd: min + (i + 1) * binSize,
            count,
          }));

          charts.push({
            spec: {
              id: `hist-${dataset.id}-${name}`,
              title: `Distribution of ${name}`,
              type: "bar",
              xField: "binStart",
              yField: "count",
            },
            data: histData,
          });
        }
      }

      summaries[name] = summary;
    }

    const result: {
      datasetId: string;
      rowCount: number;
      columns: typeof summaries;
    } & Partial<ChartPayload> = {
      datasetId: dataset.id,
      rowCount: totalRows,
      columns: summaries,
    };

    if (charts.length > 0) {
      (result as ChartPayload).charts = charts;
    }

    return result;
  },
});

export const ValueCounts = tool({
  description:
    "Compute value counts for a single column in the dataset (top N categories).",
  inputSchema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe("The id of the dataset to analyze."),
    column: z
      .string()
      .min(1)
      .describe("The column name to compute value counts for."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of distinct values to return."),
  }),
  execute: async ({ datasetId, column, limit }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server. Make sure the user has uploaded a dataset first.`,
      };
    }

    if (!dataset.columns.find((c) => c.name === column)) {
      return {
        error: `Column '${column}' was not found in the dataset.`,
      };
    }

    const counts = new Map<string, number>();
    const rows = dataset.rows;

    for (const row of rows) {
      const raw = row[column];
      if (raw === null || raw === undefined) continue;
      const key = typeof raw === "number" || typeof raw === "boolean" ? String(raw) : String(raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0);

    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({
        value,
        count,
        fraction: total > 0 ? count / total : 0,
      }));

    const chartPayload: ChartPayload = {
      charts: [
        {
          spec: {
            id: `value-counts-${dataset.id}-${column}`,
            title: `Value counts for ${column}`,
            type: "bar",
            xField: "value",
            yField: "count",
          },
          data: sorted.map((row) => ({
            value: row.value,
            count: row.count,
          })),
        },
      ],
    };

    return {
      datasetId: dataset.id,
      column,
      totalNonNull: total,
      values: sorted,
      ...chartPayload,
    };
  },
});

export const TimeSeriesSlice = tool({
  description:
    "Aggregate a numeric value column over a date column to produce a time series.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
    dateColumn: z.string().min(1),
    valueColumn: z.string().min(1),
    granularity: z.enum(["raw", "day", "week", "month"]).optional().default("raw"),
    movingAverageWindow: z.number().int().min(2).max(60).optional(),
  }),
  execute: async ({ datasetId, dateColumn, valueColumn, granularity, movingAverageWindow }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const buckets = new Map<string, { sum: number; count: number; rawDate: Date }>();

    const toBucketKey = (value: unknown): { key: string; rawDate: Date } | null => {
      if (!value) return null;
      const d = new Date(value as any);
      if (isNaN(d.getTime())) return null;
      if (!granularity || granularity === "raw") {
        return { key: d.toISOString(), rawDate: d };
      }
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      if (granularity === "day") {
        return { key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, rawDate: d };
      }
      if (granularity === "month") {
        return { key: `${year}-${String(month).padStart(2, "0")}`, rawDate: d };
      }
      // week: ISO week year-week
      const tmp = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const weekYear = tmp.getUTCFullYear();
      const jan1 = new Date(Date.UTC(weekYear, 0, 1));
      const week = Math.ceil(((tmp.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
      return { key: `${weekYear}-W${String(week).padStart(2, "0")}`, rawDate: d };
    };

    for (const row of rows) {
      const v = row[valueColumn];
      if (typeof v !== "number") continue;
      const bucketInfo = toBucketKey(row[dateColumn]);
      if (!bucketInfo) continue;
      const { key, rawDate } = bucketInfo;
      const bucket = buckets.get(key) ?? { sum: 0, count: 0, rawDate };
      bucket.sum += v;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const series = Array.from(buckets.entries())
      .map(([bucketKey, { sum, count, rawDate }]) => ({
        bucketKey,
        timestamp: rawDate.toISOString(),
        value: count > 0 ? sum / count : 0,
      }))
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    // moving average over value
    let maSeries: { timestamp: string; maValue: number }[] | undefined;
    if (movingAverageWindow && movingAverageWindow > 1 && series.length > 0) {
      const w = movingAverageWindow;
      maSeries = [];
      for (let i = 0; i < series.length; i++) {
        const start = Math.max(0, i - w + 1);
        const window = series.slice(start, i + 1);
        const avg =
          window.reduce((acc, p) => acc + p.value, 0) / (window.length || 1);
        maSeries.push({ timestamp: series[i].timestamp, maValue: avg });
      }
    }

    const charts: ChartPayload["charts"] = [
      {
        spec: {
          id: `timeseries-${dataset.id}-${dateColumn}-${valueColumn}`,
          title: `Average ${valueColumn} over ${dateColumn}`,
          type: "line",
          xField: "timestamp",
          yField: "value",
        },
        data: series,
      },
    ];

    if (maSeries && maSeries.length > 0) {
      charts.push({
        spec: {
          id: `timeseries-ma-${dataset.id}-${dateColumn}-${valueColumn}`,
          title: `Moving average (${movingAverageWindow}) of ${valueColumn}`,
          type: "line",
          xField: "timestamp",
          yField: "maValue",
        },
        data: maSeries,
      });
    }

    return {
      datasetId: dataset.id,
      dateColumn,
      valueColumn,
      granularity,
      series,
      ...(charts.length ? { charts } : {}),
    };
  },
});

export const GroupedSummary = tool({
  description:
    "Compute grouped summaries (count, sum, mean, median) for numeric metrics by one or more categorical columns.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
    groupBy: z.array(z.string().min(1)).min(1),
    metrics: z.array(z.string().min(1)).min(1),
  }),
  execute: async ({ datasetId, groupBy, metrics }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const groups = new Map<
      string,
      { keyValues: Record<string, unknown>; count: number; sums: Record<string, number>; values: Record<string, number[]> }
    >();

    const metricSet = new Set(metrics);

    for (const row of rows) {
      const keyValues: Record<string, unknown> = {};
      const keyParts: string[] = [];
      for (const g of groupBy) {
        const v = row[g];
        keyValues[g] = v;
        keyParts.push(`${g}=${String(v)}`);
      }
      const key = keyParts.join("|");
      let entry = groups.get(key);
      if (!entry) {
        entry = { keyValues, count: 0, sums: {}, values: {} };
        groups.set(key, entry);
      }
      entry.count += 1;
      for (const m of metricSet) {
        const v = row[m];
        if (typeof v !== "number") continue;
        entry.sums[m] = (entry.sums[m] ?? 0) + v;
        if (!entry.values[m]) entry.values[m] = [];
        entry.values[m].push(v);
      }
    }

    const resultRows: Array<
      Record<string, unknown> & {
        count: number;
      }
    > = [];

    for (const [, entry] of groups) {
      const rowOut: Record<string, unknown> = { ...entry.keyValues };
      rowOut.count = entry.count;
      for (const m of metricSet) {
        const vals = entry.values[m] ?? [];
        if (vals.length === 0) continue;
        const sorted = [...vals].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const mean = entry.sums[m] / vals.length;
        rowOut[`${m}_sum`] = entry.sums[m];
        rowOut[`${m}_mean`] = mean;
        rowOut[`${m}_median`] = median;
      }
      resultRows.push(rowOut as any);
    }

    const charts: ChartPayload["charts"] = [];
    // simple bar chart for first metric vs first groupBy
    if (groupBy.length === 1 && metrics.length === 1) {
      const g = groupBy[0];
      const m = metrics[0];
      charts.push({
        spec: {
          id: `grouped-${dataset.id}-${g}-${m}`,
          title: `${m} by ${g}`,
          type: "bar",
          xField: g,
          yField: `${m}_mean`,
        },
        data: resultRows,
      });
    }

    return {
      datasetId: dataset.id,
      groupBy,
      metrics,
      rows: resultRows,
      ...(charts.length ? { charts } : {}),
    };
  },
});

export const TopSegments = tool({
  description:
    "Find top segments for a numeric metric grouped by a single categorical column.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
    groupByColumn: z.string().min(1),
    metricColumn: z.string().min(1),
    direction: z.enum(["asc", "desc"]).optional().default("desc"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  execute: async ({ datasetId, groupByColumn, metricColumn, direction, limit }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const segments = new Map<string, { sum: number; count: number }>();

    for (const row of rows) {
      const g = row[groupByColumn];
      const v = row[metricColumn];
      if (g === null || g === undefined || typeof v !== "number") continue;
      const key = String(g);
      const entry = segments.get(key) ?? { sum: 0, count: 0 };
      entry.sum += v;
      entry.count += 1;
      segments.set(key, entry);
    }

    const all = Array.from(segments.entries()).map(([segment, { sum, count }]) => ({
      segment,
      count,
      mean: count > 0 ? sum / count : 0,
      sum,
    }));

    all.sort((a, b) => {
      const diff = a.mean - b.mean;
      return direction === "asc" ? diff : -diff;
    });

    const top = all.slice(0, limit ?? 10);

    const charts: ChartPayload["charts"] = [
      {
        spec: {
          id: `topsegments-${dataset.id}-${groupByColumn}-${metricColumn}`,
          title: `Top segments by ${metricColumn}`,
          type: "bar",
          xField: "segment",
          yField: "mean",
        },
        data: top,
      },
    ];

    return {
      datasetId: dataset.id,
      groupByColumn,
      metricColumn,
      direction,
      segments: top,
      charts,
    };
  },
});

export const RelationshipDrilldown = tool({
  description:
    "Return sampled pairs of two columns for relationship analysis (numeric-numeric or categorical-numeric).",
  inputSchema: z.object({
    datasetId: z.string().min(1),
    xColumn: z.string().min(1),
    yColumn: z.string().min(1),
    maxPoints: z.number().int().min(10).max(5000).optional().default(1000),
  }),
  execute: async ({ datasetId, xColumn, yColumn, maxPoints }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const pairs: { x: unknown; y: unknown }[] = [];
    for (const row of rows) {
      const x = row[xColumn];
      const y = row[yColumn];
      if (x === undefined || x === null || y === undefined || y === null) continue;
      pairs.push({ x, y });
    }

    // simple sampling if too many points
    let sampled = pairs;
    if (pairs.length > maxPoints) {
      const step = Math.ceil(pairs.length / maxPoints);
      sampled = pairs.filter((_, idx) => idx % step === 0);
    }

    return {
      datasetId: dataset.id,
      xColumn,
      yColumn,
      sampledCount: sampled.length,
      totalPairs: pairs.length,
      points: sampled,
    };
  },
});

export const CorrelationMatrix = tool({
  description:
    "Compute a simple correlation matrix between numeric columns in the dataset (Pearson correlation).",
  inputSchema: z.object({
    datasetId: z.string().min(1),
  }),
  execute: async ({ datasetId }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const numericCols = dataset.columns
      .filter((c) => c.type === "number")
      .map((c) => c.name);

    const rows = dataset.rows;
    const matrix: Record<string, Record<string, number>> = {};

    const getVector = (col: string): number[] =>
      rows
        .map((r) => r[col])
        .filter((v) => typeof v === "number") as number[];

    const corr = (a: number[], b: number[]): number => {
      const n = Math.min(a.length, b.length);
      if (n === 0) return 0;
      const ma = a.reduce((acc, v) => acc + v, 0) / n;
      const mb = b.reduce((acc, v) => acc + v, 0) / n;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < n; i++) {
        const xa = a[i] - ma;
        const xb = b[i] - mb;
        num += xa * xb;
        da += xa * xa;
        db += xb * xb;
      }
      const denom = Math.sqrt(da * db) || 1;
      return num / denom;
    };

    const vectors: Record<string, number[]> = {};
    for (const col of numericCols) {
      vectors[col] = getVector(col);
    }

    for (const colA of numericCols) {
      matrix[colA] = {};
      for (const colB of numericCols) {
        matrix[colA][colB] = corr(vectors[colA], vectors[colB]);
      }
    }

    return {
      datasetId: dataset.id,
      numericColumns: numericCols,
      matrix,
    };
  },
});

export const TargetAnalysis = tool({
  description:
    "Analyze a target column: its distribution and simple relationships with other features.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
    targetColumn: z.string().min(1),
    problemType: z
      .enum(["auto", "regression", "classification"])
      .optional()
      .default("auto"),
    maxFeatures: z.number().int().min(1).max(50).optional().default(10),
  }),
  execute: async ({ datasetId, targetColumn, problemType, maxFeatures }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const targetColMeta = dataset.columns.find((c) => c.name === targetColumn);
    if (!targetColMeta) {
      return {
        error: `Target column '${targetColumn}' was not found in the dataset.`,
      };
    }

    const rows = dataset.rows;
    const rawTarget = rows.map((r) => r[targetColumn]);
    const nonNullTarget = rawTarget.filter(
      (v) => v !== null && v !== undefined,
    );

    const inferProblemType = (): "regression" | "classification" => {
      if (problemType && problemType !== "auto") return problemType;
      if (targetColMeta.type === "number") return "regression";
      return "classification";
    };

    const inferred = inferProblemType();
    const charts: ChartPayload["charts"] = [];

    let targetDistribution: any = {};

    if (inferred === "regression") {
      const nums = nonNullTarget.filter((v) => typeof v === "number") as number[];
      if (nums.length > 0) {
        const sorted = [...nums].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const mean = nums.reduce((acc, n) => acc + n, 0) / nums.length;
        const median = sorted[Math.floor(sorted.length / 2)];
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;

        // histogram
        const binCount = Math.min(30, Math.max(5, Math.round(Math.sqrt(nums.length))));
        const range = max - min || 1;
        const binSize = range / binCount;
        const bins = new Array(binCount).fill(0);
        for (const x of nums) {
          let idx = Math.floor((x - min) / binSize);
          if (idx < 0) idx = 0;
          if (idx >= binCount) idx = binCount - 1;
          bins[idx] += 1;
        }
        const histData = bins.map((count, i) => ({
          binStart: min + i * binSize,
          binEnd: min + (i + 1) * binSize,
          count,
        }));

        charts.push({
          spec: {
            id: `target-hist-${dataset.id}-${targetColumn}`,
            title: `Distribution of target ${targetColumn}`,
            type: "bar",
            xField: "binStart",
            yField: "count",
          },
          data: histData,
        });

        targetDistribution = {
          kind: "numeric",
          summary: { min, max, mean, median, q1, q3, iqr },
        };
      }
    } else {
      // classification
      const counts = new Map<string, number>();
      for (const v of nonNullTarget) {
        const key = typeof v === "number" || typeof v === "boolean" ? String(v) : String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0) || 1;
      const values = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count, fraction: count / total }));

      charts.push({
        spec: {
          id: `target-vc-${dataset.id}-${targetColumn}`,
          title: `Target distribution for ${targetColumn}`,
          type: "bar",
          xField: "value",
          yField: "count",
        },
        data: values.map((v) => ({ value: v.value, count: v.count })),
      });

      targetDistribution = {
        kind: "categorical",
        values,
      };
    }

    // simple feature importance: numeric target vs numeric features via Pearson
    const featureImportance: {
      feature: string;
      measure: string;
      score: number;
    }[] = [];

    if (inferred === "regression") {
      const numericFeatures = dataset.columns
        .filter((c) => c.type === "number" && c.name !== targetColumn)
        .map((c) => c.name);

      const n = rows.length;
      const tVals: number[] = [];
      const featureVectors: Record<string, number[]> = {};
      for (let i = 0; i < n; i++) {
        const tv = rows[i][targetColumn];
        if (typeof tv !== "number") continue;
        tVals.push(tv);
        for (const f of numericFeatures) {
          const fv = rows[i][f];
          if (!featureVectors[f]) featureVectors[f] = [];
          featureVectors[f].push(typeof fv === "number" ? fv : NaN);
        }
      }

      const corr = (a: number[], b: number[]): number => {
        const n = Math.min(a.length, b.length);
        if (n === 0) return 0;
        const cleanA: number[] = [];
        const cleanB: number[] = [];
        for (let i = 0; i < n; i++) {
          if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
            cleanA.push(a[i]);
            cleanB.push(b[i]);
          }
        }
        const m = cleanA.length;
        if (m === 0) return 0;
        const ma = cleanA.reduce((acc, v) => acc + v, 0) / m;
        const mb = cleanB.reduce((acc, v) => acc + v, 0) / m;
        let num = 0;
        let da = 0;
        let db = 0;
        for (let i = 0; i < m; i++) {
          const xa = cleanA[i] - ma;
          const xb = cleanB[i] - mb;
          num += xa * xb;
          da += xa * xa;
          db += xb * xb;
        }
        const denom = Math.sqrt(da * db) || 1;
        return num / denom;
      };

      for (const f of numericFeatures) {
        const score = Math.abs(corr(tVals, featureVectors[f] ?? []));
        if (!Number.isFinite(score)) continue;
        featureImportance.push({ feature: f, measure: "abs_pearson", score });
      }

      featureImportance.sort((a, b) => b.score - a.score);
      const top = featureImportance.slice(0, maxFeatures ?? 10);

      if (top.length > 0) {
        charts.push({
          spec: {
            id: `target-features-${dataset.id}-${targetColumn}`,
            title: `Top feature relationships with ${targetColumn}`,
            type: "bar",
            xField: "feature",
            yField: "score",
          },
          data: top.map((f) => ({ feature: f.feature, score: f.score })),
        });
      }
    }

    const result: {
      datasetId: string;
      targetColumn: string;
      inferredProblemType: "regression" | "classification";
      targetDistribution: typeof targetDistribution;
      featureImportance: typeof featureImportance;
    } & Partial<ChartPayload> = {
      datasetId: dataset.id,
      targetColumn,
      inferredProblemType: inferred,
      targetDistribution,
      featureImportance,
    };

    if (charts.length > 0) {
      (result as ChartPayload).charts = charts;
    }

    return result;
  },
});

export const MissingValuesSummary = tool({
  description:
    "Summarize missing values per column: counts and percentage of missing entries.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
  }),
  execute: async ({ datasetId }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const totalRows = rows.length || 1;

    const columns = dataset.columns.map((col) => {
      const name = col.name;
      let nullCount = 0;
      for (const row of rows) {
        const v = row[name];
        if (v === null || v === undefined || v === "") {
          nullCount += 1;
        }
      }
      const nonNullCount = totalRows - nullCount;
      const nullPercent = (nullCount / totalRows) * 100;
      return { name, nullCount, nonNullCount, nullPercent };
    });

    const rowsWithAnyMissing = rows.reduce((acc, row) => {
      const hasMissing = dataset.columns.some((col) => {
        const v = row[col.name];
        return v === null || v === undefined || v === "";
      });
      return acc + (hasMissing ? 1 : 0);
    }, 0);

    // row-level missingness: rows with more than N missing columns
    const thresholdCounts = [1, 2, 3];
    const rowsWithMoreThan: Record<string, number> = {};
    for (const t of thresholdCounts) {
      let count = 0;
      for (const row of rows) {
        let missing = 0;
        for (const col of dataset.columns) {
          const v = row[col.name];
          if (v === null || v === undefined || v === "") missing += 1;
        }
        if (missing > t) count += 1;
      }
      rowsWithMoreThan[`gt_${t}`] = count;
    }

    // column-level missingness: columns over X% missing
    const columnThresholds = [20, 50, 80];
    const columnsOverThresholds: Record<string, string[]> = {};
    for (const pct of columnThresholds) {
      const key = `gte_${pct}`;
      columnsOverThresholds[key] = columns
        .filter((c) => c.nullPercent >= pct)
        .map((c) => c.name);
    }

    return {
      datasetId: dataset.id,
      rowCount: rows.length,
      rowsWithAnyMissing,
      columns,
      rowsWithMoreThanMissing: rowsWithMoreThan,
      columnsOverMissingThresholds: columnsOverThresholds,
    };
  },
});

export const GenerateEdaReport = tool({
  description:
    "Generate a high-level EDA report structure for the dataset based on summaries and correlations.",
  inputSchema: z.object({
    datasetId: z.string().min(1),
  }),
  execute: async ({ datasetId }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    return {
      datasetId: dataset.id,
      overview: {
        name: dataset.name,
        rowCount: dataset.rowCount,
        columnCount: dataset.columns.length,
      },
      sections: [
        {
          id: "columns",
          title: "Columns",
          description:
            "Use SummarizeColumns to get per-column statistics, then describe key findings to the user.",
        },
        {
          id: "distributions",
          title: "Distributions",
          description:
            "Use ValueCounts for categorical columns and appropriate charts to visualize distributions.",
        },
        {
          id: "relationships",
          title: "Relationships",
          description:
            "Use CorrelationMatrix and TimeSeriesSlice to highlight relationships and trends.",
        },
      ],
    };
  },
});
