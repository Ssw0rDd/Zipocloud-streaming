import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZiPo",
    short_name: "ZiPo",
    description: "Filmes, séries e animes em uma experiência rápida e responsiva.",
    start_url: "/pt",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "any",
    categories: ["entertainment", "video"],
    icons: [
      {
        src: "/zipo-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/zipo-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Filmes", url: "/pt/explore/movie" },
      { name: "Séries", url: "/pt/explore/series" },
      { name: "Animes", url: "/pt/explore/anime" },
      { name: "Buscar", url: "/pt/search" },
    ],
  };
}
