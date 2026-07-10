import { NextRequest } from "next/server";
import { getBankProfileById } from "@/lib/bankProfile";
import { apiJson, apiError, apiCorsPreflight, withApiProtection } from "@/lib/apiResponse";

export function OPTIONS() {
  return apiCorsPreflight();
}

export const GET = withApiProtection(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const profile = await getBankProfileById(id);

    if (!profile.bank) {
      return apiError("Bank not found", 404);
    }

    return apiJson(profile);
  }
);
