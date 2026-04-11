import { redirect } from "next/navigation";

export default function ThreadsAnalyticsRedirect() {
  redirect("/tools/threads?brand=dashboard");
}
