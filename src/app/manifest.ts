import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Kill Bill - Control de Gastos",
        short_name: "Kill Bill",
        description: "La forma más fácil de dividir gastos en pareja.",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a", // Matches dark theme bg
        theme_color: "#0a0a0a",
        icons: [
            {
                src: "/icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "/icon-512x512.png",
                sizes: "512x512",
                type: "image/png",
            },
        ],
    };
}
