import React, { useState } from "react";
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
    } catch (err) {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  const handleGoogleSignup = () => {
    try {
      if (typeof window !== "undefined") {
        signIn && signIn("google", { callbackUrl: "/" });
      }
    } catch (err) {
      setError("Google sign-in isn't available right now.");
    }
  };

  if (submitted)
    return (
      <div role="status" aria-live="polite"
        style={{
          color: "#C9B15D",
          background: "rgba(201,177,93,0.08)",
          border: "1px solid #c9b15d33",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: "0.98em",
          letterSpacing: ".02em",
        }}
      >
        You’re in! We’ll keep you posted.
      </div>
    );

  return (
    <form onSubmit={handleSubmit} aria-describedby="newsletter-help">
      <div
        id="newsletter-help"
        style={{
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          color: "#C9B15D",
          letterSpacing: ".08em",
          marginBottom: 8,
          fontSize: "1.05em",
        }}
      >
        Join our newsletter
      </div>
      <div style={{ display: "flex" }}>
        <input
          id="newsletter-contact"
          type="text"
          placeholder="Email address or mobile number"
          value={contact}
          onChange={e => setContact(e.target.value)}
          style={{
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            padding: "11px 13px",
            border: "none",
            borderRadius: "6px 0 0 6px",
            fontSize: "1em",
            outline: error ? "2px solid #a23232" : "none",
            background: "#232c40",
            color: "#d8dbe6",
            width: "100%",
            boxShadow: error ? "0 2px 8px #a2323236" : "none",
            transition: "outline .18s, border .18s, box-shadow .18s"
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "newsletter-error" : undefined}
          disabled={loading}
          autoComplete="email"
        />
        <button
          type="submit"
          disabled={loading || !contact}
          style={{
            border: "none",
            borderRadius: "0 6px 6px 0",
            padding: "11px 20px",
            fontFamily: "'Playfair Display', serif",
            fontWeight: 700,
            fontSize: "1.05em",
            letterSpacing: ".08em",
            background: loading ? "#b3a469" : "#C9B15D",
            color: "#1e253b",
            cursor: loading || !contact ? "not-allowed" : "pointer",
            opacity: loading || !contact ? 0.7 : 1,
            boxShadow: loading ? "0 0 8px #c9b15d50" : "none",
            transition: "background 0.18s, opacity 0.18s, box-shadow 0.16s"
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
          gap: 8,
          background: "#fff",
          color: "#353434",
          border: "1.5px solid #c9b15d",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: "1em",
          padding: "8px 17px 8px 13px",
          cursor: "pointer",
          boxShadow: "0 2px 8px #c9b15d28",
          transition: "background 0.16s, color 0.16s"
        }}
        aria-label="Sign up with Google"
      >
        <img src="/logos/google-icon.svg" alt="" style={{ width: 22, height: 22, marginRight: 6 }} />
        Sign up with Google
      </button>
      {error && (
        <span id="newsletter-error" role="alert"
          style={{
            color: "#d66969",
            fontWeight: 500,
            fontSize: "0.96em",
            marginLeft: 2,
            letterSpacing: ".01em"
          }}
        >
          {error}
        </span>
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
    <form onSubmit={onSubmit} style={{ display: "flex", marginTop: 6 }}>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Order code"
        aria-label="Order tracking code"
        style={{
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          padding: "10px 12px",
          border: "1px solid #c9b15d44",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          fontSize: "0.96em",
          background: "#232c40",
          color: "#d8dbe6",
          outline: "none",
          minWidth: 140
        }}
      />
      <button
        type="submit"
        style={{
          border: "1px solid #c9b15d44",
          borderRadius: "0 6px 6px 0",
          padding: "10px 12px",
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          fontSize: "0.96em",
          letterSpacing: ".06em",
          background: "#C9B15D",
          color: "#1e253b",
          cursor: code ? "pointer" : "not-allowed",
          opacity: code ? 1 : .7
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
        x="48" y="48" width="352" height="352" rx="105" fill="none" stroke="currentColor" strokeWidth="32"/>
      <circle cx="224" cy="224" r="80" fill="none" stroke="currentColor" strokeWidth="32"/>
      <circle cx="330" cy="118" r="18" fill="currentColor"/>
    </svg>
  ),
  facebook: (
    <svg width="26" height="26" viewBox="0 0 320 512" fill="currentColor" aria-hidden="true">
      <path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.57-50.06 52.83-50.06h40.87V6.26S265.43 0 225.36 0c-73.22 0-121.09 44.38-121.09 124.72v70.62H22.89V288h81.38v224h100.2V288z"/>
    </svg>
  ),
  linkedin: (
    <svg width="26" height="26" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
      <path d="M100.28 448H7.4V148.9h92.88zm-46.44-340a53.66 53.66 0 1 1 0-107.32 53.66 53.66 0 0 1 0 107.32zM447.9 448h-92.36V302.4c0-34.7-.7-79.3-48.3-79.3-48.3 0-55.7 37.7-55.7 76.7V448h-92.4V148.9h88.7v40.8h1.3c12.3-23.3 42.4-48 87.1-48 93.2 0 110.4 61.3 110.4 141.1z"/>
    </svg>
  ),
  youtube: (
    <svg width="26" height="26" viewBox="0 0 576 512" fill="currentColor" aria-hidden="true">
      <path d="M549.65 124.08c-6.28-23.65-24.78-42.15-48.43-48.43C458.76 64 288 64 288 64S117.24 64 74.78 75.65c-23.65 6.28-42.15 24.78-48.43 48.43C14.7 166.54 14.7 256 14.7 256s0 89.46 11.65 131.92c6.28 23.65 24.78 42.15 48.43 48.43C117.24 448 288 448 288 448s170.76 0 213.22-11.65c23.65-6.28 42.15-24.78 48.43-48.43C561.3 345.46 561.3 256 561.3 256s0-89.46-11.65-131.92zM232 338.5v-165l142 82.5z"/>
    </svg>
  ),
  pinterest: (
    <svg width="26" height="26" viewBox="0 0 496 512" fill="currentColor" aria-hidden="true">
      <path d="M248 8C111 8 0 119 0 256c0 98 57 182 139 223-2-19-4-49 1-70 4-17 28-118 28-118s-7-15-7-37c0-34 20-59 45-59 21 0 32 16 32 35 0 22-14 54-22 84-6 25 13 45 38 45 46 0 81-49 81-120 0-63-45-107-109-107-74 0-118 55-118 116 0 23 9 47 20 60 2 2 2 4 2 7-1 8-7 27-8 31-1 3-3 4-6 2-24-9-39-36-39-73 0-53 45-117 134-117 71 0 118 51 118 112 0 72-40 126-98 126-19 0-37-10-43-21l-12 45c-5 18-17 40-25 54 18 5 37 8 57 8 137 0 248-111 248-248S385 8 248 8z"/>
    </svg>
  )
};

const footerLinkStyle = {
  color: "#F4F1E4",
  textDecoration: "none",
  fontSize: ".98em",
  letterSpacing: ".07em",
  opacity: 0.9
};

const footerColHead = {
  fontFamily: "'Playfair Display', serif",
  fontWeight: 700,
  letterSpacing: ".17em",
  marginBottom: 6,
  color: "#C9B15D"
};

const iconLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 42,
  height: 42
};

export default function Footer() {
  return (
    <footer
      style={{
        background: "linear-gradient(180deg, #11162b 0%, #0e1428 100%)",
        color: "#F4F1E4",
        borderTop: "1px solid #d8cfae33",
        paddingTop: "40px",
      }}
      aria-label="Footer"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr .9fr .9fr 1fr",
          gap: "28px",
          padding: "1.2em 2.2em 0.8em 2.2em",
          alignItems: "start",
          maxWidth: 1400,
          margin: "0 auto"
        }}
      >
        {/* Brand + newsletter */}
        <div style={{ minWidth: 240 }}>
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontWeight: 800,
              letterSpacing: ".22em",
              color: "#C9B15D",
              fontSize: "1.25em",
              marginBottom: 4
            }}
          >
            TDLC — THE DNA LAB STORE
          </div>
          <div
            style={{
              color: "#d8dbe6",
              opacity: 0.86,
              fontSize: "0.98em",
              letterSpacing: ".03em",
              marginBottom: 14
            }}
          >
            Premium essentials designed for Dhaka humidity & global standards.
          </div>
          <div style={{
            background: "linear-gradient(180deg, rgba(201,177,93,0.07), rgba(201,177,93,0.02))",
            borderRadius: 10,
            boxShadow: "0 2px 16px #0002, 0 1px 0 #baa05412",
            padding: "22px 18px 16px 18px",
            border: "1.1px solid #c9b15d25"
          }}>
            <NewsletterFooterForm />
          </div>
        </div>

        {/* Contact */}
        <nav style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minWidth: 220
        }}>
          <div style={footerColHead}>CONTACT</div>
          <a href="mailto:support@thednalabstore.com" style={footerLinkStyle}>support@thednalabstore.com</a>
          <div style={{ marginTop: 6, fontSize: ".96em", opacity: .85 }}>
            Track your order quickly:
          </div>
          <QuickTrackForm />
        </nav>

        {/* Customer Care */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 120 }}>
          <div style={footerColHead}>CUSTOMER CARE</div>
          <a href="/help" style={footerLinkStyle}>Help / FAQ</a>
          <a href="/shipping" style={footerLinkStyle}>Shipping &amp; Returns</a>
          <a href="/track-order" style={footerLinkStyle}>Track Order</a>
          <a href="/payment" style={footerLinkStyle}>Payment Methods</a>
          <a href="/size-guide" style={footerLinkStyle}>Size Guide</a>
          <a href="/contact" style={footerLinkStyle}>Contact Us</a>
        </nav>

        {/* About + Connect */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          minWidth: 120
        }}>
          <div style={footerColHead}>ABOUT</div>
          <a href="/our-story" style={footerLinkStyle}>Our Story</a>
          <a href="/sustainability" style={footerLinkStyle}>Sustainability</a>
          <a href="/press" style={footerLinkStyle}>Press</a>
          <a href="/careers" style={footerLinkStyle}>Careers</a>
          <a href="/affiliates" style={footerLinkStyle}>Affiliates</a>
          <a href="/corporate" style={footerLinkStyle}>Corporate Info</a>
          <div style={{ margin: "16px 0 0 0", letterSpacing: ".16em", fontSize: "1.01em", color: "#C9B15D" }}>
            CONNECT
          </div>
          <div style={{ display: "flex", gap: 18, margin: "7px 0 0 0" }}>
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="footer-social-link" style={iconLinkStyle}>{socialIcons.instagram}</a>
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="footer-social-link" style={iconLinkStyle}>{socialIcons.facebook}</a>
            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="footer-social-link" style={iconLinkStyle}>{socialIcons.linkedin}</a>
            <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="footer-social-link" style={iconLinkStyle}>{socialIcons.youtube}</a>
            <a href="https://pinterest.com" target="_blank" rel="noopener noreferrer" aria-label="Pinterest" className="footer-social-link" style={iconLinkStyle}>{socialIcons.pinterest}</a>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        textAlign: "center",
        fontSize: "1em",
        color: "#C9B15D",
        borderTop: "1px solid #d8cfae33",
        padding: "1.1em 2.2em 0.8em 2.2em",
        letterSpacing: ".13em",
        background: "rgba(25,32,59,0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative"
      }}>
        {/* Trust row */}
        <div style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "center",
          marginBottom: 12,
          opacity: 0.72,
          fontSize: ".92em"
        }}>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Visa</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Mastercard</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>bKash</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Nagad</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>RedX</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Pathao</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Steadfast</span>
          <span style={{ border: "1px solid #c9b15d33", padding: "4px 8px", borderRadius: 6 }}>Paperfly</span>
        </div>
        <div style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          justifyContent: "center",
          fontSize: ".96em",
          opacity: 0.74,
          marginBottom: 20
        }}>
          <a href="/privacy" style={bottomLink}>Privacy Policy</a>
          <span style={{ color: "#C9B15D", opacity: 0.53 }}>|</span>
          <a href="/terms" style={bottomLink}>Terms & Conditions</a>
          <span style={{ color: "#C9B15D", opacity: 0.53 }}>|</span>
          <a href="/cookies" style={bottomLink}>Cookie Policy</a>
          <span style={{ color: "#C9B15D", opacity: 0.53 }}>|</span>
          <a href="/accessibility" style={bottomLink}>Accessibility</a>
          <span style={{ color: "#C9B15D", opacity: 0.53 }}>|</span>
          <a href="/sitemap" style={bottomLink}>Site Map</a>
        </div>

        <div style={{ fontSize: ".9em", opacity: 0.6, marginBottom: 14 }}>
          © {new Date().getFullYear()} THE DNA LAB STORE. All rights reserved.
        </div>

        <div style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",        
        }}>
            <LanguageSwitcher />
        </div>
      </div>
      <style>{`
        .footer-social-link {
          border-radius: 50%;
          border: 2px solid #C9B15D;
          background: none;
          color: #C9B15D !important;
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0;
          transition: background 0.16s, border 0.16s, transform 0.17s, box-shadow 0.17s;
        }
        .footer-social-link svg {
          width: 26px !important;
          height: 26px !important;
          stroke: currentColor !important;
          transition: stroke 0.2s;
        }
        .footer-social-link:hover,
        .footer-social-link:focus {
          background: #C9B15D;
          color: #171e2c !important;
          border: 2px solid #C9B15D;
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(201,177,93,.18);
        }

        @media (max-width: 1024px) {
          footer > div:first-child {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 640px) {
          footer > div:first-child {
            grid-template-columns: 1fr;
          }
          .footer-social-link { width: 38px; height: 38px; }
          .footer-social-link svg { width: 22px !important; height: 22px !important; }
        }
        @media (max-width: 540px) {
          footer > div {
            padding: 1.2em 0.7em 0.8em 0.7em !important;
          }
        }
        @media (max-width: 430px) {
          footer > div {
            padding: 0.9em 0.2em 0.2em 0.2em !important;
          }
          .footer-social-link { width: 36px; height: 36px; }
          .footer-social-link svg { width: 20px !important; height: 20px !important; }
        }
      `}</style>
    </footer>
  );
}

const bottomLink = {
  color: "#C9B15D",
  textDecoration: "none",
  opacity: 0.9
};
