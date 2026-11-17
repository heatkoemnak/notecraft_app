import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Shield, X } from 'lucide-react';
import { AuthUser } from '../types/notes';

interface OAuthLoginModalProps {
  isOpen: boolean;
  provider: 'google' | 'github';
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export function OAuthLoginModal({
  isOpen,
  provider,
  onClose,
  onSuccess,
}: OAuthLoginModalProps) {
  const isGoogle = provider === 'google';
  const [email, setEmail] = useState(
    isGoogle ? 'alex.google@gmail.com' : 'alex.developer@github.com'
  );
  const [name, setName] = useState(isGoogle ? 'Alex Google User' : 'Alex GitHub Dev');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName = name.trim() || (isGoogle ? 'Google User' : 'GitHub User');

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error('Please enter a valid email address.');
      }

      // Simulate OAuth token exchange and session registration
      const now = Date.now();
      const userId = `usr-oauth-${provider}-${now.toString(36)}`;
      const publicUser: AuthUser = {
        id: userId,
        name: trimmedName,
        email: trimmedEmail,
        createdAt: now,
      };

      // Store in local session / local users if local storage mode
      try {
        const LOCAL_USERS_KEY = 'notecraft.auth.users.v1';
        const LOCAL_SESSION_KEY = 'notecraft.auth.session.v1';
        const rawUsers = localStorage.getItem(LOCAL_USERS_KEY);
        const users = rawUsers ? (JSON.parse(rawUsers) as Array<Record<string, unknown>>) : [];
        const existing = users.find((u) => u.email === trimmedEmail);
        if (!existing) {
          users.push({
            id: userId,
            name: trimmedName,
            email: trimmedEmail,
            createdAt: now,
            salt: 'oauth',
            passwordHash: 'oauth',
          });
          localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
        } else {
          localStorage.setItem(LOCAL_SESSION_KEY, String(existing.id));
          const matchedUser: AuthUser = {
            id: String(existing.id),
            name: String(existing.name),
            email: String(existing.email),
            createdAt: Number(existing.createdAt || now),
          };
          setLoading(false);
          onSuccess(matchedUser);
          return;
        }
        localStorage.setItem(LOCAL_SESSION_KEY, userId);
      } catch {
        // ignore storage errors
      }

      setLoading(false);
      onSuccess(publicUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth sign-in failed.');
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-modal-title"
        className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#18181c] shadow-2xl overflow-hidden p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[16px] shadow-sm ${
                isGoogle ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-800'
              }`}
            >
              {isGoogle ? 'G' : 'GH'}
            </div>
            <div>
              <h2
                id="oauth-modal-title"
                className="text-[16px] font-semibold text-neutral-950 dark:text-white"
              >
                Sign in with {isGoogle ? 'Google' : 'GitHub'}
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                NoteCraft OAuth 2.0 Simulation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAuthorize} className="space-y-4">
          <div className="p-3 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-white/[0.02] text-[12.5px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
            NoteCraft will receive your name and email address from{' '}
            <span className="font-semibold text-neutral-900 dark:text-white">
              {isGoogle ? 'Google' : 'GitHub'}
            </span>
            .
          </div>

          <div>
            <label
              htmlFor="oauth-name"
              className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Account Name
            </label>
            <input
              id="oauth-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="oauth-email"
              className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Email Address
            </label>
            <input
              id="oauth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11.5px] text-neutral-400">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              <span>Secure Token Auth</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-medium text-white transition-colors cursor-pointer whitespace-nowrap ${
                  isGoogle
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200'
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Authorize &amp; Sign in</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
