"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // silencieux : l'app fonctionne normalement même sans service worker
      });
    }
  }, []);
  return null;
}
