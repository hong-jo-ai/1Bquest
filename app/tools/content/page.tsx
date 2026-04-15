import AppHeader from "@/components/AppHeader";
import ContentStudio from "@/components/content/ContentStudio";

export const metadata = {
  title: "콘텐츠 스튜디오 — Harriot Watches",
  description: "인스타그램·유튜브 콘텐츠 기획, 채널 변환, 트렌드 분석",
};

export default function ContentPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/content" />
      <ContentStudio />
    </>
  );
}
