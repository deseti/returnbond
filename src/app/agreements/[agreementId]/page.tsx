import { AuthButton } from "@/components/auth/auth-button";
import { SiteHeader } from "@/components/layout/site-header";
import { AgreementDetail } from "@/features/agreements/agreement-detail";

export default async function AgreementDetailPage(
  props: { params: Promise<{ agreementId: string }> },
) {
  const { agreementId } = await props.params;

  return (
    <div className="app-frame dashboard-frame">
      <SiteHeader actions={<AuthButton compact />} />
      <AgreementDetail agreementId={agreementId} />
    </div>
  );
}
