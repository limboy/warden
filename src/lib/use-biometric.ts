import { useCallback, useEffect, useState } from "react";

/** Whether Touch ID is available on this machine and enabled for `filePath`. */
export function useBiometric(filePath: string | null) {
  const [available, setAvailable] = useState(false);
  const [enabledFor, setEnabledFor] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.electron.biometricAvailable().then(setAvailable);
    if (filePath) {
      window.electron
        .biometricEnabled(filePath)
        .then((on) => setEnabledFor(on ? filePath : null))
        .catch(() => setEnabledFor(null));
    }
  }, [filePath]);

  useEffect(refresh, [refresh]);

  return { available, enabled: !!filePath && enabledFor === filePath, refresh };
}
