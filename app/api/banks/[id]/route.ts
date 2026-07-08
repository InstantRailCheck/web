import { NextRequest } from "next/server";
import { getBankProfileById } from "@/lib/bankProfile";
import { apiJson, apiError } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const { id } = await params;
  const profile = await getBankProfileById(id);

  if (!profile.bank) {
    return apiError("Bank not found", 404);
  }

  return apiJson(profile);
}
