"use client";
import React, { useEffect, useState, useRef } from "react";
import Button from "./button";

// Map group to button data (variant, text, link)
const groupToButton = {
  men: { text: "Shop Men", variant: "men", link: "/shop/men" },
  women: { text: "Shop Women", variant: "women", link: "/shop/women" },
  kids: { text: "Shop Kids", variant: "kids", link: "/shop/kids" },
  young: { text: "Shop Young", variant: "young", link: "/shop/young" },
  shop: { text: "Shop Now", variant: "shop", link: "/shop/all" },
};

function getButtonData(group) {
  return groupToButton[group?.toLowerCase()] || groupToButton["shop"];
}

export default function HighlightCards() {
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scroll, setScroll] = useState(0);
  const carouselRef = useRef(null);

  useEffect(() => {
    async function fetchHighlights() {
      setLoading(true);
      try {
        // NOTE: Update your endpoint as needed
        const res = await fetch("/api/highlights?populate=*");
        const { data } = await res.json();
        if (Array.isArray(data)) {
          setHighlights(
            data.map((h) => ({
              id: h.id,
              title: h.attributes?.title,
              description: h.attributes?.description,
              image: h.attributes?.image?.data?.attributes?.url
                ? (process.env.NEXT_PUBLIC_STRAPI_URL || "") +
                  h.attributes.image.data.attributes.url
                : "",
              group: h.attributes?.group || "shop",
              price: h.attributes?.price, // <-- Must come from Strapi as a number
            }))
          );
        }
      } catch (err) {
        setHighlights([]);
      } finally {
        setLoading(false);
      }
    }
    fetchHighlights();
  }, []);

  // Carousel animation logic for mobile
  useEffect(() => {
    if (highlights.length <= 1) return;
    const interval = setInterval(() => {
      setScroll((s) => (s + 1) % highlights.length);
    }, 3800);
    return () => clearInterval(interval);
  }, [highlights.length]);

  if (loading) return null;
  if (!Array.isArray(highlights) || highlights.length === 0) return null;

  // Responsive: stack on mobile, carousel on tablet/desktop if more than 1
  const isMobile = typeof window !== "undefined" && window.innerWidth < 650;

  return (
    <section
      style={{
        width: "100%",
        maxWidth: 1300,
        margin: "2.7rem auto 2.2rem auto",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        ref={carouselRef}
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "2.4rem",
          transition: "transform 0.8s cubic-bezier(.67,.03,.29,1)",
          transform:
            highlights.length > 1 && isMobile
              ? `translateX(-${scroll * 92}vw)`
              : "none",
          willChange: "transform",
        }}
      >
        {highlights.map((hl, i) => {
          const buttonData = getButtonData(hl.group);
          return (
            <div
              key={hl.id || i}
              style={{
                minWidth: isMobile ? "90vw" : 320,
                maxWidth: 420,
                background: "linear-gradient(120deg,#FAF9F6 60%, #F3EEE6 100%)",
                borderRadius: 22,
                boxShadow:
                  "0 8px 36px 0 rgba(200,170,80,0.10), 0 2px 7px 0 rgba(43,43,57,0.07)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: isMobile
                  ? "2em 1em 1.3em 1em"
                  : "2.5em 1.7em 1.8em 1.7em",
                margin: isMobile ? "0 auto" : "unset",
                minHeight: 320,
                cursor: "pointer",
                position: "relative",
                transition: "box-shadow .24s",
              }}
              onClick={() => {
                window.location.href = buttonData.link;
              }}
            >
              {hl.image && (
                <img
                  src={hl.image}
                  alt={hl.title}
                  style={{
                    width: 108,
                    height: 108,
                    objectFit: "contain",
                    borderRadius: "50%",
                    marginBottom: 28,
                    background: "#F5F5EF",
                    boxShadow: "0 3px 22px #C9B15D22",
                  }}
                />
              )}
              <h3
                style={{
                  fontWeight: 800,
                  fontSize: isMobile ? "1.15rem" : "1.29rem",
                  margin: "0 0 0.55em 0",
                  color: "#23314d",
                  letterSpacing: "0.011em",
                }}
              >
                {hl.title}
              </h3>
              <div
                style={{
                  color: "#58585A",
                  fontSize: isMobile ? "0.99em" : "1.10em",
                  textAlign: "center",
                  minHeight: 65,
                  marginBottom: "0.7em",
                }}
              >
                {hl.description}
              </div>
              {/* --- BDT Price --- */}
              {(typeof hl.price === "number" || typeof hl.price === "string") && hl.price !== "" && (
                <div
                  style={{
                    color: "#C9B15D",
                    fontWeight: 800,
                    fontSize: isMobile ? "1.09em" : "1.18em",
                    marginBottom: "0.6em",
                    letterSpacing: "0.01em",
                    textShadow: "0 1px 6px #C9B15D22",
                  }}
                >
                  ৳{Number(hl.price).toLocaleString("en-BD")}
                </div>
              )}
              <Button
                variant={buttonData.variant}
                href={buttonData.link}
                style={{
                  marginTop: 18,
                  marginBottom: 0,
                  width: "auto",
                  minWidth: 110,
                  fontSize: isMobile ? "0.97rem" : "1.13rem",
                  letterSpacing: ".11em",
                  padding: ".5em 1.9em",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = buttonData.link;
                }}
              >
                {buttonData.text}
              </Button>
            </div>
          );
        })}
      </div>
      {/* Carousel controls for mobile */}
      {isMobile && highlights.length > 1 && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 8,
            zIndex: 9,
          }}
        >
          {highlights.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: idx === scroll ? "#C9B15D" : "#D5D0C2",
                opacity: idx === scroll ? 0.85 : 0.45,
                transition: "background 0.2s, opacity 0.15s",
                cursor: "pointer",
              }}
              onClick={() => setScroll(idx)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
