import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const socialImageAlt =
  "SmolNotes — an experiment in local writing and generative motion";

export const socialImageSize = {
  width: 1200,
  height: 630,
};

export const socialImageContentType = "image/png";

export async function createSocialImage() {
  const spaceMono = await readFile(
    join(process.cwd(), "assets/SpaceMono-Regular.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#000000",
          padding: "80px",
          fontFamily: "Space Mono",
        }}
      >
        <div style={{ display: "flex", fontSize: 48, color: "#e8e8e8" }}>
          SmolNotes
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 26,
            color: "#6e6e6e",
            maxWidth: 860,
            lineHeight: 1.5,
          }}
        >
          An experiment in local writing and generative motion, powered by a
          small language model running entirely in your browser. Nothing leaves
          your machine.
        </div>
      </div>
    ),
    {
      ...socialImageSize,
      fonts: [
        {
          name: "Space Mono",
          data: spaceMono,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}
