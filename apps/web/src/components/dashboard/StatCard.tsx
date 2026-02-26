import Link from 'next/link';
import clsx from 'clsx';

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: 'users' | 'credit-card' | 'document' | 'chart' | 'calendar';
  trend?: {
    value: number;
    positive: boolean;
  };
  href?: string;
}

export function StatCard({
  title,
  value,
  description,
  icon = 'chart',
  trend,
  href,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-dark-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          {description && <p className="text-sm text-dark-400 mt-1">{description}</p>}
          {trend && (
            <div
              className={clsx(
                'flex items-center gap-1 mt-2 text-sm font-medium',
                trend.positive ? 'text-green-400' : 'text-red-400'
              )}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {trend.positive ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                )}
              </svg>
              <span>
                {trend.positive ? '+' : ''}
                {trend.value}%
              </span>
            </div>
          )}
        </div>
        <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-400 flex-shrink-0">
          {icon === 'users' && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          )}
          {icon === 'credit-card' && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          )}
          {icon === 'document' && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          )}
          {icon === 'chart' && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          )}
          {icon === 'calendar' && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )}
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="glass-card glass-card-hover p-6 block cursor-pointer">
        {content}
      </Link>
    );
  }

  return <div className="glass-card p-6 block">{content}</div>;
}
