import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteMetaToken } from "@/lib/metaTokenStore";

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete("meta_at");
  await deleteMetaToken().catch((e) =>
    console.error("[Meta logout] store delete failed:", e)
  );
  redirect("/ads");
}
