import AppHeader from "@/components/AppHeader";
import ChannelPricingClient from "@/components/ChannelPricingClient";

export const dynamic = "force-dynamic";

export default function ChannelPricingPage() {
  return (
    <>
      <AppHeader refreshHref="/channel-pricing" />
      <ChannelPricingClient />
    </>
  );
}
