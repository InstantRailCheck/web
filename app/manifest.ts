import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InstantRailCheck",
    short_name: "RailCheck",
    description:
      "Check whether banks and credit unions support RTP, FedNow, ACH, wire transfers, and other payment rails before sending money.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      {
        src: "/favicon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
