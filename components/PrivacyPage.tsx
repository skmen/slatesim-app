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

export const PrivacyPage: React.FC = () => {
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
          <h1 className="text-3xl md:text-4xl font-black leading-tight">Privacy Policy</h1>
          <p className="text-sm text-ink/70">Effective date: March 19, 2026</p>
        </header>

        <div className="space-y-8 rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <Section title="What Information We Collect">
            <p>
              Registration information: when you create an account, we collect account details such as email address and account identifiers through our
              authentication provider.
            </p>
            <p>
              Subscription and billing information: if you subscribe, billing and payment data is collected and processed by our payment processor, Lemon Squeezy.
              We receive subscription status and transaction metadata needed to provide access.
            </p>
            <p>
              Product usage data: we may store preferences and product changes you make (for example, research settings, lineup workflow settings, and other
              saved adjustments) to preserve your experience across sessions.
            </p>
            <p>
              Service use data: we may log actions and events such as page views, feature usage, and request activity for analytics, reliability, and abuse prevention.
            </p>
            <p>
              Device and technical data: we may collect IP address, browser type, operating system, device characteristics, and referring URLs.
            </p>
          </Section>

          <Section title="How We Use Your Information">
            <p>To operate, maintain, and personalize SlateSim.</p>
            <p>To process subscriptions and manage account entitlements.</p>
            <p>To improve product quality, performance, and user experience.</p>
            <p>To send service-related communications, updates, and optional marketing messages.</p>
            <p>To detect, prevent, and investigate abuse, fraud, and Terms of Service violations.</p>
          </Section>

          <Section title="How We Protect Your Information">
            <p>
              We use reasonable administrative, technical, and organizational safeguards designed to protect your information, including encryption in transit where supported.
              No method of transmission or storage is completely secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="Payments">
            <p>
              Subscription billing is processed by Lemon Squeezy, a third-party payment provider. Payment card details are handled by Lemon Squeezy and are not stored
              directly on SlateSim servers.
            </p>
          </Section>

          <Section title="Sharing And Disclosure">
            <p>
              We may share information with trusted service providers that support hosting, analytics, authentication, billing, customer support, and operations.
              These providers are expected to protect information and use it only for contracted purposes.
            </p>
            <p>
              We may disclose information when required by law, legal process, or to protect rights, safety, security, and platform integrity.
            </p>
          </Section>

          <Section title="Cookies And Similar Technologies">
            <p>
              We use cookies and similar technologies to authenticate users, maintain sessions, store preferences, and improve functionality.
              You can manage cookies through browser settings, though disabling cookies may affect functionality.
            </p>
          </Section>

          <Section title="Data Retention">
            <p>
              We retain personal information for as long as reasonably necessary to provide the service, comply with legal obligations, resolve disputes,
              enforce agreements, and maintain security.
            </p>
          </Section>

          <Section title="Account Deletion And Data Requests">
            <p>
              You can request account deletion or ask privacy-related questions by emailing
              {' '}
              <a href="mailto:info@slatesim.com" className="text-drafting-orange hover:underline">info@slatesim.com</a>.
              Some records may be retained where required by law or for legitimate business purposes.
            </p>
          </Section>

          <Section title="Email Preferences">
            <p>
              You can opt out of non-essential marketing emails using the unsubscribe link in those emails. We may still send essential service and account communications.
            </p>
          </Section>

          <Section title="Children">
            <p>SlateSim is intended only for users age 18 or older.</p>
          </Section>

          <Section title="Changes To This Policy">
            <p>
              We may update this Privacy Policy from time to time. Updated versions become effective when posted on this page unless otherwise stated.
              Your continued use of SlateSim after updates are posted constitutes acceptance of the revised policy.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              If you have questions about this Privacy Policy, contact us at
              {' '}
              <a href="mailto:info@slatesim.com" className="text-drafting-orange hover:underline">info@slatesim.com</a>.
            </p>
          </Section>
        </div>
      </div>

      <footer className="pb-8 text-center">
        <div className="flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest">
          <a href="/terms" className="text-ink/60 hover:text-drafting-orange transition-colors">
            Terms of Service
          </a>
          <span className="text-ink/40">|</span>
          <a href="/privacy" className="text-ink/60 hover:text-drafting-orange transition-colors">
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
};

export default PrivacyPage;
