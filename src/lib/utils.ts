import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Last path segment; handles both POSIX and Windows separators. */
export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
