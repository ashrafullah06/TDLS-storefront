//my-project/src/components/common/footer.jsx
import React, { useMemo, useState } from "react";
import LanguageSwitcher from "@/components/common/languageswitcher";
import { signIn } from "next-auth/react";

function NewsletterFooterForm() {
  const [contact, setContact] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = (val) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ||
    /^(\+?\d{1,4}[\s-]?)?(\d{10,13})$/.test(val);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!isValid(contact)) {
      setError("Enter a valid email address or mobile number.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact }),
      });
      if (response.ok) {
        setSubmitted(true);
      } else {
        const result = await response.json().catch(() => ({}));
        setError(result.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  const handleGoogleSignup = () => {
    try {
      if (typeof window !== "undefined") {
        signIn && signIn("google", { callbackUrl: "/" });
      }
    } catch {
      setError("Google sign-in isn't available right now.");
    }
  };

  if (submitted)
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          color: "#C9B15D",
          background: "rgba(201,177,93,0.08)",
          border: "1px solid #c9b15d33",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: "0.98em",
          letterSpacing: ".02em",
        }}
      >
        You’re in! We’ll keep you posted.
      </div>
    );

  return (
    <form onSubmit={handleSubmit} aria-describedby="newsletter-help" style={{ width: "100%" }}>
      <div
        id="newsletter-help"
        style={{
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          color: "#C9B15D",
          letterSpacing: ".08em",
          marginBottom: 10,
          fontSize: "1.05em",
        }}
      >
        Join our newsletter
      </div>

      <div
        style={{
          display: "flex",
          width: "100%",
          gap: 0,
          flexWrap: "nowrap",
        }}
      >
        <input
          id="newsletter-contact"
          type="text"
          placeholder="Email address or mobile number"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          style={{
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            padding: "11px 13px",
            border: "1px solid #c9b15d33",
            borderRight: "none",
            borderRadius: "10px 0 0 10px",
            fontSize: "1em",
            outline: "none",
            background: "#232c40",
            color: "#d8dbe6",
            width: "100%",
            minWidth: 0,
            boxShadow: error ? "0 2px 10px #a2323230" : "none",
            transition: "box-shadow .18s ease, border-color .18s ease",
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "newsletter-error" : undefined}
          disabled={loading}
          autoComplete="email"
          inputMode="email"
        />
        <button
          type="submit"
          disabled={loading || !contact}
          style={{
            border: "1px solid #c9b15d33",
            borderRadius: "0 10px 10px 0",
            padding: "11px 18px",
            fontFamily: "'Playfair Display', serif",
            fontWeight: 800,
            fontSize: "1.02em",
            letterSpacing: ".10em",
            background: loading ? "#b3a469" : "#C9B15D",
            color: "#1e253b",
            cursor: loading || !contact ? "not-allowed" : "pointer",
            opacity: loading || !contact ? 0.75 : 1,
            transition: "background 0.18s, opacity 0.18s, transform .06s",
            whiteSpace: "nowrap",
            minHeight: 44,
          }}
          aria-label="Join newsletter"
        >
          {loading ? "Joining..." : "JOIN"}
        </button>
      </div>

      <button
        type="button"
        onClick={handleGoogleSignup}
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          width: "100%",
          background: "#ffffff",
          color: "#1a1f2f",
          border: "1.5px solid #c9b15d",
          borderRadius: 12,
          fontWeight: 700,
          fontSize: "1em",
          padding: "10px 14px",
          cursor: "pointer",
          boxShadow: "0 2px 10px #c9b15d24",
          transition: "background 0.16s, transform .06s, box-shadow .18s",
          minHeight: 44,
        }}
        aria-label="Sign up with Google"
      >
        <img src="/logos/google-icon.svg" alt="" style={{ width: 20, height: 20 }} />
        Sign up with Google
      </button>

      {error && (
        <div
          id="newsletter-error"
          role="alert"
          style={{
            marginTop: 10,
            color: "#f0a7a7",
            fontWeight: 600,
            fontSize: "0.96em",
            letterSpacing: ".01em",
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}

function QuickTrackForm() {
  const [code, setCode] = useState("");
  const onSubmit = (e) => {
    e.preventDefault();
    const v = (code || "").trim();
    if (!v) return;
    if (typeof window !== "undefined") {
      window.location.href = `/track-order?code=${encodeURIComponent(v)}`;
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 0, width: "100%", marginTop: 8 }}>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Order code"
        aria-label="Order tracking code"
        style={{
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          padding: "10px 12px",
          border: "1px solid #c9b15d33",
          borderRight: "none",
          borderRadius: "10px 0 0 10px",
          fontSize: "0.96em",
          background: "#232c40",
          color: "#d8dbe6",
          outline: "none",
          width: "100%",
          minWidth: 0,
          minHeight: 44,
        }}
      />
      <button
        type="submit"
        style={{
          border: "1px solid #c9b15d33",
          borderRadius: "0 10px 10px 0",
          padding: "10px 12px",
          fontFamily: "'Playfair Display', serif",
          fontWeight: 800,
          fontSize: "0.96em",
          letterSpacing: ".10em",
          background: "#C9B15D",
          color: "#1e253b",
          cursor: code ? "pointer" : "not-allowed",
          opacity: code ? 1 : 0.72,
          whiteSpace: "nowrap",
          minHeight: 44,
        }}
        disabled={!code}
        aria-label="Track order"
      >
        TRACK
      </button>
    </form>
  );
}

const socialIcons = {
  instagram: (
    <svg width="26" height="26" viewBox="0 0 448 448" fill="none" aria-hidden="true">
      <rect
        x="48"
        y="48"
        width="352"
        height="352"
        rx="105"
        fill="none"
        stroke="currentColor"
        strokeWidth="32"
      />
      <circle cx="224" cy="224" r="80" fill="none" stroke="currentColor" strokeWidth="32" />
      <circle cx="330" cy="118" r="18" fill="currentColor" />
    </svg>
  ),
  facebook: (
    <svg width="26" height="26" viewBox="0 0 320 512" fill="currentColor" aria-hidden="true">
      <path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.57-50.06 52.83-50.06h40.87V6.26S265.43 0 225.36 0c-73.22 0-121.09 44.38-121.09 124.72v70.62H22.89V288h81.38v224h100.2V288z" />
    </svg>
  ),
  youtube: (
    <svg width="26" height="26" viewBox="0 0 576 512" fill="currentColor" aria-hidden="true">
      <path d="M549.65 124.08c-6.28-23.65-24.78-42.15-48.43-48.43C458.76 64 288 64 288 64S117.24 64 74.78 75.65c-23.65 6.28-42.15 24.78-48.43 48.43C14.7 166.54 14.7 256 14.7 256s0 89.46 11.65 131.92c6.28 23.65 24.78 42.15 48.43 48.43C117.24 448 288 448 288 448s170.76 0 213.22-11.65c23.65-6.28 42.15-24.78 48.43-48.43C561.3 345.46 561.3 256 561.3 256s0-89.46-11.65-131.92zM232 338.5v-165l142 82.5z" />
    </svg>
  ),
};

const footerLinkStyle = {
  color: "#F4F1E4",
  textDecoration: "none",
  fontSize: ".98em",
  letterSpacing: ".07em",
  opacity: 0.9,
};

const footerColHead = {
  fontFamily: "'Playfair Display', serif",
  fontWeight: 800,
  letterSpacing: ".17em",
  marginBottom: 10,
  color: "#C9B15D",
  fontSize: "0.95em",
};

const iconLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 42,
  height: 42,
};

const bottomLink = {
  color: "#C9B15D",
  textDecoration: "none",
  opacity: 0.9,
  letterSpacing: ".10em",
};

export default function Footer() {
  const year = useMemo(() => new Date().getFullYear(), []);

  // Removed links that likely do not exist without confirmed routes/APIs:
  // /payment, /our-story, /sustainability, /press, /careers, /affiliates, /corporate, /cookies, /accessibility, /sitemap
  // Keep only routes already present in your project context (or highly likely): /help, /shipping, /track-order, /size-guide, /contact, /privacy, /terms

  return (
    <footer
      style={{
        background: "linear-gradient(180deg, #11162b 0%, #0e1428 100%)",
        color: "#F4F1E4",
        borderTop: "1px solid #d8cfae33",
        paddingTop: 40,
      }}
      aria-label="Footer"
    >
      <div className="footer-grid-wrap">
        {/* Brand + newsletter */}
        <div className="footer-card">
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontWeight: 900,
              letterSpacing: ".22em",
              color: "#C9B15D",
              fontSize: "1.15em",
              marginBottom: 6,
            }}
          >
            TDLS — THE DNA LAB STORE
          </div>
          <div
            style={{
              color: "#d8dbe6",
              opacity: 0.88,
              fontSize: "0.98em",
              letterSpacing: ".03em",
              marginBottom: 16,
              lineHeight: 1.55,
            }}
          >
            Premium essentials designed for Dhaka humidity & global standards.
          </div>

          <div
            style={{
              background: "linear-gradient(180deg, rgba(201,177,93,0.07), rgba(201,177,93,0.02))",
              borderRadius: 14,
              boxShadow: "0 2px 16px rgba(0,0,0,.12), 0 1px 0 rgba(186,160,84,.10)",
              padding: "18px 16px 14px 16px",
              border: "1px solid rgba(201,177,93,.18)",
            }}
          >
            <NewsletterFooterForm />
          </div>
        </div>

        {/* Contact */}
        <nav className="footer-card" aria-label="Contact">
          <div style={footerColHead}>CONTACT</div>
          <a href="mailto:support@thednalabstore.com" style={footerLinkStyle}>
            support@thednalabstore.com
          </a>
          <div style={{ marginTop: 10, fontSize: ".96em", opacity: 0.85 }}>
            Track your order quickly:
          </div>
          <QuickTrackForm />
        </nav>

        {/* Customer Care */}
        <nav className="footer-card" aria-label="Customer care">
          <div style={footerColHead}>CUSTOMER CARE</div>
          <a href="/help" style={footerLinkStyle}>
            Help / FAQ
          </a>
          <a href="/shipping" style={footerLinkStyle}>
            Shipping &amp; Returns
          </a>
          <a href="/track-order" style={footerLinkStyle}>
            Track Order
          </a>
          <a href="/size-guide" style={footerLinkStyle}>
            Size Guide
          </a>
          <a href="/contact" style={footerLinkStyle}>
            Contact Us
          </a>
        </nav>

        {/* Connect */}
        <div className="footer-card">
          <div style={footerColHead}>CONNECT</div>
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="footer-social-link"
              style={iconLinkStyle}
            >
              {socialIcons.instagram}
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="footer-social-link"
              style={iconLinkStyle}
            >
              {socialIcons.facebook}
            </a>
            <a
              href="https://youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              className="footer-social-link"
              style={iconLinkStyle}
            >
              {socialIcons.youtube}
            </a>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="footer-bottom">
        <div className="footer-trust-row" aria-label="Payment and delivery partners">
          <span className="trust-pill">Visa</span>
          <span className="trust-pill">Mastercard</span>
          <span className="trust-pill">bKash</span>
          <span className="trust-pill">Nagad</span>
          <span className="trust-pill">RedX</span>
          <span className="trust-pill">Pathao</span>
          <span className="trust-pill">Steadfast</span>
          <span className="trust-pill">Paperfly</span>
        </div>

        <div className="footer-legal">
          <a href="/privacy" style={bottomLink}>
            Privacy Policy
          </a>
          <span className="sep">|</span>
          <a href="/terms" style={bottomLink}>
            Terms &amp; Conditions
          </a>
        </div>

        <div style={{ fontSize: ".9em", opacity: 0.62, marginBottom: 14, letterSpacing: ".08em" }}>
          © {year} THE DNA LAB STORE. All rights reserved.
        </div>

        <div className="footer-lang">
          <LanguageSwitcher />
        </div>
      </div>

      <style>{`
        .footer-grid-wrap{
          display:grid;
          grid-template-columns: 1.15fr .95fr .95fr .75fr;
          gap: 24px;
          padding: 0 22px 18px 22px;
          align-items:start;
          max-width: 1400px;
          margin: 0 auto;
        }
        .footer-card{
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(216,207,174,0.10);
          border-radius: 18px;
          padding: 18px 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.14);
          min-width: 0;
        }

        .footer-bottom{
          text-align:center;
          color:#C9B15D;
          border-top: 1px solid rgba(216,207,174,0.20);
          padding: 16px 18px 14px 18px;
          letter-spacing: .10em;
          background: rgba(25,32,59,0.88);
          display:flex;
          flex-direction:column;
          align-items:center;
          gap: 10px;
        }

        .footer-trust-row{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          justify-content:center;
          opacity:0.75;
          font-size:.92em;
          max-width: 980px;
        }
        .trust-pill{
          border:1px solid rgba(201,177,93,0.25);
          padding:4px 8px;
          border-radius:8px;
          background: rgba(201,177,93,0.04);
          color: #E9D99F;
          letter-spacing: .08em;
        }

        .footer-legal{
          display:flex;
          gap: 14px;
          flex-wrap:wrap;
          justify-content:center;
          font-size:.95em;
          opacity:0.78;
          margin-top: 2px;
        }
        .footer-legal .sep{
          color:#C9B15D;
          opacity:0.45;
        }

        .footer-lang{
          width:100%;
          display:flex;
          justify-content:flex-end;
          align-items:center;
          max-width: 1400px;
        }

        .footer-social-link {
          border-radius: 999px;
          border: 2px solid #C9B15D;
          background: transparent;
          color: #C9B15D !important;
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.16s, transform 0.17s, box-shadow 0.17s;
        }
        .footer-social-link svg {
          width: 24px !important;
          height: 24px !important;
          transition: opacity 0.16s;
        }
        .footer-social-link:hover,
        .footer-social-link:focus {
          background: #C9B15D;
          color: #171e2c !important;
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(201,177,93,.18);
        }

        /* Tablet */
        @media (max-width: 1024px) {
          .footer-grid-wrap{
            grid-template-columns: 1fr 1fr;
            padding: 0 16px 16px 16px;
            gap: 16px;
          }
          .footer-lang{
            justify-content:center;
          }
        }

        /* Phone */
        @media (max-width: 640px) {
          .footer-grid-wrap{
            grid-template-columns: 1fr;
            padding: 0 12px 14px 12px;
          }
          .footer-card{ padding: 16px 14px; border-radius: 16px; }
          .footer-social-link { width: 40px; height: 40px; }
          .footer-social-link svg { width: 22px !important; height: 22px !important; }
          .footer-bottom{ padding: 14px 12px 12px 12px; }
          .footer-lang{ justify-content:center; }
        }

        /* Very small phones */
        @media (max-width: 380px) {
          .footer-legal{ gap: 10px; }
          .trust-pill{ font-size: .90em; }
        }
      `}</style>
    </footer>
  );
}
