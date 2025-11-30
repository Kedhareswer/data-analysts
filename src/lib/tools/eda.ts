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
        numericStats?: {
          min: number;
          max: number;
          mean: number;
        };
      }
    > = {};

    for (const column of dataset.columns) {
      const name = column.name;
      const values = rows.map((r) => r[name]);
      const nonNullValues = values.filter((v) => v !== null && v !== undefined);
      const distinct = new Set(
        nonNullValues.map((v) => (typeof v === "number" || typeof v === "boolean" ? v : String(v)))
      );

      const summary: (typeof summaries)[string] = {
        type: column.type,
        nonNullCount: nonNullValues.length,
        nullCount: totalRows - nonNullValues.length,
        distinctCount: distinct.size,
        sampleValues: nonNullValues.slice(0, 5),
      };

      if (column.type === "number") {
        const nums = nonNullValues.filter((v) => typeof v === "number") as number[];
        if (nums.length > 0) {
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          const mean = nums.reduce((acc, n) => acc + n, 0) / nums.length;
          summary.numericStats = { min, max, mean };
        }
      }

      summaries[name] = summary;
    }

    return {
      datasetId: dataset.id,
      rowCount: totalRows,
      columns: summaries,
    };
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
  }),
  execute: async ({ datasetId, dateColumn, valueColumn }) => {
    const dataset = getDataset(datasetId);

    if (!dataset) {
      return {
        error: `Dataset with id '${datasetId}' was not found on the server.`,
      };
    }

    const rows = dataset.rows;
    const buckets = new Map<string, { sum: number; count: number }>();

    for (const row of rows) {
      const d = row[dateColumn];
      const v = row[valueColumn];
      if (!d || typeof v !== "number") continue;
      const key = String(d);
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += v;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const series = Array.from(buckets.entries())
      .map(([timestamp, { sum, count }]) => ({
        timestamp,
        value: count > 0 ? sum / count : 0,
      }))
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    const chartPayload: ChartPayload = {
      charts: [
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
      ],
    };

    return {
      datasetId: dataset.id,
      dateColumn,
      valueColumn,
      series,
      ...chartPayload,
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

    return {
      datasetId: dataset.id,
      rowCount: rows.length,
      rowsWithAnyMissing,
      columns,
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
