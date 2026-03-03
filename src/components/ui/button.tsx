import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ className, variant = 'primary', type = 'button', ...props }: Props) {
  return <button type={type} className={cn('ui-button', `ui-button--${variant}`, className)} {...props} />;
}
