// FILE: app/tdls-social-preview/route.js

import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 86400;

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(135deg, #07132d 0%, #0f2147 52%, #111a32 100%)",
          color: "#f7f2df",
          fontFamily: "serif",
        }}
      >
        {/* Subtle top-right gold atmosphere */}
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: 9999,
            top: -250,
            right: -120,
            background:
              "radial-gradient(circle, rgba(201,177,93,0.22) 0%, rgba(201,177,93,0) 70%)",
          }}
        />

        {/* Subtle lower-left atmosphere */}
        <div
          style={{
            position: "absolute",
            width: 450,
            height: 450,
            borderRadius: 9999,
            bottom: -280,
            left: -120,
            background:
              "radial-gradient(circle, rgba(201,177,93,0.14) 0%, rgba(201,177,93,0) 72%)",
          }}
        />

        {/* Fine luxury frame */}
        <div
          style={{
            position: "absolute",
            inset: 34,
            border:
              "1px solid rgba(201,177,93,0.42)",
            borderRadius: 28,
          }}
        />

        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding:
              "74px 92px",
          }}
        >
          {/* TDLS identity */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginBottom: 34,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 102,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing:
                  "0.14em",
                color:
                  "#d2bb69",
              }}
            >
              TDLS
            </div>

            <div
              style={{
                width: 145,
                height: 1,
                display: "flex",
                background:
                  "rgba(210,187,105,0.74)",
                marginTop: 14,
              }}
            />
          </div>

          {/* Main statement */}
          <div
            style={{
              display: "flex",
              maxWidth: 920,
              fontSize: 42,
              lineHeight: 1.22,
              fontWeight: 500,
              letterSpacing:
                "0.025em",
              color:
                "#fffaf0",
            }}
          >
            Refined design meets effortless confidence.
          </div>

          {/* Supporting brand memory */}
          <div
            style={{
              display: "flex",
              maxWidth: 960,
              marginTop: 34,
              fontSize: 24,
              lineHeight: 1.45,
              letterSpacing:
                "0.045em",
              color:
                "#d9cfad",
            }}
          >
            Timeless in character. Effortless in comfort. Unmistakably TDLS.
          </div>

          {/* Quiet emotional signature */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 48,
              fontSize: 17,
              letterSpacing:
                "0.21em",
              textTransform:
                "uppercase",
              color:
                "#c9b15d",
            }}
          >
            <div
              style={{
                width: 42,
                height: 1,
                display: "flex",
                background:
                  "#c9b15d",
              }}
            />

            Wear what stays with you
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
    }
  );
}