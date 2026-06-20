import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes with conflict resolution. The canonical `cn()` util. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
