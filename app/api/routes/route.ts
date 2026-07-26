import { NextRequest } from "next/server";
import { getRouteIntelligence } from "@/lib/routingEngine";
import { apiJson, apiError, apiCorsPreflight, withApiProtection, isValidUuid } from "@/lib/apiResponse";

export function OPTIONS() {
  return apiCorsPreflight();
}

export const GET = withApiProtection(async (request: NextRequest) => {
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  if (!from || !to) {
    return apiError("Both 'from' and 'to' bank id query params are required", 400);
  }

  // Every bank id is a uuid column — a malformed value can never match a
  // row, so reject it here rather than let it silently resolve to "no data
  // for this route" (a 200) or fall through to a raw Postgres invalid-uuid
  // error.
  if (!isValidUuid(from) || !isValidUuid(to)) {
    return apiError("'from' and 'to' must be valid bank id UUIDs", 400);
  }

  const result = await getRouteIntelligence(from, to);

  return apiJson(result);
});
