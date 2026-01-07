
import React from "react";
import Link from "next/link";
import PropTypes from "prop-types";
import classNames from "classnames";

const NavButton = ({ label, href = "#", onClick, badge }) => {
  return (
    <Link href={href} legacyBehavior>
      <a
        onClick={onClick}
        className={classNames(
          "inline-flex items-center justify-center px-4 py-2 m-1 rounded-full text-sm font-medium transition-colors duration-200",
          "bg-white hover:bg-neutral-100 text-deep-navy shadow-sm border border-neutral-200",
          { "cursor-pointer": !!onClick }
        )}
      >
        <span>{label}</span>
        {badge && (
          <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-deep-navy text-white">
            {badge}
          </span>
        )}
      </a>
    </Link>
  );
};

NavButton.propTypes = {
  label: PropTypes.string.isRequired,
  href: PropTypes.string,
  onClick: PropTypes.func,
  badge: PropTypes.string
};

export default NavButton;
