export async function POST() {
  console.log("[Instagram] deauthorize callback received");
  return Response.json({ success: true });
}
