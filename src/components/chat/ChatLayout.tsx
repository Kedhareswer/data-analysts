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
import { Fragment, useState } from "react";
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
  const { messages, sendMessage, status, regenerate } = useChat();
  console.log(messages);

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
        },
      }
    );
    setInput("");
  };

  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full gap-4">
        <div className="border rounded-lg p-3 text-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">Dataset</div>
              <div className="text-xs text-muted-foreground">
                Upload a CSV file to analyze.
              </div>
            </div>
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
              <div>
                <span className="font-semibold">Columns:</span>{" "}
                {dataset.columns.map((col) => `${col.name} (${col.type})`).join(", ")}
              </div>
            </div>
          )}
        </div>
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
                                        className="px-2 py-1 text-right border"
                                        style={{ backgroundColor: cellColor(v) }}
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
              </div>
            ))}
            {status === "submitted" && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

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
            <PromptInputSubmit disabled={!input && !status} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
};

export default ChatBotDemo;
