import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Last path segment; handles both POSIX and Windows separators. */
export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

/** Everything before the last path segment. */
export function dirname(path: string) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}
