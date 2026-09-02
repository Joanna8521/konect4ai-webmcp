import {
  DATAGOV_TOOL_NAME,
  type JsonObject,
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
  if (isDataGovTool(toolName)) {
    const response = await callDataGovSearch(args, signal);
    return response.result;
  }

  const response = await callKonect4aiTool(toolName, args, signal);
  return response.result;
}

