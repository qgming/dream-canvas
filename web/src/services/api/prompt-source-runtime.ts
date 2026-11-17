export type RawPrompt = {
    id: string; title: string; prompt: string; description: string; coverUrl: string; referenceImageUrls: string[];
    tags: string[]; preview: string; createdAt: string; updatedAt: string; author?: string; sourceUrl?: string;
    imageMode?: string; imageModel?: string; imageSize?: string; imageCount?: number;
};
