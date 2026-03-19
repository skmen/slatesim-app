import React from 'react';

const ArrowLeftIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-sm font-black uppercase tracking-widest text-ink">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-ink/80">{children}</div>
  </section>
);

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-vellum text-ink font-sans">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="mb-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-ink/70 hover:border-drafting-orange hover:text-drafting-orange transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </a>
        </div>

        <header className="space-y-3 mb-8">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-drafting-orange">Legal</p>
          <h1 className="text-3xl md:text-4xl font-black leading-tight">Terms of Service</h1>
          <p className="text-sm text-ink/70">Effective date: March 19, 2026</p>
        </header>

        <div className="space-y-8 rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <Section title="Acceptance Of Terms">
            <p>
              These Terms of Service govern your access to and use of SlateSim. By accessing or using the service, you agree to be bound by these Terms.
              If you do not agree, do not use SlateSim.
            </p>
          </Section>

          <Section title="Eligibility And Account Use">
            <p>You must be at least 18 years old to use SlateSim.</p>
            <p>Your account is for individual use only and may not be shared.</p>
            <p>
              You agree to provide accurate information, maintain account security, and notify us of unauthorized account activity.
            </p>
          </Section>

          <Section title="Permitted Use">
            <p>SlateSim is provided for personal, non-commercial use unless we provide written permission otherwise.</p>
            <p>
              You may not copy, scrape, reverse engineer, automate extraction, or redistribute content or data from the service without written consent.
            </p>
            <p>
              We may suspend or terminate access if we believe use violates these Terms, harms the service, or creates legal or security risk.
            </p>
          </Section>

          <Section title="Subscriptions And Billing">
            <p>
              SlateSim currently offers a Soft Launch membership tier with weekly billing processed through Lemon Squeezy.
            </p>
            <p>
              Subscriptions renew automatically unless canceled before the next billing date. You can cancel at any time and retain access through the end
              of your paid billing period.
            </p>
            <p>
              Except where required by law, fees are non-refundable and we do not provide prorated refunds for partial billing periods.
            </p>
            <p>
              We may change pricing, features, or subscription terms in the future. Any updates will apply prospectively as permitted by law.
            </p>
          </Section>

          <Section title="DFS And Educational Disclaimer">
            <p>
              SlateSim provides research tools, projections, and analytics for informational and educational use. Nothing on SlateSim is financial, legal,
              tax, or gambling advice.
            </p>
            <p>
              We do not guarantee outcomes, winnings, profitability, or model accuracy. You are solely responsible for your lineup decisions and contest entries.
            </p>
            <p>Use of daily fantasy sports may involve financial risk. Please play responsibly and comply with all laws applicable to you.</p>
          </Section>

          <Section title="Intellectual Property">
            <p>
              SlateSim, including software, design, branding, and content (excluding third-party data providers’ rights), is protected by intellectual property laws.
            </p>
            <p>
              These Terms grant a limited, revocable, non-transferable license to use the service in accordance with these Terms and do not transfer ownership rights.
            </p>
          </Section>

          <Section title="Disclaimer Of Warranties">
            <p>
              THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS. TO THE MAXIMUM EXTENT PERMITTED BY LAW, SLATESIM DISCLAIMS ALL WARRANTIES,
              EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
          </Section>

          <Section title="Limitation Of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SLATESIM AND ITS AFFILIATES WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
              OR FOR LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE.
            </p>
          </Section>

          <Section title="Indemnification">
            <p>
              You agree to defend, indemnify, and hold harmless SlateSim and its affiliates, officers, and team members from claims, liabilities, damages, losses,
              and expenses (including reasonable attorneys’ fees) arising out of your misuse of the service or your violation of these Terms.
            </p>
          </Section>

          <Section title="Dispute Resolution, Binding Arbitration, And Class-Action Waiver">
            <p>
              To the fullest extent permitted by law, any dispute, claim, or controversy arising out of or relating to these Terms or your use of SlateSim
              will be resolved by final and binding arbitration on an individual basis, rather than in court.
            </p>
            <p>
              You and SlateSim each waive the right to a trial by jury and waive the right to participate in any class action, class arbitration,
              representative action, or consolidated proceeding.
            </p>
            <p>
              Arbitration will be administered by a mutually agreed arbitration provider under its applicable rules, and the arbitration may be conducted
              remotely unless otherwise required by law.
            </p>
            <p>
              If the class-action waiver or arbitration requirement is found unenforceable for a particular claim, then that claim must be brought exclusively
              in the courts located in British Columbia, Canada, and you consent to personal jurisdiction in those courts.
            </p>
          </Section>

          <Section title="Governing Law">
            <p>
              These Terms are governed by and construed in accordance with the laws of British Columbia and the federal laws of Canada applicable therein,
              without regard to conflict-of-law principles.
            </p>
          </Section>

          <Section title="Changes To Terms">
            <p>
              We may update these Terms from time to time. Updated versions become effective when posted on this page unless otherwise stated.
              Continued use of SlateSim after changes are posted constitutes acceptance of the updated Terms.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For legal questions about these Terms, contact us at <a href="mailto:slatesiminfo@gmail.com" className="text-drafting-orange hover:underline">slatesiminfo@gmail.com</a>.
            </p>
          </Section>
        </div>
      </div>

      <footer className="pb-8 text-center">
        <a href="/terms" className="text-[11px] font-black uppercase tracking-widest text-ink/60 hover:text-drafting-orange transition-colors">
          Terms of Service
        </a>
      </footer>
    </div>
  );
};

export default TermsPage;
