import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Handshake,
  KeyRound,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { AuthButton } from "@/components/auth/auth-button";
import { SiteHeader } from "@/components/layout/site-header";
import { returnBondContract } from "@/lib/web3/contract";

const steps = [
  {
    number: "01",
    icon: Handshake,
    title: "Agree on the loan",
    description:
      "The owner, borrower, and neutral arbiter are named in one onchain agreement.",
  },
  {
    number: "02",
    icon: KeyRound,
    title: "Lock the deposit",
    description:
      "The borrower funds the security deposit. It stays in the contract, not with the owner.",
  },
  {
    number: "03",
    icon: RotateCcw,
    title: "Return and settle",
    description:
      "A successful return releases the deposit. A neutral arbiter only steps in for disputes.",
  },
];

export default function Home() {
  return (
    <div className="app-frame">
      <SiteHeader actions={<AuthButton />} />

      <main>
        <section className="hero site-shell">
          <div className="hero-copy">
            <p className="eyebrow">A safer way to lend everyday things</p>
            <h1>Lend things without awkward trust.</h1>
            <p className="hero-lede">
              ReturnBond protects everyday item loans with an onchain security
              deposit. The owner never holds the borrower&apos;s deposit. The
              borrower can recover it after the return is confirmed, or once the
              inspection window closes without a claim.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/dashboard">
                Open dashboard
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <a
                className="text-link"
                href={returnBondContract.explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                View verified contract
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
            </div>
            <div className="plain-language-note">
              <ShieldCheck aria-hidden="true" size={20} />
              <p>
                The contract follows the agreed rules automatically. No one can
                quietly move the deposit outside the loan lifecycle.
              </p>
            </div>
          </div>

          <div className="checkout-card" aria-label="How a ReturnBond loan works">
            <div className="checkout-card-top">
              <span>RETURNBOND</span>
              <span>LOAN CHECKOUT</span>
            </div>
            <div className="checkout-title-row">
              <div>
                <span className="field-label">Record type</span>
                <strong>Item loan</strong>
              </div>
              <span className="checkout-stamp">PROTECTED</span>
            </div>
            <div className="checkout-lines">
              <div>
                <span>Deposit holder</span>
                <strong>Onchain contract</strong>
              </div>
              <div>
                <span>Network</span>
                <strong>Monad Testnet</strong>
              </div>
              <div>
                <span>Settlement</span>
                <strong>Return or resolve</strong>
              </div>
            </div>
            <div className="checkout-footer">
              <Check aria-hidden="true" size={18} />
              <span>Clear roles. Clear deadlines. One deposit.</span>
            </div>
          </div>
        </section>

        <section className="process-section" aria-labelledby="process-title">
          <div className="site-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">The practical flow</p>
                <h2 id="process-title">A loan that leaves a clear receipt.</h2>
              </div>
              <p>
                ReturnBond makes the deposit rules visible before anyone hands
                over an item.
              </p>
            </div>
            <ol className="process-list">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.number}>
                    <span className="step-number">{step.number}</span>
                    <Icon aria-hidden="true" size={22} />
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="proof-section site-shell" aria-labelledby="proof-title">
          <div>
            <p className="eyebrow">Open by design</p>
            <h2 id="proof-title">The deposit rules are public.</h2>
          </div>
          <p>
            ReturnBond runs on Monad Testnet. Anyone can inspect the verified
            contract and confirm the code behind the agreement lifecycle.
          </p>
          <a
            className="button button-secondary"
            href={returnBondContract.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            MonadVision record
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell">
          <span>ReturnBond</span>
          <span>Built for careful lending on Monad Testnet.</span>
        </div>
      </footer>
    </div>
  );
}
