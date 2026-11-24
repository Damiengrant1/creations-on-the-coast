export default function manifest() {
  return {
    name: "Creations on the Coast",
    short_name: "Coast POS",
    description: "Creations on the Coast business management system",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1ea",
    theme_color: "#12324a",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
