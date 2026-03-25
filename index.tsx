
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ClerkProvider } from "@clerk/clerk-react";

declare const __CLERK_PUBLISHABLE_KEY__: string;

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


// PUBLISHABLE KEY
// First preference: Vite-injected public env.
// Fallback: build-time define from either VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY.
const HARDCODED_LIVE_KEY_FALLBACK = "pk_live_Y2xlcmsuc2xhdGVzaW0uY29tJA";
const ENV_KEY = (
  (import.meta as any)?.env?.VITE_CLERK_PUBLISHABLE_KEY ||
  (typeof __CLERK_PUBLISHABLE_KEY__ !== 'undefined' ? __CLERK_PUBLISHABLE_KEY__ : "") ||
  HARDCODED_LIVE_KEY_FALLBACK
).trim();

const IS_PROD = Boolean((import.meta as any)?.env?.PROD);
const ALLOW_TEST_KEY = String((import.meta as any)?.env?.VITE_ALLOW_TEST_CLERK_KEY || '').toLowerCase() === 'true';
const PUBLISHABLE_KEY = ENV_KEY;
const CONFIG_ERROR =
  !PUBLISHABLE_KEY || PUBLISHABLE_KEY.includes('REPLACE_ME')
    ? "Missing Clerk key. Set VITE_CLERK_PUBLISHABLE_KEY (or CLERK_PUBLISHABLE_KEY in your build env)."
    : (PUBLISHABLE_KEY.startsWith('pk_test_') && (IS_PROD || !ALLOW_TEST_KEY)
      ? "This deployment is using a Clerk test key. Set VITE_CLERK_PUBLISHABLE_KEY (or CLERK_PUBLISHABLE_KEY) to your pk_live_ key."
      : "");

if (typeof window !== 'undefined') {
  (window as any).__SLATESIM_AUTH_KEY_MODE__ =
    !PUBLISHABLE_KEY ? 'missing'
    : PUBLISHABLE_KEY.startsWith('pk_live_') ? 'live'
    : PUBLISHABLE_KEY.startsWith('pk_test_') ? 'test'
    : 'unknown';
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

if (CONFIG_ERROR) {
  root.render(
    <React.StrictMode>
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f1ea",
        color: "#1a1c1e",
        fontFamily: "Inter, sans-serif",
        padding: "24px",
      }}>
        <div style={{
          maxWidth: "680px",
          width: "100%",
          background: "white",
          border: "1px solid rgba(26,28,30,0.15)",
          borderRadius: "6px",
          padding: "20px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}>
          <h1 style={{ margin: "0 0 10px", fontSize: "18px", fontWeight: 800 }}>Authentication Configuration Required</h1>
          <p style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.5 }}>{CONFIG_ERROR}</p>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5 }}>
            For production deploys, set <code>VITE_CLERK_PUBLISHABLE_KEY</code> (or <code>CLERK_PUBLISHABLE_KEY</code>) to your <code>pk_live_...</code> key in your environment variables.
          </p>
        </div>
      </div>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        // Use breakout handler for all Clerk navigations
        routerPush={(to) => handleNavigation(to)}
        routerReplace={(to) => handleNavigation(to)}
        // Redirect behavior
        signInFallbackRedirectUrl={SAFE_DEFAULT_URL}
        signUpFallbackRedirectUrl={normalizeRedirect('/pricing')}
      >
        <App />
      </ClerkProvider>
    </React.StrictMode>
  );
}
