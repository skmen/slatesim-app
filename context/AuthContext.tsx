import React, { createContext, useContext, useMemo } from 'react';
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { User, Role, Entitlement } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  hasEntitlement: (capability: Entitlement) => boolean;
  logout: () => void;
}

const ROLE_PERMISSIONS: Record<Role, Entitlement[]> = {
  admin: [
    'run_sim',
    'view_diagnostics',
    'export_data',
    'admin_panel',
    'view_projections',
    'full_research_tools',
    'access_compare',
    'access_optimizer',
    'access_entries',
    'access_report',
  ],
  'beta-user': [
    'run_sim',
    'view_diagnostics',
    'export_data',
    'view_projections',
    'full_research_tools',
    'access_compare',
    'access_optimizer',
    'access_entries',
    'access_report',
  ],
  'soft-launch': [
    'run_sim',
    'view_diagnostics',
    'export_data',
    'view_projections',
    'full_research_tools',
    'access_compare',
    'access_optimizer',
    'access_entries',
    'access_report',
  ],
  user: ['view_projections', 'view_diagnostics']
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerkAuth();

  // Derive internal User object from Clerk metadata
  const internalUser = useMemo((): User | null => {
    if (!isLoaded || !isSignedIn || !clerkUser) return null;

    const metadata = (clerkUser.publicMetadata || {}) as Record<string, any>;
    const metadataRole = metadata.role as Role | undefined;
    const subscriptionStatus = String(
      metadata.subscriptionStatus ??
      metadata.lemonSubscriptionStatus ??
      metadata.billingStatus ??
      ''
    ).toLowerCase();
    const softLaunchActive = Boolean(
      metadata.softLaunchActive === true
      || metadata.isPaidSubscriber === true
      || ['active', 'on_trial', 'trialing', 'past_due'].includes(subscriptionStatus)
    );

    // Admin always wins. Otherwise, infer role from billing status if present.
    let role: Role = metadataRole || 'user';
    if (role !== 'admin') {
      if (softLaunchActive) {
        role = 'soft-launch';
      } else if (role === 'soft-launch') {
        role = 'user';
      }
    }
    
    return {
      username: clerkUser.username || clerkUser.primaryEmailAddress?.emailAddress || 'Sim_User',
      role,
      entitlements: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['user']
    };
  }, [isLoaded, isSignedIn, clerkUser]);

  const hasEntitlement = (capability: Entitlement): boolean => {
    return internalUser?.entitlements.includes(capability) || false;
  };

  const logout = () => {
    signOut();
  };

  return (
    <AuthContext.Provider value={{ 
      user: internalUser, 
      isLoading: !isLoaded, 
      hasEntitlement,
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
