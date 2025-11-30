"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Action, Actions } from "@/components/ai-elements/actions";
import { Fragment, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Response } from "@/components/ai-elements/response";
import { CopyIcon, GlobeIcon, RefreshCcwIcon } from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Loader } from "@/components/ai-elements/loader";

const models = [
  {
    name: "GPT-OSS 120B",
    value: "openai/gpt-oss-120b",
  },
  {
    name: "GPT-OSS 20B",
    value: "openai/gpt-oss-20b",
  },
];

const ChatBotDemo = () => {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);
  const [dataset, setDataset] = useState<{
    id: string;
    name: string;
    rowCount: number;
    columns: { name: string; type: string }[];
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "report">("chat");
  const { messages, sendMessage, status, regenerate } = useChat();
  console.log(messages);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("groqApiKey");
    if (stored) {
      setGroqApiKey(stored);
    }
  }, []);

  const handleSaveGroqKey = () => {
    if (typeof window === "undefined") return;
    const trimmed = groqApiKey.trim();
    window.localStorage.setItem("groqApiKey", trimmed);
    setGroqApiKey(trimmed);
  };

  const handleUploadChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to upload dataset");
      }

      setDataset(json.dataset);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown upload error";
      setUploadError(message);
      setDataset(null);
    } finally {
      setIsUploading(false);
      // reset the input so the same file can be selected again if needed
      event.target.value = "";
    }
  };

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage(
      {
        text: message.text || "Sent with attachments",
        files: message.files,
      },
      {
        body: {
          model: model,
          webSearch: webSearch,
          datasetId: dataset?.id,
          groqApiKey: groqApiKey || undefined,
        },
      }
    );
    setInput("");
  };

  const renderCompiledReport = () => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const findPart = (predicate: (part: any) => boolean) => {
      for (let i = assistantMessages.length - 1; i >= 0; i--) {
        const msg = assistantMessages[i];
        const part = msg.parts.find(predicate);
        if (part) return part as any;
      }
      return null;
    };

    const reportPart = findPart(
      (part) =>
        "output" in part &&
        part.output &&
        typeof part.output === "object" &&
        "overview" in part.output &&
        "sections" in part.output,
    );

    const mvPart = findPart(
      (part) =>
        "output" in part &&
        part.output &&
        typeof part.output === "object" &&
        "rowCount" in part.output &&
        "rowsWithAnyMissing" in part.output &&
        "columns" in part.output,
    );

    const corrPart = findPart(
      (part) =>
        "output" in part &&
        part.output &&
        typeof part.output === "object" &&
        "numericColumns" in part.output &&
        "matrix" in part.output,
    );

    const reportOutput = reportPart && "output" in reportPart ? (reportPart.output as {
      overview?: { name?: string; rowCount?: number; columnCount?: number };
      sections?: Array<{ id: string; title: string; description?: string }>;
    }) : null;

    const mvOutput = mvPart && "output" in mvPart ? (mvPart.output as {
      rowCount: number;
      rowsWithAnyMissing: number;
      columns: Array<{
        name: string;
        nullCount: number;
        nonNullCount: number;
        nullPercent: number;
      }>;
    }) : null;

    const corrOutput = corrPart && "output" in corrPart ? (corrPart.output as {
      numericColumns: string[];
      matrix: Record<string, Record<string, number>>;
    }) : null;

    const cellColor = (value: number) => {
      const v = Math.max(-1, Math.min(1, value));
      const intensity = Math.round(Math.abs(v) * 80);
      if (v >= 0) {
        return `rgba(34,197,94,${0.2 + intensity / 200})`;
      }
      return `rgba(239,68,68,${0.2 + intensity / 200})`;
    };

    if (!reportOutput && !mvOutput && !corrOutput) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground border rounded-lg">
          No compiled report yet. Ask for a full EDA report on the current dataset to populate this view.
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto space-y-4">
        {reportOutput && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              EDA Report
            </div>
            {reportOutput.overview && (
              <div className="space-y-1">
                {reportOutput.overview.name && (
                  <div>
                    <span className="font-semibold">Dataset:</span> {reportOutput.overview.name}
                  </div>
                )}
                <div className="flex flex-wrap gap-4 text-xs">
                  {typeof reportOutput.overview.rowCount === "number" && (
                    <div>
                      <span className="font-semibold">Rows:</span> {reportOutput.overview.rowCount}
                    </div>
                  )}
                  {typeof reportOutput.overview.columnCount === "number" && (
                    <div>
                      <span className="font-semibold">Columns:</span> {reportOutput.overview.columnCount}
                    </div>
                  )}
                </div>
              </div>
            )}
            {reportOutput.sections && reportOutput.sections.length > 0 && (
              <div className="space-y-2 mt-2">
                {reportOutput.sections.map((section) => (
                  <div key={section.id} className="space-y-1">
                    <div className="font-medium text-xs uppercase tracking-wide">
                      {section.title}
                    </div>
                    {section.description && (
                      <div className="text-xs text-muted-foreground whitespace-pre-line">
                        {section.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mvOutput && mvOutput.columns.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              Missing Values Summary
            </div>
            <div className="text-xs flex flex-wrap gap-4">
              <div>
                <span className="font-semibold">Rows:</span> {mvOutput.rowCount}
              </div>
              <div>
                <span className="font-semibold">Rows with any missing:</span> {mvOutput.rowsWithAnyMissing}
              </div>
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pr-2 py-1">Column</th>
                    <th className="text-right px-2 py-1">Missing</th>
                    <th className="text-right px-2 py-1">% Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {mvOutput.columns.map((col) => (
                    <tr key={col.name} className="border-b last:border-0">
                      <td className="pr-2 py-1">{col.name}</td>
                      <td className="text-right px-2 py-1">{col.nullCount}</td>
                      <td className="text-right px-2 py-1">{col.nullPercent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {corrOutput && corrOutput.numericColumns.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              Correlation Matrix
            </div>
            <div className="mt-2 max-h-64 overflow-auto text-xs">
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-muted px-2 py-1 text-left">Var</th>
                    {corrOutput.numericColumns.map((col) => (
                      <th key={col} className="px-2 py-1 text-right">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corrOutput.numericColumns.map((rowCol) => (
                    <tr key={rowCol}>
                      <td className="sticky left-0 bg-muted px-2 py-1 text-left font-medium">
                        {rowCol}
                      </td>
                      {corrOutput.numericColumns.map((col) => {
                        const v = corrOutput.matrix?.[rowCol]?.[col] ?? 0;
                        return (
                          <td
                            key={col}
                            className="px-2 py-1 text-right border cursor-pointer"
                            style={{ backgroundColor: cellColor(v) }}
                            onClick={() =>
                              setInput(
                                `Analyze the relationship between "${rowCol}" and "${col}" (scatterplot or grouped view) and explain any interesting patterns.`,
                              )
                            }
                          >
                            {v.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-screen px-4 py-3 relative">
      <div className="grid h-full gap-3 grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        {/* Left column: dataset + fields */}
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="border rounded-lg p-3 text-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">Dataset</div>
                <div className="text-xs text-muted-foreground">
                  Upload a CSV file to analyze.
                </div>
              </div>
              {uploadError && (
                <div className="text-xs text-red-500">{uploadError}</div>
              )}
              {dataset && (
                <div className="text-xs space-y-1">
                  <div>
                    <span className="font-semibold">Name:</span> {dataset.name}
                  </div>
                  <div>
                    <span className="font-semibold">Rows:</span> {dataset.rowCount}
                  </div>
                </div>
              )}
              <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                <span className="border px-2 py-1 rounded">{isUploading ? "Uploading..." : "Upload CSV"}</span>
                <input
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleUploadChange}
                  disabled={isUploading}
                />
              </label>
            </div>
            {uploadError && (
              <div className="text-xs text-red-500">{uploadError}</div>
            )}
            {dataset && (
              <div className="text-xs space-y-1">
                <div>
                  <span className="font-semibold">Name:</span> {dataset.name}
                </div>
                <div>
                  <span className="font-semibold">Rows:</span> {dataset.rowCount}
                </div>
              </div>
            )}
          </div>
          {dataset && (
            <div className="border rounded-lg p-3 text-sm flex-1 flex flex-col min-h-0">
              <div className="font-medium mb-2">Fields</div>
              <div className="text-[11px] text-muted-foreground mb-1">
                {dataset.columns.length} columns
              </div>
              <div className="mt-1 space-y-1 overflow-auto text-xs pr-1">
                {dataset.columns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/60 cursor-pointer"
                    onClick={() => {
                      const base =
                        col.type === "number"
                          ? `Show a detailed distribution (histogram, summary stats, and outliers) for the numeric column "${col.name}".`
                          : `Show value counts and interesting patterns for the column "${col.name}".`;
                      setInput(base);
                    }}
                  >
                    <span className="truncate" title={col.name}>
                      {col.name}
                    </span>
                    <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {col.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: chat + results */}
        <div className="flex flex-col h-full gap-4">
          <div className="flex items-center justify-between text-xs">
            <div className="inline-flex rounded-full border bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-1 rounded-full ${
                  activeTab === "chat"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("report")}
                className={`px-3 py-1 rounded-full ${
                  activeTab === "report"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Report
              </button>
            </div>
          </div>

          {activeTab === "chat" ? (
            <Conversation className="h-full">
              <ConversationContent>
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === "assistant" &&
                      message.parts.filter((part) => part.type === "source-url")
                        .length > 0 && (
                        <Sources>
                          <SourcesTrigger
                            count={
                              message.parts.filter(
                                (part) => part.type === "source-url"
                              ).length
                            }
                          />
                          {message.parts
                            .filter((part) => part.type === "source-url")
                            .map((part, i) => (
                              <SourcesContent key={`${message.id}-${i}`}>
                                <Source
                                  key={`${message.id}-${i}`}
                                  href={part.url}
                                  title={part.url}
                                />
                              </SourcesContent>
                            ))}
                        </Sources>
                      )}
                    {message.parts.map((part, i) => {
                      switch (part.type) {
                        case "text":
                          return (
                            <Fragment key={`${message.id}-${i}`}>
                              <Message from={message.role}>
                                <MessageContent>
                                  <Response>{part.text}</Response>
                                </MessageContent>
                              </Message>
                              {message.role === "assistant" &&
                                i === messages.length - 1 && (
                                  <Actions className="mt-2">
                                    <Action
                                      onClick={() => regenerate()}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="size-3" />
                                    </Action>
                                    <Action
                                      onClick={() =>
                                        navigator.clipboard.writeText(part.text)
                                      }
                                      label="Copy"
                                    >
                                      <CopyIcon className="size-3" />
                                    </Action>
                                  </Actions>
                                )}
                            </Fragment>
                          );
                        case "reasoning":
                          return (
                            <Reasoning
                              key={`${message.id}-${i}`}
                              className="w-full"
                              isStreaming={
                                status === "streaming" &&
                                i === message.parts.length - 1 &&
                                message.id === messages.at(-1)?.id
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        default:
                          if (
                            part.type.startsWith("tool-") &&
                            "state" in part &&
                            "input" in part
                          ) {
                            const toolType = part.type as `tool-${string}`;
                            return (
                              <Tool key={`${message.id}-${i}`}>
                                <ToolHeader type={toolType} state={part.state} />
                                <ToolContent>
                                  <ToolInput input={part.input} />
                                  <ToolOutput
                                    output={
                                      part.output ? (
                                        <Response>
                                          {typeof part.output === "string"
                                            ? part.output
                                            : JSON.stringify(part.output, null, 2)}
                                        </Response>
                                      ) : null
                                    }
                                    errorText={part.errorText}
                                  />
                                </ToolContent>
                              </Tool>
                            );
                          }
                          return null;
                      }
                    })}
                    {/* Display narrative from FinalizeReport as final result */}
                    {message.role === "assistant" &&
                      (() => {
                        // Find FinalizeReport by checking for the specific output structure
                        const finalizeReportPart = message.parts.find(
                          (part) =>
                            "output" in part &&
                            part.output &&
                            typeof part.output === "object" &&
                            "narrative" in part.output &&
                            "sql" in part.output &&
                            "confidence" in part.output
                        );

                        if (finalizeReportPart && "output" in finalizeReportPart) {
                          const output = finalizeReportPart.output as {
                            narrative: string;
                          };

                          if (output.narrative) {
                            return (
                              <Message from={message.role}>
                                <MessageContent>
                                  <Response>{output.narrative}</Response>
                                </MessageContent>
                              </Message>
                            );
                          }
                        }
                        return null;
                      })()}
                    {/* Display EDA report from GenerateEdaReport or similar tools */}
                    {message.role === "assistant" &&
                      (() => {
                        const reportPart = message.parts.find(
                          (part) =>
                            "output" in part &&
                            part.output &&
                            typeof part.output === "object" &&
                            "overview" in part.output &&
                            "sections" in part.output,
                        );

                        if (!reportPart || !("output" in reportPart)) return null;

                        const output = reportPart.output as {
                          overview?: {
                            name?: string;
                            rowCount?: number;
                            columnCount?: number;
                          };
                          sections?: Array<{
                            id: string;
                            title: string;
                            description?: string;
                          }>;
                        };

                        if (!output.overview && !output.sections) return null;

                        return (
                          <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
                            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                              EDA Report
                            </div>
                            {output.overview && (
                              <div className="space-y-1">
                                {output.overview.name && (
                                  <div>
                                    <span className="font-semibold">Dataset:</span>{" "}
                                    {output.overview.name}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-4 text-xs">
                                  {typeof output.overview.rowCount === "number" && (
                                    <div>
                                      <span className="font-semibold">Rows:</span>{" "}
                                      {output.overview.rowCount}
                                    </div>
                                  )}
                                  {typeof output.overview.columnCount === "number" && (
                                    <div>
                                      <span className="font-semibold">Columns:</span>{" "}
                                      {output.overview.columnCount}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {output.sections && output.sections.length > 0 && (
                              <div className="space-y-2 mt-2">
                                {output.sections.map((section) => (
                                  <div key={section.id} className="space-y-1">
                                    <div className="font-medium text-xs uppercase tracking-wide">
                                      {section.title}
                                    </div>
                                    {section.description && (
                                      <div className="text-xs text-muted-foreground whitespace-pre-line">
                                        {section.description}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    {/* Display missing-values summary from MissingValuesSummary tool */}
                    {message.role === "assistant" &&
                      (() => {
                        const mvPart = message.parts.find(
                          (part) =>
                            "output" in part &&
                            part.output &&
                            typeof part.output === "object" &&
                            "rowCount" in part.output &&
                            "rowsWithAnyMissing" in part.output &&
                            "columns" in part.output,
                        );

                        if (!mvPart || !("output" in mvPart)) return null;

                        const output = mvPart.output as {
                          rowCount: number;
                          rowsWithAnyMissing: number;
                          columns: Array<{
                            name: string;
                            nullCount: number;
                            nonNullCount: number;
                            nullPercent: number;
                          }>;
                        };

                        if (!output.columns || output.columns.length === 0) return null;

                        return (
                          <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
                            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                              Missing Values Summary
                            </div>
                            <div className="text-xs flex flex-wrap gap-4">
                              <div>
                                <span className="font-semibold">Rows:</span> {output.rowCount}
                              </div>
                              <div>
                                <span className="font-semibold">Rows with any missing:</span> {output.rowsWithAnyMissing}
                              </div>
                            </div>
                            <div className="mt-2 max-h-48 overflow-y-auto text-xs">
                              <table className="w-full border-collapse">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left pr-2 py-1">Column</th>
                                    <th className="text-right px-2 py-1">Missing</th>
                                    <th className="text-right px-2 py-1">% Missing</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {output.columns.map((col) => (
                                    <tr key={col.name} className="border-b last:border-0">
                                      <td className="pr-2 py-1">{col.name}</td>
                                      <td className="text-right px-2 py-1">{col.nullCount}</td>
                                      <td className="text-right px-2 py-1">
                                        {col.nullPercent.toFixed(1)}%
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                    {/* Display correlation matrix from CorrelationMatrix tool */}
                    {message.role === "assistant" &&
                      (() => {
                        const corrPart = message.parts.find(
                          (part) =>
                            "output" in part &&
                            part.output &&
                            typeof part.output === "object" &&
                            "numericColumns" in part.output &&
                            "matrix" in part.output,
                        );

                        if (!corrPart || !("output" in corrPart)) return null;

                        const output = corrPart.output as {
                          numericColumns: string[];
                          matrix: Record<string, Record<string, number>>;
                        };

                        const cols = output.numericColumns;
                        if (!cols || cols.length === 0) return null;

                        const cellColor = (value: number) => {
                          const v = Math.max(-1, Math.min(1, value));
                          const intensity = Math.round(Math.abs(v) * 80); // 0-80
                          if (v >= 0) {
                            return `rgba(34,197,94,${0.2 + intensity / 200})`; // greenish
                          }
                          return `rgba(239,68,68,${0.2 + intensity / 200})`; // reddish
                        };

                        return (
                          <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
                            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                              Correlation Matrix
                            </div>
                            <div className="mt-2 max-h-64 overflow-auto text-xs">
                              <table className="border-collapse">
                                <thead>
                                  <tr>
                                    <th className="sticky left-0 bg-muted px-2 py-1 text-left">Var</th>
                                    {cols.map((col) => (
                                      <th key={col} className="px-2 py-1 text-right">
                                        {col}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {cols.map((rowCol) => (
                                    <tr key={rowCol}>
                                      <td className="sticky left-0 bg-muted px-2 py-1 text-left font-medium">
                                        {rowCol}
                                      </td>
                                      {cols.map((col) => {
                                        const v = output.matrix?.[rowCol]?.[col] ?? 0;
                                        return (
                                          <td
                                            key={col}
                                            className="px-2 py-1 text-right border cursor-pointer"
                                            style={{ backgroundColor: cellColor(v) }}
                                            onClick={() =>
                                              setInput(
                                                `Analyze the relationship between "${rowCol}" and "${col}" (scatterplot or grouped view) and explain any interesting patterns.`,
                                              )
                                            }
                                          >
                                            {v.toFixed(2)}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                    {/* Fallback message when tools ran but no narrative was produced */}
                    {message.role === "assistant" &&
                      (() => {
                        const hasTextPart = message.parts.some(
                          (part) => part.type === "text",
                        );
                        const hasToolPart = message.parts.some((part) =>
                          String(part.type).startsWith("tool-"),
                        );
                        const hasNarrativeOrReport = message.parts.some((part) => {
                          if (!("output" in part) || !part.output) return false;
                          const out = part.output as any;
                          return (
                            ("narrative" in out && "sql" in out && "confidence" in out) ||
                            ("overview" in out && "sections" in out)
                          );
                        });

                        if (!hasToolPart || hasTextPart || hasNarrativeOrReport) {
                          return null;
                        }

                        return (
                          <Message from={message.role}>
                            <MessageContent>
                              <Response>
                                I have run one or more analysis tools for your request. You can review the tool cards above, or ask me to "generate a full EDA report" or "summarize key findings" for a written explanation.
                              </Response>
                            </MessageContent>
                          </Message>
                        );
                      })()}
                  </div>
                ))}
                {status === "submitted" && <Loader />}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          ) : (
            renderCompiledReport()
          )}

          {dataset && (
            <div className="mt-4 mb-2 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-full border px-3 py-1 bg-background hover:bg-muted transition-colors"
                onClick={() =>
                  setInput(
                    "Give me a high-level EDA report for the uploaded dataset.",
                  )
                }
              >
                EDA report
              </button>
              <button
                type="button"
                className="rounded-full border px-3 py-1 bg-background hover:bg-muted transition-colors"
                onClick={() =>
                  setInput(
                    "Show column-wise statistics and missing values summary.",
                  )
                }
              >
                Column stats & missingness
              </button>
              <button
                type="button"
                className="rounded-full border px-3 py-1 bg-background hover:bg-muted transition-colors"
                onClick={() =>
                  setInput(
                    "Highlight interesting relationships or correlations between numeric columns.",
                  )
                }
              >
                Correlations
              </button>
              <button
                type="button"
                className="rounded-full border px-3 py-1 bg-background hover:bg-muted transition-colors"
                onClick={() =>
                  setInput(
                    "Identify key patterns or segments in this dataset that would be useful for business decisions.",
                  )
                }
              >
                Key patterns
              </button>
            </div>
          )}

          <PromptInput
            onSubmit={handleSubmit}
            className="mt-4"
            globalDrop
            multiple
          >
            <PromptInputBody>
              <PromptInputTextarea
                onChange={(e) => setInput(e.target.value)}
                value={input}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <button
                  type="button"
                  className="mr-2 rounded border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                  onClick={() => setShowGroqKey((v) => !v)}
                >
                  {showGroqKey ? "Hide Groq key" : "Groq API key"}
                </button>
                <PromptInputModelSelect
                  onValueChange={(value) => {
                    setModel(value);
                  }}
                  value={model}
                >
                  <PromptInputModelSelectTrigger>
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {models.map((model) => (
                      <PromptInputModelSelectItem
                        key={model.value}
                        value={model.value}
                      >
                        {model.name}
                      </PromptInputModelSelectItem>
                    ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              </PromptInputTools>
              {showGroqKey && (
                <div className="flex flex-1 items-center gap-2 px-2 mt-1">
                  <input
                    type="password"
                    className="flex-1 rounded border px-2 py-1 text-xs bg-background"
                    placeholder="Enter your Groq API key (stored only in this browser)"
                    value={groqApiKey}
                    onChange={(e) => setGroqApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
                    onClick={handleSaveGroqKey}
                  >
                    Save
                  </button>
                </div>
              )}
              <PromptInputSubmit disabled={!input && !status} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
};

export default ChatBotDemo;
