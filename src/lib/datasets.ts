import { randomUUID } from "crypto";

export type DatasetColumn = {
  name: string;
  type: "number" | "string" | "boolean" | "unknown";
};

export type DatasetSummary = {
  id: string;
  name: string;
  rowCount: number;
  columns: DatasetColumn[];
};

export type Dataset = DatasetSummary & {
  rows: Record<string, unknown>[];
};

// In-memory dataset store. In dev, Next.js can hot-reload modules,
// which would normally reset a module-scoped Map. To keep uploaded
// datasets available across /api/upload and /api/chat after
// recompilations, store the Map on globalThis.
const globalAny = globalThis as unknown as {
  __DATA_ANALYST_DATASETS__?: Map<string, Dataset>;
};

const datasets: Map<string, Dataset> =
  globalAny.__DATA_ANALYST_DATASETS__ || new Map<string, Dataset>();

if (!globalAny.__DATA_ANALYST_DATASETS__) {
  globalAny.__DATA_ANALYST_DATASETS__ = datasets;
}

export function addDataset(input: {
  name: string;
  rows: Record<string, unknown>[];
}): DatasetSummary {
  const id = randomUUID();
  const { name, rows } = input;

  const columns: DatasetColumn[] = inferColumns(rows);

  const dataset: Dataset = {
    id,
    name,
    rowCount: rows.length,
    columns,
    rows,
  };

  datasets.set(id, dataset);

  return {
    id,
    name,
    rowCount: dataset.rowCount,
    columns: dataset.columns,
  };
}

export function getDataset(id: string): Dataset | undefined {
  return datasets.get(id);
}

export function listDatasets(): DatasetSummary[] {
  return Array.from(datasets.values()).map(({ rows, ...summary }) => summary);
}

function inferColumns(rows: Record<string, unknown>[]): DatasetColumn[] {
  if (!rows.length) return [];

  const sample = rows.slice(0, 20);
  const columnNames = Object.keys(sample[0]);

  return columnNames.map((name) => {
    const values = sample.map((row) => row[name]).filter((v) => v != null);

    let type: DatasetColumn["type"] = "unknown";

    if (values.every((v) => typeof v === "number")) {
      type = "number";
    } else if (values.every((v) => typeof v === "boolean")) {
      type = "boolean";
    } else if (values.every((v) => typeof v === "string")) {
      const numericValues = values.map((v) => Number(v));
      if (numericValues.every((n) => Number.isFinite(n))) {
        type = "number";
      } else {
        type = "string";
      }
    }

    return { name, type };
  });
}
