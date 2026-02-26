'use client';

import { useState, useEffect, useCallback } from 'react';

interface PasswordStrengthIndicatorProps {
  password: string;
  minLength?: number;
}

interface StrengthResult {
  requirements: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
  };
  strength: number;
  level: string;
  text: string;
}

function checkPasswordStrength(password: string, minLength: number): StrengthResult {
  const requirements = {
    length: password.length >= minLength,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };

  const metCount = Object.values(requirements).filter(Boolean).length;

  let level: string;
  let text: string;

  if (password.length === 0) {
    level = '';
    text = '';
  } else if (metCount <= 1) {
    level = 'weak';
    text = 'Svakt passord';
  } else if (metCount === 2) {
    level = 'fair';
    text = 'Middels passord';
  } else if (metCount === 3) {
    level = 'good';
    text = 'Greit passord';
  } else if (metCount === 4) {
    level = 'strong';
    text = 'Sterkt passord';
  } else {
    level = 'very-strong';
    text = 'Veldig sterkt passord';
  }

  return {
    requirements,
    strength: password.length === 0 ? 0 : metCount,
    level,
    text,
  };
}

const strengthColors: Record<string, string> = {
  weak: '#ef4444',
  fair: '#f97316',
  good: '#eab308',
  strong: '#84cc16',
  'very-strong': '#22c55e',
};

const strengthWidths: Record<number, string> = {
  0: '0%',
  1: '20%',
  2: '40%',
  3: '60%',
  4: '80%',
  5: '100%',
};

export default function PasswordStrengthIndicator({
  password,
  minLength = 10,
}: PasswordStrengthIndicatorProps) {
  const [result, setResult] = useState<StrengthResult>(() =>
    checkPasswordStrength(password, minLength)
  );

  useEffect(() => {
    setResult(checkPasswordStrength(password, minLength));
  }, [password, minLength]);

  const requirementsList = [
    { key: 'length', label: `Minst ${minLength} tegn` },
    { key: 'uppercase', label: 'Minst en stor bokstav' },
    { key: 'lowercase', label: 'Minst en liten bokstav' },
    { key: 'number', label: 'Minst ett tall' },
    { key: 'special', label: 'Minst ett spesialtegn (!@#$%^&*)' },
  ] as const;

  return (
    <div className="mt-2" aria-live="polite" aria-atomic="true">
      {/* Strength bar */}
      <div className="h-1 bg-[#e5e7eb] rounded-sm overflow-hidden mb-2">
        <div
          className="h-full rounded-sm transition-all duration-300"
          style={{
            width: strengthWidths[result.strength] || '0%',
            backgroundColor:
              result.strength === 0
                ? '#e5e7eb'
                : strengthColors[result.level] || '#e5e7eb',
          }}
        />
      </div>

      {/* Strength text */}
      {result.text && (
        <p
          className="text-xs mb-2"
          style={{ color: strengthColors[result.level] || '#6b7280' }}
        >
          {result.text}
        </p>
      )}

      {/* Requirements list */}
      <ul className="list-none p-0 m-0 text-xs text-[#6b7280]">
        {requirementsList.map(({ key, label }) => {
          const met = result.requirements[key];
          return (
            <li
              key={key}
              className="flex items-center gap-2 py-0.5 transition-colors duration-200"
              style={{ color: met ? '#22c55e' : undefined }}
            >
              <span className="w-4 h-4 inline-flex items-center justify-center text-xs">
                {met ? '\u2713' : '\u2715'}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
