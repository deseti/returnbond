import { AuthButton } from "@/components/auth/auth-button";
import { DashboardGate } from "@/components/auth/dashboard-gate";
import { SiteHeader } from "@/components/layout/site-header";

export default function DashboardPage() {
  return (
    <div className="app-frame dashboard-frame">
      <SiteHeader actions={<AuthButton compact />} />
      <DashboardGate />
    </div>
  );
}

