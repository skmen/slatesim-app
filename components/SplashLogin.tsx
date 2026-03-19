
import React from 'react';
import { SignInButton } from "@clerk/clerk-react";
import { LogIn, Cpu, BarChart2, Layers } from 'lucide-react';
import { SlateSimLogo } from './SlateSimLogo';
import { SportsBounceBackground } from './SportsBounceBackground';

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
  return (
    <div className="min-h-screen bg-vellum text-ink font-sans selection:bg-drafting-orange selection:text-white flex flex-col relative overflow-hidden">
      <SportsBounceBackground />
      <header className="fixed top-0 left-0 right-0 z-50 bg-vellum/80 backdrop-blur-md border-b border-ink/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlateSimLogo />
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/preview"
              className="px-4 py-2 border border-ink/20 hover:border-drafting-orange/40 text-ink text-xs font-black uppercase rounded-lg transition-colors"
            >
              Preview
            </a>
            <SignInButton mode="modal">
              <button className="px-4 py-2 bg-accent hover:opacity-90 text-black text-xs font-black uppercase rounded-lg transition-colors flex items-center gap-2">
                <LogIn className="w-4 h-4" /> Log In
              </button>
            </SignInButton>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-24 pb-12 relative z-10">
        <section className="text-center px-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            <span className="text-[10px] font-black text-accent uppercase tracking-widest">DFS research • backtests • data exports</span>
          </div>
          
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic">
            <span className="block">RESEARCH.</span>
            <span className="block">BACKTEST.</span>
            <span className="block">DEPLOY YOUR DFS EDGE.</span>
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-sm text-gray-700 font-mono leading-relaxed">
            Slate Sim is your workspace for DFS strategy design: run slate-level backtests, stress-test rules, and pull the data you need for your own entries and optimizers. NBA is live; MLB DFS is in the works.
          </p>

          <div className="mt-10 max-w-lg mx-auto bg-white p-6 border border-gray-200 rounded-2xl shadow-2xl">
            <h3 className="text-sm font-bold uppercase tracking-widest text-accent mb-4">Private Beta Closed</h3>
            <div className="w-full bg-accent/10 border border-accent/30 text-accent font-black py-3 rounded-lg text-center uppercase tracking-widest text-sm">
              SOFT LAUNCH COMING SOON
            </div>
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
      <footer className="pb-8 text-center relative z-10">
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
