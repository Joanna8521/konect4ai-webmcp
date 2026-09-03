import {
  ASK_DATA_SOURCE_TOOL_NAME,
  DATAGOV_TOOL_NAME,
  type JsonObject,
  askKonect4aiApi,
  callDataGovSearch,
  callKonect4aiTool,
} from "@/lib/konect4ai-client";

export function isDataGovTool(toolName: string): boolean {
  return toolName === DATAGOV_TOOL_NAME;
}

export async function executeCapability(
  toolName: string,
  args: JsonObject = {},
  signal?: AbortSignal,
): Promise<unknown> {
  if (toolName === ASK_DATA_SOURCE_TOOL_NAME) {
    const jobId = typeof args.jobId === "string" ? args.jobId : "";
    const question = typeof args.question === "string" ? args.question : "";
    return askKonect4aiApi(jobId, question, signal);
  }

  if (isDataGovTool(toolName)) {
    const response = await callDataGovSearch(args, signal);
    return response.result;
  }

  const response = await callKonect4aiTool(toolName, args, signal);
  return response.result;
}
