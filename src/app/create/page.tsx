import { AuthButton } from "@/components/auth/auth-button";
import { SiteHeader } from "@/components/layout/site-header";
import { CreateAgreementForm } from "@/features/agreements/create-agreement-form";

export default function CreateAgreementPage() {
  return (
    <div className="app-frame dashboard-frame">
      <SiteHeader actions={<AuthButton compact />} />
      <CreateAgreementForm />
    </div>
  );
}
