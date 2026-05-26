import AppHeader from "@/components/AppHeader";
import SmsClient from "@/components/SmsClient";

export const dynamic = "force-dynamic";

export default function SmsPage() {
  return (
    <>
      <AppHeader refreshHref="/sms" />
      <SmsClient />
    </>
  );
}
