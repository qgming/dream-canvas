package app

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

const canvasUpscaleNodeType = "upscale:media"

func canvasNodeDefaultPrompt(nodeType string, input *generationInput) error {
	if nodeType != canvasUpscaleNodeType { return nil }
	if !includes([]string{"image", "video"}, input.Capability) { return problem(400, "invalid_upscale_model", "超分节点仅支持图片或视频模型") }
	if strings.TrimSpace(input.Prompt) != "" { return nil }
	input.Prompt = "Upscale the source image to the selected target resolution. Reduce noise and compression artifacts and recover natural fine textures while preserving its original subjects and identities, composition, geometry, aspect ratio, colors, lighting, style, text and logos. Keep faces and small details faithful to the source. Avoid invented details, oversharpening, halos and excessive smoothing. Do not add, remove or redesign content."
	if input.Capability == "video" { input.Prompt = "Upscale the source video to the selected target resolution. Reduce noise and compression artifacts and recover natural fine textures while preserving its original subjects and identities, composition, geometry, aspect ratio, colors, lighting, style, text and logos. Keep faces and small details faithful to the source. Maintain temporal consistency between frames; avoid flicker, jitter and changing textures. Preserve the original motion, camera movement, timing, frame rate, duration and audio. Avoid invented details, oversharpening, halos and excessive smoothing. Do not add, remove or redesign content." }
	parameters := map[string]any{}
	if len(input.Parameters) > 0 { if err := json.Unmarshal(input.Parameters, &parameters); err != nil { return err } }
	if resolution := strings.TrimSpace(text(parameters["resolution"])); resolution != "" && !strings.EqualFold(resolution, "auto") { input.Prompt += "\nTarget output resolution: "+strings.ToUpper(resolution)+". Produce the enhanced result at this target resolution, not a copy at the source resolution." }
	if quality := strings.TrimSpace(text(parameters["quality"])); quality != "" && !strings.EqualFold(quality, "auto") { input.Prompt += "\nRequested output quality: "+quality+"." }
	return nil
}

func canvasUpscaleImageSize(controls []parameterControl, parameters map[string]any, width, height int) error {
	for _, control := range controls {
		if !includes([]string{"size", "ratio"}, control.Key) || !parameterVisible(control, parameters) { continue }
		best, distance := "", math.Inf(1)
		for _, option := range append(append([]parameterOption{}, control.Options...), control.Suggestions...) {
			value := text(option.Value)
			left, right, ratio := strings.Cut(value, ":"); if !ratio { continue }
			ratioWidth, widthErr := strconv.ParseFloat(left, 64); ratioHeight, heightErr := strconv.ParseFloat(right, 64)
			if widthErr != nil || heightErr != nil || ratioWidth <= 0 || ratioHeight <= 0 || math.IsNaN(ratioWidth) || math.IsNaN(ratioHeight) || math.IsInf(ratioWidth, 0) || math.IsInf(ratioHeight, 0) || validateParameterValue(control, value) != nil { continue }
			if width <= 0 || height <= 0 { return problem(400, "upscale_source_dimensions_missing", "源图片缺少原始宽高，无法自动匹配超分比例，请重新上传图片") }
			difference := math.Abs(math.Log((ratioWidth/ratioHeight)/(float64(width)/float64(height))))
			if difference < distance { best, distance = value, difference }
		}
		if best != "" { parameters[control.Key] = best }
	}
	return nil
}

func validateCanvasUpscaleSource(nodeType string, input generationInput) error {
	if nodeType != canvasUpscaleNodeType { return nil }
	if len(input.References) != 1 || input.References[0].Role != input.Capability { return problem(400, "invalid_upscale_source", "超分节点需要一份与所选模型匹配的图片或视频源素材") }
	return nil
}
