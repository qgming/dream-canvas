package app

import "strings"

const canvasUpscaleNodeType = "upscale:media"

func canvasNodeDefaultPrompt(nodeType string, input *generationInput) error {
	if nodeType != canvasUpscaleNodeType { return nil }
	if !includes([]string{"image", "video"}, input.Capability) { return problem(400, "invalid_upscale_model", "超分节点仅支持图片或视频模型") }
	if strings.TrimSpace(input.Prompt) != "" { return nil }
	input.Prompt = "Upscale the source image to the selected target resolution. Restore fine details while preserving its original composition, aspect ratio, subjects, colors and style. Do not add, remove or redesign content."
	if input.Capability == "video" { input.Prompt = "Upscale the source video to the selected target resolution. Enhance fine details while preserving its original composition, aspect ratio, subjects, motion, timing, audio and style. Do not add, remove or redesign content." }
	return nil
}

func validateCanvasUpscaleSource(nodeType string, input generationInput) error {
	if nodeType != canvasUpscaleNodeType { return nil }
	if len(input.References) != 1 || input.References[0].Role != input.Capability { return problem(400, "invalid_upscale_source", "超分节点需要一份与所选模型匹配的图片或视频源素材") }
	return nil
}
