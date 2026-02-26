import clsx from 'clsx';

interface GlassCardProps {
  className?: string;
  hover?: boolean;
  glow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export default function GlassCard({
  className = '',
  hover = false,
  glow = false,
  padding = 'md',
  children,
}: GlassCardProps) {
  return (
    <div
      className={clsx(
        'glass-card',
        hover && 'glass-card-hover',
        glow && 'animate-glow',
        paddingClasses[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
