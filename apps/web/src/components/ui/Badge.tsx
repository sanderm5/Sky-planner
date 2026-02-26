import clsx from 'clsx';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}

const variantClasses = {
  default: 'bg-primary-500/10 text-primary-400 border-primary-500/20',
  success: 'bg-secondary-500/10 text-secondary-400 border-secondary-500/20',
  warning: 'bg-accent-blue/10 text-accent-blue border-accent-blue/20',
  danger: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function Badge({
  variant = 'default',
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border',
        variantClasses[variant],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
