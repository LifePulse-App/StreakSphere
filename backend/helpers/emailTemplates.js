const baseLayout = ({ title, preview, bodyHtml, logoDataUrl }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      background: #060912;
      font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .email-wrapper {
      background: #060912;
      padding: 32px 16px;
      min-height: 100vh;
    }

    .email-container {
      width: 100%;
      max-width: 520px;
      margin: 0 auto;
    }

    /* Header bar */
    .email-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding: 0 4px;
    }
    .email-from {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .from-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b5bfc 0%, #9b59f5 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }
    .from-name {
      font-size: 13px;
      font-weight: 600;
      color: #e2e8f0;
    }
    .from-addr {
      font-size: 11px;
      color: #475569;
    }
    .email-time {
      font-size: 11px;
      color: #475569;
    }

    /* Main card */
    .card {
      background: #0d1424;
      border-radius: 24px;
      border: 1px solid rgba(99, 120, 255, 0.12);
      overflow: hidden;
      position: relative;
    }

    /* Glow accent at top */
    .card::before {
      content: '';
      display: block;
      height: 3px;
      background: linear-gradient(90deg, #3b5bfc, #9b59f5, #3b5bfc);
      background-size: 200% 100%;
    }

    /* Logo section */
    .logo-section {
      padding: 28px 28px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-wrap {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b5bfc 0%, #9b59f5 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
    }
    .logo-text {
      font-size: 17px;
      font-weight: 700;
      color: #f1f5f9;
      letter-spacing: -0.01em;
    }
    .logo-sub {
      font-size: 12px;
      color: #4b5563;
    }

    /* Body section */
    .body-section {
      padding: 24px 28px 28px;
    }

    /* Footer */
    .email-footer {
      margin-top: 20px;
      text-align: center;
      font-size: 11px;
      color: #2d3748;
      padding-bottom: 8px;
    }

    /* Mobile */
    @media (max-width: 600px) {
      .email-wrapper { padding: 16px 12px; }
      .card { border-radius: 20px; }
      .logo-section { padding: 22px 20px 0; }
      .body-section { padding: 20px 20px 24px; }
    }
  </style>
</head>
<body>
  <!-- Preview text hidden -->
  <span style="display:none;opacity:0;height:0;width:0;font-size:0;">${preview}</span>

  <div class="email-wrapper">
    <div class="email-container">

      <!-- Sender bar -->
      <div class="email-topbar">
        <div class="email-from">
          <div class="from-avatar">SS</div>
          <div>
            <div class="from-name">StreakSphere</div>
            <div class="from-addr">support@streaksphere.app</div>
          </div>
        </div>
        <div class="email-time">Just now</div>
      </div>

      <!-- Card -->
      <div class="card">
        <div class="logo-section">
          <div class="logo-wrap">⚡</div>
          <div>
            <div class="logo-text">StreakSphere</div>
            <div class="logo-sub">Your habit companion</div>
          </div>
        </div>

        <div class="body-section">
          ${bodyHtml}
        </div>
      </div>

      <div class="email-footer">Sent by StreakSphere Support &nbsp;·&nbsp; Unsubscribe</div>
    </div>
  </div>
</body>
</html>
`;


/* ─── Shared inner styles (inlined for email client compat) ─────────────── */

const s = {
  h1: `margin:0 0 6px 0;font-size:22px;font-weight:700;color:#f1f5f9;letter-spacing:-0.02em;line-height:1.2;`,
  p: `margin:0 0 10px 0;font-size:14px;color:#94a3b8;line-height:1.6;`,
  pDim: `margin:0;font-size:13px;color:#475569;line-height:1.5;`,

  divider: `height:1px;background:rgba(99,120,255,0.1);margin:18px 0;`,

  badge: (bg, color) =>
    `display:inline-flex;align-items:center;gap:5px;background:${bg};border:1px solid ${color}33;border-radius:100px;padding:4px 12px;font-size:12px;font-weight:600;color:${color};margin-bottom:14px;`,

  codeBox: `background:#0a0f1e;border:1px solid rgba(99,120,255,0.2);border-radius:16px;padding:20px;text-align:center;margin:16px 0;`,
  codeDigits: `font-size:32px;letter-spacing:0.22em;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;`,
  codeTimer: `font-size:12px;color:#475569;margin-top:8px;`,
  timerDot: `display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b;margin-right:5px;vertical-align:middle;`,

  infoRow: `display:flex;align-items:center;gap:12px;margin-bottom:10px;`,
  infoIcon: (bg, color) =>
    `width:34px;height:34px;border-radius:10px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;border:1px solid ${color}22;`,
  infoLabel: `font-size:11px;color:#475569;margin:0 0 1px;`,
  infoValue: `font-size:13px;font-weight:600;color:#cbd5e1;margin:0;`,

  alertBox: `background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);border-radius:12px;padding:12px 14px;margin-top:16px;font-size:13px;color:#fca5a5;line-height:1.5;`,
  safeBox: `display:flex;align-items:flex-start;gap:10px;margin-top:16px;padding:12px 14px;background:rgba(99,120,255,0.05);border:1px solid rgba(99,120,255,0.1);border-radius:12px;font-size:13px;color:#64748b;line-height:1.5;`,
};


/* ─── Welcome ───────────────────────────────────────────────────────────── */

export const welcomeEmailHtml = ({ username, email, logoDataUrl }) =>
  baseLayout({
    title: "Welcome to StreakSphere",
    preview: "Your account is ready — let's explore 🔥",
    logoDataUrl,
    bodyHtml: `
      <div style="${s.badge('rgba(16,185,129,0.1)', '#34d399')}">
        ✦ &nbsp;Account activated
      </div>

      <h1 style="${s.h1}">Welcome, ${username || email} 👋</h1>
      <p style="${s.p}">
        Your StreakSphere account is live. Welcome to new ERA Of Social Media... Explore it.
      </p>

      <div style="${s.divider}"></div>

      <div style="${s.safeBox}">
        🛡️ &nbsp;<span>Didn't sign up? You can safely ignore this email — your account requires email confirmation to activate.</span>
      </div>
    `
  });


/* ─── OTP ───────────────────────────────────────────────────────────────── */

export const otpEmailHtml = ({ username, email, otp, logoDataUrl }) =>
  baseLayout({
    title: "Your verification code — StreakSphere",
    preview: `Your one-time code is ${otp}`,
    logoDataUrl,
    bodyHtml: `
      <div style="${s.badge('rgba(99,120,255,0.1)', '#818cf8')}">
        🔐 &nbsp;Email verification
      </div>

      <h1 style="${s.h1}">Verify your email</h1>
      <p style="${s.p}">Hi ${username || email}, enter the code below to verify your account:</p>

      <div style="${s.codeBox}">
        <div style="${s.codeDigits}">${otp}</div>
        <div style="${s.codeTimer}">
          <span style="${s.timerDot}"></span>
          Expires in 2 minutes
        </div>
      </div>

      <div style="${s.safeBox}">
        🔒 &nbsp;<span>Never share this code with anyone. StreakSphere will never ask for it.</span>
      </div>
    `
  });


/* ─── Reset Password ────────────────────────────────────────────────────── */

export const resetPasswordEmailHtml = ({ username, email, code, logoDataUrl }) =>
  baseLayout({
    title: "Reset your password — StreakSphere",
    preview: `Your password reset code is ready`,
    logoDataUrl,
    bodyHtml: `
      <div style="${s.badge('rgba(245,158,11,0.1)', '#fbbf24')}">
        🔑 &nbsp;Password reset
      </div>

      <h1 style="${s.h1}">Reset your password</h1>
      <p style="${s.p}">Hi ${username || email}, use the code below to set a new password:</p>

      <div style="${s.codeBox}">
        <div style="${s.codeDigits}">${code}</div>
        <div style="${s.codeTimer}">
          <span style="${s.timerDot}"></span>
          Expires in 2 minutes
        </div>
      </div>

      <div style="${s.safeBox}">
        ⚠️ &nbsp;<span>Didn't request this? Your account is still secure. You can safely ignore this email — no changes were made.</span>
      </div>
    `
  });


/* ─── Login Alert ───────────────────────────────────────────────────────── */

export const loginAlertEmailHtml = ({ username, email, deviceInfo, location, ip, time, logoDataUrl }) =>
  baseLayout({
    title: "New login to your account — StreakSphere",
    preview: "A new sign-in was detected on your account",
    logoDataUrl,
    bodyHtml: `
      <div style="${s.badge('rgba(239,68,68,0.1)', '#f87171')}">
        🔔 &nbsp;Security alert
      </div>

      <h1 style="${s.h1}">New login detected</h1>
      <p style="${s.p}">Hi ${username || email}, a sign-in to your account was just recorded.</p>

      <div style="${s.divider}"></div>

      <div style="${s.infoRow}">
        <div style="${s.infoIcon('rgba(99,120,255,0.12)', '#818cf8')}">📱</div>
        <div>
          <p style="${s.infoLabel}">Device</p>
          <p style="${s.infoValue}">${deviceInfo?.deviceName || 'Unknown'} ${deviceInfo?.deviceModel || ''} ${deviceInfo?.deviceBrand || ''}</p>
        </div>
      </div>

      <div style="${s.infoRow}">
        <div style="${s.infoIcon('rgba(239,68,68,0.12)', '#f87171')}">🌐</div>
        <div>
          <p style="${s.infoLabel}">IP Address</p>
          <p style="${s.infoValue}">${ip || 'Unknown'}</p>
        </div>
      </div>

      <div style="${s.infoRow}">
        <div style="${s.infoIcon('rgba(20,184,166,0.12)', '#2dd4bf')}">📍</div>
        <div>
          <p style="${s.infoLabel}">Location</p>
          <p style="${s.infoValue}">${location || 'Unknown'}</p>
        </div>
      </div>

      <div style="${s.infoRow}">
        <div style="${s.infoIcon('rgba(245,158,11,0.12)', '#fbbf24')}">🕐</div>
        <div>
          <p style="${s.infoLabel}">Time</p>
          <p style="${s.infoValue}">${time || 'Unknown'}</p>
        </div>
      </div>

      <div style="${s.alertBox}">
        🚨 &nbsp;<strong>Not you?</strong> Reset your password immediately and revoke all active sessions from your security settings.
      </div>
    `
  });