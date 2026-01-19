import React, { useState, useEffect } from 'react';
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { Lock, LogIn, Cpu, UserPlus } from 'lucide-react';

export const SplashLogin: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2800);
    return () => clearTimeout(timer);
  }, []);

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-[200] bg-charcoal flex flex-col items-center justify-center text-white overflow-hidden">
        <div className="relative animate-in zoom-in duration-700">
          <div className="bg-brand p-4 rounded-3xl shadow-2xl shadow-brand/20 mb-8 animate-pulse">
            <Cpu className="w-16 h-16 text-charcoal" />
          </div>
        </div>
        
        <div className="text-center space-y-4 animate-in slide-in-from-bottom-8 duration-1000">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic">
            SLATE<span className="text-brand">SIM</span>
          </h1>
          <div className="flex flex-col items-center gap-2">
            <p className="text-brand font-bold tracking-[0.2em] uppercase text-sm md:text-lg">
              Welcome to SlateSim Engine
            </p>
            <div className="h-1 w-24 bg-brand/20 rounded-full overflow-hidden">
              <div className="h-full bg-brand w-1/2 animate-[progress_2s_ease-in-out_infinite]" />
            </div>
          </div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-widest mt-8 opacity-60">
            Initializing Simulation Core v4.0.7
          </p>
        </div>

        <style>{`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(250%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center p-4 selection:bg-brand selection:text-charcoal">
      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
        <div className="bg-charcoal-card border border-gray-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-10">
            <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-brand" />
            </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">System Initialization</h2>
            <p className="text-gray-500 text-sm font-medium mt-1 uppercase tracking-widest">Secure Cloud Gateway</p>
          </div>

          <div className="space-y-4">
            <SignInButton mode="modal">
              <button className="w-full bg-brand hover:bg-brand-hover text-charcoal font-black py-4 rounded-xl shadow-lg shadow-brand/20 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-sm">
                <LogIn className="w-5 h-5" />
                Initialize Session
              </button>
            </SignInButton>

            <SignUpButton mode="modal">
              <button className="w-full bg-charcoal border border-gray-700 hover:bg-gray-800 text-gray-300 font-black py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-sm">
                <UserPlus className="w-5 h-5" />
                Request Protocol Access
              </button>
            </SignUpButton>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-800 text-center">
            <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">
              SlateSim Integrity Protocol Active
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};