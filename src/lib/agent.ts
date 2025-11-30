import type { LanguageModel, UIMessage } from "ai";
import {
  stepCountIs,
  Experimental_Agent as _,
  generateText,
  convertToModelMessages,
  streamText,
} from "ai";
import { groq, createGroq } from "@ai-sdk/groq";
import {
  AssessEntityCoverage,
  ClarifyIntent,
  FinalizePlan,
  FinalizeNoData,
  LoadEntitiesBulk,
  ReadEntityYamlRaw,
  ScanEntityProperties,
  SearchCatalog,
  SearchSchema,
} from "./tools/planning";
// Use SQLite building tools for demo/development
import { BuildSQL, FinalizeBuild, ValidateSQL } from "./tools/building-sqlite";

// For production Snowflake usage, use:
// import {
//   BuildSQL,
//   FinalizeBuild,
//   JoinPathFinder,
//   ValidateSQL,
// } from "./tools/building";

// Use SQLite execution tools for demo/development
import {
  EstimateCost,
  ExecuteSQL,
  ExecuteSQLWithRepair,
} from "./tools/execute-sqlite";

// For production Snowflake usage, use:
// import {
//   EstimateCost,
//   ExecuteSQL,
//   ExecuteSQLWithRepair,
//   ExplainSnowflake,
// } from "./tools/execute";
import {
  ExplainResults,
  FinalizeReport,
  FormatResults,
  SanityCheck,
  VisualizeData,
} from "./tools/reporting";
import {
  DescribeDataset,
  SummarizeColumns,
  ValueCounts,
  TimeSeriesSlice,
  CorrelationMatrix,
  TargetAnalysis,
  GroupedSummary,
  TopSegments,
  RelationshipDrilldown,
  MissingValuesSummary,
  GenerateEdaReport,
} from "./tools/eda";
import { PLANNING_SPECIALIST_SYSTEM_PROMPT } from "./prompts/planning";
import { BUILDING_SPECIALIST_SYSTEM_PROMPT } from "./prompts/building";
import { EXECUTION_MANAGER_SYSTEM_PROMPT } from "./prompts/execution";
import { REPORTING_SPECIALIST_SYSTEM_PROMPT } from "./prompts/reporting";
import { ListEntities } from "./semantic/io";
import { sqlEvalSet } from "./sample-queries";
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}
export type Phase = "planning" | "building" | "execution" | "reporting";

export async function runAgent({
  messages,
  prompt,
  model = "openai/gpt-oss-20b",
  datasetId,
  groqApiKey,
}: {
  messages: UIMessage[];
  prompt?: string;
  model?: string;
  datasetId?: string;
  groqApiKey?: string;
}) {
  let phase: Phase = "planning";
  const possibleEntities = await ListEntities();

  const provider = groqApiKey
    ? createGroq({ apiKey: groqApiKey })
    : groq;

  const result = streamText({
    model: provider(model),
    messages: convertToModelMessages(messages),
    tools: {
      ReadEntityYamlRaw,
      LoadEntitiesBulk,
      ScanEntityProperties,
      AssessEntityCoverage,
      ClarifyIntent,
      SearchCatalog,
      SearchSchema,
      FinalizePlan,
      FinalizeNoData,
      BuildSQL,
      ValidateSQL,
      FinalizeBuild,
      EstimateCost,
      ExecuteSQL,
      ExecuteSQLWithRepair,
      SanityCheck,
      FormatResults,
      ExplainResults,
      FinalizeReport,
      DescribeDataset,
      SummarizeColumns,
      ValueCounts,
      TimeSeriesSlice,
      CorrelationMatrix,
      TargetAnalysis,
      GroupedSummary,
      TopSegments,
      RelationshipDrilldown,
      MissingValuesSummary,
      GenerateEdaReport,
    },
    stopWhen: [
      (ctx) =>
        ctx.steps.some((step) =>
          step.toolResults?.some(
            (t) =>
              t.toolName === "FinalizeReport" ||
              t.toolName === "FinalizeNoData" ||
              t.toolName === "ClarifyIntent"
          )
        ),
      stepCountIs(100),
    ],
    onStepFinish: ({ text, toolCalls }) => {
      console.log(
        `[Agent] Completed step ${text}: ${toolCalls
          .map((t) => t.toolName)
          .join(", ")}`
      );
    },
    prepareStep: async ({ steps, stepNumber }) => {
      console.log(
        `[Agent] Preparing step ${stepNumber}, current phase: ${phase}`
      );

      if (
        steps.some((step) =>
          step.toolResults?.some((t) => t.toolName === "FinalizePlan")
        )
      ) {
        phase = "building";
      }
      if (
        steps.some((step) =>
          step.toolResults?.some((t) => t.toolName === "FinalizeBuild")
        )
      ) {
        phase = "execution";
      }
      if (
        steps.some((step) =>
          step.toolResults?.some((t) => t.toolName === "ExecuteSQLWithRepair")
        )
      ) {
        phase = "reporting";
      }

      if (phase === "planning") {
        return {
          system: [
            PLANNING_SPECIALIST_SYSTEM_PROMPT,
            `POSSIBLE_ENTITIES_JSON: ${JSON.stringify(possibleEntities)}`,
            `VERIFIED_QUERIES_JSON: ${JSON.stringify(sqlEvalSet)}`,
            datasetId
              ? `ACTIVE_DATASET_ID: ${datasetId}. When you use the DescribeDataset tool, pass this id as datasetId.`
              : "NO_ACTIVE_DATASET_ID",
          ].join("\n"),
          activeTools: [
            "ReadEntityYamlRaw",
            "LoadEntitiesBulk",
            "ScanEntityProperties",
            "AssessEntityCoverage",
            "ClarifyIntent",
            "SearchCatalog",
            "SearchSchema",
            "DescribeDataset",
            "SummarizeColumns",
            "ValueCounts",
            "TimeSeriesSlice",
            "CorrelationMatrix",
            "TargetAnalysis",
            "GroupedSummary",
            "TopSegments",
            "RelationshipDrilldown",
            "MissingValuesSummary",
            "GenerateEdaReport",
            "FinalizePlan",
            "FinalizeBuild",
            "FinalizeNoData",
          ],
        };
      }

      if (phase === "building") {
        return {
          system: `${BUILDING_SPECIALIST_SYSTEM_PROMPT}\n\nYou are generating SQL for a SQLite database. Use standard SQL syntax compatible with SQLite. The schema uses simple table names: companies, people, accounts.`,
          activeTools: ["BuildSQL", "ValidateSQL", "FinalizeBuild"],
        };
      }

      if (phase === "execution") {
        return {
          system: `${EXECUTION_MANAGER_SYSTEM_PROMPT}\n\nYou are working with a SQLite database. Use ExecuteSQLWithRepair to run the final query. EstimateCost is available but returns simplified estimates for SQLite.`,
          activeTools: ["EstimateCost", "ExecuteSQLWithRepair"],
        };
      }

      return {
        system: REPORTING_SPECIALIST_SYSTEM_PROMPT,
        activeTools: [
          "SanityCheck",
          "FormatResults",
          // "VisualizeData",
          "ExplainResults",
          "FinalizeReport",
        ],
      };
    },
  });

  return result;
}
