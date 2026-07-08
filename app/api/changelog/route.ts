import { NextRequest } from "next/server";
import { getActivityFeed } from "@/lib/activityFeed";
import { apiJson, apiError } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

export async function GET(request: NextRequest) {
  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam) || 50, 200);

  const feed = await getActivityFeed(limit);
  return apiJson({ activity: feed });
}
