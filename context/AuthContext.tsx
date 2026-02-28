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
  admin: ['run_sim', 'view_diagnostics', 'export_data', 'admin_panel', 'view_projections'],
  'beta-user': ['run_sim', 'view_diagnostics', 'export_data', 'view_projections'],
  user: ['view_projections', 'view_diagnostics']
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerkAuth();

  // Derive internal User object from Clerk metadata
  const internalUser = useMemo((): User | null => {
    if (!isLoaded || !isSignedIn || !clerkUser) return null;

    // We assume the role is stored in Clerk's publicMetadata via the Dashboard or API
    // Default to 'user' if no role is defined
    const role = (clerkUser.publicMetadata.role as Role) || 'user';
    
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