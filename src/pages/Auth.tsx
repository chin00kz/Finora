import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

type Mode = 'signin' | 'signup' | 'forgot';

export default function Auth() {
  const navigate = useNavigate();
  const { signIn, signUp, sendPasswordReset } = useAuthStore();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const reset = (nextMode: Mode) => {
    setMode(nextMode);
    setError(null);
    setSuccessMsg(null);
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsLoading(true);

    if (mode === 'forgot') {
      const err = await sendPasswordReset(email);
      setIsLoading(false);
      if (err) {
        setError(err);
      } else {
        setSuccessMsg('Check your email for a password reset link.');
      }
      return;
    }

    if (mode === 'signup') {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed.endsWith('@chinookz.33mail.com')) {
        setError('SignUp not allowed please contact Nookz.Inc');
        setIsLoading(false);
        return;
      }
    }

    const err = mode === 'signup'
      ? await signUp(email, password)
      : await signIn(email, password);

    setIsLoading(false);

    if (err) {
      setError(err);
      return;
    }

    // On success, go back to the app
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Back button */}
      <div className="p-4 pt-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-muted-foreground text-sm font-medium active:scale-95 transition-transform"
        >
          <ArrowLeft size={18} />
          Back to app
        </button>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-16">
        <div className="max-w-sm mx-auto w-full">
          <div className="mb-8">
            <h1 className="text-2xl font-medium text-foreground mb-1">
              {mode === 'signin' && 'Sign in'}
              {mode === 'signup' && 'Create account'}
              {mode === 'forgot' && 'Reset password'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'signin' && 'Welcome back. Sign in to sync your data across devices.'}
              {mode === 'signup' && 'Create an account to back up and sync your financial data.'}
              {mode === 'forgot' && "Enter your email and we'll send a reset link."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 bg-card border border-border rounded-xl text-foreground font-medium outline-none focus:border-foreground transition-colors"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {/* Password */}
            {mode !== 'forgot' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full pl-10 pr-12 py-3.5 bg-card border border-border rounded-xl text-foreground font-medium outline-none focus:border-foreground transition-colors"
                    placeholder="Min. 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-500 font-medium">
                {error}
              </div>
            )}

            {/* Success */}
            {successMsg && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-600 font-medium">
                {successMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-accent text-accent-foreground rounded-xl font-medium text-base active:scale-[0.98] transition-transform disabled:opacity-60 mt-2"
            >
              {isLoading
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>

          {/* Footer links */}
          <div className="mt-6 space-y-3 text-center">
            {mode === 'signin' && (
              <>
                <button
                  onClick={() => reset('forgot')}
                  className="block w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </button>
                <button
                  onClick={() => reset('signup')}
                  className="block w-full text-sm font-medium text-foreground"
                >
                  Don't have an account? <span className="underline">Sign up</span>
                </button>
              </>
            )}
            {mode === 'signup' && (
              <button
                onClick={() => reset('signin')}
                className="block w-full text-sm font-medium text-foreground"
              >
                Already have an account? <span className="underline">Sign in</span>
              </button>
            )}
            {mode === 'forgot' && (
              <button
                onClick={() => reset('signin')}
                className="block w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

