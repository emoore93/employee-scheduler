import type { ReactNode } from 'react';

/** Shared layout for the signed-out screens. */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3" />
            </svg>
          </span>
          Shift Planner
        </div>
        {children}
      </div>
    </div>
  );
}

export const MIN_PASSWORD = 12;
