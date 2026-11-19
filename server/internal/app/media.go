package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
)

type limitedBuffer struct { bytes.Buffer; limit int64 }
func (b *limitedBuffer) Write(data []byte) (int, error) { if int64(b.Len())+int64(len(data)) > b.limit { return 0, errors.New("media metadata exceeds JSON limit") }; return b.Buffer.Write(data) }

// ffprobe and ffmpeg receive fixed arguments and a validated local asset path, never shell text.
func (a *App) probeMedia(ctx context.Context, asset *Asset, policy executionPolicy) {
	if asset.Kind != "video" && asset.Kind != "audio" { return }
	if asset.MimeType == "audio/pcm" { asset.ProbeError = "无头 PCM 的采样率与声道信息未核实，原件保留，请下载后按接口格式读取"; return }
	probe, err := exec.LookPath("ffprobe"); if err != nil { asset.ProbeError = "服务器未安装 ffprobe，时长与编码信息尚未核实"; return }
	name, err := a.assetOriginalPath(*asset); if err != nil { asset.ProbeError = "原件路径无法读取"; return }
	// Upload/result writers already hold their transfer slot and file lease. Do not
	// acquire a second file gate while holding that lease (cleanup uses the same gates).
	a.previewMu.Lock(); defer a.previewMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, seconds(policy.QuerySeconds)); defer cancel()
	output := &limitedBuffer{limit: policy.JSONBytes}
	command := exec.CommandContext(ctx, probe, "-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json", name)
	command.Stdout, command.Stderr = output, io.Discard
	var info struct { Format struct { Duration string `json:"duration"` } `json:"format"`; Streams []struct { Type string `json:"codec_type"`; Codec string `json:"codec_name"`; Width int `json:"width"`; Height int `json:"height"`; Rate string `json:"avg_frame_rate"` } `json:"streams"` }
	if command.Run() != nil || json.Unmarshal(output.Bytes(), &info) != nil { asset.ProbeError = "媒体信息读取失败或超出运行边界，原件仍保留"; return }
	if duration, ok := decimalValue(info.Format.Duration); ok { if value := scaledInteger(duration, 1000); value != nil { asset.DurationMS = *value } }
	for _, stream := range info.Streams { if stream.Type == "video" && asset.VideoCodec == "" { asset.Width, asset.Height, asset.VideoCodec, asset.FPS = stream.Width, stream.Height, stream.Codec, stream.Rate }; if stream.Type == "audio" && asset.AudioCodec == "" { asset.AudioCodec = stream.Codec } }
	asset.ProbeError = ""
}

func videoPreview(ctx context.Context, source, target string) error {
	program, err := exec.LookPath("ffmpeg"); if err != nil { return errors.New("服务器未安装 ffmpeg，原件仍保留") }
	command := exec.CommandContext(ctx, program, "-nostdin", "-v", "error", "-protocol_whitelist", "file", "-i", source, "-frames:v", "1", "-an", "-vf", "scale=768:768:force_original_aspect_ratio=decrease", "-f", "image2", "-c:v", "png", "-y", target)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if err := command.Run(); err != nil { return errors.New("视频封面提取失败或超出运行时限，原件仍保留") }
	file, err := os.OpenFile(target, os.O_RDWR, 0600); if err != nil { return err }; defer file.Close(); return file.Sync()
}

func materialControls(controls []parameterControl, parameters map[string]any, reference assetInput) []parameterControl {
	named, connected := []parameterControl{}, []parameterControl{}
	for _, control := range controls {
		if !parameterVisible(control, parameters) { continue }
		if control.Role != reference.Role { continue }
		if control.Type == "asset" && parameters[control.Key] == reference.AssetID { named = append(named, control) }
		if control.Type == "reference" { connected = append(connected, control) }
	}
	if len(named) > 0 { return named }; return connected
}

func (a *App) validateReferenceMedia(snapshot executionSnapshot, input generationInput, userID string) error {
	var controls []parameterControl
	if err := json.Unmarshal(snapshot.Model.Parameters, &controls); err != nil { return err }
	parameters := map[string]any{}; if err := json.Unmarshal(input.Parameters, &parameters); err != nil { return err }
	declared := map[string]bool{}
	for _, control := range controls {
		if !parameterVisible(control, parameters) { continue }
		if control.Type != "reference" && control.Type != "asset" { continue }
		declared[control.Role] = true
		count := 0
		for _, reference := range input.References {
			if reference.Role != control.Role || control.Type == "asset" && reference.AssetID != parameters[control.Key] { continue }
			if control.Type == "reference" { named := false; for _, other := range controls { if other.Type == "asset" && other.Role == reference.Role && parameters[other.Key] == reference.AssetID { named = true } }; if named { continue } }
			count++
			var asset Asset; if err := a.db.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", reference.AssetID, userID, "saved", "").Error; err != nil { return problem(400, "invalid_asset", "参考素材不存在、已删除或尚未保存") }
			invalid := func(reason string) error { return problem(400, "invalid_reference_media", control.Label+"："+asset.Title+"，"+reason+"；请调整原件后重新上传") }
			if len(control.MimeTypes) > 0 { allowed := false; for _, kind := range control.MimeTypes { if asset.MimeType == kind || strings.HasSuffix(kind, "/*") && strings.HasPrefix(asset.MimeType, strings.TrimSuffix(kind, "*")) { allowed = true } }; if !allowed { return invalid("格式不符合模型要求") } }
			if control.MaxBytes > 0 && asset.Bytes > control.MaxBytes { return invalid("文件超过模型大小限制") }
			if control.MinWidth > 0 && asset.Width < control.MinWidth || control.MaxWidth > 0 && asset.Width > control.MaxWidth || control.MinHeight > 0 && asset.Height < control.MinHeight || control.MaxHeight > 0 && asset.Height > control.MaxHeight { return invalid("尺寸不符合模型要求") }
			if control.MinDurationMS > 0 || control.MaxDurationMS > 0 { if asset.ProbeError != "" || asset.DurationMS <= 0 { return invalid("时长尚未核实，请在服务器安装 ffprobe 后重新上传") }; if asset.DurationMS < control.MinDurationMS || control.MaxDurationMS > 0 && asset.DurationMS > control.MaxDurationMS { return invalid("时长不符合模型要求") } }
		}
		minimum := control.MinCount; if control.Required && minimum == 0 { minimum = 1 }
		if count < minimum || control.MaxCount != nil && count > *control.MaxCount { return problem(400, "invalid_reference_count", "参考素材「"+control.Label+"」的数量不符合模型要求") }
	}
	for _, reference := range input.References { allowed := false; for _, control := range controls { if parameterVisible(control, parameters) && control.Role == reference.Role && (control.Type == "reference" || control.Type == "asset" && parameters[control.Key] == reference.AssetID) { allowed = true } }; if !declared[reference.Role] || !allowed { return problem(400, "undeclared_reference", "当前模型或模式未声明该类型素材") } }
	return nil
}
