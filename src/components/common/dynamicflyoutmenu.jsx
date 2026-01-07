import DynamicFlyoutMenu from "./dynamicflyoutmenu";

// ...rest above unchanged

function MenuItems({ items, menuWidth, depth, flyoutPath, setFlyoutPath, closeMenu, tiers, tierSlug, parentOption }) {
  // ...remove useState/useEffect from here!

  return (
    <div
      style={{
        position: depth ? "absolute" : "static",
        left: depth ? "99%" : 0,
        top: 0,
        minWidth: depth ? 235 : undefined,
        background: depth ? "#faf9f5" : undefined,
        borderRadius: depth ? 19 : undefined,
        border: depth ? "1.5px solid #e4eaf1" : undefined,
        boxShadow: depth ? "0 8px 38px 0 #bfc9d033, 0 1.5px 7px #d4dfe63a" : undefined,
        zIndex: 200 + depth,
        padding: depth ? "12px 0" : 0,
        display: "flex",
        flexDirection: "column",
        marginLeft: depth ? 5 : 0,
        backgroundClip: "padding-box"
      }}
    >
      {items.map((cat, i) => {
        const hasChildren = depth === 0 || depth === 1;
        const catColor = getCategoryColor(cat.label, tiers);
        let baseColor = "#386079";
        if (catColor && cat.label.replace(/\s\(.+\)/, "").trim().toLowerCase() === "signature series") baseColor = "#7B2326";
        const thisPath = [...flyoutPath.slice(0, depth), i];
        const isFlyoutOpen = flyoutPath.length > depth && flyoutPath[depth] === i;

        return (
          <div
            key={cat.id || i}
            style={{ position: "relative", width: "100%" }}
            onMouseLeave={() => {
              if (flyoutPath.length > depth && flyoutPath[depth] === i) {
                setFlyoutPath(flyoutPath.slice(0, depth));
              }
            }}
          >
            <a
              href={cat.href}
              tabIndex={0}
              className="luxecat-link"
              style={{
                position: "relative",
                padding: menuWidth < 400
                  ? "14px 6vw 11px 6vw"
                  : "18px 42px 14px 42px",
                fontFamily: "'Playfair Display', 'Georgia', serif",
                fontWeight: 400,
                fontSize: menuWidth < 400 ? "1.03rem" : "1.18rem",
                color: baseColor,
                letterSpacing: "0.14em",
                textDecoration: "none",
                borderBottom: depth === 0 ? "1.13px solid #e4eaf1" : "none",
                background: "rgba(250,252,255,0.94)",
                borderLeft: "0px solid transparent",
                borderRadius: 12,
                marginLeft: 0,
                marginRight: 7,
                marginBottom: 3,
                boxShadow: "none",
                overflow: "hidden",
                transition:
                  "background 0.17s, color 0.17s, letter-spacing 0.17s, box-shadow 0.15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: hasChildren ? "pointer" : "default"
              }}
              onMouseEnter={() => { if (hasChildren) setFlyoutPath(thisPath); }}
              onFocus={() => { if (hasChildren) setFlyoutPath(thisPath); }}
              onClick={e => {
                if (hasChildren) {
                  e.preventDefault();
                  setFlyoutPath(thisPath);
                } else {
                  closeMenu();
                }
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && hasChildren) {
                  setFlyoutPath(thisPath);
                  e.preventDefault();
                }
              }}
              onMouseOver={e => {
                if (catColor) {
                  e.currentTarget.style.background = catColor.bg;
                  e.currentTarget.style.color = catColor.color;
                  e.currentTarget.style.boxShadow = `0 0 0 0 ${catColor.bg}, 0 4px 18px 0 ${catColor.bg}1a`;
                } else {
                  e.currentTarget.style.background = "#e4eaf1";
                  e.currentTarget.style.color = "#18345d";
                  e.currentTarget.style.boxShadow = "none";
                }
                e.currentTarget.style.letterSpacing = "0.22em";
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = "rgba(250,252,255,0.94)";
                e.currentTarget.style.color = baseColor;
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.letterSpacing = "0.14em";
              }}
            >
              <span>{cat.label}</span>
              {hasChildren && (
                <span style={{
                  marginLeft: 15,
                  fontWeight: 800,
                  fontSize: 18,
                  color: catColor ? catColor.color : "#ab9d61",
                  userSelect: "none",
                  transition: "color 0.16s",
                }}>
                  &#8250;
                </span>
              )}
              <span
                style={{
                  display: "block",
                  height: 2,
                  width: "0%",
                  background:
                    catColor
                      ? `linear-gradient(90deg,${catColor.color} 0%, #fffbe1 100%)`
                      : "linear-gradient(90deg,#f3f8fd 0%, #e4eaf1 60%, #f7fbff 100%)",
                  borderRadius: 2,
                  position: "absolute",
                  left: menuWidth < 400 ? "5vw" : 34,
                  bottom: 5,
                }}
                className="luxecat-underline"
              />
            </a>
            {hasChildren && isFlyoutOpen && (
              depth === 0 ? (
                <MenuItems
                  items={LEVEL2_OPTIONS}
                  menuWidth={menuWidth}
                  depth={depth + 1}
                  flyoutPath={flyoutPath}
                  setFlyoutPath={setFlyoutPath}
                  closeMenu={closeMenu}
                  tiers={tiers}
                  tierSlug={cat.slug}
                />
              ) : depth === 1 ? (
                <DynamicFlyoutMenu
                  tierSlug={tierSlug}
                  optionType={cat.type}
                  optionSlug={cat.slug}
                  menuWidth={menuWidth}
                  flyoutPath={flyoutPath}
                  setFlyoutPath={setFlyoutPath}
                  closeMenu={closeMenu}
                  tiers={tiers}
                  depth={depth + 1}
                />
              ) : null
            )}
          </div>
        );
      })}
    </div>
  );
}
