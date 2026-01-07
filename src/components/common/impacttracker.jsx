// /src/components/common/impacttracker.jsx
import React, { useEffect, useRef, useState } from "react";

// Hardcoded fallback data for all metrics
const HARDCODED_METRICS = {
  trees: {
    value: 1250,
    label: "Trees Planted",
    icon: "/img/icon-tree.png",
    unit: "",
    tooltip: "We plant a tree for every 5 garments sold.",
  },
  water: {
    value: 275000,
    label: "Liters Water Saved",
    icon: "/img/icon-water.png",
    unit: "L",
    tooltip: "Sustainable dyeing saves over 10,000L water per batch.",
  },
  schools: {
    value: 6,
    label: "Schools Helped",
    icon: "/img/icon-school.png",
    unit: "",
    tooltip: "Your purchases fund uniforms for underprivileged students.",
  },
  children: {
    value: 175,
    label: "Children Impacted",
    icon: "/img/icon-child.png",
    unit: "",
    tooltip: "We support nutrition and education for local children.",
  },
  energy: {
    value: 9500,
    label: "kWh Energy Saved",
    icon: "/img/icon-energy.png",
    unit: "kWh",
    tooltip: "We use solar and efficient production to lower our footprint.",
  },
  co2: {
    value: 28,
    label: "Tons CO₂ Reduced",
    icon: "/img/icon-co2.png",
    unit: "T",
    tooltip: "Reduced through sustainable logistics & packaging.",
  },
  families: {
    value: 32,
    label: "Families Supported",
    icon: "/img/icon-family.png",
    unit: "",
    tooltip: "Every order supports workers’ families in Bangladesh.",
  },
  garments: {
    value: 6600,
    label: "Garments Made",
    icon: "/img/icon-shirt.png",
    unit: "",
    tooltip: "Produced with premium, sustainable materials.",
  },
};

// Utility for tooltips (Strapi or fallback)
function getTooltip(key, strapiTooltip) {
  return strapiTooltip || HARDCODED_METRICS[key]?.tooltip || "";
}

// Animation on scroll helper
function useInView(ref, offset = 0) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (rect.top + offset < window.innerHeight && rect.bottom > 0) {
        setInView(true);
      }
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [ref, offset]);
  return inView;
}

// Animated number hook
function useAnimatedNumber(target, start, animate) {
  const [val, setVal] = React.useState(start);
  useEffect(() => {
    if (!animate) {
      setVal(target);
      return;
    }
    let frame, startTime, initial = start;
    function step(ts) {
      if (!startTime) startTime = ts;
      let progress = Math.min((ts - startTime) / 1100, 1);
      let eased = initial + (target - initial) * (1 - Math.pow(1 - progress, 2));
      setVal(Math.round(eased));
      if (progress < 1) frame = requestAnimationFrame(step);
      else setVal(target);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, animate, start]);
  return val;
}

// Real-time polling for latest impact data
async function fetchImpact(apiBase = "", fallback = {}) {
  try {
    const res = await fetch(
      `${apiBase || process.env.NEXT_PUBLIC_STRAPI_API_URL || "http://localhost:1337"}/api/impact-tracker`
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    // Return attributes or empty object if not present
    return data?.data?.attributes || fallback;
  } catch {
    return fallback;
  }
}

// Tooltip UI (uses Tailwind for smoothness)
function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative cursor-pointer"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      tabIndex={0}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute z-50 w-52 bg-black text-white text-xs rounded-md px-3 py-2 left-1/2 -translate-x-1/2 bottom-full mb-3 shadow-xl opacity-90 pointer-events-none transition duration-300">
          {text}
        </span>
      )}
    </span>
  );
}

export default function ImpactTracker({
  impact: impactFromProps = null,
  apiBase = "",
  pollInterval = 30, // seconds; set 0 for no real-time update
}) {
  // Use fallback hardcoded if nothing from Strapi
  const [impact, setImpact] = useState(
    impactFromProps && Object.keys(impactFromProps).length
      ? impactFromProps
      : Object.fromEntries(
          Object.entries(HARDCODED_METRICS).map(([k, v]) => [k, v.value])
        )
  );

  // Real-time updates
  useEffect(() => {
    let interval;
    if (pollInterval > 0) {
      interval = setInterval(async () => {
        const latest = await fetchImpact(apiBase, impact);
        if (Object.keys(latest).length) setImpact(latest);
      }, pollInterval * 1000);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, [apiBase, pollInterval]);

  // Detect metrics: show all HARDCODED_METRICS keys, but prefer dynamic values
  const impactKeys = Object.keys(HARDCODED_METRICS).slice(0, 8);

  // For scroll-triggered animation
  const ref = useRef();
  const inView = useInView(ref, -40);

  return (
    <section
      ref={ref}
      className="w-full mx-auto bg-gradient-to-br from-green-50 via-amber-50 to-blue-50 border border-green-200 rounded-2xl shadow-xl p-7 md:p-10"
      aria-label="Impact Metrics"
    >
      <div className="mb-7 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold text-green-900 tracking-tight mb-1">
          Every Purchase Makes an Impact
        </h2>
        <p className="text-base md:text-lg text-green-700 font-medium">
          Our community drives positive change — here’s what <span className="font-bold text-green-800">you</span> made possible:
        </p>
      </div>
      <div
        className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-${Math.min(
          4,
          impactKeys.length
        )} gap-5 md:gap-7 lg:gap-10 justify-center items-center`}
      >
        {impactKeys.map((key, idx) => {
          const strapiVal =
            impact && typeof impact[key] === "number" && impact[key] > 0
              ? impact[key]
              : null;
          const fallback = HARDCODED_METRICS[key] || {};
          const val = strapiVal !== null ? strapiVal : fallback.value;
          const animatedVal = useAnimatedNumber(val, 0, inView);

          // Strapi tooltip support: expects impact[`${key}_tooltip`] (or fallback)
          const strapiTooltip =
            (impact && impact[`${key}_tooltip`]) || fallback.tooltip;
          const tooltip = getTooltip(key, strapiTooltip);

          const label =
            (impact && impact[`${key}_label`]) ||
            fallback.label ||
            key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
          const icon =
            (impact && impact[`${key}_icon`]) || fallback.icon || "/img/icon-impact.png";
          const unit =
            (impact && impact[`${key}_unit`]) ||
            fallback.unit ||
            "";

          return (
            <Tooltip text={tooltip} key={key}>
              <div
                className={`flex flex-col items-center bg-white/90 rounded-xl border border-green-100 shadow-sm px-3 py-4 transition-all group hover:scale-105 focus-within:scale-105 outline-none`}
                tabIndex={0}
                aria-label={label}
              >
                <img
                  src={icon}
                  alt={label}
                  className="h-10 w-10 mb-2 object-contain"
                  loading="lazy"
                  style={{ filter: "drop-shadow(0 2px 6px #e5fbe5)" }}
                />
                <span className="font-black text-2xl md:text-3xl text-green-900 mb-0.5">
                  {animatedVal.toLocaleString()}
                  {unit && (
                    <span className="font-bold text-green-700 text-base ml-1">
                      {unit}
                    </span>
                  )}
                </span>
                <span className="text-xs md:text-sm font-semibold text-green-700 text-center leading-tight">
                  {label}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="text-center mt-6 text-green-900/90 text-sm md:text-base">
        <span>
          Learn more about our mission&nbsp;
          <a
            href="/about/impact"
            className="underline text-green-700 font-bold hover:text-green-900 transition"
            tabIndex={0}
          >
            here
          </a>
          .
        </span>
      </div>
    </section>
  );
}
