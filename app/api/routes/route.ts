import { NextRequest } from "next/server";
import { getRouteIntelligence } from "@/lib/routingEngine";
import { apiJson, apiError, apiCorsPreflight, withApiProtection } from "@/lib/apiResponse";

export function OPTIONS() {
  return apiCorsPreflight();
}

export const GET = withApiProtection(async (request: NextRequest) => {
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  if (!from || !to) {
    return apiError("Both 'from' and 'to' bank id query params are required", 400);
  }

  const result = await getRouteIntelligence(from, to);

  return apiJson(result);
});
