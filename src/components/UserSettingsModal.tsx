import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  LogOut,
  Moon,
  Shield,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AuthUser } from '../types/notes';

interface UserSettingsModalProps {
  isOpen: boolean;
  user: AuthUser;
  theme: 'dark' | 'light';
  onClose: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function UserSettingsModal({
  isOpen,
  user,
  theme,
  onClose,
  onToggleTheme,
  onLogout,
}: UserSettingsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Recent';

  const initials =
    user.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] || '')
      .join('')
      .toUpperCase() || 'U';

  return createPortal(
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
        className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#17171c] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/12 dark:bg-blue-500/18 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
            <h2
              id="user-settings-title"
              className="text-[15px] font-semibold text-neutral-950 dark:text-white truncate"
            >
              Account Settings
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* User Profile Card */}
          <div className="flex items-center gap-3.5 p-3.5 rounded-xl border border-neutral-200/80 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02]">
            <div className="w-12 h-12 rounded-xl bg-neutral-900 dark:bg-white/12 text-white dark:text-neutral-100 text-[15px] font-bold flex items-center justify-center shrink-0 shadow-xs">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-neutral-950 dark:text-white truncate">
                {user.name}
              </div>
              <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                {user.email}
              </div>
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1 tabular-nums">
                Member since {memberSince}
              </div>
            </div>
          </div>

          {/* Theme Mode Section */}
          <div className="space-y-2.5">
            <label className="text-[12.5px] font-semibold text-neutral-900 dark:text-neutral-200 block">
              Appearance / Theme Mode
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (theme === 'dark') onToggleTheme();
                }}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  theme === 'light'
                    ? 'border-blue-600 bg-blue-600/8 dark:bg-blue-500/15 text-neutral-950 dark:text-white font-medium ring-1 ring-blue-600/40'
                    : 'border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-white/[0.03] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Light Mode</span>
                </span>
                {theme === 'light' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (theme === 'light') onToggleTheme();
                }}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  theme === 'dark'
                    ? 'border-blue-600 bg-blue-600/8 dark:bg-blue-500/15 text-neutral-950 dark:text-white font-medium ring-1 ring-blue-600/40'
                    : 'border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-white/[0.03] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <Moon className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Dark Mode</span>
                </span>
                {theme === 'dark' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
              </button>
            </div>
          </div>

          {/* Account Security / Info */}
          <div className="pt-2 border-t border-neutral-200 dark:border-white/[0.07] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
              <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Secure encrypted session</span>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
