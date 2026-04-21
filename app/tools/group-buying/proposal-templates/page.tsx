import AppHeader from "@/components/AppHeader";
import ProposalTemplateManager from "@/components/group-buying/ProposalTemplateManager";

export const metadata = { title: "제안 템플릿 | PAULVICE" };

export default function ProposalTemplatesPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/group-buying/proposal-templates" />
      <ProposalTemplateManager />
    </>
  );
}
