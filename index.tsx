import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from "@clerk/clerk-react";

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const getPublishableKey = (): string => {
  const key = process.env.VITE_CLERK_PUBLISHABLE_KEY || 
              process.env.CLERK_PUBLISHABLE_KEY || 
              "pk_test_bG92ZWQtY291Z2FyLTYuY2xlcmsuYWNjb3VudHMuZGV2JA";
  return key;
};

const PUBLISHABLE_KEY = getPublishableKey();

/**
 * Normalizes navigation to prevent Clerk from breaking out of current context.
 */
const safeNavigate = (to: string, replace = false) => {
  if (to.includes('CLERK-ROUTER')) return;
  
  try {
    const target = new URL(to, window.location.href).href;
    if (replace) {
      window.location.replace(target);
    } else {
      window.location.href = target;
    }
  } catch (e) {
    window.location.reload();
  }
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => safeNavigate(to, false)}
      routerReplace={(to) => safeNavigate(to, true)}
      signInForceRedirectUrl="/"
      signUpForceRedirectUrl="/"
      afterSignOutUrl="/"
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
);