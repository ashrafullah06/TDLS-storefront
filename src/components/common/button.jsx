"use client";
import React from "react";

// Utility to merge base and variant styles
function mergeStyles(...styles) {
  return Object.assign({}, ...styles);
}

// Softer gradients for a more premium look
const variants = {
  men: {
    background: "linear-gradient(98deg, #2a3550 0%, #889bcb 100%)",
    borderColor: "#C7CFDA",
    color: "#F7F8FF"
  },
  women: {
    background: "linear-gradient(97deg, #cba4b8 0%, #ecd6e7 100%)",
    borderColor: "#E8BFE7",
    color: "#fff"
  },
  kids: {
    background: "linear-gradient(97deg, #B2D561 2%, #F3E288 98%)",
    borderColor: "#E5E3C3",
    color: "#23292F"
  },
  young: {
    background: "linear-gradient(97deg, #7DD9DB 0%, #7B87C7 98%)",
    borderColor: "#B7DEF2",
    color: "#fff"
  },
  shop: {
    background: "linear-gradient(97deg, #222428 0%, #eedfb2 100%)",
    borderColor: "#F1DDA2",
    color: "#222428"
  },
  disabled: {
    background: "#F0EFEA",
    borderColor: "#b9b4a6",
    color: "#999",
    cursor: "not-allowed"
  }
};

// Softer, less shiny hover
const hoverVariants = {
  men: {
    background: "linear-gradient(97deg, #445580 0%, #a4b4df 100%)",
    borderColor: "#B8C6EA"
  },
  women: {
    background: "linear-gradient(97deg, #E5BCD2 0%, #f6eaf4 100%)",
    borderColor: "#E8BFE7"
  },
  kids: {
    background: "linear-gradient(97deg, #d5e6a3 2%, #FFF7B1 98%)",
    borderColor: "#D6D88C"
  },
  young: {
    background: "linear-gradient(97deg, #afe2e6 0%, #b9bbe2 98%)",
    borderColor: "#B7DEF2"
  },
  shop: {
    background: "linear-gradient(97deg, #322C19 0%, #ffefc1 100%)",
    borderColor: "#F1DDA2"
  }
};

const baseStyle = {
  all: "unset",
  boxSizing: "border-box",
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 112,
  maxWidth: 320,
  padding: "0.7rem 1.45rem",
  borderRadius: "9999px",
  fontFamily: "'Playfair Display', 'Merriweather', serif",
  fontWeight: 600,
  fontSize: "1.04rem",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  transition: "background 0.18s, border 0.18s, color 0.18s, box-shadow 0.19s, transform 0.15s",
  cursor: "pointer",
  overflow: "hidden",
  margin: "0 auto",
  marginBottom: "1rem",
  marginTop: "0.2rem",
  width: "100%",
  outline: "2px solid #C9B15D",   // focus visible for a11y
  outlineOffset: "2px",
  touchAction: "manipulation",
  userSelect: "none",
  boxShadow: "0 2px 8px #C9B15D19"
};

function Button({
  type = "button",
  variant = "shop", // 'men', 'women', 'kids', 'young', 'shop'
  href,
  children,
  onClick,
  disabled = false,
  style = {},
  className = "",
  ...props
}) {
  const isLink = !!href && !disabled;

  // Set actual style
  const mainStyle = mergeStyles(
    baseStyle,
    variants[disabled ? "disabled" : variant] || variants.shop,
    style
  );

  // For hover/focus effects, apply with JS for inline CSS (for accessibility)
  const handleHover = (e) => {
    if (disabled) return;
    const hv = hoverVariants[variant] || hoverVariants.shop;
    e.currentTarget.style.background = hv.background;
    e.currentTarget.style.borderColor = hv.borderColor;
  };
  const handleOut = (e) => {
    if (disabled) return;
    const bs = variants[variant] || variants.shop;
    e.currentTarget.style.background = bs.background;
    e.currentTarget.style.borderColor = bs.borderColor;
  };

  // Use <a> if href given, else <button>
  const buttonContent = (
    <span
      style={{
        position: "relative",
        zIndex: 2,
        textAlign: "center",
        width: "100%",
        display: "block",
        textShadow: "0 1.5px 6px #0001",
        lineHeight: 1.3
      }}
    >
      {children}
    </span>
  );

  if (isLink) {
    return (
      <a
        href={href}
        tabIndex={0}
        role="button"
        aria-disabled={disabled}
        className={className}
        style={mainStyle}
        onMouseOver={handleHover}
        onFocus={handleHover}
        onMouseOut={handleOut}
        onBlur={handleOut}
        {...props}
      >
        {buttonContent}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={className}
      style={mainStyle}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      onMouseOver={handleHover}
      onFocus={handleHover}
      onMouseOut={handleOut}
      onBlur={handleOut}
      {...props}
    >
      {buttonContent}
    </button>
  );
}

export default Button;
