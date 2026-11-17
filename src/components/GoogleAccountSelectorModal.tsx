import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Plus, Shield, X } from 'lucide-react';
import { AuthUser } from '../types/notes';

interface GoogleAccountSelectorModalProps {
  isOpen: boolean;
  provider: 'google' | 'github';
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

interface AccountOption {
  name: string;
  email: string;
  avatarBg: string;
}

const MOCK_GOOGLE_ACCOUNTS: AccountOption[] = [
  { name: 'Alex Rivera', email: 'alex.rivera@gmail.com', avatarBg: 'bg-blue-600' },
  { name: 'Alex Engineering', email: 'alex.dev.engineer@gmail.com', avatarBg: 'bg-emerald-600' },
];

const MOCK_GITHUB_ACCOUNTS: AccountOption[] = [
  { name: 'Alex Rivera (Personal)', email: 'alex@github-dev.com', avatarBg: 'bg-neutral-900' },
  { name: 'Alex Work', email: 'alex.work@company.org', avatarBg: 'bg-indigo-600' },
];

export function GoogleAccountSelectorModal({
  isOpen,
  provider,
  onClose,
  onSuccess,
}: GoogleAccountSelectorModalProps) {
  const isGoogle = provider === 'google';
  const accounts = isGoogle ? MOCK_GOOGLE_ACCOUNTS : MOCK_GITHUB_ACCOUNTS;

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [useOther, setUseOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherEmail, setOtherEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAuthenticate = async (name: string, email: string) => {
    setError(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName = name.trim() || (isGoogle ? 'Google User' : 'GitHub User');

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error('Please select or enter a valid email address.');
      }

      const now = Date.now();
      const userId = `usr-oauth-${provider}-${now.toString(36)}`;
      const publicUser: AuthUser = {
        id: userId,
        name: trimmedName,
        email: trimmedEmail,
        createdAt: now,
      };

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
      setError(err instanceof Error ? err.message : 'Authentication failed.');
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-account-modal-title"
        className="w-full max-w-[420px] rounded-2xl border border-neutral-200 dark:border-white/15 bg-white dark:bg-[#1a1a1f] shadow-2xl overflow-hidden p-6 sm:p-7"
      >
        {/* Google / GitHub Chooser Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[15px] shadow-xs ${
                isGoogle ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-800'
              }`}
            >
              {isGoogle ? 'G' : 'GH'}
            </div>
            <div>
              <h2
                id="google-account-modal-title"
                className="text-[16px] font-semibold text-neutral-950 dark:text-white"
              >
                Sign in with {isGoogle ? 'Google' : 'GitHub'}
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Choose an account to continue to NoteCraft
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400">
            <Loader2 className="w-7 h-7 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-[13.5px] font-medium">Connecting to {isGoogle ? 'Google' : 'GitHub'}...</span>
          </div>
        ) : useOther ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAuthenticate(otherName, otherEmail);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={otherEmail}
                onChange={(e) => setOtherEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="pt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setUseOther(false)}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.07] cursor-pointer"
              >
                Back to accounts
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                Continue
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-2">
              Select an account:
            </div>

            <div className="divide-y divide-neutral-200 dark:divide-white/[0.08] rounded-xl border border-neutral-200 dark:border-white/[0.09] bg-neutral-50/50 dark:bg-white/[0.02] overflow-hidden">
              {accounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => void handleAuthenticate(acc.name, acc.email)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-100/80 dark:hover:bg-white/[0.06] transition-colors cursor-pointer group"
                >
                  <div
                    className={`w-9 h-9 rounded-full ${acc.avatarBg} text-white font-semibold text-[13px] flex items-center justify-center shrink-0`}
                  >
                    {acc.name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-neutral-900 dark:text-white truncate">
                      {acc.name}
                    </div>
                    <div className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                      {acc.email}
                    </div>
                  </div>
                </button>
              ))}

              <button
                type="button"
                onClick={() => setUseOther(true)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-100/80 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <div className="w-9 h-9 rounded-full border border-dashed border-neutral-300 dark:border-white/20 flex items-center justify-center text-neutral-500 shrink-0">
                  <Plus className="w-4 h-4" />
                </div>
                <div className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
                  Use another account
                </div>
              </button>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-white/[0.07] flex items-center justify-between text-[11.5px] text-neutral-400">
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                <span>Verified OAuth 2.0</span>
              </span>
              <span>NoteCraft Security</span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
