import React from "react";
import Link from "next/link";
import PropTypes from "prop-types";
import classNames from "classnames";

const NavButton = ({ label, href = "#", onClick, badge, className }) => {
  return (
    <Link href={href} legacyBehavior>
      <a
        onClick={onClick}
        className={classNames(
          // Base
          "inline-flex items-center justify-center rounded-full font-medium transition-colors duration-200 select-none",
          "bg-white hover:bg-neutral-100 text-deep-navy shadow-sm border border-neutral-200",
          // Responsive sizing (small screens first)
          "m-0.5 sm:m-1",
          "px-2.5 sm:px-3 md:px-4",
          "py-1.5 sm:py-2",
          "text-[12px] sm:text-sm",
          "min-h-[34px] sm:min-h-[38px]",
          // Prevent overflow on tiny screens
          "max-w-[42vw] sm:max-w-none",
          "truncate",
          // Pointer only when clickable
          { "cursor-pointer": !!onClick },
          className
        )}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <span className="truncate">{label}</span>

        {badge ? (
          <span
            className={classNames(
              "ml-1.5 sm:ml-2 rounded-full font-semibold",
              "bg-deep-navy text-white",
              // Responsive badge sizing
              "px-1.5 sm:px-2",
              "py-0.5",
              "text-[10px] sm:text-xs",
              "leading-none",
              "flex-shrink-0"
            )}
          >
            {badge}
          </span>
        ) : null}
      </a>
    </Link>
  );
};

NavButton.propTypes = {
  label: PropTypes.string.isRequired,
  href: PropTypes.string,
  onClick: PropTypes.func,
  badge: PropTypes.string,
  className: PropTypes.string,
};

export default NavButton;
