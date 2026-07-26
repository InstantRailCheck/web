import { NextRequest } from "next/server";
import { getBankProfileById } from "@/lib/bankProfile";
import { apiJson, apiError, apiCorsPreflight, withApiProtection, isValidUuid } from "@/lib/apiResponse";

export function OPTIONS() {
  return apiCorsPreflight();
}

export const GET = withApiProtection(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    // banks.id is a uuid column — a malformed value can never match a row.
    // Rejecting it here as a 400 keeps "you sent something invalid" distinct
    // from a real 404 ("that id doesn't exist"), instead of both collapsing
    // into the same "Bank not found" response.
    if (!isValidUuid(id)) {
      return apiError("Invalid bank id", 400);
    }

    const profile = await getBankProfileById(id);

    if (!profile.bank) {
      return apiError("Bank not found", 404);
    }

    return apiJson(profile);
  }
);
