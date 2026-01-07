import React, { useEffect, useState } from "react";

function getBangladeshHour() {
  const nowUTC = new Date();
  const nowBD = new Date(nowUTC.getTime() + (6 * 60 * 60 * 1000));
  return nowBD.getHours();
}

export default function ThemeToggle() {
  function shouldNightModeBD() {
    const h = getBangladeshHour();
    return h >= 19 || h < 6;
  }

  const [isNight, setIsNight] = useState(shouldNightModeBD);

  // Live update with BD time
  useEffect(() => {
    const interval = setInterval(() => {
      setIsNight(shouldNightModeBD());
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Set global theme
  useEffect(() => {
    document.documentElement.classList.toggle("night", isNight);
    document.body.classList.toggle("night", isNight);
  }, [isNight]);

  return (
    <button
      onClick={() => setIsNight((prev) => !prev)}
      title={isNight ? "Switch to Day Mode" : "Switch to Night Mode"}
      className="relative w-20 h-11 flex items-center border-0 outline-none focus:ring-2 focus:ring-[#C9B15D] transition-all duration-300"
      style={{
        background: isNight
          ? "linear-gradient(100deg, #151B28 80%, #223048 100%)"
          : "linear-gradient(90deg, #FFF9E1 80%, #E2E6EF 100%)",
        borderRadius: 32,
        boxShadow: isNight
          ? "0 2px 16px #1a183855, 0 0 0 1.5px #C9B15D"
          : "0 2px 16px #f0eadc99, 0 0 0 1.5px #C9B15D",
        border: "2.5px solid #C9B15D",
        overflow: "hidden",
      }}
    >
      {/* Abstract luxury motif (SVG, animates left/right) */}
      <span
        style={{
          position: "absolute",
          left: isNight ? "54%" : "7%",
          top: "9%",
          width: 39,
          height: 39,
          borderRadius: "50%",
          transition: "left 0.36s cubic-bezier(.52,.07,.43,1.05)",
          zIndex: 2,
        }}
      >
        <svg
          width="39"
          height="39"
          viewBox="0 0 39 39"
          fill="none"
          style={{
            display: "block",
            filter: isNight
              ? "drop-shadow(0 0 8px #76A8E355)"
              : "drop-shadow(0 0 6px #F3E8A399)",
            transition: "filter 0.33s",
          }}
        >
          {/* Outer gold ring, always present */}
          <circle
            cx="19.5"
            cy="19.5"
            r="17"
            stroke="#C9B15D"
            strokeWidth="3"
            fill={isNight
              ? "url(#nightInner)" // sapphire fill at night
              : "url(#dayInner)"   // soft gold at day
            }
            style={{
              transition: "fill 0.36s"
            }}
          />
          {/* Abstract "moon arc" appears at night */}
          {isNight && (
            <path
              d="M33 28.5C29.5 33 21.5 34.5 15.5 29.5"
              stroke="#D3AF52"
              strokeWidth="2.3"
              strokeLinecap="round"
              fill="none"
              style={{ filter: "drop-shadow(0 1px 3px #76A8E344)" }}
            />
          )}
          {/* Sapphire orb at night */}
          {isNight && (
            <circle
              cx="26.7"
              cy="24"
              r="5"
              fill="url(#sapphireOrb)"
              stroke="#B1D2F8"
              strokeWidth="1.2"
              style={{ filter: "drop-shadow(0 0 8px #74B7F9AA)" }}
            />
          )}
          {/* Small gold dot at day */}
          {!isNight && (
            <circle
              cx="19.5"
              cy="19.5"
              r="5.2"
              fill="url(#goldDot)"
              stroke="#EAD485"
              strokeWidth="1.3"
              style={{ filter: "drop-shadow(0 0 6px #F8E9B7)" }}
            />
          )}
          <defs>
            <radialGradient id="dayInner" cx="0.5" cy="0.4" r="0.9">
              <stop offset="0%" stopColor="#FFF6D8" />
              <stop offset="100%" stopColor="#F3E4B7" />
            </radialGradient>
            <radialGradient id="nightInner" cx="0.68" cy="0.36" r="0.94">
              <stop offset="0%" stopColor="#294E82" />
              <stop offset="100%" stopColor="#111B2C" />
            </radialGradient>
            <radialGradient id="sapphireOrb" cx="0.5" cy="0.5" r="0.9">
              <stop offset="0%" stopColor="#AEE1FF" />
              <stop offset="50%" stopColor="#3586D6" />
              <stop offset="100%" stopColor="#15305B" />
            </radialGradient>
            <radialGradient id="goldDot" cx="0.43" cy="0.42" r="0.92">
              <stop offset="0%" stopColor="#FFE487" />
              <stop offset="100%" stopColor="#E7C875" />
            </radialGradient>
          </defs>
        </svg>
      </span>
    </button>
  );
}
