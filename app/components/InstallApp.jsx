"use client";

import { useEffect, useState } from "react";

// Bouton « Installer » : visible uniquement sur Android, hors application déjà installée.
// Il télécharge l'APK (application Android de ASN Santé).
export default function InstallApp() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || "";
      const isAndroid = /Android/i.test(ua);
      const installed =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        (document.referrer || "").startsWith("android-app://");
      let dismissed = false;
      try { dismissed = sessionStorage.getItem("asn-install-dismissed") === "1"; } catch {}
      setShow(isAndroid && !installed && !dismissed);
    } catch {}
  }, []);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 9999,
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        background: "#073A57", color: "#fff", borderRadius: 14,
        boxShadow: "0 6px 24px rgba(0,0,0,.28)", fontFamily: "inherit",
      }}
      role="region"
      aria-label="Installer l'application"
    >
      <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10, background: "#fff" }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.25 }}>
        <strong>ASN Santé</strong>
        <div style={{ opacity: 0.85, fontSize: 12 }}>Installer l'application Android</div>
      </div>
      <a
        href="/asn-sante.apk"
        download="ASN-Sante.apk"
        style={{ background: "#fff", color: "#073A57", fontWeight: 700, fontSize: 14, padding: "8px 14px", borderRadius: 10, textDecoration: "none" }}
      >
        Installer
      </a>
      <button
        type="button"
        aria-label="Fermer"
        onClick={() => { try { sessionStorage.setItem("asn-install-dismissed", "1"); } catch {} setShow(false); }}
        style={{ background: "transparent", border: 0, color: "#fff", fontSize: 20, lineHeight: 1, padding: 4, cursor: "pointer" }}
      >
        ×
      </button>
    </div>
  );
}
