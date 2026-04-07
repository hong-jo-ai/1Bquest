export async function POST() {
  console.log("[Instagram] data deletion callback received");
  return Response.json({
    url: "https://paulvice-dashboard.vercel.app",
    confirmation_code: crypto.randomUUID(),
  });
}
