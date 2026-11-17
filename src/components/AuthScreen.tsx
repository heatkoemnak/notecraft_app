import React, { useState } from 'react';
import { Eye, EyeOff, FileText, Lock, Mail, Moon, Sun, User } from 'lucide-react';
import { AuthUser } from '../types/notes';
import { loginAccount, registerAccount, StorageBackendMode } from '../utils/authClient';
import { GoogleAccountSelectorModal } from './GoogleAccountSelectorModal';

interface AuthScreenProps {
  storageMode: StorageBackendMode;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({
  storageMode,
  theme,
  onToggleTheme,
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthProviderModal, setOauthProviderModal] = useState<'google' | 'github' | null>(null);

  const handleModeChange = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const user =
        mode === 'register'
          ? await registerAccount(storageMode, { name, email, password })
          : await loginAccount(storageMode, { email, password });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex flex-col bg-white dark:bg-[#121214] text-neutral-900 dark:text-[#ececf1]">
      {/* Minimal Header */}
      <header className="h-[56px] px-5 sm:px-8 flex items-center justify-between border-b border-neutral-200 dark:border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-neutral-900 dark:bg-white flex items-center justify-center text-white dark:text-neutral-950">
            <FileText className="w-4 h-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-neutral-950 dark:text-white">
            NoteCraft
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </>
          )}
        </button>
      </header>

      {/* Centered Auth Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] rounded-2xl border border-neutral-200 dark:border-white/[0.09] bg-[#fafafa] dark:bg-[#18181c] p-6 sm:p-7 shadow-xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold tracking-tight text-neutral-950 dark:text-white">
              {mode === 'login' ? 'Sign in to NoteCraft' : 'Create your workspace'}
            </h1>
            <p className="mt-1.5 text-[13.5px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {mode === 'login'
                ? 'Access your technical notes, folders, and snippet library.'
                : 'Set up an account to organize private notes and reusable code snippets.'}
            </p>
          </div>

          {/* Segmented Mode Switch */}
          <div
            className="grid grid-cols-2 p-1 rounded-xl bg-neutral-200/70 dark:bg-white/[0.05] border border-neutral-200 dark:border-white/[0.06] mb-5"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => handleModeChange('login')}
              className={`py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => handleModeChange('register')}
              className={`py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Full name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Rivera"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13.5px] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
              >
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13.5px] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter your password'}
                  className="w-full pl-9 pr-10 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13.5px] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg text-[13.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors cursor-pointer"
            >
              {submitting
                ? mode === 'login'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-neutral-200 dark:border-white/10" />
            </div>
            <div className="relative flex justify-center text-[11.5px] uppercase">
              <span className="bg-[#fafafa] dark:bg-[#18181c] px-2 text-neutral-400 font-medium">
                Or continue with
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setOauthProviderModal('google')}
              className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <span className="w-4 h-4 rounded-full bg-red-500 text-white font-bold text-[10px] flex items-center justify-center">
                G
              </span>
              <span>Google</span>
            </button>

            <button
              type="button"
              onClick={() => setOauthProviderModal('github')}
              className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <span className="w-4 h-4 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold text-[10px] flex items-center justify-center">
                GH
              </span>
              <span>GitHub</span>
            </button>
          </div>
        </div>
      </main>

      {oauthProviderModal && (
        <GoogleAccountSelectorModal
          isOpen={Boolean(oauthProviderModal)}
          provider={oauthProviderModal}
          onClose={() => setOauthProviderModal(null)}
          onSuccess={(user) => {
            setOauthProviderModal(null);
            onAuthenticated(user);
          }}
        />
      )}
    </div>
  );
}
