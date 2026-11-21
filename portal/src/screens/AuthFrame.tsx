import type { ReactNode } from 'react';

/** The two-sided page for signing in and adding a course: a course drawing on one side, the form on the other. */
export function AuthFrame({ headline, body, children }: { headline: string; body: string; children: ReactNode }) {
  return (
    <div className="fore-auth">
      <aside className="fore-auth-art">
        <div className="fore-auth-brand"><img src="/maison-mark-light.svg" alt="" /><b>Maison<span>Fore</span></b></div>
        <div>
          <h2>{headline}</h2>
          <p>{body}</p>
        </div>
        <Course />
      </aside>
      <main className="fore-auth-form">{children}</main>
    </div>
  );
}

/** Rolling fairways and a green with its flag. */
function Course() {
  return (
    <svg className="course" viewBox="0 0 800 360" aria-hidden>
      <path d="M0 210 C120 170 230 190 340 175 C470 158 560 120 800 140 L800 360 L0 360Z" fill="#2c4d42" />
      <path d="M0 260 C140 225 260 245 380 232 C520 216 640 196 800 214 L800 360 L0 360Z" fill="#355b4d" />
      <ellipse cx="560" cy="226" rx="92" ry="17" fill="#4d7a63" />
      <path d="M0 312 C160 290 330 300 470 292 C600 285 700 276 800 284 L800 360 L0 360Z" fill="#3f6b57" />
      <ellipse cx="250" cy="304" rx="58" ry="10" fill="#d9c79f" opacity="0.85" />
      <line x1="586" y1="226" x2="586" y2="122" stroke="#efe9db" strokeWidth="3" strokeLinecap="round" />
      <path d="M587 124 L630 136 L587 149Z" fill="#c9a86c" />
      <circle cx="586" cy="226" r="4" fill="#1c3029" />
    </svg>
  );
}
