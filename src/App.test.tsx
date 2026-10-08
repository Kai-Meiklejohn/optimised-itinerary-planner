import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import App from './App'
import { confirmSignUpUser, forgotPassword, resendConfirmationCode, signInUser, signUpUser } from './services/authService'
import { createUserProfile } from './services/userService'

const { fakeTokens, buildIdToken } = vi.hoisted(() => {
  function toBase64Url(value: string) {
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function buildIdToken(sub: string) {
    const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const body = toBase64Url(JSON.stringify({ sub, name: 'Kai Meiklejohn' }))
    return `${header}.${body}.fake-signature`
  }

  return {
    fakeTokens: {
      accessToken: 'fake-access-token',
      idToken: buildIdToken('test-user-1'),
      refreshToken: 'fake-refresh-token',
    },
    buildIdToken,
  }
})

vi.mock('./services/userService', () => ({
  createUserProfile: vi.fn().mockResolvedValue({}),
}))

vi.mock('./services/authService', () => ({
  signUpUser: vi.fn().mockResolvedValue({}),
  confirmSignUpUser: vi.fn().mockResolvedValue({}),
  resendConfirmationCode: vi.fn().mockResolvedValue({}),
  signInUser: vi.fn().mockResolvedValue(fakeTokens),
  forgotPassword: vi.fn().mockResolvedValue({}),
  confirmForgotPassword: vi.fn().mockResolvedValue({}),
  signOutUser: vi.fn(),
  getSessionVersion: () => 0,
  invalidatePendingSession: vi.fn(),
  restoreSession: vi.fn().mockResolvedValue(null),
}))

async function signIn() {
  const user = userEvent.setup()
  const form = screen.getByRole('form', { name: 'Sign in' })

  await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
  await user.type(within(form).getByLabelText('Password'), 'password123')
  await user.click(within(form).getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Your itinerary projects' })

  return user
}

describe('App', () => {
  it('rejects an otherwise valid eleven-character password before contacting Cognito', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const form = screen.getByRole('form', { name: 'Create account' })
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'Password12!' } })
    fireEvent.change(within(form).getByLabelText('Confirm password'), { target: { value: 'Password12!' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert')).toHaveTextContent('at least 12 characters')
    expect(signUpUser).not.toHaveBeenCalled()
  })

  it('lets a user switch to sign up, verify, and enter the dashboard', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    const form = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(form).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(form).getByLabelText('Password'), 'Password123!')
    await user.type(within(form).getByLabelText('Confirm password'), 'Password123!')
    await user.click(within(form).getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Verify your account' })).toBeInTheDocument()

    const verifyForm = screen.getByRole('form', { name: 'Verify your account' })
    await user.type(within(verifyForm).getByLabelText('Confirmation code'), '000000')
    await user.click(within(verifyForm).getByRole('button', { name: 'Verify account' }))

    expect(await screen.findByRole('heading', { name: 'Your itinerary projects' })).toBeInTheDocument()
    expect(screen.getByText('Welcome, Kai')).toBeInTheDocument()
    expect(screen.getByText('You don\'t have any trips planned yet')).toBeInTheDocument()
    expect(createUserProfile).toHaveBeenCalled()
  })

  it('clears credentials when switching to sign up or forgot password', async () => {
    const user = userEvent.setup()
    render(<App />)

    const signInForm = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(signInForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signInForm).getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    expect(within(signUpForm).getByLabelText('Email address')).toHaveValue('')
    expect(within(signUpForm).getByLabelText('Password')).toHaveValue('')
    expect(within(signUpForm).getByLabelText('Confirm password')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(within(screen.getByRole('form', { name: 'Sign in' })).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(screen.getByRole('form', { name: 'Sign in' })).getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))

    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    expect(within(forgotForm).getByLabelText('Email address')).toHaveValue('')
  })

  it('opens the forgot password form from sign in', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))

    const form = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(form).getByRole('button', { name: 'Send reset code' }))

    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    expect(within(resetForm).getByLabelText('Reset code')).toBeInTheDocument()
    expect(within(resetForm).getByLabelText('New password')).toBeInTheDocument()
    expect(within(resetForm).getByLabelText('Confirm password')).toBeInTheDocument()
    await user.type(within(resetForm).getByLabelText('Reset code'), '000000')
    await user.type(within(resetForm).getByLabelText('New password'), 'NewPassword123!')
    await user.type(within(resetForm).getByLabelText('Confirm password'), 'NewPassword123!')
    await user.click(within(resetForm).getByRole('button', { name: 'Reset password' }))

    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Password reset successfully. You can now sign in.')).toBeInTheDocument()
  })

  it('requires matching passwords when signing up and resetting a password', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(signUpForm).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(signUpForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signUpForm).getByLabelText('Password'), 'Password123!')
    await user.type(within(signUpForm).getByLabelText('Confirm password'), 'Different123!')
    await user.click(within(signUpForm).getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')

    cleanup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))
    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(resetForm).getByLabelText('Reset code'), '000000')
    await user.type(within(resetForm).getByLabelText('New password'), 'NewPassword123!')
    await user.type(within(resetForm).getByLabelText('Confirm password'), 'Different123!')
    await user.click(within(resetForm).getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
  })

  it('rejects a reset password that fails the same policy enforced at sign-up', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))

    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(resetForm).getByLabelText('Reset code'), '000000')
    await user.type(within(resetForm).getByLabelText('New password'), 'weakpassword')
    await user.type(within(resetForm).getByLabelText('Confirm password'), 'weakpassword')
    await user.click(within(resetForm).getByRole('button', { name: 'Reset password' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password must be at least 12 characters long and include an uppercase letter, lowercase letter, number, and special character.',
    )
  })

  it('shows the password criteria checklist while resetting a password too, not just at sign-up', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))

    expect(screen.getByText('Password must contain:')).toBeInTheDocument()
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument()
  })

  it('clears a partially entered new password when returning to sign in from reset password', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))

    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(resetForm).getByLabelText('New password'), 'PartialPass1!')
    await user.click(within(resetForm).getByRole('button', { name: 'Back to sign in' }))

    const signInForm = screen.getByRole('form', { name: 'Sign in' })
    expect(within(signInForm).getByLabelText('Password')).toHaveValue('')
  })

  it('resends a fresh code and continues to verify instead of stranding a user who went Back and resubmitted sign-up', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(signUpForm).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(signUpForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signUpForm).getByLabelText('Password'), 'Password123!')
    await user.type(within(signUpForm).getByLabelText('Confirm password'), 'Password123!')

    const usernameExistsError = new Error('An account with the given email already exists.')
    usernameExistsError.name = 'UsernameExistsException'
    vi.mocked(signUpUser).mockRejectedValueOnce(usernameExistsError)

    await user.click(within(signUpForm).getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Verify your account' })).toBeInTheDocument()
    expect(vi.mocked(resendConfirmationCode)).toHaveBeenCalledWith('kai@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      "Sign in with the password from your original sign-up, not necessarily this one.",
    )
  })

  it('preserves the email when going Back from verify, so resubmitting the same account does not require retyping it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(signUpForm).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(signUpForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signUpForm).getByLabelText('Password'), 'Password123!')
    await user.type(within(signUpForm).getByLabelText('Confirm password'), 'Password123!')
    await user.click(within(signUpForm).getByRole('button', { name: 'Create account' }))

    const verifyForm = await screen.findByRole('form', { name: 'Verify your account' })
    await user.click(within(verifyForm).getByRole('button', { name: 'Back' }))

    const signUpFormAgain = screen.getByRole('form', { name: 'Create account' })
    expect(within(signUpFormAgain).getByLabelText('Email address')).toHaveValue('kai@example.com')
  })

  it('clears the stale confirmation code and any leftover banner when going Back from verify', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(signUpForm).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(signUpForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signUpForm).getByLabelText('Password'), 'Password123!')
    await user.type(within(signUpForm).getByLabelText('Confirm password'), 'Password123!')
    await user.click(within(signUpForm).getByRole('button', { name: 'Create account' }))

    const verifyForm = await screen.findByRole('form', { name: 'Verify your account' })
    const expiredError = new Error('Invalid code provided, please request a code again.')
    expiredError.name = 'ExpiredCodeException'
    vi.mocked(confirmSignUpUser).mockRejectedValueOnce(expiredError)
    await user.type(within(verifyForm).getByLabelText('Confirmation code'), '000000')
    await user.click(within(verifyForm).getByRole('button', { name: 'Verify account' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(within(verifyForm).getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const usernameExistsError = new Error('An account with the given email already exists.')
    usernameExistsError.name = 'UsernameExistsException'
    vi.mocked(signUpUser).mockRejectedValueOnce(usernameExistsError)
    const signUpFormAgain = screen.getByRole('form', { name: 'Create account' })
    await user.click(within(signUpFormAgain).getByRole('button', { name: 'Create account' }))

    const verifyFormAgain = await screen.findByRole('form', { name: 'Verify your account' })
    expect(within(verifyFormAgain).getByLabelText('Confirmation code')).toHaveValue('')
  })

  it('preserves the email when going Back to sign in from forgot password, since there is no password to leak yet', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Back to sign in' }))

    const signInForm = screen.getByRole('form', { name: 'Sign in' })
    expect(within(signInForm).getByLabelText('Email address')).toHaveValue('kai@example.com')
  })

  it('clears a leftover error banner when going Back to sign in from forgot password', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    vi.mocked(forgotPassword).mockRejectedValueOnce(new Error('Too many requests. Try again later.'))
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(within(forgotForm).getByRole('button', { name: 'Back to sign in' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves the email when going Back to sign in from reset password, only clearing the reset-specific fields', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const forgotForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(forgotForm).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(forgotForm).getByRole('button', { name: 'Send reset code' }))

    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(resetForm).getByLabelText('Reset code'), '000000')
    await user.click(within(resetForm).getByRole('button', { name: 'Back to sign in' }))

    const signInForm = screen.getByRole('form', { name: 'Sign in' })
    expect(within(signInForm).getByLabelText('Email address')).toHaveValue('kai@example.com')
  })

  it('still surfaces the error when resubmitting sign-up for an email that is already confirmed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const signUpForm = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(signUpForm).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(signUpForm).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(signUpForm).getByLabelText('Password'), 'Password123!')
    await user.type(within(signUpForm).getByLabelText('Confirm password'), 'Password123!')

    const usernameExistsError = new Error('An account with the given email already exists.')
    usernameExistsError.name = 'UsernameExistsException'
    vi.mocked(signUpUser).mockRejectedValueOnce(usernameExistsError)
    const alreadyConfirmedError = new Error('User is already confirmed.')
    vi.mocked(resendConfirmationCode).mockRejectedValueOnce(alreadyConfirmedError)

    await user.click(within(signUpForm).getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('User is already confirmed.')
    expect(screen.getByRole('form', { name: 'Create account' })).toBeInTheDocument()
  })

  it('lets the user resend the confirmation code without a client-side expiry gating verify', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    const form = screen.getByRole('form', { name: 'Create account' })
    fireEvent.change(within(form).getByLabelText('Full name'), { target: { value: 'Kai Meiklejohn' } })
    fireEvent.change(within(form).getByLabelText('Email address'), { target: { value: 'kai@example.com' } })
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'Password123!' } })
    fireEvent.change(within(form).getByLabelText('Confirm password'), { target: { value: 'Password123!' } })
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Create account' }))
    })

    const verifyForm = screen.getByRole('form', { name: 'Verify your account' })
    expect(within(verifyForm).getByRole('button', { name: 'Verify account' })).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(within(verifyForm).getByRole('button', { name: 'Resend code' }))
    })

    expect(screen.getByText('A new confirmation code has been sent to your email.')).toBeInTheDocument()
    expect(within(verifyForm).getByRole('button', { name: 'Verify account' })).not.toBeDisabled()
  })

  it('disables the resend-code button while a request is in flight, preventing a duplicate resend', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const form = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(form).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(form).getByLabelText('Password'), 'Password123!')
    await user.type(within(form).getByLabelText('Confirm password'), 'Password123!')
    await user.click(within(form).getByRole('button', { name: 'Create account' }))

    const verifyForm = await screen.findByRole('form', { name: 'Verify your account' })

    vi.mocked(resendConfirmationCode).mockClear()
    let resolveResend!: () => void
    vi.mocked(resendConfirmationCode).mockImplementationOnce(
      () => new Promise((resolve) => { resolveResend = () => resolve({} as Awaited<ReturnType<typeof resendConfirmationCode>>) }),
    )

    const resendButton = within(verifyForm).getByRole('button', { name: 'Resend code' })
    await user.click(resendButton)

    expect(resendButton).toBeDisabled()
    expect(vi.mocked(resendConfirmationCode)).toHaveBeenCalledTimes(1)

    resolveResend()

    expect(await screen.findByText('A new confirmation code has been sent to your email.')).toBeInTheDocument()
  })

  it('shows the sign-up password criteria under the field', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(screen.getByText('Password must contain:')).toBeInTheDocument()
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument()
    expect(screen.getByText('One uppercase letter (A-Z)')).toBeInTheDocument()
    expect(screen.getByText('One number (0-9)')).toBeInTheDocument()
    expect(screen.getByText('One special character (!@#$%...)')).toBeInTheDocument()
  })

  it('disables the sign-in button while a request is in flight, preventing a duplicate submission', async () => {
    const user = userEvent.setup()
    render(<App />)

    vi.mocked(signInUser).mockClear()
    let resolveSignIn!: (tokens: typeof fakeTokens) => void
    vi.mocked(signInUser).mockImplementationOnce(() => new Promise((resolve) => { resolveSignIn = resolve }))

    const form = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(form).getByLabelText('Password'), 'password123')

    const submitButton = within(form).getByRole('button', { name: 'Sign in' })
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(vi.mocked(signInUser)).toHaveBeenCalledTimes(1)

    resolveSignIn(fakeTokens)

    expect(await screen.findByRole('heading', { name: 'Your itinerary projects' })).toBeInTheDocument()
  })

  it.each([
    ['UserNotFoundException', 'User does not exist.'],
    ['NotAuthorizedException', 'Incorrect username or password.'],
    ['UserNotConfirmedException', 'User is not confirmed.'],
    ['PasswordResetRequiredException', 'Password reset required for the user.'],
  ])('shows the same generic error for a %s as for a wrong password, so sign-in cannot reveal which emails are registered', async (errorName, rawMessage) => {
    const user = userEvent.setup()
    render(<App />)

    const cognitoError = new Error(rawMessage)
    cognitoError.name = errorName
    vi.mocked(signInUser).mockRejectedValueOnce(cognitoError)

    const form = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(form).getByLabelText('Email address'), 'someone@example.com')
    await user.type(within(form).getByLabelText('Password'), 'wrong-password')
    await user.click(within(form).getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument()
  })

  it('shows a friendly message for an expired confirmation code instead of the raw Cognito exception text', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    const form = screen.getByRole('form', { name: 'Create account' })
    await user.type(within(form).getByLabelText('Full name'), 'Kai Meiklejohn')
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(form).getByLabelText('Password'), 'Password123!')
    await user.type(within(form).getByLabelText('Confirm password'), 'Password123!')
    await user.click(within(form).getByRole('button', { name: 'Create account' }))

    const verifyForm = await screen.findByRole('form', { name: 'Verify your account' })
    const expiredError = new Error('Invalid code provided, please request a code again.')
    expiredError.name = 'ExpiredCodeException'
    vi.mocked(confirmSignUpUser).mockRejectedValueOnce(expiredError)

    await user.type(within(verifyForm).getByLabelText('Confirmation code'), '000000')
    await user.click(within(verifyForm).getByRole('button', { name: 'Verify account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That confirmation code has expired. Request a new one and try again.')
    expect(screen.queryByText(expiredError.message)).not.toBeInTheDocument()
  })

  it('shows success confirmations in a status region, not the error alert', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const form = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.click(within(form).getByRole('button', { name: 'Send reset code' }))

    const resetForm = screen.getByRole('form', { name: 'Reset your password' })
    await user.type(within(resetForm).getByLabelText('Reset code'), '000000')
    await user.type(within(resetForm).getByLabelText('New password'), 'NewPassword123!')
    await user.type(within(resetForm).getByLabelText('Confirm password'), 'NewPassword123!')
    await user.click(within(resetForm).getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Password reset successfully. You can now sign in.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('creates an itinerary and opens its planning workspace', async () => {
    render(<App />)
    const user = await signIn()

    await user.click(screen.getByRole('button', { name: 'Create itinerary' }))

    const form = screen.getByRole('form', { name: 'Create itinerary' })
    await user.type(within(form).getByLabelText('Trip name'), 'Weekend in Wellington')
    await user.type(within(form).getByLabelText('Main destination'), 'Wellington, New Zealand')
    await user.type(within(form).getByLabelText('Start date'), '2027-09-10')
    await user.type(within(form).getByLabelText('End date'), '2027-09-12')
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ tripId: 'trip-1' }) } as Response)
    await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))

    expect(await screen.findByRole('heading', { name: 'Build your itinerary' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Weekend in Wellington' })).toBeInTheDocument()
    expect(screen.getAllByText('Wellington, New Zealand')).toHaveLength(2)
    expect(screen.getByText('Nothing planned for this day yet')).toBeInTheDocument()
    expect(screen.getByText('Fri, 10 Sept')).toBeInTheDocument()
    expect(screen.getByText('Sun, 12 Sept')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add the first place' }))

    const placeForm = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(placeForm).getByLabelText('Place name'), 'Te Papa Museum')
    await user.type(within(placeForm).getByLabelText('Address (optional)'), '55 Cable Street')
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ stopId: 'stop-1', placeName: 'Te Papa Museum', category: 'Attraction', address: '55 Cable Street', visitDurationMinutes: 60, time: '10:00', date: '2027-09-10' }) } as Response)
    await user.click(within(placeForm).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('heading', { name: 'Te Papa Museum' })).toBeInTheDocument()
    expect(screen.getAllByText('Not shown on map')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Back to itineraries' }))

    expect(screen.getByText('1 itinerary project')).toBeInTheDocument()
    expect(screen.getByText('Weekend in Wellington')).toBeInTheDocument()
    expect(screen.getByText('1 place')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Weekend in Wellington/i }))
    expect(screen.getByRole('heading', { name: 'Te Papa Museum' })).toBeInTheDocument()
  })

  it('disables the submit button while creating a trip, preventing a duplicate trip from a double-click', async () => {
    render(<App />)
    const user = await signIn()
    vi.mocked(globalThis.fetch).mockClear()

    let resolveFetch!: (response: Response) => void
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )

    await user.click(screen.getByRole('button', { name: 'Create itinerary' }))
    const form = screen.getByRole('form', { name: 'Create itinerary' })
    await user.type(within(form).getByLabelText('Trip name'), 'Weekend in Wellington')
    await user.type(within(form).getByLabelText('Main destination'), 'Wellington, New Zealand')
    await user.type(within(form).getByLabelText('Start date'), '2027-09-10')
    await user.type(within(form).getByLabelText('End date'), '2027-09-12')

    const submitButton = within(form).getByRole('button', { name: 'Add itinerary' })
    await user.click(submitButton)

    expect(within(form).getByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)

    resolveFetch({ ok: true, json: () => Promise.resolve({ tripId: 'trip-1' }) } as Response)

    expect(await screen.findByRole('heading', { name: 'Build your itinerary' })).toBeInTheDocument()
  })

  it('keeps the create form open when the trip date range is invalid', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as Response)
    render(<App />)
    const user = await signIn()

    await user.click(screen.getByRole('button', { name: 'Create itinerary' }))

    const form = screen.getByRole('form', { name: 'Create itinerary' })
    await user.type(within(form).getByLabelText('Trip name'), 'Invalid date trip')
    await user.type(within(form).getByLabelText('Main destination'), 'Auckland, New Zealand')
    await user.type(within(form).getByLabelText('Start date'), '2027-10-12')
    await user.type(within(form).getByLabelText('End date'), '2027-10-10')
    await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'End date must be the same as or later than the start date.',
    )
    expect(within(form).getByLabelText('End date')).toHaveFocus()
    expect(screen.getByRole('form', { name: 'Create itinerary' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Build your itinerary' })).not.toBeInTheDocument()
  })

  it('rejects blank trimmed trip details and excessive date ranges', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as Response)
    render(<App />)
    const user = await signIn()

    await user.click(screen.getByRole('button', { name: 'Create itinerary' }))

    const form = screen.getByRole('form', { name: 'Create itinerary' })
    await user.type(within(form).getByLabelText('Trip name'), '   ')
    await user.type(within(form).getByLabelText('Main destination'), '   ')
    await user.type(within(form).getByLabelText('Start date'), '2027-01-01')
    await user.type(within(form).getByLabelText('End date'), '2027-03-02')
    await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))

    expect(screen.getByText('Enter a trip name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a destination.')).toBeInTheDocument()
    expect(screen.getByText('Trips can be no longer than 60 days.')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
    expect(within(form).getByLabelText('Trip name')).toHaveFocus()
    expect(screen.getByRole('form', { name: 'Create itinerary' })).toBeInTheDocument()
  })

  it('closes the create form and restores focus to its trigger', async () => {
    render(<App />)
    const user = await signIn()
    const trigger = screen.getByRole('button', { name: 'Create itinerary' })

    await user.click(trigger)
    await user.click(within(screen.getByRole('form', { name: 'Create itinerary' })).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('form', { name: 'Create itinerary' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  async function createItinerary(user: ReturnType<typeof userEvent.setup>, overrides: {
    name: string
    destination: string
    startDate: string
    endDate: string
  }) {
    await user.click(screen.getByRole('button', { name: 'Create itinerary' }))
    const form = screen.getByRole('form', { name: 'Create itinerary' })
    await user.type(within(form).getByLabelText('Trip name'), overrides.name)
    await user.type(within(form).getByLabelText('Main destination'), overrides.destination)
    await user.type(within(form).getByLabelText('Start date'), overrides.startDate)
    await user.type(within(form).getByLabelText('End date'), overrides.endDate)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ tripId: 'trip-1' }) } as Response)
    await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))
    await screen.findByRole('heading', { name: 'Build your itinerary' })
  }

  it('persists edited dates before rebuilding days and preserves the old range on failure', async () => {
    render(<App />)
    const user = await signIn()
    await createItinerary(user, { name: 'Date edit trip', destination: 'Hamilton', startDate: '2027-05-01', endDate: '2027-05-02' })
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-03' } })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the trip changes')
    expect(screen.queryByRole('button', { name: /Day 3/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('End date')).toHaveValue('2027-05-03')
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ tripId: 'trip-1' }) } as Response)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('button', { name: /Day 3/ })).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenLastCalledWith(expect.stringContaining('/trips/trip-1'), expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ name: 'Date edit trip', destination: 'Hamilton', startDate: '2027-05-01', endDate: '2027-05-03' }),
    }))
  })

  it('opens an existing itinerary and switches between days', async () => {
    render(<App />)
    const user = await signIn()

    await createItinerary(user, {
      name: 'Kyoto in spring',
      destination: 'Kyoto, Japan',
      startDate: '2027-04-21',
      endDate: '2027-04-24',
    })
    await user.click(screen.getByRole('button', { name: 'Back to itineraries' }))

    await user.click(screen.getByRole('button', { name: /Kyoto in spring/i }))

    expect(screen.getByRole('heading', { name: 'Build your itinerary' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Day 4/i }))

    expect(screen.getByText('Nothing planned for this day yet')).toBeInTheDocument()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens an itinerary card with the %s key', async (_keyName, key) => {
    render(<App />)
    const user = await signIn()

    await createItinerary(user, {
      name: 'South Island road trip',
      destination: 'Queenstown, New Zealand',
      startDate: '2027-07-06',
      endDate: '2027-07-14',
    })
    await user.click(screen.getByRole('button', { name: 'Back to itineraries' }))

    const project = screen.getByRole('button', { name: /South Island road trip/i })
    project.focus()
    await user.keyboard(key)

    expect(screen.getByRole('heading', { name: 'South Island road trip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Build your itinerary' })).toBeInTheDocument()
  })

  it('opens the create form from the secondary dashboard action', async () => {
    render(<App />)
    const user = await signIn()
    const trigger = screen.getByRole('button', { name: /Create your first itinerary/i })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const form = screen.getByRole('form', { name: 'Create itinerary' })
    expect(within(form).getByLabelText('Trip name')).toHaveFocus()
  })

  it('loads a user\'s trips and stops on sign in', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-1',
          userId: 'test-user-1',
          name: 'Loaded from backend',
          destination: 'Auckland, New Zealand',
          startDate: '2027-08-01',
          endDate: '2027-08-02',
        },
      ]),
    } as Response)

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-1',
          stopId: 'stop-1',
          placeName: 'Sky Tower',
          category: 'Attraction',
          placeId: 'place-1',
          visitDurationMinutes: 60,
          priority: 3,
          date: '2027-08-01',
          time: '10:00',
          address: '1 Sky Tower Way, Auckland',
          notes: 'Book the skywalk in advance.',
        },
      ]),
    } as Response)

    render(<App />)
    const user = await signIn()

    expect(await screen.findByText('Loaded from backend')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Loaded from backend/i }))

    expect(await screen.findByRole('heading', { name: 'Sky Tower' })).toBeInTheDocument()
    expect(screen.getByText('1 Sky Tower Way, Auckland')).toBeInTheDocument()
    expect(screen.getByText('Book the skywalk in advance.')).toBeInTheDocument()
  })

  it('loads a trip\'s stops in their saved order, not re-sorted by time', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-1',
          userId: 'test-user-1',
          name: 'Loaded from backend',
          destination: 'Auckland, New Zealand',
          startDate: '2027-08-01',
          endDate: '2027-08-02',
        },
      ]),
    } as Response)

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-1', stopId: 'stop-1', placeName: 'Evening dinner', category: 'Food',
          placeId: 'place-1', visitDurationMinutes: 60, priority: 3, date: '2027-08-01', time: '19:00',
        },
        {
          tripId: 'trip-1', stopId: 'stop-2', placeName: 'Morning museum', category: 'Attraction',
          placeId: 'place-2', visitDurationMinutes: 60, priority: 3, date: '2027-08-01', time: '09:00',
        },
      ]),
    } as Response)

    render(<App />)
    const user = await signIn()
    await screen.findByText('Loaded from backend')

    await user.click(screen.getByRole('button', { name: /Loaded from backend/i }))
    await screen.findByRole('heading', { name: 'Evening dinner' })

    const activityNames = screen
      .getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
    expect(activityNames).toEqual(['Evening dinner', 'Morning museum'])
  })

  it('returns to sign in when the user signs out', async () => {
    render(<App />)
    const user = await signIn()

    expect(screen.getByRole('heading', { name: 'Your itinerary projects' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('shows a customer-facing error, with no mention of the backend, when the trip list fails to load', async () => {
    const user = userEvent.setup()

    render(<App />)
    const form = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(form).getByLabelText('Email address'), 'kai@example.com')
    await user.type(within(form).getByLabelText('Password'), 'password123')
    await user.click(within(form).getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Couldn\'t load your trips. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument()
  })

  it('does not populate the dashboard with a previous user\'s trips when their delayed response arrives after someone else signed in', async () => {
    const user = userEvent.setup()

    let resolveFirstTripsFetch!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstTripsFetch = resolve }),
    )

    render(<App />)
    const signInFormA = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(signInFormA).getByLabelText('Email address'), 'a@example.com')
    await user.type(within(signInFormA).getByLabelText('Password'), 'password123')
    await user.click(within(signInFormA).getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Your itinerary projects' })

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()

    vi.mocked(signInUser).mockResolvedValueOnce({ ...fakeTokens, idToken: buildIdToken('user-b') })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as Response)

    const signInFormB = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(signInFormB).getByLabelText('Email address'), 'b@example.com')
    await user.type(within(signInFormB).getByLabelText('Password'), 'password123')
    await user.click(within(signInFormB).getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Your itinerary projects' })

    await act(async () => {
      resolveFirstTripsFetch({
        ok: true,
        json: () => Promise.resolve([
          {
            tripId: 'trip-a',
            userId: 'test-user-1',
            name: 'User A\'s private trip',
            destination: 'Nowhere',
            startDate: '2027-01-01',
            endDate: '2027-01-02',
          },
        ]),
      } as Response)
    })

    expect(screen.queryByText('User A\'s private trip')).not.toBeInTheDocument()
  })

  it('does not apply a stale trips response from a sign-in attempt that was superseded by a later sign-in of the same user', async () => {
    const user = userEvent.setup()

    let resolveFirstTripsFetch!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstTripsFetch = resolve }),
    )

    render(<App />)
    const signInFormA = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(signInFormA).getByLabelText('Email address'), 'a@example.com')
    await user.type(within(signInFormA).getByLabelText('Password'), 'password123')
    await user.click(within(signInFormA).getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Your itinerary projects' })

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-b',
          userId: 'test-user-1',
          name: 'Second sign-in\'s trip',
          destination: 'Somewhere else',
          startDate: '2027-02-01',
          endDate: '2027-02-02',
        },
      ]),
    } as Response)

    const signInFormB = screen.getByRole('form', { name: 'Sign in' })
    await user.type(within(signInFormB).getByLabelText('Email address'), 'a@example.com')
    await user.type(within(signInFormB).getByLabelText('Password'), 'password123')
    await user.click(within(signInFormB).getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Second sign-in\'s trip')

    await act(async () => {
      resolveFirstTripsFetch({
        ok: true,
        json: () => Promise.resolve([
          {
            tripId: 'trip-a',
            userId: 'test-user-1',
            name: 'First sign-in\'s stale trip',
            destination: 'Nowhere',
            startDate: '2027-01-01',
            endDate: '2027-01-02',
          },
        ]),
      } as Response)
    })

    expect(screen.queryByText('First sign-in\'s stale trip')).not.toBeInTheDocument()
    expect(screen.getByText('Second sign-in\'s trip')).toBeInTheDocument()
  })

  it('waits for saved stops before adding an activity and preserves other days', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          tripId: 'trip-1',
          userId: 'test-user-1',
          name: 'Kyoto in spring',
          destination: 'Kyoto, Japan',
          startDate: '2027-04-21',
          endDate: '2027-04-24',
        },
      ]),
    } as Response)

    let resolveStopsFetch!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () => new Promise((resolve) => { resolveStopsFetch = resolve }),
    )
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Fushimi Inari Taisha', category: 'Attraction' }),
    } as Response)

    render(<App />)
    const user = await signIn()
    await screen.findByText('Kyoto in spring')

    await user.click(screen.getByRole('button', { name: /Kyoto in spring/i }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading places')
    expect(screen.queryByRole('button', { name: 'Add a place' })).not.toBeInTheDocument()

    await act(async () => {
      resolveStopsFetch({
        ok: true,
        json: () => Promise.resolve([
          {
            tripId: 'trip-1',
            stopId: 'stop-2',
            placeName: 'Kinkaku-ji',
            category: 'Attraction',
            placeId: 'place-2',
            visitDurationMinutes: 60,
            priority: 3,
            date: '2027-04-22',
            time: '09:00',
          },
          {
            tripId: 'trip-1',
            stopId: 'stop-3',
            placeName: 'Nishiki Market',
            category: 'Food',
            placeId: 'place-3',
            visitDurationMinutes: 60,
            priority: 3,
            date: '2027-04-21',
            time: '08:00',
          },
        ]),
      } as Response)
    })

    await user.click(screen.getByRole('button', { name: 'Add a place' }))
    const placeForm = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(placeForm).getByLabelText('Place name'), 'Fushimi Inari Taisha')
    await user.click(within(placeForm).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('heading', { name: 'Fushimi Inari Taisha' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Nishiki Market' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    expect(await screen.findByRole('heading', { name: 'Kinkaku-ji' })).toBeInTheDocument()
  })
})
