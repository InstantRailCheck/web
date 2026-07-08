import { NextRequest } from "next/server";
import { getActivityFeed } from "@/lib/activityFeed";
import { apiJson, apiError, apiCsv, apiCorsPreflight, legacyApiRedirect } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { toCsv } from "@/lib/csv";

export function OPTIONS() {
  return apiCorsPreflight();
}

export async function GET(request: NextRequest) {
  const redirect = legacyApiRedirect(request);
  if (redirect) return redirect;

  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam) || 50, 200);
  const format = request.nextUrl.searchParams.get("format");

  const feed = await getActivityFeed(limit);

  if (format === "csv") {
    // Flatten the union type into consistent columns, since CSV headers
    // are derived from the first row and the two activity types differ.
    const rows = feed.map((item) => ({
      type: item.type,
      createdAt: item.createdAt,
      bankId: item.type === "bank_added" ? item.bankId : item.fromBankId,
      bankName: item.type === "bank_added" ? item.bankName : item.fromBankName,
      toBankName: item.type === "report" ? item.toBankName : "",
      rail: item.type === "report" ? item.rail : "",
      status: item.type === "report" ? item.status : "",
      isFirstConfirmed: item.type === "report" ? item.isFirstConfirmed : "",
    }));
    return apiCsv(toCsv(rows), "changelog.csv");
  }

  return apiJson({ activity: feed });
}
