import { NextRequest } from "next/server";
import { getActivityFeed } from "@/lib/activityFeed";
import { apiJson } from "@/lib/apiResponse";

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam) || 50, 200);

  const feed = await getActivityFeed(limit);
  return apiJson({ activity: feed });
}
