import { ImagePlus, Images, Lightbulb, Maximize2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "inspiration",
        icon: Lightbulb,
    },
    {
        slug: "assets",
        icon: Images,
    },
] as const;

