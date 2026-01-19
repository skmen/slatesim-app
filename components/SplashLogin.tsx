
import React, { useState, FormEvent } from 'react';
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { LogIn, UserPlus, Cpu, BarChart2, Zap, Layers, Send, AlertTriangle, CheckCircle } from 'lucide-react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const Feature: React.FC<{ icon: React.ElementType, title: string, children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="flex flex-col items-center text-center p-6 bg-charcoal-card border border-gray-800 rounded-2xl">
    <div className="w-12 h-12 bg-brand/10 border border-brand/20 rounded-xl flex items-center justify-center mb-4 text-brand">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-2">{title}</h3>
    <p className="text-[11px] text-gray-500 leading-relaxed font-mono">
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
    <div className="min-h-screen bg-charcoal text-charcoal-text font-sans selection:bg-brand selection:text-charcoal">
      <header className="fixed top-0 left-0 right-0 z-50 bg-charcoal/80 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand p-1.5 rounded-lg"><Cpu className="w-5 h-5 text-charcoal" /></div>
            <h1 className="font-black text-xl tracking-tighter leading-none italic uppercase">SLATE<span className="text-brand">SIM</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <button className="px-4 py-2 text-charcoal-text text-xs font-bold uppercase hover:bg-white/5 rounded-lg transition-colors flex items-center gap-2">
                <LogIn className="w-4 h-4" /> Log In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-4 py-2 bg-brand hover:bg-brand-hover text-charcoal text-xs font-black uppercase rounded-lg transition-colors flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Sign Up
              </button>
            </SignUpButton>
          </div>
        </div>
      </header>

      <main className="pt-24 pb-12">
        <section className="text-center px-4">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic">
            Find Your <span className="text-brand terminal-glow">Winning Edge</span> in NBA DFS
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-sm text-gray-400 font-mono leading-relaxed">
            SlateSim is a professional analytics dashboard that runs thousands of simulations on your DFS lineups against the field, identifying high-leverage rosters and quantifying your actual win probability.
          </p>

          <div className="mt-10 max-w-lg mx-auto bg-charcoal-card p-6 border border-gray-800 rounded-2xl shadow-2xl">
            <h3 className="text-sm font-bold uppercase tracking-widest text-brand mb-4">Join the Private Beta</h3>
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
                className="w-full bg-charcoal border border-gray-700 rounded-lg px-4 py-3 text-xs font-bold text-white focus:border-brand outline-none transition-all placeholder:text-gray-600"
                disabled={status === 'submitting' || status === 'success'}
              />
              <button
                type="submit"
                className="w-full bg-brand hover:bg-brand-hover text-charcoal font-black py-3 rounded-lg shadow-lg shadow-brand/20 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={status === 'submitting' || status === 'success'}
              >
                {status === 'submitting' ? 'Submitting...' : 'Request Beta Access'}
                {status !== 'submitting' && <Send className="w-4 h-4" />}
              </button>
              <div className="h-5 text-xs font-bold font-mono uppercase tracking-widest">
                {status === 'success' && <p className="text-emerald-400 flex items-center justify-center gap-2 animate-in fade-in"><CheckCircle className="w-4 h-4"/>Thanks! We'll reach out soon.</p>}
                {status === 'error' && <p className="text-red-400 flex items-center justify-center gap-2 animate-in fade-in"><AlertTriangle className="w-4 h-4"/>{error}</p>}
              </div>
            </form>
          </div>
        </section>

        <section className="max-w-4xl mx-auto mt-20 px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Feature icon={Layers} title="Field Simulation">
              Test your lineups against thousands of simulated opponent rosters to see how they perform in a realistic contest environment.
            </Feature>
            <Feature icon={Zap} title="Leverage Analysis">
              Identify "chalky" players and discover high-leverage pivots that differentiate your rosters and increase your GPP upside.
            </Feature>
            <Feature icon={BarChart2} title="Quantify Win %">
              Move beyond simple projections. Our engine calculates your true probability of winning, cashing, or landing in the top 1%.
            </Feature>
          </div>
        </section>
      </main>
    </div>
  );
};
