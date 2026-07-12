import { QRCodeSVG } from "qrcode.react";
import "./checkin.css";

/**
 * Printable / host-stand QR that opens the patron check-in flow (docs/05). Encodes the
 * absolute /checkin?source=qr URL so scans are attributable and the permanent URL keeps
 * a redirect if routes ever move (docs/12). Reusable component; the /checkin/qr route
 * below renders it full-screen for a table tent or the host stand display.
 */
export function CheckinQR({ size = 240 }: { size?: number }) {
  const url = `${window.location.origin}/checkin?source=qr`;
  return (
    <span className="ck-qr">
      <QRCodeSVG value={url} size={size} bgColor="#02120a" fgColor="#00ff41" level="M" />
    </span>
  );
}

export function CheckinQRPage() {
  return (
    <div className="ck">
      <header className="ck-header">
        <span className="ck-brand">BUNKER CLUB</span>
        <span className="ck-sys">PATRON TERMINAL v2<br />SHELTER AUTHORITY CERTIFIED</span>
      </header>
      <div className="ck-screen" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div className="ck-eyebrow">SCAN TO CHECK IN</div>
        <h1 className="ck-title">TRIVIA{"\n"}CHECK-IN</h1>
        <p className="ck-sub">Point your phone camera here. Any team member can check the team in.</p>
        <CheckinQR size={260} />
        <p className="ck-note" style={{ marginTop: 20 }}>{window.location.origin}/checkin</p>
      </div>
      <footer className="ck-footer">
        <span>ATOMIC PUB TRIVIA — WEDNESDAYS</span>
        <span>HOST STAND</span>
      </footer>
    </div>
  );
}
