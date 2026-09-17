import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { type User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { supabase } from '../supabase';
import { syncUser, updateMyProfile, uploadImage, syncInstagram, deleteMyAccount } from '../api';
import api from '../api/client';
import { socketService } from '../api/socket';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

WebBrowser.maybeCompleteAuthSession();

// Configure Google Sign-In for native
GoogleSignin.configure({
  webClientId: '943950919478-l56meupro3lo2lsuq7lk84021bmm464l.apps.googleusercontent.com',
  iosClientId: '943950919478-qdt1laap0hufg4f5cdh5vhkv7b75f48h.apps.googleusercontent.com',
  scopes: ['profile', 'email'],
});

// Onboarding data shape
export interface OnboardingData {
  currentStep: string;
  role: 'Brand' | 'Influencer' | null;
  name: string;
  dob: string;
  gender: string;
  platforms: string[];
  categories: string[];
  location: { name: string; lat: number; lng: number } | null;
  bio: string;
  instagramUsername?: string;
  photos: string[];
  packages: any[];
  // Brand-specific
  logo: string;
  campaigns: string[];
  website?: string;
}

const DEFAULT_ONBOARDING: OnboardingData = {
  currentStep: 'role_selection',
  role: null,
  name: '',
  dob: '',
  gender: '',
  platforms: [],
  categories: [],
  location: null,
  bio: '',
  photos: [],
  packages: [],
  logo: '',
  campaigns: [],
  website: '',
};

interface AuthContextType {
  user: User | null;
  loading: boolean;
  onboardingData: OnboardingData | null;
  onboardingComplete: boolean;
  userDataError: string | null;
  retryUserData: () => Promise<void>;
  // Auth methods
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithLinkedIn: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  // Email verification methods
  verifyOtpCode: (email: string, otp: string) => Promise<void>;
  resendOtp: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  // Onboarding methods
  updateOnboarding: (data: Partial<OnboardingData>) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  // Set when the user's backend state couldn't be loaded. Routing must wait on a
  // retry rather than guess, or a transient error looks like lost progress.
  const [userDataError, setUserDataError] = useState<string | null>(null);

  const fetchUserDataPromise = useRef<Promise<void> | null>(null);
  // Onboarding saves fire on every field change, so warn at most once per run.
  const progressSaveWarned = useRef(false);

  // Listen to auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // ── Safe startup token diagnostics (never logs the actual token) ──
      const _t = session?.access_token ?? null;
      console.log(
        '[AuthContext Startup Debug]',
        `sessionExists=${!!session}`,
        `accessTokenExists=${!!_t}`,
        `tokenType=${_t !== null ? typeof _t : 'null'}`,
        `tokenLength=${_t?.length ?? 0}`,
        `jwtPartCount=${_t ? _t.split('.').length : 0}`,
      );
      // ──────────────────────────────────────────────────────────
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log(`[AuthContext] onAuthStateChange event: ${_event}`);

      // ── Safe auth state change token diagnostics (never logs the actual token) ──
      const _t2 = session?.access_token ?? null;
      console.log(
        '[AuthContext Auth State Debug]',
        `event=${_event}`,
        `sessionExists=${!!session}`,
        `accessTokenExists=${!!_t2}`,
        `tokenType=${_t2 !== null ? typeof _t2 : 'null'}`,
        `tokenLength=${_t2?.length ?? 0}`,
        `jwtPartCount=${_t2 ? _t2.split('.').length : 0}`,
      );
      // ──────────────────────────────────────────────────────────────────────

      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        // Connect globally so banners and notifications work everywhere
        socketService.connect();

        // Fix 3: Update socket token on every auth state change (handles hourly JWT refresh)
        if (session?.access_token) {
          socketService.updateToken(session.access_token);
        }
        await fetchUserData(currentUser);
      } else {
        // Disconnect socket on sign-out
        socketService.disconnect();
        setOnboardingData(null);
        setOnboardingComplete(false);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserData = async (currentUser: User) => {
    if (fetchUserDataPromise.current) {
      console.log('[Startup] fetchUserData already in progress. Waiting...');
      return fetchUserDataPromise.current;
    }

    fetchUserDataPromise.current = (async () => {
      try {
        setUserDataError(null);
        console.log('[Startup] Fetching user data and onboarding progress...');
        // Fetch user profile and onboarding state from Backend
        const [dbUser, onboardingProgress] = await Promise.all([
          api.get<any>('/api/auth/me').catch((e) => {
            const status = e?.status ?? e?.response?.status;
            if (status === 403 || status === 404) return null; // Expected if user just signed up and has no DB record yet
            throw e; // Bubble up true network errors
          }),
          api.get<any>('/api/auth/onboarding').catch((e) => {
            const status = e?.status ?? e?.response?.status;
            if (status === 403 || status === 404) return null;
            throw e;
          })
        ]);

        console.log('[Startup] DB User fetched:', !!dbUser);
        console.log('[Startup] Onboarding progress fetched:', !!onboardingProgress);

        if (dbUser) {
          setOnboardingComplete(!!dbUser.role);
        } else {
          setOnboardingComplete(false);
        }

        if (onboardingProgress && Object.keys(onboardingProgress).length > 0) {
          setOnboardingData({ ...DEFAULT_ONBOARDING, ...onboardingProgress });
        } else {
          setOnboardingData({ ...DEFAULT_ONBOARDING });
        }
      } catch (error: any) {
        console.error('[Startup] Error fetching user data:', error);
        const status = error?.status ?? error?.response?.status;

        // Only a real auth rejection invalidates the session. Network failures
        // and server errors are transient — keep the session so a retry works
        // without forcing the user to sign in again.
        if (status === 401) {
          alert('Your session has expired. Please sign in again.');
          await supabase.auth.signOut();
        } else {
          setUserDataError(
            status === 429
              ? 'Too many requests. Please wait a moment and try again.'
              : 'Could not connect to servers. Please check your connection and try again.',
          );
        }
      } finally {
        console.log('[Startup] Finished fetching user data. Setting loading=false');
        setLoading(false);
        fetchUserDataPromise.current = null;
      }
    })();

    return fetchUserDataPromise.current;
  };

  const retryUserData = async () => {
    if (!user) return;
    setLoading(true);
    await fetchUserData(user);
  };

  // --- Auth methods ---

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  // Verify the 6-digit OTP code sent to the user's email after signup
  const verifyOtpCode = async (email: string, otp: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });
    if (error) throw error;
    // onAuthStateChange fires automatically on success, creating the session
  };

  // Resend the OTP verification email (e.g. if user didn't receive it)
  const resendOtp = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (error) throw error;
  };

  // Send a password reset link to the given email address
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const handleNativeOAuth = async (provider: 'google' | 'apple' | 'linkedin_oidc') => {
    const redirectUrl = makeRedirectUri();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      }
    });
    
    if (error) throw error;
    
    if (data?.url) {
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      if (res.type === 'success' && res.url) {
        const { params, errorCode } = QueryParams.getQueryParams(res.url);
        if (errorCode) throw new Error(errorCode);
        const { access_token, refresh_token } = params;
        if (access_token && refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (sessionError) throw sessionError;
        }
      }
    }
  };

  const signInWithGoogle = async () => {
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } else {
      try {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        
        // If user dismissed or cancelled the modal, exit cleanly
        if (userInfo.type === 'cancelled') {
          return;
        }
        
        // Handle both older and newer versions of the GoogleSignin API response
        let idToken = userInfo.data?.idToken || (userInfo as any).idToken;
        
        // Fallback to getTokens() if idToken is empty (sometimes happens on iOS)
        if (!idToken) {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens.idToken;
        }
        
        if (idToken) {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
        } else {
          throw new Error('No ID token returned from Google Sign-In');
        }
      } catch (err: any) {
        console.warn('Google Sign-In Error:', err);
        throw err;
      }
    }
  };

  const signInWithApple = async () => {
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } else {
      await handleNativeOAuth('apple');
    }
  };

  const signInWithLinkedIn = async () => {
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'linkedin_oidc',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } else {
      await handleNativeOAuth('linkedin_oidc');
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('Supabase signout returned an error:', error.message);
      }
    } catch (e) {
      console.warn('Error during sign out:', e);
    }
  };

  // Permanently deletes the account on the server, then clears the local session.
  // Throws if the server call fails so the caller can tell the user.
  const deleteAccount = async () => {
    await deleteMyAccount();
    await signOut();
  };

  // --- Onboarding methods ---

  const updateOnboarding = async (data: Partial<OnboardingData>) => {
    if (!user) return;

    const newData = { ...onboardingData, ...data } as OnboardingData;
    setOnboardingData(newData);

    try {
      // Save onboarding progress via API
      await api.put('/api/auth/onboarding', newData);
      progressSaveWarned.current = false;
    } catch (error: any) {
      const reason = [error?.status && `HTTP ${error.status}`, error?.message, error?.detail]
        .filter(Boolean)
        .join(' · ');
      console.error('Error saving onboarding progress:', reason || error);

      // A silent failure here is what hid a broken write path until the very
      // last step of onboarding. Tell the user once rather than on every field.
      if (!progressSaveWarned.current) {
        progressSaveWarned.current = true;
        alert(`Your progress isn't being saved.\n\n${reason || 'Unknown error'}`);
      }
    }
  };

  const completeOnboarding = async () => {
    if (!user) return;

    try {
      // 1. Sync role into PostgreSQL users table
      const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;
      
      try {
        await api.post('/api/auth/sync', { role });
      } catch (e: any) {
        console.error('[API] syncUser on complete failed:', e);
        // Report the cause, not just that something went wrong — release
        // builds have no console, so this alert is the only diagnostic.
        const reason = [e?.status && `HTTP ${e.status}`, e?.message, e?.detail]
          .filter(Boolean)
          .join(' · ');
        alert(`Failed to initialize profile. Please try again.\n\n${reason || 'Unknown error'}`);
        return; // HALT EXECUTION
      }

      // 2. Push profile fields into PostgreSQL
      if (onboardingData && role) {
        try {
          // Upload logo if necessary
          let finalLogo = onboardingData.logo;
          if (finalLogo && (finalLogo.startsWith('file://') || finalLogo.startsWith('blob:'))) {
            try { 
              finalLogo = await uploadImage(finalLogo); 
            } catch (e) { 
              console.error('[API] upload logo failed:', e); 
              alert("Failed to upload logo. Please try again.");
              return; // HALT EXECUTION
            }
          }

          // Upload photos if necessary
          const finalPhotos = [];
          for (const uri of (onboardingData.photos || [])) {
            if (uri && (uri.startsWith('file://') || uri.startsWith('blob:'))) {
              try { 
                finalPhotos.push(await uploadImage(uri)); 
              } catch (e) { 
                console.error('[API] upload photo failed:', e); 
                alert("Failed to upload a photo. Please try again.");
                return; // HALT EXECUTION
              }
            } else {
              finalPhotos.push(uri);
            }
          }

          if (role === 'brand') {
            await updateMyProfile({
              name:           onboardingData.name       || undefined,
              bio:            onboardingData.bio        || undefined,
              logo_url:       finalLogo                 || undefined,
              photos:         finalPhotos.length ? finalPhotos : undefined,
              categories:     onboardingData.categories?.length ? onboardingData.categories : undefined,
              campaign_types: onboardingData.campaigns?.length  ? onboardingData.campaigns  : undefined,
              platforms:      onboardingData.platforms?.length  ? onboardingData.platforms  : undefined,
              location:       onboardingData.location?.name     || undefined,
              lat:            onboardingData.location?.lat      ?? undefined,
              lng:            onboardingData.location?.lng      ?? undefined,
              website:        onboardingData.website             || undefined,
            });
          } else {
            await updateMyProfile({
              name:       onboardingData.name         || undefined,
              bio:        onboardingData.bio          || undefined,
              avatar_url: finalPhotos[0]              || undefined,
              photos:     finalPhotos.length ? finalPhotos : undefined,
              categories: onboardingData.categories?.length ? onboardingData.categories : undefined,
              platforms:  onboardingData.platforms?.length  ? onboardingData.platforms  : undefined,
              gender:     onboardingData.gender       || undefined,
              location:   onboardingData.location?.name    || undefined,
              lat:        onboardingData.location?.lat     ?? undefined,
              lng:        onboardingData.location?.lng     ?? undefined,
              instagram_handle: onboardingData.instagramUsername || undefined,
            });

            // Fire off the Instagram scrape in the background (fire-and-forget)
            if (onboardingData.instagramUsername) {
              syncInstagram(onboardingData.instagramUsername).catch(e => {
                console.warn('[API] Background Instagram sync failed:', e);
              });
            }
          }
        } catch (e) {
          console.error('[API] updateMyProfile on complete failed:', e);
          alert("Failed to save profile. Please try again.");
          return; // HALT EXECUTION
        }
      }

      setOnboardingComplete(true);
    } catch (error) {
      console.error('Error completing onboarding:', error);
      alert("An unexpected error occurred.");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        onboardingData,
        onboardingComplete,
        userDataError,
        retryUserData,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signInWithApple,
        signInWithLinkedIn,
        signOut,
        deleteAccount,
        verifyOtpCode,
        resendOtp,
        resetPassword,
        updateOnboarding,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
