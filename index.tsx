
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from "@clerk/clerk-react";

/**
 * 1. DEFINE URL CONTEXT
 * Resolves the correct application entry URL, which is crucial in sandboxed
 * environments like AI Studio where the app lives under a long path.
 */
const META_URL = (() => { try { return new URL(import.meta.url); } catch { return null; } })();
const META_ORIGIN = META_URL?.origin || "";
const META_DIR_URL = (() => {
  if (!META_URL) return "";
  const p = META_URL.pathname;
  // Get the directory containing the module (e.g., /.../app/index.tsx -> /.../app/)
  const dir = p.endsWith("/") ? p : p.replace(/\/[^\/]*$/, "/");
  return META_URL.origin + dir;
})();

const CURRENT_APP_ORIGIN =
  (window as any).__APP_ORIGIN__ ||
  (window.location.origin && window.location.origin !== "null" && !window.location.origin.startsWith("blob"))
    ? window.location.origin
    : (META_ORIGIN || "https://aistudio.google.com");

// Canonical URL is derived from the module's path, which is reliable in AI Studio.
const CANONICAL_APP_URL = META_DIR_URL || (CURRENT_APP_ORIGIN + "/");

// Fallback URL logic: Prefer the canonical URL unless window.location.href is a valid, non-root app URL on the same host.
const SAFE_DEFAULT_URL = (() => {
  if (typeof window.location.href === "string" && window.location.href.startsWith("http")) {
    try {
      const u = new URL(window.location.href);
      const isSameOrigin = u.origin === META_ORIGIN;
      const isUserContent = u.hostname.includes("usercontent.goog");
      if ((isSameOrigin || isUserContent) && u.pathname !== "/") {
        return window.location.href;
      }
    } catch (e) { /* fall through to canonical */ }
  }
  return CANONICAL_APP_URL;
})();

// PUBLISHABLE KEY - Sourced from env, with a fallback for AI Studio
const ENV_KEY =
  (import.meta as any)?.env?.VITE_CLERK_PUBLISHABLE_KEY ||
  (globalThis as any)?.VITE_CLERK_PUBLISHABLE_KEY ||
  "";

const PUBLISHABLE_KEY = ENV_KEY || "pk_test_bG92ZWQtY291Z2FyLTYuY2xlcmsuYWNjb3VudHMuZGV2JA";

if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.includes('REPLACE_ME')) {
  throw new Error("Missing Clerk Publishable Key. Set VITE_CLERK_PUBLISHABLE_KEY in your environment or provide a valid fallback.");
}

/**
 * 2. REDIRECT & NAVIGATION HELPERS
 */

const isNonNavigationTarget = (to: string): boolean => {
  const s = (to || "").trim();
  if (!s) return false;
  // Block obvious non-routes / data payloads.
  if (s.startsWith("data:") || s.startsWith("blob:")) return true;
  if (s.startsWith("javascript:")) return true;
  if (s.includes("application/javascript")) return true;
  if (s.includes("base64,")) return true;
  // Block raw mime-type-ish strings that are not full URLs.
  if (/^[a-zA-Z]+\/[a-zA-Z0-9.+-]+/.test(s) && !s.startsWith("http")) return true;
  return false;
};

const normalizeRedirect = (to: string): string => {
  if (isNonNavigationTarget(to)) return SAFE_DEFAULT_URL;
  
  // Default to the safe entry URL to preserve the full path.
  if (!to || to === "/") return SAFE_DEFAULT_URL;
  
  // Handle root-relative paths by joining with our current origin, but avoid root path.
  if (to.startsWith("/")) {
    const result = CURRENT_APP_ORIGIN + to;
    if (result === CURRENT_APP_ORIGIN + "/") {
        return SAFE_DEFAULT_URL;
    }
    return result;
  }
  
  try {
    // Parse all other paths against the canonical app URL to handle relative paths correctly.
    const u = new URL(to, CANONICAL_APP_URL);
    
    // Rewrite localhost, blob, or null origins
    if (u.hostname === "localhost" || u.protocol === "blob:" || u.origin === "null") {
      const path = u.pathname.startsWith("/") ? u.pathname : ("/" + u.pathname);
      return CURRENT_APP_ORIGIN + path + u.search + u.hash;
    }
    
    // Prevent navigating to a different origin than the app's host
    if (u.origin !== CURRENT_APP_ORIGIN && !u.href.includes('clerk')) {
      return SAFE_DEFAULT_URL;
    }
    
    return u.href;
  } catch (e) {
    // If URL parsing fails for any reason, fall back to the safe entry URL
    return SAFE_DEFAULT_URL;
  }
};

// Helper function to safely get origin from a URL string
function safeOrigin(href: string): string {
  try {
    return new URL(href).origin;
  } catch (e) {
    return "";
  }
}

/**
 * 3. NAVIGATION INTERCEPTOR (IFRAME BREAKOUT)
 * Determines if navigation should happen in-frame or via top-level breakout.
 * Same-origin (usercontent.goog) navigations must stay inside iframe; only
 * aistudio.google.com or other cross-origin destinations require breakout.
 */
const handleNavigation = (to: string) => {
  // CRITICAL: Block navigation to non-URL targets like data URIs.
  if (isNonNavigationTarget(to)) {
    console.log("Ignoring non-navigation target:", to.slice(0, 80));
    return;
  }

  if (to.includes('CLERK-ROUTER') || to.includes('/v1/')) return;

  const target = normalizeRedirect(to);
  
  try {
    const current = normalizeRedirect(window.location.href);
    if (current === target) return;
  } catch (e) { /* ignore security errors on window.location */ }

  const inFrame = window.top && window.top !== window.self;
  const targetOrigin = safeOrigin(target);
  const isSameOrigin = targetOrigin && (targetOrigin === CURRENT_APP_ORIGIN);

  if (isSameOrigin) {
    console.log("Navigating within frame (same-origin):", target);
    window.location.assign(target);
    return;
  }
  
  // Cross-origin navigation requires breakout
  console.log("Hard redirecting (cross-origin):", target);
  if (inFrame) {
    try {
      window.top!.location.assign(target);
    } catch (e) {
      // Fallback for sandboxed frames, with a guard to prevent popup loops.
      const key = "__slatesim_clerk_popup_once__";
      if (sessionStorage.getItem(key) === "1") {
        console.warn("Popup blocked to prevent loop.");
        return;
      }
      sessionStorage.setItem(key, "1");
      window.open(target, "_blank", "noopener,noreferrer");
    }
  } else {
    window.location.assign(target);
  }
};


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY}
      // Use breakout handler for all Clerk navigations
      routerPush={(to) => handleNavigation(to)}
      routerReplace={(to) => handleNavigation(to)}
      // CRITICAL: Point redirects to the full app URL including the pathname
      afterSignInUrl={SAFE_DEFAULT_URL}
      afterSignUpUrl={SAFE_DEFAULT_URL}
      signInFallbackRedirectUrl={SAFE_DEFAULT_URL}
      signUpFallbackRedirectUrl={SAFE_DEFAULT_URL}
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
