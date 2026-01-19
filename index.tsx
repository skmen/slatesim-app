
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

// HARDCODED KEY
const PUBLISHABLE_KEY = "pk_test_bG92ZWQtY291Z2FyLTYuY2xlcmsuYWNjb3VudHMuZGV2JA";

// --- SHIMS START ---

/**
 * A. WORKER SHIM
 * Essential for sandboxed environments that block Web Workers via CSP.
 */
class MockWorker {
  onmessage = null;
  onmessageerror = null;
  onerror = null;
  constructor(stringUrl: string | URL, options?: WorkerOptions) { 
    console.log("MockWorker initialized"); 
  }
  postMessage(msg: any) { return; }
  terminate() { return; }
  addEventListener() { return; }
  removeEventListener() { return; }
  dispatchEvent() { return true; }
}
// @ts-ignore
window.Worker = MockWorker;
// @ts-ignore
globalThis.Worker = MockWorker;

/**
 * B. URL SHIM
 * Prevents "URL constructor" crashes in restricted origins.
 * Ensures relative URLs resolve against the dynamic CURRENT_APP_ORIGIN.
 */
const NativeURL = window.URL;
// @ts-ignore
window.URL = function(url: string | URL, base?: string | URL) {
  let finalBase = base;
  if (!finalBase && typeof url === 'string' && (url.startsWith('/') || !url.includes(':'))) {
    finalBase = CURRENT_APP_ORIGIN;
  }

  try {
    const u = new NativeURL(url, finalBase || CURRENT_APP_ORIGIN);
    if (u.origin === "null" || u.protocol === "blob:" || u.hostname === "localhost") {
      return new NativeURL(u.pathname + u.search + u.hash, CURRENT_APP_ORIGIN);
    }
    return u;
  } catch (e) {
    return new NativeURL("/", CURRENT_APP_ORIGIN); 
  }
} as any;

window.URL.prototype = NativeURL.prototype;
Object.getOwnPropertyNames(NativeURL).forEach(prop => {
  if (prop !== 'prototype' && prop !== 'name' && prop !== 'length') {
    try {
      // @ts-ignore
      window.URL[prop] = NativeURL[prop];
    } catch (e) {}
  }
});
// --- SHIM END ---

/**
 * 2. REDIRECT NORMALIZATION
 * Ensures all navigations stay within the valid AI Studio host and preserve full path.
 */
const normalizeRedirect = (to: string): string => {
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
      return CURRENT_APP_ORIGIN + u.pathname + u.search + u.hash;
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
