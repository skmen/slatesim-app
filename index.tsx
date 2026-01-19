import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from "@clerk/clerk-react";

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/**
 * Robust lookup for Clerk Publishable Key across different environments.
 * Checks process.env (Node/Vite/Deno), import.meta.env (Vite), and window (Browser Global).
 */
const getPublishableKey = (): string => {
  const keyName = 'VITE_CLERK_PUBLISHABLE_KEY';
  const fallbackKeyName = 'CLERK_PUBLISHABLE_KEY';

  const envKey = (typeof process !== 'undefined' ? process.env?.[keyName] : undefined) ||
                 (typeof process !== 'undefined' ? process.env?.[fallbackKeyName] : undefined) ||
                 (import.meta as any).env?.[keyName] ||
                 (import.meta as any).env?.[fallbackKeyName] ||
                 (window as any)?.[keyName] ||
                 "";

  return envKey;
};

const PUBLISHABLE_KEY = getPublishableKey();

if (!PUBLISHABLE_KEY) {
  console.warn(
    "Clerk Publishable Key is missing. Please set VITE_CLERK_PUBLISHABLE_KEY in your environment variables. " +
    "Authentication features will be disabled until a valid key is provided."
  );
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* 
      We wrap the app even if the key is missing to allow the UI to render. 
      Clerk components will handle missing keys gracefully or show internal errors.
    */}
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </React.StrictMode>
);