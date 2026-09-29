import { useState, useEffect, useRef, type ReactNode } from 'react';

import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { DismissKeyboard } from '@/components/DismissKeyboard';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

type SignInProvider = 'google' | 'apple' | 'linkedin';

type AuthMode =
  | 'login'
  | 'signup'
  | 'email_login'
  | 'email_signup'
  | 'verify_email'
  | 'forgot_password'
  | 'reset_code'
  | 'reset_password';

// Length of the emailed one-time code. This must match the Supabase project's
// Auth → Email OTP length setting (currently 8); a mismatch silently makes
// every code unenterable, because the input truncates what the user pastes.
const OTP_LENGTH = 8;

// Supabase rejects anything shorter, and the signup form enforces the same.
const MIN_PASSWORD_LENGTH = 6;

// ─── Shared Sub-Components ───────────────────────────────────────

function AuthButton({
  label,
  variant,
  width,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  variant: 'primary' | 'secondary';
  width: number;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityState={{ busy: !!loading, disabled: !!(loading || disabled) }}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.primaryButton : styles.secondaryButton,
        {
          width: '100%',
          minHeight: isPrimary ? sz(64) : sz(56),
        },
        (loading || disabled) && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.text : '#111111'} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            isPrimary ? styles.primaryButtonText : styles.secondaryButtonText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function SocialButton({
  children,
  onPress,
  loading,
  disabled,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading, disabled: !!(loading || disabled) }}
      style={({ pressed }) => [
        styles.socialButton,
        disabled && !loading && styles.buttonDisabled,
        pressed && styles.socialPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.background} /> : children}
    </Pressable>
  );
}

function FooterLink({
  lead,
  action,
  onPress,
}: {
  lead: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.footerRow}>
      <Text style={styles.footerText}>{lead} </Text>
      <Pressable onPress={onPress}>
        <Text style={styles.footerLink}>{action}</Text>
      </Pressable>
    </View>
  );
}

// ─── Helper: map Supabase error to friendly message ──────────────

function mapSupabaseError(err: any): string {
  const msg = (err?.message || '').toLowerCase();
  const code = (err?.code || err?.error_code || '').toLowerCase();

  if (code.includes('invalid_credentials') || msg.includes('invalid login credentials')) {
    return 'Invalid email or password';
  }
  if (code.includes('user_already_exists') || msg.includes('already registered') || msg.includes('already exists')) {
    return 'An account with this email already exists';
  }
  if (code.includes('weak_password') || msg.includes('weak password')) {
    return 'Password is too weak. Choose a stronger password.';
  }
  if (code.includes('email_not_confirmed') || msg.includes('email not confirmed')) {
    return 'Please verify your email first';
  }
  if (code.includes('too_many_requests') || msg.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (code.includes('otp_expired') || msg.includes('expired')) {
    return 'That code has expired. Request a new one.';
  }
  if (code.includes('otp_disabled') || msg.includes('token has invalid') || msg.includes('invalid token')) {
    return 'That code is not valid. Check it and try again.';
  }
  if (code.includes('same_password') || msg.includes('should be different')) {
    return 'Your new password must be different from your old one.';
  }
  if (msg.includes('over_email_send_rate') || code.includes('over_email_send_rate')) {
    return 'Too many emails sent. Please wait a minute and try again.';
  }
  if (msg.includes('invalid email') || code.includes('validation_failed')) {
    return 'Invalid email address';
  }
  return err?.message || 'Authentication failed';
}

// ─── Email / Password Auth Form ───────────────────────────────────

function EmailAuthForm({
  mode,
  onBack,
  onVerifyEmail,
  onForgotPassword,
}: {
  mode: 'email_login' | 'email_signup';
  onBack: () => void;
  onVerifyEmail: (email: string) => void;
  onForgotPassword: (email: string) => void;
}) {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - sz(28), 500);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSignup = mode === 'email_signup';

  const handleSubmit = async () => {
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      if (isSignup) {
        await signUpWithEmail(email.trim(), password);
        // Switch to OTP verification — user must confirm their email
        onVerifyEmail(email.trim());
      } else {
        await signInWithEmail(email.trim(), password);
        // onAuthStateChange fires automatically after successful login
      }
    } catch (err: any) {
      setError(mapSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Scrolls the focused field above the keyboard on small iPhones.
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboard>
        <View style={styles.emailContainer}>
          <View style={[styles.emailContent, { width: contentWidth }]}>
            {/* Back Button */}
            <Pressable
              onPress={onBack}
              hitSlop={sz(12)}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
            >
              <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
            </Pressable>

            <Text style={styles.emailTitle}>
              {isSignup ? 'Create\naccount' : 'Welcome\nback'}
            </Text>
            <Text style={styles.emailSubtitle}>
              {isSignup
                ? 'Enter your email and password to get started'
                : 'Sign in with your email and password'}
            </Text>

            {/* Error */}
            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Email Input */}
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.textInput}
                placeholder="your@email.com"
                placeholderTextColor="#666666"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* Password Input */}
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={styles.textInput}
                placeholder="••••••••"
                placeholderTextColor="#666666"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType={isSignup ? 'next' : 'done'}
                onSubmitEditing={isSignup ? undefined : Keyboard.dismiss}
              />
            </View>

            {/* Forgot Password — login mode only */}
            {!isSignup && (
              <Pressable
                onPress={() => onForgotPassword(email)}
                style={styles.forgotPasswordButton}
              >
                <Text style={styles.forgotPasswordText}>Forgot password?</Text>
              </Pressable>
            )}

            {/* Confirm Password (signup only) */}
            {isSignup ? (
              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>Confirm Password</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="••••••••"
                  placeholderTextColor="#666666"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>
            ) : null}

            {/* Submit Button */}
            <Pressable
              style={({ pressed }) => [styles.submitButton, loading && styles.buttonDisabled, pressed && styles.pressed]}
              onPress={() => { Keyboard.dismiss(); handleSubmit(); }}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isSignup ? 'Create Account' : 'Sign In'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
        </DismissKeyboard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── OTP Email Verification Form ──────────────────────────────────

function OtpVerificationForm({
  email,
  purpose,
  onBack,
  onVerified,
}: {
  email: string;
  // 'signup' confirms a new account; 'recovery' authorizes a password reset.
  purpose: 'signup' | 'recovery';
  onBack: () => void;
  onVerified?: () => void;
}) {
  const { verifyOtpCode, resendOtp, verifyPasswordResetCode, resetPassword } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - sz(28), 500);

  const isRecovery = purpose === 'recovery';

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  // Countdown timer — decrements every second until 0
  useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH) {
      setError(`Please enter the full ${OTP_LENGTH}-digit code`);
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (isRecovery) {
        await verifyPasswordResetCode(email, otp);
        onVerified?.();
      } else {
        await verifyOtpCode(email, otp);
        // onAuthStateChange fires automatically → session created → app navigates
      }
    } catch (err: any) {
      setError(mapSupabaseError(err) || 'Invalid or expired code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    try {
      // Recovery codes have no `resend` endpoint — re-requesting the reset
      // issues a fresh one.
      if (isRecovery) await resetPassword(email);
      else await resendOtp(email);
      setOtp('');
      setCountdown(60);
      setCanResend(false);
    } catch (err: any) {
      setError(mapSupabaseError(err) || 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  // Show masked email like "v***h@gmail.com"
  const maskedEmail = email.replace(/^(.)(.*)(@.*)$/, (_, first, middle, domain) => {
    return first + '***' + domain;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Scrolls the focused field above the keyboard on small iPhones.
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboard>
          <View style={styles.emailContainer}>
            <View style={[styles.emailContent, { width: contentWidth }]}>
              {/* Back Button */}
              <Pressable
              onPress={onBack}
              hitSlop={sz(12)}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
            >
                <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
              </Pressable>

              {/* Icon */}
              <View style={styles.otpIconContainer}>
                <AntDesign name="mail" size={sz(36)} color={colors.primary} />
              </View>

              <Text style={styles.emailTitle}>
                {isRecovery ? 'Enter reset\ncode' : 'Verify your\nemail'}
              </Text>
              <Text style={styles.emailSubtitle}>
                {`We sent a ${OTP_LENGTH}-digit code to\n`}
                <Text style={styles.emailHighlight}>{maskedEmail}</Text>
              </Text>

              {/* Error */}
              {error ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* OTP Input */}
              <View style={styles.otpInputWrapper}>
                <TextInput
                  style={styles.otpInput}
                  value={otp}
                  onChangeText={v => setOtp(v.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
                  keyboardType="number-pad"
                  maxLength={OTP_LENGTH}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  placeholder={'0'.repeat(OTP_LENGTH)}
                  placeholderTextColor="#333333"
                  textAlign="center"
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                  autoFocus
                />
                {/* Visual digit indicator dots */}
                <View style={styles.otpDotsRow}>
                  {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.otpDot,
                        i < otp.length && styles.otpDotFilled,
                      ]}
                    />
                  ))}
                </View>
              </View>

              {/* Verify Button */}
              <Pressable
                style={({ pressed }) => [styles.submitButton, loading && styles.buttonDisabled, pressed && styles.pressed]}
                onPress={handleVerify}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.submitButtonText}>
                    {isRecovery ? 'Continue' : 'Verify Email'}
                  </Text>
                )}
              </Pressable>

              {/* Resend Code */}
              <Pressable
                style={styles.resendButton}
                onPress={handleResend}
                disabled={!canResend || resending}
              >
                {resending ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={[styles.resendText, !canResend && styles.resendTextDisabled]}>
                    {canResend ? 'Resend code' : `Resend in ${countdown}s`}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </DismissKeyboard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Forgot Password Form ─────────────────────────────────────────

function ForgotPasswordForm({
  initialEmail,
  onBack,
  onSent,
}: {
  initialEmail: string;
  onBack: () => void;
  onSent: (email: string) => void;
}) {
  const { resetPassword } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - sz(28), 500);

  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(email.trim());
      onSent(email.trim());
    } catch (err: any) {
      setError(mapSupabaseError(err) || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Scrolls the focused field above the keyboard on small iPhones.
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboard>
          <View style={styles.emailContainer}>
            <View style={[styles.emailContent, { width: contentWidth }]}>
              {/* Back Button */}
              <Pressable
              onPress={onBack}
              hitSlop={sz(12)}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
            >
                <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
              </Pressable>

              {/* Icon */}
              <View style={styles.otpIconContainer}>
                <AntDesign name="lock" size={sz(36)} color={colors.primary} />
              </View>

              <Text style={styles.emailTitle}>{'Forgot\npassword?'}</Text>
              <Text style={styles.emailSubtitle}>
                Enter your email and we'll send you a code to reset your password.
              </Text>

              {/* Error */}
              {error ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Email Input */}
              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="your@email.com"
                  placeholderTextColor="#666666"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => { Keyboard.dismiss(); handleSubmit(); }}
                />
              </View>

              {/* Submit Button */}
              <Pressable
                style={({ pressed }) => [styles.submitButton, loading && styles.buttonDisabled, pressed && styles.pressed]}
                onPress={() => { Keyboard.dismiss(); handleSubmit(); }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Send Reset Code</Text>
                )}
              </Pressable>
            </View>
          </View>
        </DismissKeyboard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Set New Password (after a verified recovery code) ────────────

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const { updatePassword } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - sz(28), 500);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!password.trim()) {
      setError('Please enter a new password');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await updatePassword(password);
      // The recovery session is already valid, so clearing recovery mode lets
      // AuthGuard take them straight into the app.
      onDone();
    } catch (err: any) {
      setError(mapSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Scrolls the focused field above the keyboard on small iPhones.
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboard>
          <View style={styles.emailContainer}>
            <View style={[styles.emailContent, { width: contentWidth }]}>
              <View style={styles.otpIconContainer}>
                <AntDesign name="lock" size={sz(36)} color={colors.primary} />
              </View>

              <Text style={styles.emailTitle}>{'Set a new\npassword'}</Text>
              <Text style={styles.emailSubtitle}>
                Choose a new password for your account.
              </Text>

              {error ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>New Password</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="••••••••"
                  placeholderTextColor="#666666"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  returnKeyType="next"
                />
              </View>

              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="••••••••"
                  placeholderTextColor="#666666"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={() => { Keyboard.dismiss(); handleSubmit(); }}
                />
              </View>

              <Pressable
                style={({ pressed }) => [styles.submitButton, loading && styles.buttonDisabled, pressed && styles.pressed]}
                onPress={() => { Keyboard.dismiss(); handleSubmit(); }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Update Password</Text>
                )}
              </Pressable>
            </View>
          </View>
        </DismissKeyboard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Main Auth Page (Google / Email selector) ─────────────────────

function AuthPage({
  mode,
  onSwitchMode,
}: {
  mode: 'login' | 'signup';
  onSwitchMode: (mode: AuthMode) => void;
}) {
  const { signInWithGoogle, signInWithApple, signInWithLinkedIn } = useAuth();
  const { width, height } = useWindowDimensions();
  const contentWidth = Math.min(width - sz(28), 500);
  const titleSize = sz(48);
  const subtitleSize = sz(18);
  const topSpacing = Math.max(height * 0.20, sz(140));
  // One sign-in at a time: two OAuth sheets racing each other can leave the
  // session from whichever finishes last. The ref blocks a second tap before
  // the disabled state has rendered.
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const pendingRef = useRef<SignInProvider | null>(null);
  const [error, setError] = useState('');

  const isLogin = mode === 'login';
  const title = isLogin ? 'Login' : 'Sign Up';
  const subtitle = isLogin ? "It's easier to login now" : "It's easier to sign up now";
  const footerLead = isLogin ? "Don't have an account?" : 'Already have an account?';
  const footerAction = isLogin ? 'SignUp' : 'Login';

  const runSignIn = async (provider: SignInProvider, signIn: () => Promise<unknown>, name: string) => {
    if (pendingRef.current) return;
    pendingRef.current = provider;
    setPending(provider);
    setError('');
    tapFeedback();
    try {
      await signIn();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || `${name} sign-in failed`);
      }
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  const handleGoogleSignIn = () => runSignIn('google', signInWithGoogle, 'Google');
  const handleAppleSignIn = () => runSignIn('apple', signInWithApple, 'Apple');
  const handleLinkedInSignIn = () => runSignIn('linkedin', signInWithLinkedIn, 'LinkedIn');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.container, { paddingTop: topSpacing }]}>
          <View style={[styles.content, { width: contentWidth }]}>
            <Text
              style={[
                styles.title,
                { fontSize: titleSize, lineHeight: titleSize * 0.98 },
              ]}
            >
              {title}
            </Text>

            <Text
              style={[
                styles.subtitle,
                { fontSize: subtitleSize, lineHeight: subtitleSize * 1.28 },
              ]}
            >
              {subtitle}
            </Text>

            {/* Error Message */}
            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.buttonStack}>
              <AuthButton
                label="Continue with google"
                variant="primary"
                width={contentWidth}
                onPress={handleGoogleSignIn}
                loading={pending === 'google'}
                disabled={pending !== null}
              />
              <AuthButton
                label="I'll use email or phone instead"
                variant="secondary"
                width={contentWidth}
                disabled={pending !== null}
                onPress={() => {
                  tapFeedback();
                  onSwitchMode(isLogin ? 'email_login' : 'email_signup');
                }}
              />
            </View>

            <Text style={styles.separator}>Or</Text>

            <View style={styles.socialRow}>
              <SocialButton
                label="Continue with LinkedIn"
                onPress={handleLinkedInSignIn}
                loading={pending === 'linkedin'}
                disabled={pending !== null}
              >
                <FontAwesome
                  name="linkedin-square"
                  size={sz(24)}
                  color={colors.background}
                />
              </SocialButton>
              <SocialButton
                label="Continue with Apple"
                onPress={handleAppleSignIn}
                loading={pending === 'apple'}
                disabled={pending !== null}
              >
                <FontAwesome
                  name="apple"
                  size={sz(24)}
                  color={colors.background}
                />
              </SocialButton>
            </View>

            <FooterLink
              lead={footerLead}
              action={footerAction}
              onPress={() =>
                onSwitchMode(isLogin ? 'signup' : 'login')
              }
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Root LoginScreen — state machine ────────────────────────────

export function LoginScreen() {
  const { beginPasswordRecovery, endPasswordRecovery } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  // Email carried across mode transitions (signup → verify, login → forgot)
  const [pendingEmail, setPendingEmail] = useState('');
  // Email the reset code was sent to
  const [resetEmail, setResetEmail] = useState('');

  // Leaving the reset flow must always release the guard, or the user is
  // stranded on the auth screen with a live session.
  const leaveRecovery = (next: AuthMode) => {
    endPasswordRecovery();
    setMode(next);
  };

  // `mode` resets when this screen remounts but the guard lives in context, so
  // release it here too — otherwise an interrupted reset locks the user out.
  useEffect(() => endPasswordRecovery, []);

  // ── OTP verification after signup ──
  if (mode === 'verify_email') {
    return (
      <OtpVerificationForm
        email={pendingEmail}
        purpose="signup"
        onBack={() => setMode('email_signup')}
      />
    );
  }

  // ── Forgot password form ──
  if (mode === 'forgot_password') {
    return (
      <ForgotPasswordForm
        initialEmail={pendingEmail}
        onBack={() => setMode('email_login')}
        onSent={(sentEmail) => {
          setResetEmail(sentEmail);
          // Guard before the code is verified — verification itself creates
          // the session that would otherwise trigger a redirect.
          beginPasswordRecovery();
          setMode('reset_code');
        }}
      />
    );
  }

  // ── Enter the emailed reset code ──
  if (mode === 'reset_code') {
    return (
      <OtpVerificationForm
        email={resetEmail}
        purpose="recovery"
        onBack={() => leaveRecovery('forgot_password')}
        onVerified={() => setMode('reset_password')}
      />
    );
  }

  // ── Choose the new password ──
  if (mode === 'reset_password') {
    return <NewPasswordForm onDone={() => leaveRecovery('login')} />;
  }

  // ── Email form (login or signup) ──
  if (mode === 'email_login' || mode === 'email_signup') {
    return (
      <EmailAuthForm
        mode={mode}
        onBack={() => setMode(mode === 'email_login' ? 'login' : 'signup')}
        onVerifyEmail={(email) => {
          setPendingEmail(email);
          setMode('verify_email');
        }}
        onForgotPassword={(email) => {
          setPendingEmail(email);
          setMode('forgot_password');
        }}
      />
    );
  }

  // ── Default: social / main auth page ──
  return <AuthPage mode={mode} onSwitchMode={setMode} />;
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: sz(24),
    backgroundColor: colors.background,
  },
  content: {
    alignSelf: 'center',
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    letterSpacing: sz(-2),
    textAlign: 'center',
  },
  subtitle: {
    color: '#F0F0F0',
    fontWeight: '400',
    textAlign: 'center',
    marginTop: sz(18),
  },
  buttonStack: {
    width: '100%',
    alignItems: 'center',
    gap: sz(16),
    marginTop: sz(48),
  },
  button: {
    borderRadius: sz(999),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sz(20),
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.text,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    textAlign: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: sz(20),
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: sz(16),
    fontWeight: '400',
  },
  separator: {
    color: colors.text,
    fontSize: sz(20),
    fontWeight: '700',
    textAlign: 'center',
    marginTop: sz(24),
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: sz(16),
    marginTop: sz(24),
  },
  socialButton: {
    width: sz(50),
    height: sz(50),
    borderRadius: sz(999),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: sz(48),
  },
  footerText: {
    color: '#D4D4D4',
    fontSize: sz(16),
    fontWeight: '400',
    textAlign: 'center',
  },
  footerLink: {
    color: colors.primary,
    fontSize: sz(16),
    fontWeight: '400',
    textDecorationLine: 'underline',
  },

  // ── Email auth form shared ──────────────────────────────────────
  emailContainer: {
    flex: 1,
    paddingHorizontal: sz(14),
    paddingTop: sz(60),
    paddingBottom: sz(42),
    backgroundColor: colors.background,
  },
  centeredContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emailContent: {
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    marginBottom: sz(32),
  },
  emailTitle: {
    color: colors.text,
    fontSize: sz(40),
    fontWeight: '700',
    lineHeight: sz(44),
    marginBottom: sz(12),
  },
  emailSubtitle: {
    color: '#8A8A8A',
    fontSize: sz(14),
    lineHeight: sz(20),
    marginBottom: sz(32),
  },
  emailHighlight: {
    color: colors.text,
    fontWeight: '600',
  },
  textCenter: {
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderRadius: sz(12),
    padding: sz(12),
    marginBottom: sz(16),
    marginTop: sz(8),
  },
  errorText: {
    color: '#FF3B30',
    fontSize: sz(14),
    textAlign: 'center',
  },
  inputWrapper: {
    marginBottom: sz(20),
  },
  inputLabel: {
    color: '#8A8A8A',
    fontSize: sz(13),
    fontWeight: '500',
    marginBottom: sz(8),
  },
  textInput: {
    backgroundColor: '#000000',
    borderRadius: sz(12),
    borderWidth: 1.5,
    borderColor: '#262626',
    color: colors.text,
    fontSize: sz(16),
    paddingHorizontal: sz(16),
    paddingVertical: sz(14),
  },
  submitButton: {
    backgroundColor: colors.primary,
    height: sz(56),
    borderRadius: sz(999),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: sz(16),
  },
  submitButtonText: {
    color: colors.text,
    fontSize: sz(18),
    fontWeight: '700',
  },

  // ── Forgot password ─────────────────────────────────────────────
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: sz(-8),
    marginBottom: sz(12),
    paddingVertical: sz(4),
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: sz(13),
    fontWeight: '500',
    textDecorationLine: 'underline',
  },

  // ── OTP verification ────────────────────────────────────────────
  otpIconContainer: {
    width: sz(72),
    height: sz(72),
    borderRadius: sz(36),
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sz(24),
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  otpInputWrapper: {
    marginBottom: sz(8),
  },
  otpInput: {
    backgroundColor: '#000000',
    borderRadius: sz(16),
    borderWidth: 1.5,
    borderColor: '#3a3a3a',
    color: colors.text,
    // Sized so OTP_LENGTH digits still fit on a 320pt-wide screen.
    fontSize: sz(28),
    fontWeight: '700',
    letterSpacing: sz(8),
    paddingHorizontal: sz(16),
    paddingVertical: sz(18),
    textAlign: 'center',
    marginBottom: sz(12),
  },
  otpDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: sz(10),
    marginBottom: sz(8),
  },
  otpDot: {
    width: sz(8),
    height: sz(8),
    borderRadius: sz(4),
    backgroundColor: '#333333',
  },
  otpDotFilled: {
    backgroundColor: colors.primary,
  },
  resendButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: sz(16),
    marginTop: sz(8),
  },
  resendText: {
    color: colors.primary,
    fontSize: sz(15),
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  resendTextDisabled: {
    color: '#555555',
    textDecorationLine: 'none',
  },

  // ── Forgot sent confirmation ────────────────────────────────────
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backPressed: { opacity: 0.6 },
  socialPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
});
