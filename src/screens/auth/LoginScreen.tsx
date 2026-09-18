import { useState, useEffect, type ReactNode } from 'react';

import { AntDesign, FontAwesome, Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  Platform,
} from 'react-native';

import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { DismissKeyboard } from '@/components/DismissKeyboard';

type AuthMode =
  | 'login'
  | 'signup'
  | 'email_login'
  | 'email_signup'
  | 'verify_email'
  | 'forgot_password'
  | 'forgot_sent';

// ─── Shared Sub-Components ───────────────────────────────────────

function AuthButton({
  label,
  variant,
  width,
  onPress,
  loading,
}: {
  label: string;
  variant: 'primary' | 'secondary';
  width: number;
  onPress?: () => void;
  loading?: boolean;
}) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={[
        styles.button,
        isPrimary ? styles.primaryButton : styles.secondaryButton,
        {
          width: '100%',
          minHeight: isPrimary ? 64 : 56,
        },
        loading && styles.buttonDisabled,
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
}: {
  children: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.socialButton} onPress={onPress}>
      {children}
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
  const contentWidth = Math.min(width - 28, 500);
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
      >
        <DismissKeyboard>
        <View style={styles.emailContainer}>
          <View style={[styles.emailContent, { width: contentWidth }]}>
            {/* Back Button */}
            <Pressable onPress={onBack} style={styles.backButton}>
              <AntDesign name="arrow-left" size={24} color={colors.text} />
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
              style={[styles.submitButton, loading && styles.buttonDisabled]}
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
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const { verifyOtpCode, resendOtp } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - 28, 500);

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
    if (otp.length !== 6) {
      setError('Please enter the full 6-digit code');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await verifyOtpCode(email, otp);
      // onAuthStateChange fires automatically → session created → app navigates
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
      await resendOtp(email);
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
      >
        <DismissKeyboard>
          <View style={styles.emailContainer}>
            <View style={[styles.emailContent, { width: contentWidth }]}>
              {/* Back Button */}
              <Pressable onPress={onBack} style={styles.backButton}>
                <AntDesign name="arrow-left" size={24} color={colors.text} />
              </Pressable>

              {/* Icon */}
              <View style={styles.otpIconContainer}>
                <AntDesign name="mail" size={36} color={colors.primary} />
              </View>

              <Text style={styles.emailTitle}>{'Verify your\nemail'}</Text>
              <Text style={styles.emailSubtitle}>
                {'We sent a 6-digit code to\n'}
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
                  onChangeText={v => setOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor="#333333"
                  textAlign="center"
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                  autoFocus
                />
                {/* Visual digit indicator dots */}
                <View style={styles.otpDotsRow}>
                  {Array.from({ length: 6 }).map((_, i) => (
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
                style={[styles.submitButton, loading && styles.buttonDisabled]}
                onPress={handleVerify}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Verify Email</Text>
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
  const contentWidth = Math.min(width - 28, 500);

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
      >
        <DismissKeyboard>
          <View style={styles.emailContainer}>
            <View style={[styles.emailContent, { width: contentWidth }]}>
              {/* Back Button */}
              <Pressable onPress={onBack} style={styles.backButton}>
                <AntDesign name="arrow-left" size={24} color={colors.text} />
              </Pressable>

              {/* Icon */}
              <View style={styles.otpIconContainer}>
                <AntDesign name="lock" size={36} color={colors.primary} />
              </View>

              <Text style={styles.emailTitle}>{'Forgot\npassword?'}</Text>
              <Text style={styles.emailSubtitle}>
                Enter your email and we'll send you a link to reset your password.
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
                style={[styles.submitButton, loading && styles.buttonDisabled]}
                onPress={() => { Keyboard.dismiss(); handleSubmit(); }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Send Reset Link</Text>
                )}
              </Pressable>
            </View>
          </View>
        </DismissKeyboard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Forgot Password Sent Screen ──────────────────────────────────

function ForgotPasswordSentScreen({
  email,
  onBackToLogin,
}: {
  email: string;
  onBackToLogin: () => void;
}) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - 28, 500);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.emailContainer, styles.centeredContainer]}>
        <View style={[styles.emailContent, { width: contentWidth, alignItems: 'center' }]}>
          {/* Success Icon */}
          <View style={styles.sentIconContainer}>
            <AntDesign name="check-circle" size={72} color={colors.primary} />
          </View>

          <Text style={[styles.emailTitle, styles.textCenter]}>{'Check your\nemail'}</Text>
          <Text style={[styles.emailSubtitle, styles.textCenter]}>
            {'We sent a password reset link to\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>

          <Text style={styles.sentNote}>Didn't receive it? Check your spam folder.</Text>

          <Pressable style={[styles.submitButton, { marginTop: 40, width: '100%' }]} onPress={onBackToLogin}>
            <Text style={styles.submitButtonText}>Back to Login</Text>
          </Pressable>
        </View>
      </View>
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
  const contentWidth = Math.min(width - 28, 500);
  const titleSize = 48;
  const subtitleSize = 18;
  const topSpacing = Math.max(height * 0.20, 140);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isLogin = mode === 'login';
  const title = isLogin ? 'Login' : 'Sign Up';
  const subtitle = isLogin ? "It's easier to login now" : "It's easier to sign up now";
  const footerLead = isLogin ? "Don't have an account?" : 'Already have an account?';
  const footerAction = isLogin ? 'SignUp' : 'Login';

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Google sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithApple();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Apple sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLinkedInSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithLinkedIn();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'LinkedIn sign-in failed');
      }
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
                loading={loading}
              />
              <AuthButton
                label="I'll use email or phone instead"
                variant="secondary"
                width={contentWidth}
                onPress={() =>
                  onSwitchMode(isLogin ? 'email_login' : 'email_signup')
                }
              />
            </View>

            <Text style={styles.separator}>Or</Text>

            <View style={styles.socialRow}>
              <SocialButton onPress={handleLinkedInSignIn}>
                <FontAwesome
                  name="linkedin-square"
                  size={24}
                  color={colors.background}
                />
              </SocialButton>
              <SocialButton onPress={handleAppleSignIn}>
                <FontAwesome
                  name="apple"
                  size={24}
                  color={colors.background}
                />
              </SocialButton>
              <SocialButton>
                <FontAwesome name="facebook" size={22} color={colors.background} />
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
  const [mode, setMode] = useState<AuthMode>('login');
  // Email carried across mode transitions (signup → verify, login → forgot)
  const [pendingEmail, setPendingEmail] = useState('');
  // Email shown on the "reset link sent" confirmation screen
  const [forgotSentEmail, setForgotSentEmail] = useState('');

  // ── OTP verification after signup ──
  if (mode === 'verify_email') {
    return (
      <OtpVerificationForm
        email={pendingEmail}
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
          setForgotSentEmail(sentEmail);
          setMode('forgot_sent');
        }}
      />
    );
  }

  // ── Forgot password sent confirmation ──
  if (mode === 'forgot_sent') {
    return (
      <ForgotPasswordSentScreen
        email={forgotSentEmail}
        onBackToLogin={() => setMode('login')}
      />
    );
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
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  content: {
    alignSelf: 'center',
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    letterSpacing: -2,
    textAlign: 'center',
  },
  subtitle: {
    color: '#F0F0F0',
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 18,
  },
  buttonStack: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
    marginTop: 48,
  },
  button: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
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
    fontSize: 20,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '400',
  },
  separator: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 24,
  },
  socialButton: {
    width: 50,
    height: 50,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 48,
  },
  footerText: {
    color: '#D4D4D4',
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
  },
  footerLink: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '400',
    textDecorationLine: 'underline',
  },

  // ── Email auth form shared ──────────────────────────────────────
  emailContainer: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 60,
    paddingBottom: 42,
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
    marginBottom: 32,
  },
  emailTitle: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    marginBottom: 12,
  },
  emailSubtitle: {
    color: '#8A8A8A',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 32,
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
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    marginTop: 8,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
  },
  inputWrapper: {
    marginBottom: 20,
  },
  inputLabel: {
    color: '#8A8A8A',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#000000',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#262626',
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  submitButton: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitButtonText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },

  // ── Forgot password ─────────────────────────────────────────────
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 12,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },

  // ── OTP verification ────────────────────────────────────────────
  otpIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  otpInputWrapper: {
    marginBottom: 8,
  },
  otpInput: {
    backgroundColor: '#000000',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#3a3a3a',
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    textAlign: 'center',
    marginBottom: 12,
  },
  otpDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  otpDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
  otpDotFilled: {
    backgroundColor: colors.primary,
  },
  resendButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  resendText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  resendTextDisabled: {
    color: '#555555',
    textDecorationLine: 'none',
  },

  // ── Forgot sent confirmation ────────────────────────────────────
  sentIconContainer: {
    marginBottom: 28,
    marginTop: 16,
  },
  sentNote: {
    color: '#555555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
});
