import AppHeader from "@/components/AppHeader";
import InfluencerManager from "@/components/influencer/InfluencerManager";

export const metadata = { title: "인플루언서 마케팅 | PAULVICE Dashboard" };

export default function InfluencerPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/influencer" />
      <InfluencerManager />
    </>
  );
}
