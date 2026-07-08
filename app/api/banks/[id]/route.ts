import { getBankProfile } from "@/lib/bankProfile";
import { apiJson, apiError } from "@/lib/apiResponse";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getBankProfile(id);

  if (!profile.bank) {
    return apiError("Bank not found", 404);
  }

  return apiJson(profile);
}
