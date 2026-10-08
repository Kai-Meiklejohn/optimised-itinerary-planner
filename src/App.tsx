import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  FolderKanban,
  Globe2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  PlaneTakeoff,
  Plus,
  Route,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { updateItineraryDates } from '@/itinerary'
import { ItineraryPlanner } from '@/ItineraryPlanner'
import type { ItineraryProject, NewItineraryProject } from '@/itinerary'
import {
  createBackendTrip,
  deleteBackendTrip,
  listBackendStops,
  listBackendTrips,
  updateBackendTrip,
} from '@/lib/backendApi'
import { readIdTokenIdentity } from '@/lib/jwt'
import {
  confirmForgotPassword,
  confirmSignUpUser,
  forgotPassword,
  resendConfirmationCode,
  signInUser,
  signOutUser,
  restoreSession,
  getSessionVersion,
  invalidatePendingSession,
  signUpUser,
} from '@/services/authService'
import { createUserProfile } from '@/services/userService'
import {
  createClientId,
  createItineraryDays,
  formatDateRange,
  getItineraryDayCount,
  getProjectPlaceCount,
  getProjectStatus,
  MAX_ITINERARY_DAYS,
} from '@/itinerary'

type AuthMode = 'sign-in' | 'sign-up' | 'verify' | 'forgot-password' | 'reset-password'
type AppView = 'auth' | 'dashboard' | 'planner'
type LoadedProject = ItineraryProject & { placesStatus: 'loading' | 'ready' | 'error' }
const VERIFICATION_CODE_TIMEOUT_SECONDS = 120

const fieldClassName =
  'h-11 w-full rounded-xl border border-emerald-950/12 bg-white px-3.5 text-sm text-emerald-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700/45 focus:ring-3 focus:ring-emerald-700/10'

const PASSWORD_POLICY_REQUIREMENTS = [
  { key: 'length', label: 'At least 12 characters', test: (value: string) => value.length >= 12 },
  { key: 'uppercase', label: 'One uppercase letter (A-Z)', test: (value: string) => /[A-Z]/.test(value) },
  { key: 'lowercase', label: 'One lowercase letter (a-z)', test: (value: string) => /[a-z]/.test(value) },
  { key: 'number', label: 'One number (0-9)', test: (value: string) => /[0-9]/.test(value) },
  { key: 'special', label: 'One special character (!@#$%...)', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const

function getPasswordPolicyErrors(password: string): string[] {
  return PASSWORD_POLICY_REQUIREMENTS.filter((requirement) => !requirement.test(password)).map(
    (requirement) => requirement.label,
  )
}

function PasswordRequirementsChecklist({ password }: { password: string }) {
  return (
    <div className="mt-3 px-0.5 py-1">
      <p className="mb-2 text-sm font-semibold tracking-[-0.01em] text-red-500">Password must contain:</p>
      <ul className="space-y-1.5 text-sm leading-5">
        {PASSWORD_POLICY_REQUIREMENTS.map((requirement) => {
          const isSatisfied = requirement.test(password)

          return (
            <li
              className={`flex items-center gap-2 ${isSatisfied ? 'text-emerald-600' : 'text-red-500'}`}
              key={requirement.key}
            >
              <span
                className={`inline-flex size-4 items-center justify-center rounded-full border text-[9px] font-bold ${
                  isSatisfied
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
                    : 'border-red-400 bg-red-50 text-red-500'
                }`}
                aria-hidden="true"
              >
                {isSatisfied ? '✓' : '×'}
              </span>
              <span className={isSatisfied ? 'font-medium' : ''}>{requirement.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-800 text-white shadow-sm">
        <PlaneTakeoff className="size-4.5" aria-hidden="true" />
      </span>
      {!compact && (
        <div>
          <p className="font-semibold tracking-[-0.02em] text-emerald-950">Optimised</p>
          <p className="-mt-0.5 text-xs text-slate-500">Itinerary Planner</p>
        </div>
      )}
    </div>
  )
}

function AuthScreen({ onContinue }: { onContinue: (name: string, userId: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [verificationSecondsLeft, setVerificationSecondsLeft] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSignUp = mode === 'sign-up'
  const isVerify = mode === 'verify'
  const isForgotPassword = mode === 'forgot-password'
  const isResetPassword = mode === 'reset-password'
  const isVerificationExpired = isVerify && verificationSecondsLeft === 0
  const verificationTimeLabel = `${Math.floor(verificationSecondsLeft / 60)}:${String(
    verificationSecondsLeft % 60,
  ).padStart(2, '0')}`

  const switchAuthMode = (nextMode: AuthMode) => {
    if (nextMode === 'sign-in' || nextMode === 'sign-up' || nextMode === 'forgot-password') {
      setFullName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setOtp('')
      setErrorMsg('')
      setSuccessMsg('')
    }

    setMode(nextMode)
  }

  useEffect(() => {
    if (!isVerify) {
      return
    }

    const timer = window.setInterval(() => {
      setVerificationSecondsLeft((secondsLeft) => Math.max(secondsLeft - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isVerify])

  const ensureUserProfile = async () => {
    try {
      await createUserProfile()
    } catch (error) {
      console.error('Could not create the user profile in the backend:', error)
    }
  }

  const handleResendCode = async () => {
    if (isSubmitting) {
      return
    }
    setErrorMsg('')
    setSuccessMsg('')
    setIsSubmitting(true)

    try {
      await resendConfirmationCode(email)
      setOtp('')
      setVerificationSecondsLeft(VERIFICATION_CODE_TIMEOUT_SECONDS)
      setSuccessMsg('A new confirmation code has been sent to your email.')
    } catch (err) {
      console.error('Resend confirmation code error:', err)
      setErrorMsg(err instanceof Error ? err.message : 'Could not resend the confirmation code.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) {
      return
    }
    setErrorMsg('')
    setSuccessMsg('')

    if (isSignUp || isResetPassword) {
      const passwordErrors = getPasswordPolicyErrors(password)

      if (passwordErrors.length > 0) {
        setErrorMsg('Password must be at least 12 characters long and include an uppercase letter, lowercase letter, number, and special character.')
        return
      }

      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.')
        return
      }
    }

    setIsSubmitting(true)

    try {
      if (isForgotPassword) {
        await forgotPassword(email)
        setMode('reset-password')
      } else if (isResetPassword) {
        await confirmForgotPassword(email, otp, password)
        setMode('sign-in')
        setPassword('')
        setConfirmPassword('')
        setOtp('')
        setSuccessMsg('Password reset successfully. You can now sign in.')
      } else if (isSignUp) {
        try {
          await signUpUser(email, password, fullName)
        } catch (signUpError) {
          // The account already exists - most commonly because the user hit
          // Back on the verify screen and resubmitted the same email, which
          // Cognito rejects even though the account is still unconfirmed.
          // Resend a fresh code and continue to verify instead of dead-ending
          // here; if the account is actually already confirmed, resending
          // fails too and that error surfaces below as usual.
          if (!(signUpError instanceof Error) || signUpError.name !== 'UsernameExistsException') {
            throw signUpError
          }
          await resendConfirmationCode(email)
          // Resending doesn't change the account's password - Cognito has no
          // client-side way to update an unconfirmed user's password without
          // signing in first, which they can't yet. If this password field
          // was retyped differently than the original sign-up, verifying
          // will succeed but the later signInUser (isVerify branch) will
          // fail with the real password unknown to this form - surfaced here
          // rather than silently after an already-successful verification.
          setSuccessMsg("This email already has an unconfirmed account - we've sent a new code. Sign in with the password from your original sign-up, not necessarily this one.")
        }
        setVerificationSecondsLeft(VERIFICATION_CODE_TIMEOUT_SECONDS)
        setMode('verify')
      } else if (isVerify) {
        await confirmSignUpUser(email, otp)
        const tokens = await signInUser(email, password)
        const identity = readIdTokenIdentity(tokens.idToken)
        const version = getSessionVersion()
        await ensureUserProfile()
        if (getSessionVersion() !== version) {
          // A newer session already won this race - don't leave this
          // attempt's now-stale tokens in localStorage for a reload to
          // silently pick up despite the error we're about to show.
          await signOutUser()
          throw new Error('Session changed. Please sign in again.')
        }
        onContinue(identity.name, identity.userId)
      } else {
        const tokens = await signInUser(email, password)
        const identity = readIdTokenIdentity(tokens.idToken)
        const version = getSessionVersion()
        await ensureUserProfile()
        if (getSessionVersion() !== version) {
          await signOutUser()
          throw new Error('Session changed. Please sign in again.')
        }
        onContinue(identity.name, identity.userId)
      }
    } catch (err) {
      console.error('Authentication error:', err)
      const isSignInAttempt = !isForgotPassword && !isResetPassword && !isSignUp && !isVerify
      const revealsWhetherAccountExists = err instanceof Error
        && ['UserNotFoundException', 'NotAuthorizedException', 'UserNotConfirmedException', 'PasswordResetRequiredException'].includes(err.name)

      if (isSignInAttempt && revealsWhetherAccountExists) {
        setErrorMsg('Incorrect email or password.')
      } else if (err instanceof Error && err.name === 'ExpiredCodeException') {
        setErrorMsg('That confirmation code has expired. Request a new one and try again.')
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'An error occurred during authentication.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-grid min-h-dvh bg-[#f6f5ef] p-3 text-emerald-950 sm:p-5">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-7xl overflow-hidden rounded-[1.75rem] bg-white shadow-[0_30px_100px_rgba(24,61,47,0.12)] ring-1 ring-emerald-950/8 sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-emerald-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
          <div className="auth-orbit auth-orbit-two" aria-hidden="true" />

          <div className="relative flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <PlaneTakeoff className="size-4.5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold">Optimised</p>
              <p className="text-xs text-emerald-100/60">Itinerary Planner</p>
            </div>
          </div>

          <div className="relative max-w-lg py-16">
            <Badge className="mb-6 border-white/12 bg-white/8 text-emerald-50" variant="outline">
              <Sparkles data-icon="inline-start" />
              Your trips, clearly organised
            </Badge>
            <h1 className="text-balance text-5xl leading-[1.04] font-semibold tracking-[-0.045em] xl:text-6xl">
              Make space for the journey, not the planning tabs.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-emerald-100/65">
              Keep every itinerary, place, date, and idea together in one calm workspace.
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-3">
            {[
              [Globe2, 'All trips', 'One workspace'],
              [Route, 'Clear days', 'Simple plans'],
              [UsersRound, 'Together', 'Shared ideas'],
            ].map(([Icon, title, detail]) => {
              const FeatureIcon = Icon as typeof Globe2
              return (
                <div className="rounded-2xl bg-white/6 p-4 ring-1 ring-white/10" key={title as string}>
                  <FeatureIcon className="size-4 text-amber-300" aria-hidden="true" />
                  <p className="mt-5 text-sm font-medium">{title as string}</p>
                  <p className="mt-1 text-xs text-emerald-100/50">{detail as string}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="flex min-h-full items-center justify-center px-5 py-10 sm:px-10 lg:px-14 xl:px-20">
          <div className="w-full max-w-md">
            <div className="mb-12 lg:hidden">
              <BrandMark />
            </div>

            <div>
              <p className="text-sm font-medium text-emerald-700">Welcome to your travel workspace</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                {isVerify
                  ? 'Verify your account'
                  : isForgotPassword || isResetPassword
                  ? 'Reset your password'
                  : isSignUp
                  ? 'Create your account'
                  : 'Welcome back'}
              </h2>
              <p className="mt-3 leading-7 text-slate-500">
                {isVerify
                  ? 'Enter the confirmation code sent to your email.'
                  : isForgotPassword
                  ? 'Enter your email address to receive a reset code.'
                  : isResetPassword
                  ? 'Enter the code from your email and choose a new password.'
                  : isSignUp
                  ? 'Start keeping your future journeys in one place.'
                  : 'Sign in to continue planning your next journey.'}
              </p>
            </div>

            {!isForgotPassword && !isResetPassword && (
              <div className="mt-8 grid grid-cols-2 rounded-xl bg-[#f1f3ef] p-1" aria-label="Authentication mode">
                <button
                  aria-pressed={!isSignUp}
                  className="h-10 rounded-lg text-sm font-medium transition aria-pressed:bg-white aria-pressed:text-emerald-950 aria-pressed:shadow-sm"
                  disabled={isVerify || isSubmitting}
                  onClick={() => switchAuthMode('sign-in')}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  aria-pressed={isSignUp}
                  className="h-10 rounded-lg text-sm font-medium text-slate-500 transition aria-pressed:bg-white aria-pressed:text-emerald-950 aria-pressed:shadow-sm disabled:opacity-50"
                  disabled={isVerify || isSubmitting}
                  onClick={() => switchAuthMode('sign-up')}
                  type="button"
                >
                  Sign up
                </button>
              </div>
            )}

            <form
              aria-label={
                isVerify
                  ? 'Verify your account'
                  : isForgotPassword || isResetPassword
                  ? 'Reset your password'
                  : isSignUp
                  ? 'Create account'
                  : 'Sign in'
              }
              className="mt-7 space-y-5"
              key={mode}
              onSubmit={handleSubmit}
            >
              {isSignUp && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="full-name">
                    Full name
                  </label>
                  <div className="relative">
                    <CircleUserRound className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      className={`${fieldClassName} pl-10`}
                      id="full-name"
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Alex Morgan"
                      required
                      type="text"
                      value={fullName}
                    />
                  </div>
                </div>
              )}

              {!isResetPassword && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="email">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete={isForgotPassword || isSignUp ? 'off' : 'email'}
                      className={`${fieldClassName} pl-10`}
                      id="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                      type="email"
                      value={email}
                    />
                  </div>
                </div>
              )}

              {!isForgotPassword && !isResetPassword && !isVerify && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="text-sm font-medium" htmlFor="password">
                      Password
                    </label>
                    {!isSignUp && (
                      <button
                        className="text-xs text-emerald-700 transition hover:text-emerald-900"
                        onClick={() => switchAuthMode('forgot-password')}
                        type="button"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <LockKeyhole className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      className={`${fieldClassName} pl-10`}
                      id="password"
                      minLength={12}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 12 characters"
                      required
                      type="password"
                      value={password}
                    />
                  </div>

                  {isSignUp && <PasswordRequirementsChecklist password={password} />}
                </div>
              )}

              {isSignUp && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="confirm-password">
                    Confirm password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete="new-password"
                      className={`${fieldClassName} pl-10`}
                      id="confirm-password"
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Re-enter your password"
                      required
                      type="password"
                      value={confirmPassword}
                    />
                  </div>
                </div>
              )}

              {isVerify && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="confirmation-code">
                    Confirmation code
                  </label>
                  <div className="relative">
                    <Mail className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete="one-time-code"
                      className={`${fieldClassName} pl-10 text-center text-lg tracking-[0.15em]`}
                      id="confirmation-code"
                      maxLength={6}
                      onChange={(event) => setOtp(event.target.value)}
                      placeholder="000000"
                      required
                      type="text"
                      value={otp}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Check your email for the 6-digit code</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p
                      className={`text-xs ${isVerificationExpired ? 'text-red-600' : 'text-slate-500'}`}
                      role={isVerificationExpired ? 'alert' : undefined}
                    >
                      {isVerificationExpired ? 'This confirmation code has expired.' : `Code expires in ${verificationTimeLabel}`}
                    </p>
                    <button
                      className="text-xs font-medium text-emerald-700 transition hover:text-emerald-900 disabled:opacity-50"
                      disabled={isSubmitting}
                      onClick={handleResendCode}
                      type="button"
                    >
                      Resend code
                    </button>
                  </div>
                </div>
              )}

              {isResetPassword && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="confirmation-code">
                    Reset code
                  </label>
                  <div className="relative">
                    <Mail className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete="one-time-code"
                      className={`${fieldClassName} pl-10 text-center text-lg tracking-[0.15em]`}
                      id="confirmation-code"
                      maxLength={6}
                      onChange={(event) => setOtp(event.target.value)}
                      placeholder="000000"
                      required
                      type="text"
                      value={otp}
                    />
                  </div>
                </div>
              )}

              {isResetPassword && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="password">
                    New password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete="new-password"
                      className={`${fieldClassName} pl-10`}
                      id="password"
                      minLength={12}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 12 characters"
                      required
                      type="password"
                      value={password}
                    />
                  </div>
                  <PasswordRequirementsChecklist password={password} />
                </div>
              )}

              {isResetPassword && (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="confirm-password">
                    Confirm password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoComplete="new-password"
                      className={`${fieldClassName} pl-10`}
                      id="confirm-password"
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Re-enter your password"
                      required
                      type="password"
                      value={confirmPassword}
                    />
                  </div>
                </div>
              )}

              {(isForgotPassword || isResetPassword || isSignUp || isVerify) && (
                <div className="flex gap-3 rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-950 ring-1 ring-amber-900/10">
                  <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {isForgotPassword || isResetPassword
                    ? 'A reset code will be sent to your email.'
                    : isVerify
                    ? 'Enter the confirmation code sent to your email.'
                    : "You'll receive a confirmation code by email after signing up."}
                </div>
              )}

              {errorMsg && (
                <div className="rounded-xl bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700 ring-1 ring-red-700/10" role="alert">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="rounded-xl bg-emerald-50 px-3.5 py-3 text-xs leading-5 text-emerald-800 ring-1 ring-emerald-700/10" role="status">
                  {successMsg}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                {(isVerify || isForgotPassword || isResetPassword) && (
                  <button
                    className="h-11 flex-1 rounded-xl border border-emerald-950/12 bg-slate-50 text-sm font-medium text-emerald-950 shadow-sm transition hover:bg-slate-100"
                    disabled={isSubmitting}
                    onClick={() => {
                      if (isResetPassword) {
                        // issue #36: a partially-typed new password must not
                        // leak into the sign-in field. Preserve the email
                        // though, same as the forgot-password Back below -
                        // only the reset-specific fields need clearing here.
                        setPassword('')
                        setConfirmPassword('')
                        setOtp('')
                        setErrorMsg('')
                        setSuccessMsg('')
                        setMode('sign-in')
                      } else if (isForgotPassword) {
                        // No password field exists at this stage yet, so
                        // there's nothing to leak - preserve the just-typed
                        // email rather than force a pointless retype, but
                        // still clear a leftover banner (e.g. a failed
                        // "Send reset code" attempt) so it can't persist
                        // onto the sign-in form.
                        setErrorMsg('')
                        setSuccessMsg('')
                        setMode('sign-in')
                      } else {
                        // Verify -> sign-up: keep the email/password so a
                        // resubmit after hitting UsernameExistsException
                        // (issue #34) doesn't force a full retype into a
                        // possibly-different password than the account
                        // already has. Do clear the one-time code and any
                        // leftover banner from the verify attempt, though,
                        // so a stale/expired code or error message can't
                        // linger onto the sign-up form or a later verify.
                        setOtp('')
                        setErrorMsg('')
                        setSuccessMsg('')
                        setMode('sign-up')
                      }
                    }}
                    type="button"
                  >
                    {isForgotPassword || isResetPassword ? 'Back to sign in' : 'Back'}
                  </button>
                )}
                <Button
                  className={`h-11 ${isVerify || isForgotPassword || isResetPassword ? 'flex-1' : 'w-full'} rounded-xl`}
                  disabled={isVerificationExpired || isSubmitting}
                  size="lg"
                  type="submit"
                >
                  {isVerify
                    ? 'Verify account'
                    : isForgotPassword
                    ? 'Send reset code'
                    : isResetPassword
                    ? 'Reset password'
                    : isSignUp
                    ? 'Create account'
                    : 'Sign in'}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </form>

            <p className="mt-8 text-center text-xs leading-5 text-slate-400">
              By continuing, you agree to the future terms of service and privacy policy.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

function CreateItineraryPanel({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (project: NewItineraryProject) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [nameError, setNameError] = useState('')
  const [destinationError, setDestinationError] = useState('')
  const [dateError, setDateError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const destinationInputRef = useRef<HTMLInputElement | null>(null)
  const endDateInputRef = useRef<HTMLInputElement | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) {
      return
    }
    const trimmedName = name.trim()
    const trimmedDestination = destination.trim()
    const dayCount = getItineraryDayCount(startDate, endDate)
    const nextNameError = trimmedName ? '' : 'Enter a trip name.'
    const nextDestinationError = trimmedDestination ? '' : 'Enter a destination.'
    let nextDateError = ''

    if (dayCount < 1) {
      nextDateError = 'End date must be the same as or later than the start date.'
    } else if (dayCount > MAX_ITINERARY_DAYS) {
      nextDateError = `Trips can be no longer than ${MAX_ITINERARY_DAYS} days.`
    }

    setNameError(nextNameError)
    setDestinationError(nextDestinationError)
    setDateError(nextDateError)

    if (nextNameError || nextDestinationError || nextDateError) {
      if (nextNameError) {
        nameInputRef.current?.focus()
      } else if (nextDestinationError) {
        destinationInputRef.current?.focus()
      } else {
        endDateInputRef.current?.focus()
      }
      return
    }

    setIsSubmitting(true)
    setSaveError('')
    const saved = await onCreate({ name: trimmedName, destination: trimmedDestination, startDate, endDate })
    if (!saved) {
      setSaveError('Could not create the itinerary. Please check your connection and try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="border-0 bg-white py-0 shadow-[0_18px_50px_rgba(24,61,47,0.09)] ring-1 ring-emerald-950/8">
      <CardContent className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-emerald-700 uppercase">New project</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-emerald-950">Create an itinerary</h2>
            <p className="mt-1 text-sm text-slate-500">Give the trip a starting point. Places and daily plans come next.</p>
          </div>
          <button
            aria-label="Close itinerary form"
            disabled={isSubmitting}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <form aria-label="Create itinerary" className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit}>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium" htmlFor="trip-name">
              Trip name
            </label>
            <input
              autoFocus
              className={fieldClassName}
              id="trip-name"
              aria-describedby={nameError ? 'trip-name-error' : undefined}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => {
                setName(event.target.value)
                setNameError('')
              }}
              placeholder="Summer in Seoul"
              ref={nameInputRef}
              required
              value={name}
            />
            {nameError && (
              <p className="mt-2 text-xs text-red-700" id="trip-name-error" role="alert">
                {nameError}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium" htmlFor="destination">
              Main destination
            </label>
            <input
              className={fieldClassName}
              id="destination"
              aria-describedby={destinationError ? 'destination-error' : undefined}
              aria-invalid={destinationError ? true : undefined}
              onChange={(event) => {
                setDestination(event.target.value)
                setDestinationError('')
              }}
              placeholder="Seoul, South Korea"
              ref={destinationInputRef}
              required
              value={destination}
            />
            {destinationError && (
              <p className="mt-2 text-xs text-red-700" id="destination-error" role="alert">
                {destinationError}
              </p>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="start-date">
              Start date
            </label>
            <input
              className={fieldClassName}
              id="start-date"
              onChange={(event) => {
                setStartDate(event.target.value)
                setDateError('')
              }}
              required
              type="date"
              value={startDate}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="end-date">
              End date
            </label>
            <input
              className={fieldClassName}
              id="end-date"
              aria-describedby={dateError ? 'date-error' : undefined}
              aria-invalid={dateError ? true : undefined}
              onChange={(event) => {
                setEndDate(event.target.value)
                setDateError('')
              }}
              ref={endDateInputRef}
              required
              type="date"
              value={endDate}
            />
          </div>
          {dateError && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-700/10 sm:col-span-2" id="date-error" role="alert">
              {dateError}
            </p>
          )}
          {saveError && (
            <p className="text-sm text-red-700 sm:col-span-2" role="alert">{saveError}</p>
          )}
          <div className="flex flex-col-reverse gap-3 pt-1 sm:col-span-2 sm:flex-row sm:justify-end">
            <Button className="rounded-xl" disabled={isSubmitting} onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button className="rounded-xl" disabled={isSubmitting} type="submit">
              <Plus data-icon="inline-start" />
              {isSubmitting ? 'Adding…' : 'Add itinerary'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ProjectCard({ project, onOpen }: { project: LoadedProject; onOpen: () => void }) {
  const placeCount = getProjectPlaceCount(project)
  const status = project.placesStatus === 'ready' ? getProjectStatus(project) : 'Loading places'
  const placesLabel = project.placesStatus === 'loading' ? 'Loading places…'
    : project.placesStatus === 'error' ? 'Places unavailable' : `${placeCount} ${placeCount === 1 ? 'place' : 'places'}`

  return (
    <Card
      aria-label={`Open ${project.name}`}
      className="group overflow-hidden border-0 bg-white py-0 shadow-sm ring-1 ring-emerald-950/8 transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(24,61,47,0.09)]"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className={`relative h-28 bg-gradient-to-br ${project.accent}`}>
        <div className="project-contours absolute inset-0 opacity-35" aria-hidden="true" />
        <span className="absolute top-4 left-4 flex size-9 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur ring-1 ring-white/20">
          <MapPin className="size-4" aria-hidden="true" />
        </span>
        <Badge className="absolute top-4 right-4 border-white/15 bg-white/12 text-white" variant="outline">
          {project.placesStatus === 'error' ? 'Load failed' : status}
        </Badge>
      </div>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold tracking-tight text-emerald-950">{project.name}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.destination}</span>
            </p>
          </div>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-800 group-hover:text-white">
            <ChevronRight className="size-4" aria-hidden="true" />
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-emerald-950/8 pt-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {formatDateRange(project.startDate, project.endDate)}
          </span>
          <span>{placesLabel}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function Dashboard({
  name,
  projects,
  loadError,
  loading,
  onCreate,
  onOpen,
  onSignOut,
}: {
  name: string
  projects: LoadedProject[]
  loadError: boolean
  loading: boolean
  onCreate: (project: NewItineraryProject) => Promise<boolean>
  onOpen: (projectId: number) => void
  onSignOut: () => void
}) {
  const [showCreator, setShowCreator] = useState(false)
  const creatorTriggerRef = useRef<HTMLButtonElement | null>(null)

  const totalPlaces = useMemo(
    () => projects.reduce((total, project) => total + getProjectPlaceCount(project), 0),
    [projects],
  )

  const openCreator = (event: MouseEvent<HTMLButtonElement>) => {
    creatorTriggerRef.current = event.currentTarget
    setShowCreator(true)
  }

  const closeCreator = () => {
    setShowCreator(false)
    creatorTriggerRef.current?.focus()
  }

  return (
    <div className="min-h-dvh bg-[#f4f5f1] text-emerald-950">
      <header className="border-b border-emerald-950/8 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <BrandMark />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{name}</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 font-semibold text-emerald-800">
              {name.charAt(0).toUpperCase()}
            </span>
            <Button className="rounded-xl" onClick={onSignOut} size="sm" variant="outline">
              <LogOut data-icon="inline-start" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12 lg:px-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">Welcome, {name}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Your itinerary projects</h1>
            <p className="mt-3 max-w-xl text-slate-500">Create a trip, collect the places you care about, and shape each day from one workspace.</p>
          </div>
          <Button
            aria-controls="create-itinerary-panel"
            aria-expanded={showCreator}
            className="h-11 rounded-xl px-5 shadow-[0_10px_25px_rgba(27,93,70,0.16)]"
            onClick={openCreator}
          >
            <Plus data-icon="inline-start" />
            Create itinerary
          </Button>
        </div>

        {loadError && (
          <p className="mt-6 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-700/10" role="alert">
            Couldn't load your trips. Please try again.
          </p>
        )}

        <section aria-label="Itinerary overview" className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            [FolderKanban, loading ? 'Loading…' : `${projects.length}`, 'Itinerary projects'],
            [MapPin, loadError || projects.some(project => project.placesStatus === 'error') ? 'Unavailable'
              : loading || projects.some(project => project.placesStatus === 'loading') ? 'Loading…' : `${totalPlaces}`, 'Planned places'],
            [Compass, '0 km', 'Routes planned'],
          ].map(([Icon, value, label]) => {
            const StatIcon = Icon as typeof FolderKanban
            return (
              <Card className="border-0 bg-white py-0 shadow-sm ring-1 ring-emerald-950/8" key={label as string}>
                <CardContent className="flex items-center gap-4 p-5">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                    <StatIcon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-2xl font-semibold tracking-tight">{value as string}</p>
                    <p className="text-xs text-slate-500">{label as string}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        {showCreator && (
          <section className="mt-8" aria-label="New itinerary panel" id="create-itinerary-panel">
            <CreateItineraryPanel onCancel={closeCreator} onCreate={onCreate} />
          </section>
        )}

        <section className="mt-10" aria-labelledby="projects-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight" id="projects-heading">All itineraries</h2>
              <p className="mt-1 text-sm text-slate-500">
                {projects.length} itinerary {projects.length === 1 ? 'project' : 'projects'}
              </p>
            </div>
          </div>

          {loading && projects.length === 0 ? <p className="mt-5" role="status">Loading your trips…</p> : projects.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-emerald-900/20 bg-white/45 px-6 py-14 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <FolderKanban className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 font-semibold">You don't have any trips planned yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Create your first itinerary to start collecting places and shaping your days.
              </p>
              <Button
                aria-controls="create-itinerary-panel"
                aria-expanded={showCreator}
                className="mt-5 rounded-xl"
                onClick={openCreator}
              >
                <Plus data-icon="inline-start" />
                Create your first itinerary
              </Button>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} onOpen={() => onOpen(project.id)} project={project} />
              ))}

              <button
                aria-controls="create-itinerary-panel"
                aria-expanded={showCreator}
                className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-900/20 bg-white/45 p-8 text-center transition hover:border-emerald-700/40 hover:bg-white"
                onClick={openCreator}
                type="button"
              >
                <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <Plus className="size-5" aria-hidden="true" />
                </span>
                <span className="mt-4 font-semibold">Plan another trip</span>
                <span className="mt-2 max-w-48 text-sm leading-6 text-slate-500">Start a separate itinerary project for your next destination.</span>
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function App() {
  const [view, setView] = useState<AppView>('auth')
  const [sessionCheck, setSessionCheck] = useState<'ready' | 'checking' | 'error'>(
    () => localStorage.getItem('refreshToken') ? 'checking' : 'ready',
  )
  const [sessionAttempt, setSessionAttempt] = useState(0)
  const [displayName, setDisplayName] = useState('Traveller')
  const [userId, setUserId] = useState('')
  const [projects, setProjects] = useState<LoadedProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsLoadError, setProjectsLoadError] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const authGenerationRef = useRef(0)

  const loadProjectPlaces = useCallback(async (project: LoadedProject, signedInUserId: string, generation: number) => {
    setProjects(current => current.map(item => item.id === project.id ? { ...item, placesStatus: 'loading' } : item))
    try {
      const stops = await listBackendStops(project.backendTripId!, signedInUserId)
      if (authGenerationRef.current !== generation) return
      setProjects(current => current.map(item => item.id !== project.id ? item : {
        ...item,
        placesStatus: 'ready',
        days: item.days.map(day => ({
          ...day,
          // The backend returns saved drag order. Do not re-sort by start time.
          activities: stops.filter(stop => stop.date === day.date).map(stop => ({
            id: createClientId(),
            name: stop.placeName,
            category: stop.category,
            time: stop.time ?? '',
            duration: `${stop.visitDurationMinutes} min`,
            address: stop.address || 'Address to be confirmed',
            location: stop.location,
            backendStopId: stop.stopId,
            ...(stop.notes ? { notes: stop.notes } : {}),
          })),
        })),
      }))
    } catch {
      if (authGenerationRef.current !== generation) return
      setProjects(current => current.map(item => item.id === project.id ? { ...item, placesStatus: 'error' } : item))
    }
  }, [])

  const continueToDashboard = useCallback(async (name: string, signedInUserId: string) => {
    const generation = ++authGenerationRef.current
    setDisplayName(name)
    setUserId(signedInUserId)
    setProjects([])
    setProjectsLoadError(false)
    setProjectsLoading(true)
    setView('dashboard')

    try {
      const backendTrips = await listBackendTrips(signedInUserId)
      if (authGenerationRef.current !== generation) {
        return
      }
      const loadedProjects: LoadedProject[] = backendTrips.map((trip) => ({
        id: createClientId(),
        name: trip.name,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        collaborators: 1,
        accent: 'from-[#276b54] to-[#84a98c]',
        days: createItineraryDays(trip.startDate, trip.endDate),
        backendTripId: trip.tripId,
        placesStatus: 'loading',
      }))
      // Preserve trips created while this older list request was in flight.
      setProjects(current => [
        ...current,
        ...loadedProjects.filter(project => !current.some(item => item.backendTripId === project.backendTripId)),
      ])
      for (const project of loadedProjects) void loadProjectPlaces(project, signedInUserId, generation)
    } catch (error) {
      console.error('Could not load trips from the backend (is `npm run dev` running in backend/?):', error)
      if (authGenerationRef.current === generation) {
        setProjectsLoadError(true)
      }
    } finally {
      if (authGenerationRef.current === generation) setProjectsLoading(false)
    }
  }, [loadProjectPlaces])

  const clearPrivateState = useCallback(() => {
    authGenerationRef.current += 1
    setProjects([])
    setSelectedProjectId(null)
    setUserId('')
    setDisplayName('Traveller')
    setProjectsLoadError(false)
    setProjectsLoading(false)
    setView('auth')
  }, [])

  const signOut = useCallback(() => {
    // signOutUser clears local tokens synchronously; remote revocation can be
    // slow, so hide private UI now and let revocation finish on its own. It
    // catches its own failures, so the promise never rejects.
    void signOutUser()
    clearPrivateState()
    setSessionCheck('ready')
    setSessionAttempt((attempt) => attempt + 1)
  }, [clearPrivateState])

  useEffect(() => {
    if (!localStorage.getItem('refreshToken')) {
      setSessionCheck('ready')
      return
    }
    let cancelled = false
    setSessionCheck('checking')
    restoreSession().then((tokens) => {
      if (cancelled) return
      if (tokens) {
        const identity = readIdTokenIdentity(tokens.idToken)
        void continueToDashboard(identity.name, identity.userId)
      } else {
        clearPrivateState()
      }
      setSessionCheck('ready')
    }).catch(() => {
      if (!cancelled) setSessionCheck('error')
    })
    return () => { cancelled = true }
  }, [sessionAttempt, continueToDashboard, clearPrivateState])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== 'refreshToken') return
      invalidatePendingSession()
      clearPrivateState()
      setSessionCheck(localStorage.getItem('refreshToken') ? 'checking' : 'ready')
      setSessionAttempt((attempt) => attempt + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearPrivateState])

  const openProject = (projectId: number) => {
    setSelectedProjectId(projectId)
    setView('planner')
  }

  const createProject = async (project: NewItineraryProject): Promise<boolean> => {
    const generation = authGenerationRef.current
    let backendTripId: string
    try {
      const trip = await createBackendTrip({ ...project, userId })
      backendTripId = trip.tripId
    } catch (error) {
      console.error('Could not create the trip in the backend:', error)
      return false
    }
    if (authGenerationRef.current !== generation) return false

    const id = createClientId()
    setProjects((current) => [
      {
        ...project,
        id,
        backendTripId,
        placesStatus: 'ready',
        collaborators: 1,
        accent: 'from-[#8a633e] to-[#d6b47d]',
        days: createItineraryDays(project.startDate, project.endDate),
      },
      ...current,
    ])
    void openProject(id)
    return true
  }

  const updateProject = (projectId: number, update: (project: ItineraryProject) => ItineraryProject) => {
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, ...update(project) } : project)),
    )
  }

  const editProject = async (projectId: number, updates: NewItineraryProject): Promise<boolean> => {
    const project = projects.find((current) => current.id === projectId)

    if (project?.backendTripId) {
      try {
        await updateBackendTrip(project.backendTripId, userId, updates)
      } catch (error) {
        console.error('Could not update the trip in the backend (is `npm run dev` running in backend/?):', error)
        return false
      }
    }

    setProjects((current) =>
      current.map((current_project) => (current_project.id === projectId ? { ...current_project, ...updateItineraryDates(current_project, updates.startDate, updates.endDate), ...updates } : current_project)),
    )
    return true
  }

  const deleteProject = async (projectId: number): Promise<boolean> => {
    const project = projects.find((current) => current.id === projectId)

    if (project?.backendTripId) {
      try {
        await deleteBackendTrip(project.backendTripId, userId)
      } catch (error) {
        console.error('Could not delete the trip in the backend (is `npm run dev` running in backend/?):', error)
        return false
      }
    }

    setProjects((current) => current.filter((item) => item.id !== projectId))
    setView('dashboard')
    return true
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId)

  if (sessionCheck !== 'ready') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f4f5f1] p-6 text-emerald-950">
        <div className="max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm">
          <BrandMark />
          {sessionCheck === 'checking'
            ? <p role="status">Restoring your session…</p>
            : <p role="alert">Couldn't restore your session. Check your connection and try again.</p>}
          <div className="flex flex-wrap gap-3">
            {sessionCheck === 'error' && <Button onClick={() => setSessionAttempt((attempt) => attempt + 1)}>Try again</Button>}
            <Button variant="outline" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </main>
    )
  }

  if (view === 'planner' && selectedProject) {
    if (selectedProject.placesStatus !== 'ready') {
      return (
        <main className="mx-auto max-w-3xl space-y-6 p-6 text-emerald-950">
          <Button variant="outline" onClick={() => setView('dashboard')}>Back to itineraries</Button>
          <h1 className="text-2xl font-semibold">{selectedProject.name}</h1>
          {selectedProject.placesStatus === 'loading'
            ? <p role="status">Loading places…</p>
            : <>
                <p role="alert">Couldn't load this itinerary's places. Your saved places have not been changed.</p>
                <Button onClick={() => void loadProjectPlaces(selectedProject, userId, authGenerationRef.current)}>Try again</Button>
              </>}
        </main>
      )
    }
    return (
      <ItineraryPlanner
        onBack={() => setView('dashboard')}
        onChange={updateProject}
        onDelete={() => deleteProject(selectedProject.id)}
        onEdit={(updates) => editProject(selectedProject.id, updates)}
        project={selectedProject}
        userId={userId}
      />
    )
  }

  if (view === 'dashboard') {
    return (
      <Dashboard
        name={displayName}
        loadError={projectsLoadError}
        loading={projectsLoading}
        onCreate={createProject}
        onOpen={openProject}
        onSignOut={signOut}
        projects={projects}
      />
    )
  }

  return <AuthScreen onContinue={continueToDashboard} />
}

export default App
