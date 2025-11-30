import type { NextRequest } from "next/server";
import { addDataset } from "@/lib/datasets";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      const raw = values[index]?.trim() ?? "";
      const num = Number(raw);

      if (raw === "") {
        row[header] = null;
      } else if (!Number.isNaN(num) && raw !== "") {
        row[header] = num;
      } else if (raw.toLowerCase() === "true" || raw.toLowerCase() === "false") {
        row[header] = raw.toLowerCase() === "true";
      } else {
        row[header] = raw;
      }
    });

    return row;
  });

  return rows;
}

function sampleRows<T>(rows: T[], maxRows = 5000): T[] {
  if (rows.length <= maxRows) return rows;

  const sampled: T[] = [];
  const step = rows.length / maxRows;
  for (let i = 0; i < rows.length; i += step) {
    const idx = Math.floor(i);
    if (idx < rows.length) sampled.push(rows[idx]);
  }
  return sampled;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing file field 'file'" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    let rows: Record<string, unknown>[] = [];

    if (name.endsWith(".csv")) {
      const text = new TextDecoder().decode(arrayBuffer);
      rows = parseCsv(text);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });
      rows = json;
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: "Unsupported file type. Please upload a CSV or Excel (.xlsx) file." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    rows = sampleRows(rows);

    const datasetSummary = addDataset({
      name: file.name,
      rows,
    });

    return new Response(JSON.stringify({ ok: true, dataset: datasetSummary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
