
import React, { useState, FormEvent } from 'react';
import { SignInButton } from "@clerk/clerk-react";
import { LogIn, Cpu, BarChart2, Layers, Send, AlertTriangle, CheckCircle } from 'lucide-react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const Feature: React.FC<{ icon: React.ElementType, title: string, children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="flex flex-col items-center text-center p-6 bg-white border border-gray-200 rounded-2xl shadow-sm">
    <div className="w-12 h-12 bg-brand/10 border border-brand/20 rounded-xl flex items-center justify-center mb-4 text-brand">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-sm font-bold uppercase tracking-widest text-black mb-2">{title}</h3>
    <p className="text-[11px] text-gray-700 leading-relaxed font-mono">
      {children}
    </p>
  </div>
);

export const SplashLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'submitting' || status === 'success') return;

    // Honeypot check for bots
    if (honeypot) return;

    // Basic email validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('error');
      setError('Please enter a valid email address.');
      return;
    }

    setStatus('submitting');
    setError('');

    try {
      const response = await fetch('/api/beta-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'splash', ts: Date.now() }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok.');
      }
      
      setStatus('success');
      setTimeout(() => setStatus('idle'), 30000); // Cooldown period

    } catch (err) {
      setStatus('error');
      setError('Could not submit. Please try again later.');
    }
  };

  return (
    <div className="min-h-screen bg-vellum text-ink font-sans selection:bg-drafting-orange selection:text-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-vellum/80 backdrop-blur-md border-b border-ink/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-accent p-1.5 rounded-lg"><Cpu className="w-5 h-5 text-black" /></div>
            <h1 className="font-black text-xl tracking-tighter leading-none italic uppercase">SLATE<span className="text-accent"> SIM</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <button className="px-4 py-2 bg-accent hover:opacity-90 text-black text-xs font-black uppercase rounded-lg transition-colors flex items-center gap-2">
                <LogIn className="w-4 h-4" /> Log In
              </button>
            </SignInButton>
          </div>
        </div>
      </header>

      <main className="pt-24 pb-12">
        <section className="text-center px-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            <span className="text-[10px] font-black text-accent uppercase tracking-widest">DFS research • backtests • data exports</span>
          </div>
          
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic">
            Research. Backtest. Deploy your DFS edge.
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-sm text-gray-700 font-mono leading-relaxed">
            Slate Sim is your workspace for DFS strategy design: run slate-level backtests, stress-test rules, and pull the data you need for your own entries and optimizers. NBA is live; MLB DFS is in the works.
          </p>

          <div className="mt-10 max-w-lg mx-auto bg-white p-6 border border-gray-200 rounded-2xl shadow-2xl">
            <h3 className="text-sm font-bold uppercase tracking-widest text-accent mb-4">Join the Private Beta</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input 
                type="hidden" 
                name="honeypot" 
                value={honeypot} 
                onChange={(e) => setHoneypot(e.target.value)} 
                style={{ display: 'none' }}
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address..."
                className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-xs font-bold text-black focus:border-accent outline-none transition-all placeholder:text-gray-500"
                disabled={status === 'submitting' || status === 'success'}
              />
              <button
                type="submit"
                className="w-full bg-accent hover:opacity-90 text-black font-black py-3 rounded-lg shadow-lg shadow-accent/20 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={status === 'submitting' || status === 'success'}
              >
                {status === 'submitting' ? 'Submitting...' : 'Request Beta Access'}
                {status !== 'submitting' && <Send className="w-4 h-4" />}
              </button>
              <div className="h-5 text-xs font-bold font-mono uppercase tracking-widest">
                {status === 'success' && <p className="text-boom flex items-center justify-center gap-2 animate-in fade-in"><CheckCircle className="w-4 h-4"/>Thanks! We'll reach out soon.</p>}
                {status === 'error' && <p className="text-bust flex items-center justify-center gap-2 animate-in fade-in"><AlertTriangle className="w-4 h-4"/>{error}</p>}
              </div>
            </form>
          </div>
        </section>

        <section className="max-w-4xl mx-auto mt-20 px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Feature icon={Layers} title="Backtesting Engine">
              Replay slates with historical salaries, ownership, and outcomes to validate rules before they touch live contests.
            </Feature>
            <Feature icon={BarChart2} title="Research Lab">
              Surface stackable plays, fades, and correlation clusters with dense positional and matchup context.
            </Feature>
            <Feature icon={Cpu} title="Exportable Data">
              Download projection sets and player pools to feed your own builders and entry flows.
            </Feature>
          </div>
        </section>
      </main>
    </div>
  );
};
